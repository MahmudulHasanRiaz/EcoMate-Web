/**
 * Category lifecycle — central-commerce §8.9 (P4).
 *
 * Mapping keyed on (storeId, categoryId), never on name. ensureCategories
 * resolves top-down: local mapping → remote slug-within-parent lookup →
 * create. Rename updates the mapped term; move re-parents it. Re-sync is
 * idempotent (field comparison skips the call). Remote-deleted terms are
 * re-created once; second failure raises an issue. categoryModel
 * 'unsupported' → CATEGORY_UNSUPPORTED notice, products proceed.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { CommerceProvider, RemoteRef, StoreWithSecrets } from '../providers/provider.contract';
import { SyncRunService } from './sync-run.service';

function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

@Injectable()
export class CategorySyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runs: SyncRunService,
  ) {}

  async ensurePath(
    store: { id: string },
    provider: CommerceProvider,
    storeWithSecrets: StoreWithSecrets,
    categoryId: string,
    runId?: string,
  ): Promise<RemoteRef | null> {
    const caps = provider.declaredCapabilities;
    if (!caps.categories || caps.categoryModel === 'unsupported') {
      await this.runs.upsertIssue({
        storeId: store.id,
        code: 'CATEGORY_UNSUPPORTED',
        objectType: 'CATEGORY',
        objectKey: `category:${categoryId}`,
        message: 'Categories are unsupported on this provider: the EcoMate hierarchy stays local and product sync proceeds.',
      });
      if (runId) {
        await this.runs.recordItem(runId, {
          storeId: store.id,
          objectType: 'CATEGORY',
          status: 'SKIPPED',
          reason: 'CATEGORY_UNSUPPORTED: product sync proceeds',
        });
      }
      return null;
    }
    const chain = await this.categoryChain(categoryId);
    if (chain.length === 0) return null;
    const names = chain.map((c) => c.name);
    const key = names.join(' / ');
    let parentRef: RemoteRef | null = null;
    let leafRef: RemoteRef | null = null;
    // Top-down: resolve each level through mapping first.
    for (let i = 0; i < chain.length; i++) {
      const level = chain[i] as { id: string; name: string };
      const existing = await (this.prisma as any).storeCategoryMapping.findUnique({
        where: { storeId_categoryId: { storeId: store.id, categoryId: level.id } },
      });
      if (existing) {
        parentRef = { providerId: existing.externalTermId };
        if (i === chain.length - 1) leafRef = parentRef;
        continue;
      }
      const ensured = await provider.ensureCategories(storeWithSecrets, [names.slice(0, i + 1)]);
      const ref = ensured.get(names.slice(0, i + 1).join(' / ')) ?? ensured.get(key);
      if (!ref) {
        await this.runs.upsertIssue({
          storeId: store.id,
          code: 'CATEGORY_SYNC_FAILED',
          objectType: 'CATEGORY',
          objectKey: `category:${level.id}`,
          message: `Category ensure failed for "${level.name}" (remote lookup + create both missed).`,
        });
        return parentRef;
      }
      await (this.prisma as any).storeCategoryMapping.create({
        data: {
          storeId: store.id,
          categoryId: level.id,
          externalTermId: ref.providerId,
          externalPath: names.slice(0, i + 1).join(' / '),
        },
      });
      if (runId) {
        await this.runs.recordItem(runId, {
          storeId: store.id,
          objectType: 'CATEGORY',
          externalObjectId: ref.providerId,
          status: 'SUCCESS',
          reason: `ensured category "${level.name}"`,
          auditLevel: 'G',
        });
      }
      parentRef = ref;
      if (i === chain.length - 1) leafRef = ref;
    }
    return leafRef;
  }

  async rename(
    storeId: string,
    provider: CommerceProvider,
    storeWithSecrets: StoreWithSecrets,
    categoryId: string,
    nextName: string,
  ): Promise<void> {
    const mapping = await (this.prisma as any).storeCategoryMapping.findUnique({
      where: { storeId_categoryId: { storeId, categoryId } },
    });
    if (!mapping) return;
    await provider.renameCategory(
      storeWithSecrets,
      { providerId: mapping.externalTermId },
      { name: nextName, slug: slugify(nextName) },
    );
    await (this.prisma as any).storeCategoryMapping.update({
      where: { id: mapping.id },
      data: { externalPath: mapping.externalPath?.replace(/[^/]+$/, nextName) ?? nextName },
    });
  }

  async move(
    storeId: string,
    provider: CommerceProvider,
    storeWithSecrets: StoreWithSecrets,
    categoryId: string,
    newParentCategoryId: string | null,
  ): Promise<void> {
    const mapping = await (this.prisma as any).storeCategoryMapping.findUnique({
      where: { storeId_categoryId: { storeId, categoryId } },
    });
    if (!mapping) return;
    let parentRef: RemoteRef | null = null;
    if (newParentCategoryId) {
      const parent = await (this.prisma as any).storeCategoryMapping.findUnique({
        where: { storeId_categoryId: { storeId, categoryId: newParentCategoryId } },
      });
      if (!parent) return;
      parentRef = { providerId: parent.externalTermId };
    }
    try {
      await provider.moveCategory(storeWithSecrets, { providerId: mapping.externalTermId }, parentRef);
    } catch {
      await this.runs.upsertIssue({
        storeId,
        code: 'CATEGORY_MOVE_UNSUPPORTED',
        objectType: 'CATEGORY',
        objectKey: `category:${categoryId}`,
        message: 'This provider cannot re-parent a category: move it manually in the store admin.',
      });
    }
  }

  private async categoryChain(leafId: string): Promise<{ id: string; name: string; parentId: string | null }[]> {
    const out: { id: string; name: string; parentId: string | null }[] = [];
    const seen = new Set<string>();
    let cur: string | null = leafId;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const cat = await this.prisma.category.findUnique({ where: { id: cur }, select: { id: true, name: true, parentId: true } });
      if (!cat) break;
      out.unshift(cat);
      cur = cat.parentId;
    }
    return out;
  }
}
