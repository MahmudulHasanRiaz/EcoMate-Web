import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from '../common/utils/encryption';
import { verifyRawHmacSha256Hex } from './webhook-verifier';

/**
 * Task 8 (owner-locked hybrid, Steadfast-only): MULTIPLE credential accounts.
 *
 * - Settings hold MANY sets (label + Api-Key/Secret-Key, one default).
 * - Keys are encrypted at rest via EncryptionService (like marketing OAuth
 *   tokens / attendance device credentials) — plaintext CourierCredentials
 *   stays as the legacy single-business fallback and is NEVER written here.
 * - Dispatch stores the booking set id (nullable, null = legacy default).
 * - Tracking/status/balance/returns/payments resolve the set from the
 *   booking record, never the current default.
 * - Webhooks accept ANY configured set (verify with the matching token;
 *   booking record's set tried first via consignment lookup).
 * - NEVER retry-loop 401 across profiles: callers resolve ONE set upfront
 *   and fail fast (the wrong-profile hint tells staff to pick a set).
 *
 * LIMITATION (settlement-blind): the courier-settlement matcher is
 * consignment-only and carries NO credential context — multi-business payout
 * files share one ledger. A payout row matches by consignment/tracking/
 * displayId only; it never records which Steadfast account was booked.
 * See reconciliation/matcher.ts header for the same note.
 */
export interface SteadfastSetMeta {
  id: string;
  label: string;
  isDefault: boolean;
  hasApiKey: boolean;
  hasSecret: boolean;
  hasWebhook: boolean;
  createdAt?: unknown;
}

export interface SteadfastResolvedAuth {
  apiKey: string;
  secretKey: string;
  /** Booking set id, or null when the legacy single row was used. */
  setId: string | null;
  label: string;
  isLegacy: boolean;
}

const STEADFAST = 'steadfast';

function toMeta(row: any): SteadfastSetMeta {
  return {
    id: row.id,
    label: row.label,
    isDefault: !!row.isDefault,
    hasApiKey: !!row.apiKeyEnc,
    hasSecret: !!row.secretKeyEnc,
    hasWebhook: !!row.webhookSecretEnc,
    createdAt: row.createdAt,
  };
}

@Injectable()
export class SteadfastCredentialSetsService {
  private readonly logger = new Logger(SteadfastCredentialSetsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  private get sets(): any {
    return (this.prisma as any).courierCredentialSet;
  }

  /**
   * Run fn inside a $transaction when available (tests may stub a prisma
   * without $transaction — fall back to the plain client). All
   * single-default read-then-write sequences MUST go through here so the
   * check and the writes share one transaction scope.
   */
  private inTx<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    const p = this.prisma as any;
    if (typeof p.$transaction === 'function') return p.$transaction((tx: any) => fn(tx));
    return fn(p);
  }

  private txSets(tx: any): any {
    return (tx as any)?.courierCredentialSet ?? this.sets;
  }

  /**
   * Single-default enforcement inside the tx: clear every OTHER default.
   * updateMany is preferred (one round-trip); older stubs without
   * updateMany fall back to per-row updates.
   */
  private async clearOtherDefaults(sets: any, keepId: string): Promise<void> {
    if (typeof sets.updateMany === 'function') {
      await sets.updateMany({
        where: { courier: STEADFAST, isDefault: true, id: { not: keepId } },
        data: { isDefault: false },
      });
      return;
    }
    const all = (await sets.findMany({ where: { courier: STEADFAST } })) ?? [];
    for (const row of all) {
      if (row.id !== keepId && row.isDefault)
        await sets.update({ where: { id: row.id }, data: { isDefault: false } });
    }
  }

