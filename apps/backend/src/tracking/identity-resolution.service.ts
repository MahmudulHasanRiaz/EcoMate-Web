import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TrackingSettingsService } from './tracking-settings.service';
import { TrackingNormalizer } from './tracking.normalizer';

/** Settings/env gate (Wave-2.1, Candidate B). Default OFF → zero behavior change. */
const EXTERNAL_ID_SETTING = 'tracking_customer_external_id';
const EXTERNAL_ID_ENV = 'TRACKING_CUSTOMER_EXTERNAL_ID';

/** Wave-2.3 Advanced Matching gate. Default OFF → browser init stays parameterless. */
const ADVANCED_MATCHING_SETTING = 'tracking_advanced_matching';
const ADVANCED_MATCHING_ENV = 'TRACKING_ADVANCED_MATCHING';

/**
 * IdentityResolutionService (Wave-2.1, Candidate B) — the single authoritative
 * component that resolves a customer's stable `external_id` for every channel
 * (Web, Admin, POS, Public API, Mobile). All channels capture through
 * `TrackingCaptureService` → `TrackingDispatcherService`, so injecting this
 * service into the dispatcher gives one resolution path platform-wide.
 *
 * Design (architect-corrected): **identity-binding, not rewriting.** The
 * customer key is resolved at dispatch time from `order.customerId →
 * CustomerProfile.externalId`; existing `TrackingContext.externalId` rows
 * (per-journey UUIDs) are never rewritten. This preserves replay consistency
 * and historical attribution, and stays fully reversible via the feature flag.
 *
 * The model is future-compatible with customer merge/split: a future merge only
 * reassigns `CustomerProfile.externalId`, and every channel follows via this
 * resolver.
 */
@Injectable()
export class IdentityResolutionService {
  private readonly logger = new Logger(IdentityResolutionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: TrackingSettingsService,
  ) {}

  async isEnabled(): Promise<boolean> {
    return this.settings.isEnabledOrDefault(
      EXTERNAL_ID_SETTING,
      false,
      EXTERNAL_ID_ENV,
    );
  }

  /**
   * Lazily assign a stable external_id to a customer (idempotent). Runs inside a
   * caller-supplied transaction when provided; otherwise its own read+write.
   * A concurrent ensure is absorbed by the unique constraint (P2002 → re-read).
   */
  async ensureForCustomer(
    customerId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<string | null> {
    const client = tx ?? this.prisma;
    const row = await client.customerProfile.findUnique({
      where: { id: customerId },
      select: { externalId: true },
    });
    if (!row) return null;
    if (row.externalId) return row.externalId;

    const externalId = crypto.randomUUID();
    try {
      const updated = await client.customerProfile.update({
        where: { id: customerId },
        data: { externalId },
        select: { externalId: true },
      });
      return updated.externalId;
    } catch (err) {
      if ((err as { code?: string })?.code === 'P2002') {
        const winner = await client.customerProfile.findUnique({
          where: { id: customerId },
          select: { externalId: true },
        });
        return winner?.externalId ?? null;
      }
      this.logger.warn(`Failed to assign external_id for customer ${customerId}: ${err}`);
      return null;
    }
  }

  /**
   * Shopper-facing resolution for the browser Pixel (Wave-2.1). Given the Better
   * Auth user id from the storefront session, return the customer's stable
   * external_id — the correct source for browser AM (NOT /auth/me, which is the
   * admin UserProfile). Flag-gated: off or no linked CustomerProfile → the
   * browser keeps the (parameterless) init. No context rows are rewritten.
   */
  async resolveForShopper(
    betterAuthUserId: string,
  ): Promise<string | null> {
    if (!(await this.isEnabled())) return null;
    const profile = await this.prisma.customerProfile.findFirst({
      where: { betterAuthUserId },
      select: { id: true },
    });
    if (!profile) return null;
    return this.ensureForCustomer(profile.id);
  }

  /**
   * Wave-2.3 hashed contact keys for the browser Pixel's Advanced Matching.
   * Returns the customer's hashed email/phone for the Pixel init — only when
   * `tracking_advanced_matching` is ON and the session is linked to a
   * CustomerProfile. The storefront calls this ONLY after the visitor granted
   * consent (the `/tracking/config` contract), so the server flag is the
   * default-off guard and client gating enforces consent. Hashing lives in
   * TrackingNormalizer so browser hashes match server-side hashes exactly.
   * No context rows are written; when off or unlinked → `{}` (parameterless).
   */
  async resolveAdvancedMatching(
    betterAuthUserId: string,
  ): Promise<{ em?: string; ph?: string }> {
    const enabled = await this.settings.isEnabledOrDefault(
      ADVANCED_MATCHING_SETTING,
      false,
      ADVANCED_MATCHING_ENV,
    );
    if (!enabled) return {};
    const profile = await this.prisma.customerProfile.findFirst({
      where: { betterAuthUserId },
      select: { email: true, phone: true },
    });
    if (!profile) return {};
    const normalizer = new TrackingNormalizer();
    return {
      ...(profile.email ? { em: normalizer.hashEmail(profile.email) } : {}),
      ...(profile.phone ? { ph: normalizer.hashPhone(profile.phone, 'BD') } : {}),
    };
  }

  /**
   * Authoritative external_id for an order-bound event (identity-binding at
   * dispatch). Flag ON + a known customer → the customer's stable external_id;
   * otherwise the caller-provided journey uuid (guests/anonymous unchanged).
   * No TrackingContext rows are rewritten. `customerId` is read from the
   * canonical snapshot payload (added at capture for order events).
   */
  async resolveForOrder(
    customerId: string | undefined | null,
    ctxExternalId: string | undefined | null,
  ): Promise<string | undefined> {
    if (!(await this.isEnabled())) return ctxExternalId ?? undefined;
    if (customerId) {
      const ext = await this.ensureForCustomer(customerId);
      if (ext) return ext;
    }
    return ctxExternalId ?? undefined;
  }
}
