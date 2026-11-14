/**
 * Distribution service — central-commerce §8.2 + §8.2.1 + §10 (P3).
 *
 * Owns ProductStoreAssignment overrides, StoreAvailabilityRule category
 * rules, and the resolved per-store availability view. Additive only:
 * mutations touch ONLY the P3 tables — Product rows are never written, so
 * the storefront read path (isActive + status != draft) is untouched.
 *
 * BR-20: NATIVE store ids are rejected 400 on every write and excluded
 * from bulk actions (with excludedNativeCount in the response).
 */
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { StoreAvailabilityService } from './store-availability.service';

export const BULK_BG_THRESHOLD = 50;
export const DISABLE_ALL_CONFIRM = 'DISABLE';

export interface StoreAvailabilityRow {
  storeId: string;
  kind: string;
  name: string;
  overrideAvailable: boolean | null;
  ruleAvailable: boolean | null;
  effective: boolean;
}

export interface ProductAvailabilityView {
  productId: string;
  globalActive: boolean;
  stores: StoreAvailabilityRow[];
}

export interface BulkAvailabilityResult {
  enqueued: boolean;
  jobId?: string;
  updated: number;
  total: number;
  excludedNativeCount: number;
}

export interface BulkJobStatus {
  jobId: string;
  productId: string;
  action: 'all_on' | 'all_off';
  status: 'RUNNING' | 'DONE' | 'FAILED';
  total: number;
  done: number;
  failed: number;
  error?: string;
}

interface RuleRecord {
  categoryId: string;
  available: boolean;
  inheritFromParent: boolean;
}

