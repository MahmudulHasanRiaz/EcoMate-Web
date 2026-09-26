/**
 * Product sync engine — central-commerce §8.3 + §8.8 + §8.11 (P4).
 *
 * Per (store, product, field): batched `readProductFields` (ONE call per
 * product per sync) → `FieldOwnershipService.evaluate` → push only
 * EcoMate-changed fields. NO push over drifted external (BR-02/BR-03);
 * PRESERVE cases surface ownership + externalHash and are resolvable ONLY
 * through the audited override workflow (BR-04/BR-26 — no implicit
 * resolution anywhere in this file).
 *
 * Read-only on Product rows: sync never writes Product/Variant/Category.
 */
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { ProviderRegistryService } from '../providers/provider-registry.service';
import { FieldOwnershipService } from '../distribution/field-ownership.service';
import { DistributionService } from '../distribution/distribution.service';
import { StoresService } from '../stores.service';
import { hashFieldValue } from '../providers/field-snapshot';
import { FIELD_MATRIX, matrixRowFor, readEcoMateFields, assertSyncedFieldsSubset } from './field-matrix';
import { classifyProviderError, RETRY_BACKOFF_MS, MAX_SYNC_ATTEMPTS } from '../providers/retry-classifier';
import { SyncRunService } from './sync-run.service';
import { CategorySyncService } from './category-sync.service';
import type { FieldSnapshot } from '../providers/provider.contract';

export const SYNC_FANOUT_CONCURRENCY_DEFAULT = 5;