  /** Count dispatches booked with a set (tx-scoped; stub-tolerant). */
  private async countDispatches(tx: any, setId: string): Promise<number> {
    const dispatch = (tx as any)?.dispatch;
    if (!dispatch) return 0;
    if (typeof dispatch.count === 'function')
      return (await dispatch.count({ where: { credentialSetId: setId } })) ?? 0;
    if (typeof dispatch.findMany === 'function') {
      const rows = (await dispatch.findMany({ where: { credentialSetId: setId } })) ?? [];
      return rows.length;
    }
    return 0;
  }

  /** Labels + flags only — keys NEVER leave the server. */
  async listSets(): Promise<SteadfastSetMeta[]> {
    // Hardening (5a): zero/unavailable sets → [], never an unhandled 500.
    // A missing model (legacy DB / unwired provider surface) or a failing
    // query degrades to "no accounts configured" so settings UI renders
    // instead of crashing.
    try {
      const delegate = (this.prisma as any)?.courierCredentialSet;
      if (typeof delegate?.findMany !== 'function') return [];
      const rows =
        (await delegate.findMany({
          where: { courier: STEADFAST },
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        })) ?? [];
      return rows.map(toMeta);
    } catch (err) {
      this.logger.warn(
        `credential-sets list degraded to []: ${(err as Error)?.message}`,
      );
      return [];
    }
  }

  /**
   * Owner-requested reveal (2026-10-31): decrypt one set's stored keys for
   * the settings eye toggle. The list endpoint stays labels/flags-only;
   * values leave the server only through this explicit per-set request,
   * behind the controller's settings @Roles gate.
   */
  async revealSet(
    id: string,
  ): Promise<{ apiKey: string; secretKey: string; webhookSecret: string }> {
    const delegate = (this.prisma as any)?.courierCredentialSet;
    const row =
      typeof delegate?.findUnique === 'function'
        ? await delegate.findUnique({ where: { id } })
        : null;
    if (!row) throw new NotFoundException(`Credential set ${id} not found`);
    return {
      apiKey: row.apiKeyEnc ? this.encryption.decrypt(row.apiKeyEnc) : '',
      secretKey: row.secretKeyEnc ? this.encryption.decrypt(row.secretKeyEnc) : '',
      webhookSecret: row.webhookSecretEnc
        ? this.encryption.decrypt(row.webhookSecretEnc)
        : '',
    };
  }

  async createSet(input: {
    label: string;
    apiKey: string;
    secretKey: string;
    webhookSecret?: string;
    isDefault?: boolean;
  }): Promise<SteadfastSetMeta> {
    const label = String(input.label ?? '').trim();
    if (!label) throw new BadRequestException('Set label is required');
    if (!input.apiKey || !input.secretKey)
      throw new BadRequestException('Api-Key and Secret-Key are required');
    // MEDIUM race fix: check-then-write runs INSIDE one $transaction, and
    // the default-clear happens AFTER the create (not before). Two
    // concurrent first-creates both see "empty", both insert default=true,
    // then each clears the other — last-writer-wins leaves exactly one
    // default instead of two.
    return this.inTx(async (tx) => {
      const sets = this.txSets(tx);
      const existing =
        (await sets.findMany({ where: { courier: STEADFAST } })) ?? [];
      // First set is the default automatically (zero-friction migration).
      const makeDefault = input.isDefault === true || existing.length === 0;
      const row = await sets.create({
        data: {
          courier: STEADFAST,
          label,
          apiKeyEnc: this.encryption.encrypt(input.apiKey),
          secretKeyEnc: this.encryption.encrypt(input.secretKey),
          webhookSecretEnc: input.webhookSecret
            ? this.encryption.encrypt(input.webhookSecret)
            : null,
          isDefault: makeDefault,
        },
      });
      if (makeDefault) await this.clearOtherDefaults(sets, row.id);
      return toMeta(row);
    });
  }