@Injectable()
export class DistributionService {
  private readonly logger = new Logger(DistributionService.name);
  private readonly bulkJobs = new Map<string, BulkJobStatus>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: StoreAvailabilityService,
  ) {}

  // ── Resolved view ────────────────────────────────────────────────

  async getAvailability(productId: string): Promise<ProductAvailabilityView> {
    const product = await this.requireProduct(productId);
    const globalActive = product.status === 'active' && product.isActive === true;
    const stores = await this.prisma.store.findMany({ orderBy: { createdAt: 'asc' } });
    const assignments = await this.prisma.productStoreAssignment.findMany({
      where: { productId },
    });
    const overrideByStore = new Map(assignments.map((a) => [a.storeId, a.available]));
    const rules = await this.prisma.storeAvailabilityRule.findMany({
      where: { storeId: { in: stores.map((s) => s.id) } },
    });
    const rulesByStore = new Map<string, RuleRecord[]>();
    for (const r of rules) {
      const list = rulesByStore.get(r.storeId) ?? [];
      list.push({
        categoryId: r.categoryId,
        available: r.available,
        inheritFromParent: r.inheritFromParent,
      });
      rulesByStore.set(r.storeId, list);
    }
    const parentOf = await this.categoryParentMap();
    const directCategories = this.directCategories(product);

    const view: StoreAvailabilityRow[] = stores.map((store) => {
      const overrideAvailable = overrideByStore.get(store.id) ?? null;
      const ruleAvailable = this.resolveRuleForCategories(
        directCategories,
        rulesByStore.get(store.id) ?? [],
        parentOf,
      );
      return {
        storeId: store.id,
        kind: store.kind,
        name: store.name,
        overrideAvailable,
        ruleAvailable,
        effective: this.availability.resolve({
          globalActive,
          storeKind: store.kind,
          overrideAvailable,
          ruleAvailable,
        }),
      };
    });
    return { productId, globalActive, stores: view };
  }

  // ── Overrides ────────────────────────────────────────────────────

  async setOverride(productId: string, storeId: string, available: boolean | null) {
    const store = await this.requireExternalStore(storeId);
    await this.requireProduct(productId);
    if (available === null) {
      await this.prisma.productStoreAssignment.deleteMany({ where: { productId, storeId } });
      return { cleared: true, productId, storeId };
    }
    void store;
    return this.prisma.productStoreAssignment.upsert({
      where: { storeId_productId: { storeId, productId } },
      create: { storeId, productId, source: 'MANUAL', available },
      update: { source: 'MANUAL', available },
    });
  }

  // ── Bulk ─────────────────────────────────────────────────────────

  async bulkSet(
    productId: string,
    action: 'all_on' | 'all_off',
    confirm?: string,
  ): Promise<BulkAvailabilityResult> {
    await this.requireProduct(productId);
    if (action === 'all_off' && confirm !== DISABLE_ALL_CONFIRM) {
      throw new BadRequestException(
        `Disable-all requires typed confirmation: pass confirm: '${DISABLE_ALL_CONFIRM}'`,
      );
    }
    const stores = await this.prisma.store.findMany({ orderBy: { createdAt: 'asc' } });
    const external = stores.filter((s) => s.kind !== 'NATIVE');
    const excludedNativeCount = stores.length - external.length;
    const available = action === 'all_on';

    if (external.length > BULK_BG_THRESHOLD) {
      const jobId = randomUUID();
      this.bulkJobs.set(jobId, {
        jobId,
        productId,
        action,
        status: 'RUNNING',
        total: external.length,
        done: 0,
        failed: 0,
      });
      // Post-commit background work (queues land in P4): never throws into
      // the request. Correctness comes from the per-row upserts, retried by
      // re-issuing the bulk action — surfaced via the job status endpoint.
      setImmediate(() => void this.runBulkJob(jobId, productId, available));
      return { enqueued: true, jobId, updated: 0, total: external.length, excludedNativeCount };
    }

    let updated = 0;
    for (const store of external) {
      await this.prisma.productStoreAssignment.upsert({
        where: { storeId_productId: { storeId: store.id, productId } },
        create: { storeId: store.id, productId, source: 'MANUAL', available },
        update: { source: 'MANUAL', available },
      });
      updated += 1;
    }
    return { enqueued: false, updated, total: external.length, excludedNativeCount };
  }

  getBulkJob(jobId: string): BulkJobStatus {
    const job = this.bulkJobs.get(jobId);
    if (!job) throw new NotFoundException('Bulk job not found');
    return job;
  }

  /** Test seam: resolves when the background job reaches a terminal state. */
  async waitForBulkJob(jobId: string, timeoutMs = 10000): Promise<BulkJobStatus> {
    const started = Date.now();
    for (;;) {
      const job = this.bulkJobs.get(jobId);
      if (!job) throw new NotFoundException('Bulk job not found');
      if (job.status === 'DONE' || job.status === 'FAILED') return job;
      if (Date.now() - started > timeoutMs) throw new Error(`Bulk job ${jobId} timed out`);
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  private async runBulkJob(jobId: string, productId: string, available: boolean): Promise<void> {
    const job = this.bulkJobs.get(jobId);
    if (!job) return;
    try {
      const stores = await this.prisma.store.findMany({});
      for (const store of stores.filter((s) => s.kind !== 'NATIVE')) {
        try {
          await this.prisma.productStoreAssignment.upsert({
            where: { storeId_productId: { storeId: store.id, productId } },
            create: { storeId: store.id, productId, source: 'MANUAL', available },
            update: { source: 'MANUAL', available },
          });
          job.done += 1;
        } catch (err) {
          job.failed += 1;
          this.logger.error(`Bulk job ${jobId}: store ${store.id} failed: ${err}`);
        }
      }
      job.status = 'DONE';
    } catch (err) {
      job.status = 'FAILED';
      job.error = err instanceof Error ? err.message : String(err);
    }
  }

  // ── Category rules ───────────────────────────────────────────────

  async listRules(storeId?: string) {
    let storeFilter: { storeId: string } | Record<string, never> = {};
    if (storeId) {
      const store = await this.requireStore(storeId);
      // Reads are truthful: NATIVE can hold no rules — return [] (writes 400).
      if (store.kind === 'NATIVE') return [];
      storeFilter = { storeId };
    }
    const [rules, categories] = await Promise.all([
      this.prisma.storeAvailabilityRule.findMany({
        where: storeFilter,
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.category.findMany({ select: { id: true, name: true, slug: true, parentId: true } }),
    ]);
    const byId = new Map(categories.map((c) => [c.id, c]));
    return rules.map((r) => ({
      storeId: r.storeId,
      categoryId: r.categoryId,
      categoryName: byId.get(r.categoryId)?.name ?? r.categoryId,
      categoryPath: this.categoryPath(r.categoryId, byId),
      available: r.available,
      inheritFromParent: r.inheritFromParent,
    }));
  }

  async upsertRule(
    storeId: string,
    categoryId: string,
    input: { available: boolean; inheritFromParent?: boolean },
  ) {
    await this.requireExternalStore(storeId);
    const category = await this.prisma.category.findUnique({ where: { id: categoryId } });
    if (!category) throw new NotFoundException('Category not found');
    // An explicit merchant toggle is an own-value rule (inherit=false) unless
    // the caller says otherwise; an update without the flag preserves it.
    const existing = await this.prisma.storeAvailabilityRule.findUnique({
      where: { storeId_categoryId: { storeId, categoryId } },
    });
    const inheritFromParent = input.inheritFromParent ?? existing?.inheritFromParent ?? false;
    return this.prisma.storeAvailabilityRule.upsert({
      where: { storeId_categoryId: { storeId, categoryId } },
      create: { storeId, categoryId, available: input.available, inheritFromParent },
      update: { available: input.available, inheritFromParent },
    });
  }

  // ── Rule resolution (pure over loaded rows) ──────────────────────
  //
  // A rule with inheritFromParent=false is an own-value rule: it governs its
  // own category and always beats inherited ancestors. A rule with
  // inheritFromParent=true defers upward (propagates down to descendants
  // that have no own-value rule). Nearest own-value-or-propagating hit wins;
  // across several direct categories the nearest hit wins and a tie resolves
  // fail-closed (OFF). No rule → null → external default OFF (§8.2).

  resolveRuleForCategories(
    directCategoryIds: string[],
    rules: RuleRecord[],
    parentOf: Map<string, string | null>,
  ): boolean | null {
    const rulesByCategory = new Map(rules.map((r) => [r.categoryId, r]));
    let best: { available: boolean; depth: number } | null = null;
    for (const direct of directCategoryIds) {
      let cur: string | null = direct;
      let depth = 0;
      while (cur) {
        const rule = rulesByCategory.get(cur);
        // Take the rule iff it speaks for this level: own category with an
        // own value, or an ancestor whose rule propagates downward.
        const takes =
          rule !== undefined &&
          (cur === direct ? !rule.inheritFromParent : rule.inheritFromParent);
        if (takes) {
          if (!best || depth < best.depth || (depth === best.depth && !rule.available)) {
            best = { available: (rule as RuleRecord).available, depth };
          }
          break;
        }
        cur = parentOf.get(cur) ?? null;
        depth += 1;
      }
    }
    return best?.available ?? null;
  }

  // ── Internals ────────────────────────────────────────────────────

  private async requireProduct(productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: { productCategories: { select: { categoryId: true } } },
    });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  private async requireStore(storeId: string) {
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store) throw new NotFoundException('Store not found');
    return store;
  }

  /** Row-level storeId validation + BR-20 write rejection. */
  private async requireExternalStore(storeId: string) {
    const store = await this.requireStore(storeId);
    if (store.kind === 'NATIVE') {
      throw new BadRequestException('NATIVE store is never a distribution target (BR-20)');
    }
    return store;
  }

  private async categoryParentMap(): Promise<Map<string, string | null>> {
    const cats = await this.prisma.category.findMany({ select: { id: true, parentId: true } });
    return new Map(cats.map((c) => [c.id, c.parentId]));
  }

  private directCategories(product: {
    categoryId?: string | null;
    productCategories?: { categoryId: string }[];
  }): string[] {
    const ids = new Set<string>();
    if (product.categoryId) ids.add(product.categoryId);
    for (const pc of product.productCategories ?? []) ids.add(pc.categoryId);
    return [...ids];
  }

  private categoryPath(
    categoryId: string,
    byId: Map<string, { id: string; name: string; parentId?: string | null }>,
  ): string {
    const parts: string[] = [];
    let cur: string | null | undefined = categoryId;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const cat = byId.get(cur);
      if (!cat) break;
      parts.unshift(cat.name);
      cur = cat.parentId;
    }
    return parts.join(' / ') || categoryId;
  }
}
