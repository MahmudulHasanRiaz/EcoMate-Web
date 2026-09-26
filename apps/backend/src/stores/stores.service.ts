/**
 * Stores service — central-commerce §8.10 + §10 (P1 foundation).
 *
 * Owns: connect / reconnect / disconnect with duplicate protection,
 * write-only credential rotation (AES-256-GCM, masked reads — the
 * `MarketingConnection` pattern), NATIVE provisioning plus the throwing
 * guard (BR-20), and the health probe that populates the §12 state
 * vocabulary. Reads never return secrets (allowlist sanitize).
 *
 * Disconnect never deletes: identity, credential rows, mappings, history
 * and ownership state are retained; status flips to DISCONNECTED and the
 * store's queues stop (queues land in P4+).
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { EncryptionService } from '../common/utils/encryption';
import { identityFingerprint, normaliseDomain } from './store-identity';
import { NATIVE_STORE_KIND, ProviderRegistryService } from './providers/provider-registry.service';
import type { StoreWithSecrets, TestConnectionResult } from './providers/provider.contract';
import {
  ProviderError,
  ProviderErrorCategory,
} from '../marketing/ad-provider.adapter';
import {
  isInstallTimestampFresh,
  verifyShopifyInstallHmac,
} from './providers/webhook-crypto';
import {
  CreateStoreDto,
  RotateStoreCredentialsDto,
  TestConnectionDto,
  UpdateStoreDto,
} from './dto/stores.dto';

function sanitizeStore(store: any) {
  const { ...rest } = store ?? {};
  delete (rest as any).credentials;
  delete (rest as any).credentialsEnc;
  return rest;
}

@Injectable()
export class StoresService {
  private readonly logger = new Logger(StoresService.name);

  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
    private registry: ProviderRegistryService,
  ) {}

  // ── Reads (never secrets) ──────────────────────────────────────────

  async list() {
    const stores = await this.prisma.store.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { credentials: true, healthChecks: true } } },
    });
    return stores.map(sanitizeStore);
  }

  async detail(id: string) {
    const store = await this.requireStore(id);
    return sanitizeStore(store);
  }

  // ── Connect (P1: §8.10 duplicate protection + 409 reconnect payload) ──

  async connect(dto: CreateStoreDto, actorId?: string) {
    if (dto.kind === NATIVE_STORE_KIND) {
      throw new BadRequestException('NATIVE is provisioned, never connected (BR-20)');
    }
    const domainNormalised = normaliseDomain(dto.domain);
    const fingerprint = identityFingerprint({
      kind: dto.kind,
      providerStoreId: dto.providerStoreId,
      domain: domainNormalised,
    });

    const existing = await this.prisma.store.findFirst({
      where: {
        OR: [{ identityFingerprint: fingerprint }, { kind: dto.kind as any, domainNormalised }],
      },
    });
    if (existing) {
      // §8.10: reconnect onto the same row — never a duplicate row.
      throw new ConflictException({
        message: 'This store is already registered. Reconnect to the existing store.',
        code: 'STORE_ALREADY_EXISTS',
        storeId: existing.id,
        storeName: existing.name,
        storeStatus: existing.status,
      });
    }

    const store = await this.prisma.store.create({
      data: {
        kind: dto.kind as any,
        name: dto.name,
        domainNormalised,
        identityFingerprint: fingerprint,
        providerStoreId: dto.providerStoreId,
        status: 'PENDING',
        healthState: 'DISCONNECTED',
      },
    });

    if (dto.credentials && Object.keys(dto.credentials).length > 0) {
      await this.storeCredentialRow(store.id, dto.credentials, actorId);
    }

    this.logger.log(`Store connected: ${store.id} (${store.kind})`);
    return sanitizeStore(store);
  }

  // ── Update (name + settings only; no delete-mode field — BR-09) ──────

  async update(id: string, dto: UpdateStoreDto) {
    const store = await this.requireStore(id);
    if (store.kind === NATIVE_STORE_KIND && dto.autoSyncEnabled !== undefined) {
      throw new BadRequestException('NATIVE store has no sync settings (BR-20)');
    }
    // P9 wizard "Sync configuration" (additive): syncScope/initialSyncPolicy
    // merge into the existing settings JSON — never a wholesale replace of
    // unrelated keys (e.g. baseUrl/mediaProbeUrl written by other flows).
    const prevSettings = ((store.settings as Record<string, unknown> | null) ?? {});
    const wantsSyncConfig =
      dto.settings !== undefined ||
      dto.syncScope !== undefined ||
      dto.initialSyncPolicy !== undefined;
    const nextSettings: Record<string, unknown> | undefined = wantsSyncConfig
      ? {
          ...prevSettings,
          ...((dto.settings as Record<string, unknown> | undefined) ?? {}),
          ...(dto.syncScope !== undefined
            ? {
                syncScope: {
                  ...((prevSettings.syncScope as Record<string, unknown> | undefined) ?? {}),
                  ...dto.syncScope,
                },
              }
            : {}),
          ...(dto.initialSyncPolicy !== undefined
            ? { initialSyncPolicy: dto.initialSyncPolicy }
            : dto.syncScope !== undefined && (prevSettings as Record<string, unknown>).initialSyncPolicy === undefined
              ? { initialSyncPolicy: 'adopt_existing' }
              : {}),
        }
      : undefined;
    const updated = await this.prisma.store.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(nextSettings !== undefined
          ? { settings: nextSettings as unknown as Prisma.InputJsonValue }
          : {}),
        ...(dto.autoSyncEnabled !== undefined ? { autoSyncEnabled: dto.autoSyncEnabled } : {}),
      },
    });
    return sanitizeStore(updated);
  }

  // ── Credentials: write-only rotation ────────────────────────────────

  async rotateCredentials(id: string, dto: RotateStoreCredentialsDto, actorId?: string) {
    await this.requireStore(id);
    const row = await this.storeCredentialRow(id, dto.credentials, actorId);
    // Write-only: acknowledge rotation, never echo the payload.
    return { storeId: id, rotatedAt: row.rotatedAt, keyFingerprint: row.keyFingerprint };
  }

  private async storeCredentialRow(storeId: string, credentials: Record<string, unknown>, actorId?: string) {
    return this.prisma.storeCredential.create({
      data: {
        storeId,
        credentialsEnc: this.encryption.encrypt(JSON.stringify(credentials)),
        keyFingerprint: process.env.LICENSE_ENCRYPTION_KEY ? 'license-key' : 'default-key',
        rotatedById: actorId,
      },
    });
  }

  /** Latest credential payload, decrypted. Server-side only — never returned by reads. */
  async loadSecrets(storeId: string): Promise<Record<string, unknown> | null> {
    const row = await this.prisma.storeCredential.findFirst({
      where: { storeId },
      orderBy: { rotatedAt: 'desc' },
    });
    if (!row) return null;
    try {
      return JSON.parse(this.encryption.decrypt(row.credentialsEnc));
    } catch {
      throw new BadRequestException('Stored credentials cannot be decrypted');
    }
  }

  // ── test-connection / health probe (§12 vocabulary) ─────────────────

  async testConnection(id: string, dto?: TestConnectionDto) {
    const store = await this.requireStore(id);
    const provider = this.registry.providerFor({ kind: store.kind });
    const secrets =
      dto?.credentials ?? ((await this.loadSecrets(id)) as Record<string, unknown> | null) ?? {};
    let result: TestConnectionResult;
    try {
      result = await provider.testConnection({
        id: store.id,
        kind: store.kind,
        settings: (store.settings as Record<string, unknown> | null) ?? {},
        secrets,
      });
    } catch (err) {
      // Adapter-refused connections (bad credentials shape, org mismatch,
      // app not installed) surface as 400 with the actionable message.
      // Messages never carry secrets (stores-secret-leak.spec.ts).
      if (
        err instanceof ProviderError &&
        err.category === ProviderErrorCategory.INVALID_REQUEST
      ) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
    await this.recordHealthCheck(id, {
      state: result.authenticated ? 'HEALTHY' : result.reachable ? 'ATTENTION_REQUIRED' : 'ERROR',
      reason: result.authenticated ? 'ok' : result.reachable ? 'auth_error' : 'store_down',
      reachable: result.reachable,
      authenticated: result.authenticated,
      permissionsOk: result.permissionsOk,
      mediaReachable: result.mediaReachable,
      detail: {
        providerStoreId: result.providerStoreId,
        plugin: result.plugin,
        capabilities: result.capabilities,
      },
    });
    if (result.providerStoreId && !store.providerStoreId) {
      await this.prisma.store.update({
        where: { id },
        data: { providerStoreId: result.providerStoreId },
      });
    }
    // Verified connection completes the wizard: PENDING → CONNECTED on the
    // first authenticated probe. DISCONNECTED is untouched (reconnect flows
    // through PENDING first); health vocabulary stays in healthState.
    if (result.authenticated && (store as any).status === 'PENDING') {
      await this.prisma.store.update({
        where: { id },
        data: { status: 'CONNECTED' as any },
      });
    }
    return result;
  }

  async health(id: string) {
    await this.requireStore(id);
    return this.prisma.storeHealthCheck.findFirst({
      where: { storeId: id },
      orderBy: { checkedAt: 'desc' },
    });
  }

  // ── Reconnect / disconnect (§8.10: identity + history retained) ─────

  async reconnect(id: string, dto: RotateStoreCredentialsDto, actorId?: string) {
    const store = await this.requireStore(id);
    if (store.kind === NATIVE_STORE_KIND) {
      throw new BadRequestException('NATIVE store cannot be reconnected (BR-20)');
    }
    await this.storeCredentialRow(id, dto.credentials, actorId);
    const updated = await this.prisma.store.update({
      where: { id },
      data: { status: 'PENDING', lastError: null },
    });
    this.logger.log(`Store reconnect started: ${id}`);
    return sanitizeStore(updated);
  }

  async disconnect(id: string) {
    const store = await this.requireStore(id);
    if (store.kind === NATIVE_STORE_KIND) {
      throw new BadRequestException('NATIVE store cannot be disconnected (BR-20)');
    }
    // Retains identity, credential rows, mappings, history, ownership state.
    const updated = await this.prisma.store.update({
      where: { id },
      data: { status: 'DISCONNECTED', healthState: 'DISCONNECTED' },
    });
    await this.recordHealthCheck(id, {
      state: 'DISCONNECTED',
      reason: 'disabled',
      reachable: false,
      authenticated: false,
      permissionsOk: false,
    });
    this.logger.log(`Store disconnected: ${id} (rows retained)`);
    return sanitizeStore(updated);
  }

  // ── NATIVE provisioning (BR-20) ─────────────────────────────────────

  async ensureNativeStore(): Promise<Record<string, unknown>> {
    const existing = await this.prisma.store.findFirst({
      where: { kind: 'NATIVE' as any },
    });
    if (existing) return sanitizeStore(existing);
    const created = await this.prisma.store.create({
      data: {
        kind: 'NATIVE' as any,
        name: 'Native Website',
        status: 'CONNECTED',
        healthState: 'HEALTHY',
      },
    });
    return sanitizeStore(created);
  }

  /** Build the provider-facing shape (secrets stay server-side). */
  async storeWithSecrets(id: string): Promise<StoreWithSecrets> {
    const store = await this.requireStore(id);
    return {
      id: store.id,
      kind: store.kind,
      settings: (store.settings as Record<string, unknown> | null) ?? {},
      secrets: await this.loadSecrets(id),
    };
  }

  // ── Internals ───────────────────────────────────────────────────────

  private async requireStore(id: string) {
    const store = await this.prisma.store.findUnique({ where: { id } });
    if (!store) throw new NotFoundException('Store not found');
    return store;
  }

  /**
   * Shopify app-install landing (App URL redirect after merchant install).
   * Resolves the `shop` query param to a connected SHOPIFY store, verifies
   * the HMAC with that store's secret, and returns safe display data.
   * Unknown shop → 404; bad/stale signature → 401 (both generic, no
   * secrets, no query echo).
   */
  async verifyInstallCallback(
    query: Record<string, string | string[] | undefined>,
  ): Promise<{ shop: string; storeId: string; storeName: string }> {
    const first = (v: string | string[] | undefined): string =>
      Array.isArray(v) ? v[0] ?? '' : v ?? '';
    const shop = first(query['shop']);
    const domain = normaliseDomain(shop);
    const store = domain
      ? await this.prisma.store.findFirst({
          where: { kind: 'SHOPIFY' as any, domainNormalised: domain },
        })
      : null;
    if (!store) throw new NotFoundException('Store not found');
    const secrets = (await this.loadSecrets(store.id)) ?? {};
    const secret = String(
      (secrets as any).webhookSecret ?? (secrets as any).clientSecret ?? '',
    );
    if (
      !verifyShopifyInstallHmac(query, secret) ||
      !isInstallTimestampFresh(first(query['timestamp']))
    ) {
      throw new UnauthorizedException('Unauthorized');
    }
    return {
      shop: (store as any).domainNormalised ?? domain ?? '',
      storeId: store.id,
      storeName: (store as any).name ?? '',
    };
  }

  private async recordHealthCheck(
    storeId: string,
    check: {
      state: 'HEALTHY' | 'ATTENTION_REQUIRED' | 'ERROR' | 'DISCONNECTED';
      reason?: string;
      reachable: boolean;
      authenticated: boolean;
      permissionsOk: boolean;
      mediaReachable?: boolean;
      detail?: Record<string, unknown>;
    },
  ) {
    await this.prisma.storeHealthCheck.create({
      data: {
        storeId,
        state: check.state as any,
        reason: check.reason,
        reachable: check.reachable,
        authenticated: check.authenticated,
        permissionsOk: check.permissionsOk,
        mediaReachable: check.mediaReachable,
        detail: check.detail as unknown as Prisma.InputJsonValue,
      },
    });
    await this.prisma.store.update({
      where: { id: storeId },
      data: { healthState: check.state as any, lastHealthCheckAt: new Date() },
    });
  }
}