  async updateSet(
    id: string,
    input: {
      label?: string;
      apiKey?: string | null;
      secretKey?: string | null;
      webhookSecret?: string | null;
    },
  ): Promise<SteadfastSetMeta> {
    const row = await this.sets.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Credential set not found');
    const data: Record<string, unknown> = {};
    if (input.label !== undefined) {
      const label = String(input.label).trim();
      if (!label) throw new BadRequestException('Set label is required');
      data['label'] = label;
    }
    // LOW blank-wipe fix: "" is ignored (keep stored value); only an
    // explicit null clears a key. The admin form only sends keys staff
    // actually typed, so a stray "" must never wipe a stored secret.
    if (input.apiKey !== undefined && input.apiKey !== '')
      data['apiKeyEnc'] = input.apiKey ? this.encryption.encrypt(input.apiKey) : null;
    if (input.secretKey !== undefined && input.secretKey !== '')
      data['secretKeyEnc'] = input.secretKey ? this.encryption.encrypt(input.secretKey) : null;
    if (input.webhookSecret !== undefined && input.webhookSecret !== '')
      data['webhookSecretEnc'] = input.webhookSecret
        ? this.encryption.encrypt(input.webhookSecret)
        : null;
    const updated = await this.sets.update({ where: { id }, data });
    return toMeta(updated);
  }

  async deleteSet(id: string): Promise<{ deleted: boolean }> {
    // LOW delete-guard + MEDIUM race fix: the reference check, the delete,
    // and the default-promotion share one $transaction scope.
    return this.inTx(async (tx) => {
      const sets = this.txSets(tx);
      const row = await sets.findUnique({ where: { id } });
      if (!row) throw new NotFoundException('Credential set not found');
      // LOW delete-guard: never orphan booking history — the FK is
      // ON DELETE SET NULL, so deleting a referenced set would silently
      // re-attribute past bookings to the legacy/default profile.
      const refCount = await this.countDispatches(tx, id);
      if (refCount > 0)
        throw new BadRequestException(
          `Cannot delete this account: ${refCount} dispatch(es) were booked with it.`,
        );
      await sets.delete({ where: { id } });
      if (row.isDefault) {
        const rest =
          (await sets.findMany({
            where: { courier: STEADFAST },
            orderBy: { createdAt: 'asc' },
          })) ?? [];
        if (rest.length > 0)
          await sets.update({ where: { id: rest[0].id }, data: { isDefault: true } });
      }
      return { deleted: true };
    });
  }

  async setDefault(id: string): Promise<SteadfastSetMeta> {
    // MEDIUM race fix: the read-then-clear-then-set sequence runs INSIDE one
    // $transaction so two concurrent make-default calls cannot both leave
    // isDefault=true (single-default enforcement is tx-scoped).
    return this.inTx(async (tx) => {
      const sets = this.txSets(tx);
      const row = await sets.findUnique({ where: { id } });
      if (!row) throw new NotFoundException('Credential set not found');
      await this.clearOtherDefaults(sets, id);
      const updated = await sets.update({ where: { id }, data: { isDefault: true } });
      return toMeta(updated);
    });
  }

  /**
   * Set-resolution helper (owner-locked order):
   * order override → dispatch record set → consignment record set → default
   * set → legacy single row. Resolves EXACTLY ONE profile; callers must not
   * fall through to the next profile on 401 (fail fast instead).
   */
  async resolveAuth(opts?: {
    overrideSetId?: string | null;
    dispatchSetId?: string | null;
    consignmentId?: string | null;
  }): Promise<SteadfastResolvedAuth> {
    const singleId = opts?.overrideSetId || opts?.dispatchSetId;
    if (singleId) return this.resolveOne(singleId, 'override');
    if (opts?.consignmentId) {
      const setId = await this.findSetForConsignment(opts.consignmentId);
      if (setId) return this.resolveOne(setId, 'booking');
    }
    const all = (await this.sets.findMany({ where: { courier: STEADFAST } })) ?? [];
    const def = all.find((r: any) => r.isDefault) ?? null;
    if (def) {
      return {
        apiKey: this.encryption.decrypt(def.apiKeyEnc),
        secretKey: this.encryption.decrypt(def.secretKeyEnc),
        setId: def.id,
        label: def.label,
        isLegacy: false,
      };
    }
    // Zero friction for single-business: no sets → legacy single row.
    const creds = await (this.prisma as any).courierCredentials.findUnique({
      where: { courier: STEADFAST },
    });
    if (!creds?.enabled)
      throw new BadRequestException('Steadfast is not configured or disabled');
    const apiKey = creds.apiKey || (creds.credentials as any)?.['apiKey'];
    const secretKey = creds.secretKey || (creds.credentials as any)?.['secretKey'];
    if (!apiKey || !secretKey)
      throw new BadRequestException('Steadfast API key/secret not configured');
    return { apiKey, secretKey, setId: null, label: 'Default', isLegacy: true };
  }