function sha(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

@Injectable()
export class ProductSyncService {
  private readonly logger = new Logger(ProductSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ProviderRegistryService,
    private readonly ownership: FieldOwnershipService,
    private readonly distribution: DistributionService,
    private readonly runs: SyncRunService,
    private readonly categories: CategorySyncService,
    private readonly stores?: StoresService,
  ) {}

  // ── Single-product sync (the ownership engine) ──────────────────────

  async syncProduct(storeId: string, productId: string, runId: string): Promise<{ pushed: string[]; preserved: string[]; skipped: string[] }> {
    const started = Date.now();
    const store = await this.requireStore(storeId);
    if (store.kind === 'NATIVE') throw new BadRequestException('NATIVE is never a sync target (BR-20)');
    const provider = this.registry.providerFor(store);
    assertSyncedFieldsSubset(provider.slug, (provider as any).syncedFields ?? []);
    const storeWithSecrets = await this.storeWithSecrets(store);
    const product = await this.loadProduct(productId);
    if (!product) throw new NotFoundException('Product not found');

    const pushed: string[] = [];
    const preserved: string[] = [];
    const skipped: string[] = [];

    // BR-22: combos skipped with explicit reason, never fabricated.
    if (product.type === 'combo') {
      await this.runs.recordItem(runId, {
        storeId, productId, objectType: 'PRODUCT', status: 'SKIPPED',
        reason: 'COMBO_SKIPPED: combos are not representable by phase-1 providers (BR-22)',
        auditLevel: 'G', durationMs: Date.now() - started,
      });
      await this.runs.upsertIssue({
        storeId, code: 'COMBO_SKIPPED', objectType: 'PRODUCT',
        objectKey: `product:${productId}`, productId,
        message: 'Combo skipped: not representable by this provider (BR-22). Publish its components instead.',
      });
      return { pushed, preserved, skipped: ['combo'] };
    }

    // SKU gate (Table B rows 4-6): no SKU → blocked + MISSING_SKU.
    if (!product.sku) {      await this.runs.recordItem(runId, {
        storeId, productId, objectType: 'PRODUCT', status: 'SKIPPED',
        reason: 'MISSING_SKU: a product without an SKU cannot be distributed',
        auditLevel: 'F', durationMs: Date.now() - started,
      });
      await this.runs.upsertIssue({
        storeId, code: 'MISSING_SKU', objectType: 'PRODUCT',
        objectKey: `product:${productId}`, productId,
        message: 'Missing SKU: assign an SKU before this product can be distributed.',
      });
      return { pushed, preserved, skipped: ['missing-sku'] };
    }
    // The gate passed: clear a stale MISSING_SKU left from before the
    // operator assigned an SKU (compact row kept, marked RESOLVED).
    await this.runs.resolveIssue(
      storeId,
      'MISSING_SKU',
      `product:${productId}`,
      'SKU assigned since — gate passes, auto-resolved by sync.',
    ).catch(() => undefined);

    // Mapping: reuse external id; first contact by SKU → adopt_existing (BR-05).
    let mapping = await (this.prisma as any).storeProductMapping.findUnique({
      where: { storeId_productId: { storeId, productId } },
    });
    const caps = provider.declaredCapabilities;
    const ecoFields = readEcoMateFields(product);
    const fieldKeys = FIELD_MATRIX.filter((r) => this.capabilityAllows(caps, r.capability, r.key)).map((r) => r.key);

    if (!mapping) {
      const preexisting = await this.findPreexistingBySku(provider, storeWithSecrets, product.sku as string).catch(() => null);
      if (preexisting) {
        await this.adoptExisting(storeId, productId, provider, storeWithSecrets, preexisting, ecoFields, fieldKeys);
        mapping = await (this.prisma as any).storeProductMapping.findUnique({
          where: { storeId_productId: { storeId, productId } },
        });
      }
    }

    // One batched external read per product per sync (§8.3).
    let external: Record<string, FieldSnapshot> = {};
    if (mapping) {
      try {
        external = await provider.readProductFields(storeWithSecrets, { providerId: mapping.externalId }, fieldKeys);
      } catch (err) {
        // Remote-deleted recovery: re-create once, then re-map.
        const decision = classifyProviderError(err);
        if ((err as any)?.category === 'REMOTE_NOT_FOUND' || decision.reason === 'http-404') {
          this.logger.warn(`Remote product gone for ${productId} on ${storeId} — re-creating`);
          mapping = null;
        } else {
          throw err;
        }
      }
    }

    // Category first (§8.9): failure never blocks the product.
    if (product.categoryId && fieldKeys.includes('category')) {
      try {
        await this.categories.ensurePath(store, provider, storeWithSecrets, product.categoryId as string, runId);
      } catch (err) {
        this.logger.warn(`Category ensure failed (non-blocking): ${err}`);
      }
    }

    // Media: ingest + hash/id reuse, never re-upload mapped (§8.11 rows 7-8).
    await this.syncMedia(storeId, provider, storeWithSecrets, product, runId, productId);

    const states = await this.prisma.productStoreFieldState.findMany({ where: { storeId, productId } });
    const stateByField = new Map(states.map((s: any) => [s.field, s]));

    const pushPayload: Record<string, unknown> = {};
    const pushFields: string[] = [];

    for (const row of FIELD_MATRIX) {
      if (!fieldKeys.includes(row.key)) {
        skipped.push(row.key);
        continue;
      }
      // BR-23: cost never customer-facing where cost:false — informational row only.
      if (row.key === 'costPrice' && (caps as any).costPrice === false) {
        await this.runs.recordItem(runId, {
          storeId, productId, objectType: 'PRODUCT', status: 'SKIPPED', field: row.key,
          reason: 'CAPABILITY_UNSUPPORTED: cost price has no native field here (BR-23)', auditLevel: 'F',
        });
        skipped.push(row.key);
        continue;
      }
      const ecoHash = hashFieldValue((ecoFields as any)[row.key]);
      const extSnap = external[row.key];
      const st = stateByField.get(row.key) as any;
      // No baseline yet (fresh product): create path pushes everything below.
      if (!st || !st.baselineHash) {
        if (mapping) {
          // Adopted or state-missing: treat external as baseline when equal,
          // else preserve (BR-02) — never overwrite blindly.
          const extHash = extSnap?.hash ?? ecoHash;
          const adopted = extHash === ecoHash
            ? { ownership: 'ECOMATE' as const, baseline: ecoHash }
            : { ownership: 'EXTERNAL' as const, baseline: extHash };
          await this.upsertFieldState(storeId, productId, row.key, {
            ownership: adopted.ownership, baselineHash: adopted.baseline,
            externalHash: extHash, ecoMateHashAtRebase: ecoHash,
            evidence: caps.externalEditsDetectable === 'plugin' ? 'PLUGIN' : 'INFERRED',
          });
          if (adopted.ownership === 'EXTERNAL') {
            preserved.push(row.key);
            await this.runs.recordItem(runId, {
              storeId, productId, objectType: 'PRODUCT', status: 'SKIPPED', field: row.key,
              reason: 'PRESERVE_EXTERNAL: adopted store value as baseline (BR-05)', auditLevel: 'F',
            });
            continue;
          }
        }
      }
      const baseline = (st?.baselineHash as string | undefined) ?? ecoHash;
      if (!mapping && !st) {
        // Fresh create path: handled by upsert below — collect for payload.
        pushPayload[row.key] = (ecoFields as any)[row.key];
        pushFields.push(row.key);
        continue;
      }
      const extHash = extSnap?.hash ?? baseline;
      const decision = this.ownership.evaluate({
        baselineHash: baseline,
        ecoMateHash: ecoHash,
        externalHash: extHash,
        ecoMateHashAtRebase: (st?.ecoMateHashAtRebase as string | null | undefined) ?? undefined,
        currentOwnership: (st?.ownership as any) ?? 'ECOMATE',
      });
      if (decision.action === 'SKIP') {
        skipped.push(row.key);
        continue;
      }
      if (decision.action === 'PUSH') {
        pushPayload[row.key] = (ecoFields as any)[row.key];
        pushFields.push(row.key);
        continue;
      }
      // PRESERVE_*: no push, ever. Update ownership + externalHash only
      // (BR-26: this path must never resolve — ownership stays drifted).
      preserved.push(row.key);
      await this.upsertFieldState(storeId, productId, row.key, {
        ownership: decision.ownership,
        baselineHash: baseline,
        externalHash: extHash,
        evidence: caps.externalEditsDetectable === 'plugin' ? 'PLUGIN' : 'INFERRED',
      });
      await this.runs.recordItem(runId, {
        storeId, productId, objectType: 'PRODUCT',
        status: decision.action === 'PRESERVE_CONFLICT' ? 'FAILED' : 'SKIPPED',
        field: row.key,
        reason: decision.action === 'PRESERVE_CONFLICT'
          ? `CONFLICT: both sides changed — explicit Force/Keep required (BR-03)`
          : `EXTERNAL: store-local edit preserved — explicit Force/Keep required (BR-02)`,
        auditLevel: row.audit,
      });
    }

    // Create vs update push.
    if (!mapping) {
      const ref = await provider.upsertProduct(storeWithSecrets, pushPayload as any, pushFields);
      mapping = await (this.prisma as any).storeProductMapping.create({
        data: { storeId, productId, externalId: ref.providerId, externalUrl: ref.url },
      });
      for (const f of pushFields) {
        const ecoHash = hashFieldValue((ecoFields as any)[f]);
        await this.upsertFieldState(storeId, productId, f, {
          ownership: 'ECOMATE', baselineHash: ecoHash, externalHash: ecoHash,
          evidence: caps.externalEditsDetectable === 'plugin' ? 'PLUGIN' : 'INFERRED',
          lastPushedAt: new Date(),
        });
      }
      pushed.push(...pushFields);
      await this.runs.recordItem(runId, {
        storeId, productId, objectType: 'PRODUCT', externalObjectId: ref.providerId,
        status: 'SUCCESS', reason: `created ${pushFields.length} fields`, auditLevel: 'G',
        durationMs: Date.now() - started,
      });
    } else if (pushFields.length > 0) {
      const ref = await provider.upsertProduct(
        storeWithSecrets,
        // Routing sku is always present for idempotent adapters (Fake/Woo
        // match on it); `pushFields` alone decides what is evaluated +
        // audited, so a name-only push never touches the sku baseline.
        { sku: (product as any).sku ?? undefined, ...pushPayload, __externalId: mapping.externalId } as any,
        pushFields,
      );
      for (const f of pushFields) {
        const ecoHash = hashFieldValue((ecoFields as any)[f]);
        await this.upsertFieldState(storeId, productId, f, {
          ownership: 'ECOMATE', baselineHash: ecoHash, externalHash: ecoHash,
          evidence: caps.externalEditsDetectable === 'plugin' ? 'PLUGIN' : 'INFERRED',
          lastPushedAt: new Date(),
        });
        pushed.push(f);
      }
      await this.runs.recordItem(runId, {
        storeId, productId, objectType: 'PRODUCT', externalObjectId: ref.providerId,
        status: 'SUCCESS', reason: `pushed ${pushFields.length} fields: ${pushFields.join(',')}`, auditLevel: 'F',
        durationMs: Date.now() - started,
      });
    }

    // Variants: add/update; removal per variantDelete.
    await this.syncVariants(storeId, provider, storeWithSecrets, product, mapping, runId);

    // Publication (§8.8): effective availability → published/draft.
    await this.syncPublication(storeId, provider, storeWithSecrets, product, mapping, runId);

    // SKU secondary index.
    if (product.sku) {
      await (this.prisma as any).storeSkuMapping.upsert({
        where: { storeId_sku: { storeId, sku: product.sku as string } },
        create: { storeId, sku: product.sku as string, productId, lastVerifiedAt: new Date() },
        update: { productId, lastVerifiedAt: new Date() },
      });
    }

    return { pushed, preserved, skipped };
  }

  // ── Overrides (BR-04): the ONLY resolution path ─────────────────────

  async forceEcoMateValue(storeId: string, productId: string, fields: string[], actorId?: string) {
    return this.applyOverride(storeId, productId, fields, 'reset', actorId);
  }

  async keepExternalValue(storeId: string, productId: string, fields: string[], actorId?: string) {
    return this.applyOverride(storeId, productId, fields, 'keep', actorId);
  }

  async resetAll(storeId: string, productId: string, actorId?: string) {
    const states = await this.prisma.productStoreFieldState.findMany({
      where: { storeId, productId, ownership: { in: ['EXTERNAL', 'CONFLICT'] as any } },
    });
    return this.applyOverride(storeId, productId, (states as any[]).map((s) => s.field), 'reset', actorId);
  }

  private async applyOverride(
    storeId: string,
    productId: string,
    fields: string[],
    mode: 'reset' | 'keep',
    actorId?: string,
  ) {
    const store = await this.requireStore(storeId);
    const provider = this.registry.providerFor(store);
    const storeWithSecrets = await this.storeWithSecrets(store);
    const product = await this.loadProduct(productId);
    if (!product) throw new NotFoundException('Product not found');
    const mapping = await (this.prisma as any).storeProductMapping.findUnique({
      where: { storeId_productId: { storeId, productId } },
    });
    if (!mapping) throw new NotFoundException('Product is not mapped to this store');
    const ecoFields = readEcoMateFields(product);
    const results: { field: string; ok: boolean; reason?: string }[] = [];
    // Batched external read for audit (prev external recorded per field).
    const external = await provider
      .readProductFields(storeWithSecrets, { providerId: mapping.externalId }, fields)
      .catch(() => ({} as Record<string, FieldSnapshot>));
    for (const field of fields) {
      const st = await this.prisma.productStoreFieldState.findUnique({
        where: { storeId_productId_field: { storeId, productId, field } },
      });
      const prevBaseline = (st as any)?.baselineHash ?? null;
      const prevExternal = (external as any)[field]?.hash ?? (st as any)?.externalHash ?? null;
      if (mode === 'keep') {
        // Rebase: baseline = externalHash, anchor eco hash — later EcoMate
        // edits push normally (prevents a permanently frozen field).
        const ecoHash = hashFieldValue((ecoFields as any)[field]);
        const extHash = prevExternal ?? ecoHash;
        await this.upsertFieldState(storeId, productId, field, {
          ownership: 'EXTERNAL', baselineHash: extHash, externalHash: extHash,
          ecoMateHashAtRebase: ecoHash,
          evidence: provider.declaredCapabilities.externalEditsDetectable === 'plugin' ? 'PLUGIN' : 'INFERRED',
        });
        await this.auditOverride(storeId, productId, field, 'keep', actorId, prevExternal, prevBaseline);
        results.push({ field, ok: true });
      } else {
        const row = matrixRowFor(field);
        const caps = provider.declaredCapabilities;
        if (row && !this.capabilityAllows(caps, row.capability, row.key)) {
          results.push({ field, ok: false, reason: `CAPABILITY_UNSUPPORTED: ${row.capability}` });
          continue;
        }
        await provider.upsertProduct(
          storeWithSecrets,
          { sku: (product as any).sku ?? undefined, [field]: (ecoFields as any)[field], __externalId: mapping.externalId } as any,
          [field],
        );
        const ecoHash = hashFieldValue((ecoFields as any)[field]);
        await this.upsertFieldState(storeId, productId, field, {
          ownership: 'ECOMATE', baselineHash: ecoHash, externalHash: ecoHash,
          evidence: caps.externalEditsDetectable === 'plugin' ? 'PLUGIN' : 'INFERRED',
          lastPushedAt: new Date(),
        });
        await this.auditOverride(storeId, productId, field, 'reset', actorId, prevExternal, prevBaseline);
        results.push({ field, ok: true });
      }
    }
    return { storeId, productId, mode, actor: actorId ?? null, results };
  }

  private async auditOverride(
    storeId: string, productId: string, field: string,
    action: string, actorId: string | undefined,
    prevExternal: string | null, prevBaseline: string | null,
  ) {
    // Awaited audit write (never swallowed — §4.2): SyncRunItem on an
    // ad-hoc run so every override is traceable.
    const run = await this.prisma.syncRun.create({
      data: {
        scope: 'PRODUCT' as any, triggerType: 'MANUAL' as any, storeId,
        initiatedById: actorId, status: 'SUCCESS' as any, finishedAt: new Date(),
      },
    });
    await this.prisma.syncRunItem.create({
      data: {
        runId: run.id, storeId, productId, objectType: 'PRODUCT' as any,
        status: 'SUCCESS' as any, field, auditLevel: matrixRowFor(field)?.audit ?? 'F',
        reason: `override:${action} actor=${actorId ?? 'unknown'} prevExternal=${prevExternal ?? 'null'} prevBaseline=${prevBaseline ?? 'null'}`,
      },
    });
  }

  // ── Publication (§8.8) ─────────────────────────────────────────────

  async syncPublication(
    storeId: string, provider: any, storeWithSecrets: any,
    product: any, mapping: any, runId: string,
  ) {
    if (!mapping) return;
    const view = await this.distribution.getAvailability(product.id);
    const row = view.stores.find((s: any) => s.storeId === storeId);
    const state = row && row.effective ? 'published' : 'draft';
    // Assignment OFF / unpublish → draft, NEVER delete. Mapping retained.
    await provider.setPublication(storeWithSecrets, { providerId: mapping.externalId }, state);
    await this.upsertFieldState(storeId, product.id, 'publicationState', {
      ownership: 'ECOMATE',
      baselineHash: sha(state),
      externalHash: sha(state),
      evidence: 'INFERRED',
      lastPushedAt: new Date(),
    });
    await this.runs.recordItem(runId, {
      storeId, productId: product.id, objectType: 'PUBLICATION',
      externalObjectId: mapping.externalId, status: 'SUCCESS',
      reason: `publication → ${state}`, auditLevel: 'G',
    });
  }

  /** Capability-gated deletion — reachable ONLY from the hard-delete path (BR-09). */
  async deleteRemote(storeId: string, productId: string): Promise<{ deleted: boolean; reason: string }> {
    const store = await this.requireStore(storeId);
    const provider = this.registry.providerFor(store);
    const mapping = await (this.prisma as any).storeProductMapping.findUnique({
      where: { storeId_productId: { storeId, productId } },
    });
    if (!mapping) return { deleted: false, reason: 'not-mapped' };
    if ((provider.declaredCapabilities as any).delete !== true) {
      await this.runs.upsertIssue({
        storeId, code: 'MANUAL_ACTION_REQUIRED', objectType: 'DELETION',
        objectKey: `product:${productId}`, productId,
        message: 'This provider cannot delete remotely: remove the product manually in the store admin.',
      });
      return { deleted: false, reason: 'delete:false → retained + MANUAL_ACTION_REQUIRED (BR-09)' };
    }
    const storeWithSecrets = await this.storeWithSecrets(store);
    const res = await provider.deleteProduct(storeWithSecrets, { providerId: mapping.externalId });
    if (res.ok) {
      await (this.prisma as any).storeProductMapping.delete({ where: { id: mapping.id } });
      return { deleted: true, reason: 'deleted' };
    }
    await this.runs.upsertIssue({
      storeId, code: 'EXTERNAL_DELETE_FAILED', objectType: 'DELETION',
      objectKey: `product:${productId}`, productId,
      message: `Remote delete failed: ${res.reason ?? 'unknown'}`,
    });
    return { deleted: false, reason: res.reason ?? 'failed' };
  }

  // ── Internals ─────────────────────────────────────────────────────

  private capabilityAllows(caps: any, capability: string, fieldKey: string): boolean {
    if (capability === 'products' || capability === 'variations') return true;
    if (capability === 'costPrice') return true; // gated per-row (BR-23 info row)
    if (typeof caps[capability] === 'boolean') return caps[capability] === true;
    return true;
  }

  private async requireStore(storeId: string) {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store) throw new NotFoundException('Store not found');
    return store;
  }

  private async storeWithSecrets(store: any) {
    if (this.stores) {
      try {
        return await this.stores.storeWithSecrets(store.id);
      } catch {
        // fall through to settings-only shape (tests / missing credentials)
      }
    }
    const creds = await this.prisma.storeCredential.findMany({ where: { storeId: store.id }, orderBy: { createdAt: 'desc' } });
    void creds;
    return { id: store.id, kind: store.kind, settings: (store.settings as any) ?? {}, secrets: {} };
  }

  private async loadProduct(productId: string) {
    return this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        variants: { include: { attributeValues: true } },
        brand: true,
        productTags: true,
        productCategories: true,
      },
    });
  }

  private async findPreexistingBySku(provider: any, storeWithSecrets: any, sku: string): Promise<{ providerId: string } | null> {
    // Provider-agnostic first-contact probe: adapters expose lookup via
    // upsert idempotency, but an explicit read keeps adopt semantics loud.
    // WooCommerce implements `findBySku`; others return null → normal create.
    // Shape-validated: only `{ providerId: string }` counts (the Fake's
    // introspection helper shares the name with a different signature).
    if (typeof provider.findBySku !== 'function') return null;
    try {
      const found = await provider.findBySku(storeWithSecrets, sku);
      if (found && typeof found.providerId === 'string') return found;
      return null;
    } catch {
      return null;
    }
  }

  /** BR-05: adopt pre-existing external values as the baseline. */
  private async adoptExisting(
    storeId: string, productId: string, provider: any, storeWithSecrets: any,
    preexisting: { providerId: string }, ecoFields: Record<string, unknown>, fieldKeys: string[],
  ) {
    const external = await provider.readProductFields(storeWithSecrets, preexisting, fieldKeys).catch(() => ({}));
    const ecoHashes: Record<string, string> = {};
    for (const f of fieldKeys) ecoHashes[f] = hashFieldValue((ecoFields as any)[f]);
    for (const f of fieldKeys) {
      const extHash = (external as any)[f]?.hash as string | undefined;
      if (!extHash) continue;
      const decided = this.ownership.adoptExisting({ ecoMateHash: ecoHashes[f], externalHash: extHash });
      await this.upsertFieldState(storeId, productId, f, {
        ownership: decided.ownership, baselineHash: decided.baselineHash,
        externalHash: decided.externalHash, ecoMateHashAtRebase: decided.ecoMateHashAtRebase,
        evidence: provider.declaredCapabilities.externalEditsDetectable === 'plugin' ? 'PLUGIN' : 'INFERRED',
      });
    }
    await (this.prisma as any).storeProductMapping.create({
      data: { storeId, productId, externalId: preexisting.providerId },
    });
  }

  private async syncMedia(
    storeId: string, provider: any, storeWithSecrets: any,
    product: any, runId: string, productId: string,
  ) {
    if (provider.declaredCapabilities.media !== true) return;
    const images: string[] = Array.isArray(product.images) ? product.images : [];
    if (images.length === 0) return;
    const unmapped: { src: string; hash: string }[] = [];
    for (const src of images) {
      const existing = await (this.prisma as any).storeMediaMapping.findUnique({
        where: { storeId_mediaKey: { storeId, mediaKey: src } },
      });
      if (!existing) unmapped.push({ src, hash: sha(src) });
    }
    // Never re-upload mapped media: only unmapped sources hit the provider.
    if (unmapped.length === 0) return;
    const refs = await provider.ensureMedia(storeWithSecrets, unmapped as any);
    for (const item of unmapped) {
      const ref = refs.get(item.src);
      if (!ref) continue;
      await (this.prisma as any).storeMediaMapping.create({
        data: { storeId, mediaKey: item.src, externalId: ref.providerId },
      });
      await this.runs.recordItem(runId, {
        storeId, productId, objectType: 'MEDIA', externalObjectId: ref.providerId,
        status: 'SUCCESS', reason: `media ensured ${item.src}`, auditLevel: 'F',
      });
    }
  }

  private async syncVariants(
    storeId: string, provider: any, storeWithSecrets: any,
    product: any, mapping: any, runId: string,
  ) {
    const variants = product.variants ?? [];
    if (product.type !== 'variable' || variants.length === 0 || !mapping) return;
    if (provider.declaredCapabilities.variations !== true) return;
    const payload = variants.map((v: any) => ({
      sku: v.sku,
      price: v.price !== null && v.price !== undefined ? String(v.price) : undefined,
      salePrice: v.salePrice !== null && v.salePrice !== undefined ? String(v.salePrice) : undefined,
      isActive: v.isActive,
    }));
    const refs = await provider.upsertVariants(storeWithSecrets, { providerId: mapping.externalId }, payload);
    for (const v of variants) {
      const ref = refs.get(v.sku);
      if (!ref) continue;
      await (this.prisma as any).storeVariantMapping.upsert({
        where: { storeId_variantId: { storeId, variantId: v.id } },
        create: { storeId, productId: product.id, variantId: v.id, externalId: ref.providerId },
        update: { externalId: ref.providerId },
      });
    }
    await this.runs.recordItem(runId, {
      storeId, productId: product.id, objectType: 'VARIANT',
      externalObjectId: mapping.externalId, status: 'SUCCESS',
      reason: `variants synced: ${variants.length}`, auditLevel: 'F',
    });
    // Removal per variantDelete: local variants missing remotely are out of
    // scope for P4's push direction; remote extras are never auto-deleted
    // unless the capability allows explicit removal (WC deletes).
    void provider.declaredCapabilities.variantDelete;
  }

  private async upsertFieldState(
    storeId: string, productId: string, field: string,
    data: { ownership: string; baselineHash: string | null; externalHash: string | null; ecoMateHashAtRebase?: string | null; evidence?: string; lastPushedAt?: Date },
  ) {
    await (this.prisma as any).productStoreFieldState.upsert({
      where: { storeId_productId_field: { storeId, productId, field } },
      create: {
        storeId, productId, field,
        ownership: data.ownership as any,
        baselineHash: data.baselineHash,
        externalHash: data.externalHash,
        ecoMateHashAtRebase: data.ecoMateHashAtRebase,
        evidence: (data.evidence as any) ?? 'INFERRED',
        lastPushedAt: data.lastPushedAt,
      },
      // BR-26: sync NEVER resolves — ownership from the decision is written
      // verbatim; no upsert here may flip EXTERNAL/CONFLICT back to ECOMATE
      // except via the PUSH path that just proved the remote write.
      update: {
        ownership: data.ownership as any,
        baselineHash: data.baselineHash,
        externalHash: data.externalHash,
        ecoMateHashAtRebase: data.ecoMateHashAtRebase,
        evidence: (data.evidence as any) ?? 'INFERRED',
        lastPushedAt: data.lastPushedAt,
      },
    });
  }

  /** Retry helper: 30s→6h ladder, 5 attempts → DEAD + issue (§8.1). */
  nextRetry(attemptNo: number): Date | null {
    if (attemptNo >= MAX_SYNC_ATTEMPTS) return null;
    const delay = RETRY_BACKOFF_MS[Math.min(attemptNo - 1, RETRY_BACKOFF_MS.length - 1)];
    return new Date(Date.now() + (delay ?? 30_000));
  }

  classifyForIssue(err: unknown) {
    return classifyProviderError(err);
  }
}

// Re-export for specs.
export { MAX_SYNC_ATTEMPTS, RETRY_BACKOFF_MS };
export const __test__ = { sha };
