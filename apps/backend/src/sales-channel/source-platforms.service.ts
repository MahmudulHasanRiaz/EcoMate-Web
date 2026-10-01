/**
 * SourcePlatform registry — extensible, capability-aware.
 *
 * Seed semantics are INSERT-ONLY. `ensureDefaults()` uses `skipDuplicates`,
 * which cannot touch an existing row — so an operator who customised a row
 * (renamed it, disabled it, reordered it) keeps that customisation forever,
 * even when the default set changes in a later deploy. Upsert would clobber
 * those edits, which is why it is not used here.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  SOURCE_PLATFORM_SEEDS,
  type SourceCapability,
} from './sales-channel.constants';

export interface SourcePlatformView {
  slug: string;
  displayName: string;
  enabled: boolean;
  capabilities: string[];
}

@Injectable()
export class SourcePlatformsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Insert any missing default rows. Never updates an existing row.
   */
  async ensureDefaults(): Promise<void> {
    await this.prisma.sourcePlatform.createMany({
      data: SOURCE_PLATFORM_SEEDS.map((s) => ({
        slug: s.slug,
        displayName: s.displayName,
        capabilities: s.capabilities as string[],
        sortOrder: s.sortOrder,
        enabled: true,
      })),
      skipDuplicates: true,
    });
  }

  /** All enabled platforms, in display order. */
  async listAll(): Promise<SourcePlatformView[]> {
    await this.ensureDefaults();
    const rows = await this.prisma.sourcePlatform.findMany({
      where: { enabled: true },
      orderBy: [{ sortOrder: 'asc' }, { displayName: 'asc' }],
    });
    return rows.map((r) => ({
      slug: r.slug,
      displayName: r.displayName,
      enabled: r.enabled,
      capabilities: r.capabilities,
    }));
  }

  /**
   * Platforms carrying a capability — e.g. the Messaging channel may only
   * offer sources where capabilities contains MESSAGING. Backed by the GIN
   * index on the capabilities array.
   */
  async listByCapability(capability: SourceCapability): Promise<SourcePlatformView[]> {
    await this.ensureDefaults();
    const rows = await this.prisma.sourcePlatform.findMany({
      where: { enabled: true, capabilities: { has: capability } },
      orderBy: [{ sortOrder: 'asc' }, { displayName: 'asc' }],
    });
    return rows.map((r) => ({
      slug: r.slug,
      displayName: r.displayName,
      enabled: r.enabled,
      capabilities: r.capabilities,
    }));
  }

  /** Every known slug → used by the validator so it stays offline-testable. */
  async slugSet(): Promise<Set<string>> {
    const rows = await this.prisma.sourcePlatform.findMany({
      select: { slug: true, enabled: true },
    });
    return new Set(rows.filter((r) => r.enabled).map((r) => r.slug));
  }

  async capabilitiesFor(slug: string): Promise<string[] | null> {
    const row = await this.prisma.sourcePlatform.findUnique({
      where: { slug },
      select: { capabilities: true, enabled: true },
    });
    if (!row || !row.enabled) return null;
    return row.capabilities;
  }
}