  private async resolveOne(setId: string, kind: string): Promise<SteadfastResolvedAuth> {
    const row = await this.sets.findUnique({ where: { id: setId } });
    if (!row)
      throw new BadRequestException(
        `Steadfast credential set not found (${kind}) — wrong profile? Pick the set from settings.`,
      );
    if (!row.apiKeyEnc || !row.secretKeyEnc)
      throw new BadRequestException(
        `Steadfast set '${row.label}' has no keys configured — wrong profile?`,
      );
    return {
      apiKey: this.encryption.decrypt(row.apiKeyEnc),
      secretKey: this.encryption.decrypt(row.secretKeyEnc),
      setId: row.id,
      label: row.label,
      isLegacy: false,
    };
  }

  /** Booking record's set id for a consignment (null = legacy/default). */
  async findSetForConsignment(consignmentId: string): Promise<string | null> {
    if (!consignmentId) return null;
    const dispatch = await (this.prisma as any).dispatch?.findFirst?.({
      where: { consignmentId },
      select: { credentialSetId: true },
    });
    const setId = (dispatch as any)?.credentialSetId;
    return typeof setId === 'string' && setId ? setId : null;
  }

  /** True when the order picker must show (>1 configured). */
  async isMultiSet(): Promise<boolean> {
    const all = (await this.sets.findMany({ where: { courier: STEADFAST } })) ?? [];
    return all.length > 1;
  }

  /** 401 hint: with several profiles a 401 usually means the wrong set. */
  async wrongProfileHint(): Promise<string> {
    return (await this.isMultiSet())
      ? ' (multiple Steadfast profiles configured — wrong profile? Pick the matching account.)'
      : '';
  }

  /**
   * Webhook multi-set verify: the booking record's set is tried first
   * (consignment lookup or explicit preferred id), then every other
   * configured set, then legacy. Constant-time compare per candidate;
   * tokens never logged.
   */
  async verifyWebhook(
    rawBody: string,
    signature: unknown,
    preferredSetId?: string | null,
  ): Promise<{ matched: boolean; setId: string | null }> {
    const candidates: { setId: string | null; secret: string }[] = [];
    const all = (await this.sets.findMany({ where: { courier: STEADFAST } })) ?? [];
    const ordered = [...all].sort((a: any, b: any) =>
      a.id === preferredSetId ? -1 : b.id === preferredSetId ? 1 : 0,
    );
    for (const row of ordered) {
      if (!row.webhookSecretEnc) continue;
      try {
        candidates.push({ setId: row.id, secret: this.encryption.decrypt(row.webhookSecretEnc) });
      } catch {
        continue;
      }
    }
    const legacy = await (this.prisma as any).courierCredentials
      .findUnique({ where: { courier: STEADFAST } })
      .catch(() => null);
    const legacySecret = (legacy as any)?.webhookSecret?.trim?.();
    if (legacySecret) candidates.push({ setId: null, secret: legacySecret });
    for (const c of candidates) {
      try {
        verifyRawHmacSha256Hex(rawBody, signature, c.secret);
        return { matched: true, setId: c.setId };
      } catch {
        continue;
      }
    }
    return { matched: false, setId: null };
  }
}
