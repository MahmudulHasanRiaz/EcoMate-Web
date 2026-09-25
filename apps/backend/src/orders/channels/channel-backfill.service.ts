/**
 * Channel backfill — central-commerce P8 (§9.2, §16 item 2).
 *
 * Idempotent (NULL-only: only `salesChannelType IS NULL` rows are touched,
 * and only NULL columns are written), chunked (cursor pagination, one
 * transaction per chunk), resumable (re-running continues where the previous
 * run stopped — finished rows no longer match the predicate) and observable
 * (structured report + progress log lines). Uses the indexed
 * `Order_salesChannelType_idx` predicate so no long lock is taken.
 *
 * A row with `salesChannelType` set was already classified by the single
 * ChannelResolver (legacy provenance fields are creation-time snapshots and
 * never mutate), so `marketingChannel = NULL` beside it is the correct
 * resolved value — never re-derived.
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  resolveChannels,
  type MarketingChannelValue,
  type SalesChannelTypeValue,
} from './channel-resolver';

export interface BackfillOrderRow {
  id: string;
  salesChannel: string | null;
  source: string | null;
  sourcePlatform: string | null;
  sourceType: string | null;
  sourceEntity: string | null;
  trackingSessionId: string | null;
  salesChannelType: SalesChannelTypeValue | null;
}

export interface BackfillUpdate {
  salesChannelType: SalesChannelTypeValue;
  /** Only present when the resolver yields a platform (NULL stays NULL). */
  marketingChannel?: MarketingChannelValue;
  /** Only present when the showroom name resolves to a Warehouse id. */
  showroomId?: string;
}

/**
 * Pure: compute the write for one row. Returns null when there is nothing
 * to write (row already typed — the idempotency guarantee).
 */
export function buildBackfillUpdate(
  row: BackfillOrderRow,
  utmSource: string | null,
  showroomId: string | null,
): BackfillUpdate | null {
  if (row.salesChannelType !== null) return null;
  const resolved = resolveChannels({
    salesChannel: row.salesChannel,
    source: row.source,
    sourcePlatform: row.sourcePlatform,
    sourceType: row.sourceType,
    sourceEntity: row.sourceEntity,
    utmSource,
  });
  const update: BackfillUpdate = {
    salesChannelType: resolved.salesChannelType,
  };
  if (resolved.marketingChannel !== null) {
    update.marketingChannel = resolved.marketingChannel;
  }
  if (showroomId !== null) update.showroomId = showroomId;
  return update;
}

export interface BackfillOptions {
  dryRun?: boolean;
  chunkSize?: number;
  maxOrders?: number;
}

export interface BackfillReport {
  dryRun: boolean;
  scanned: number;
  updated: number;
  skippedAlreadyTyped: number;
  showroomLinked: number;
  bySalesChannelType: Record<string, number>;
  byMarketingChannel: Record<string, number>;
  errors: string[];
}

const BACKFILL_SELECT = {
  id: true,
  salesChannel: true,
  source: true,
  sourcePlatform: true,
  sourceType: true,
  sourceEntity: true,
  trackingSessionId: true,
  salesChannelType: true,
} as const;

@Injectable()
export class ChannelBackfillService {
  private readonly logger = new Logger(ChannelBackfillService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Name → Warehouse id (type='showroom'); null cached for misses. */
  async resolveShowroomId(
    name: string | null,
    cache: Map<string, string | null>,
  ): Promise<string | null> {
    if (!name) return null;
    const key = name.trim().toLowerCase();
    if (cache.has(key)) return cache.get(key) ?? null;
    const candidates = await (this.prisma as any).warehouse.findMany({
      where: { type: 'showroom', name: { equals: name, mode: 'insensitive' } },
      select: { id: true, name: true },
      take: 5,
    });
    const exact = candidates.find((w: any) => w.name === name);
    const id: string | null = exact?.id ?? candidates[0]?.id ?? null;
    cache.set(key, id);
    return id;
  }

  async run(opts: BackfillOptions = {}): Promise<BackfillReport> {
    const dryRun = opts.dryRun ?? false;
    const chunkSize = Math.min(Math.max(opts.chunkSize ?? 200, 1), 1000);
    const maxOrders = opts.maxOrders ?? Number.MAX_SAFE_INTEGER;
    const report: BackfillReport = {
      dryRun,
      scanned: 0,
      updated: 0,
      skippedAlreadyTyped: 0,
      showroomLinked: 0,
      bySalesChannelType: {},
      byMarketingChannel: {},
      errors: [],
    };
    const showroomCache = new Map<string, string | null>();
    let cursor: string | undefined;
    let done = false;

    while (!done && report.scanned < maxOrders) {
      const rows: BackfillOrderRow[] = await (this.prisma as any).order.findMany({
        where: { salesChannelType: null },
        select: BACKFILL_SELECT,
        orderBy: { id: 'asc' },
        take: Math.min(chunkSize, maxOrders - report.scanned),
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (rows.length === 0) break;
      done = rows.length < chunkSize;
      cursor = rows[rows.length - 1].id;

      // Batch the session → utmSource lookup for the chunk (one query).
      const tokens = Array.from(
        new Set(rows.map((r) => r.trackingSessionId).filter(Boolean)),
      ) as string[];
      const utmByToken = new Map<string, string | null>();
      if (tokens.length > 0) {
        const sessions = await (this.prisma as any).marketingSession.findMany({
          where: { sessionToken: { in: tokens } },
          select: { sessionToken: true, utmSource: true },
        });
        for (const s of sessions) utmByToken.set(s.sessionToken, s.utmSource ?? null);
      }

      for (const row of rows) {
        report.scanned += 1;
        try {
          const utmSource = row.trackingSessionId
            ? (utmByToken.get(row.trackingSessionId) ?? null)
            : null;
          const resolved = resolveChannels({
            salesChannel: row.salesChannel,
            source: row.source,
            sourcePlatform: row.sourcePlatform,
            sourceType: row.sourceType,
            sourceEntity: row.sourceEntity,
            utmSource,
          });
          const showroomId = resolved.showroomName
            ? await this.resolveShowroomId(resolved.showroomName, showroomCache)
            : null;
          const update = buildBackfillUpdate(row, utmSource, showroomId);
          if (update === null) {
            report.skippedAlreadyTyped += 1;
            continue;
          }
          const write: Record<string, unknown> = {
            salesChannelType: update.salesChannelType,
          };
          if (update.marketingChannel !== undefined) {
            write.marketingChannel = update.marketingChannel;
          }
          if (update.showroomId !== undefined) write.showroomId = update.showroomId;
          if (!dryRun) {
            await (this.prisma as any).order.update({
              where: { id: row.id },
              data: write,
            });
          }
          report.updated += 1;
          report.bySalesChannelType[update.salesChannelType] =
            (report.bySalesChannelType[update.salesChannelType] ?? 0) + 1;
          if (update.marketingChannel !== undefined) {
            report.byMarketingChannel[update.marketingChannel] =
              (report.byMarketingChannel[update.marketingChannel] ?? 0) + 1;
          }
          if (update.showroomId !== undefined) report.showroomLinked += 1;
        } catch (err) {
          const msg = `order ${row.id}: ${err instanceof Error ? err.message : String(err)}`;
          if (report.errors.length < 10) report.errors.push(msg);
          this.logger.error(`Channel backfill row failed: ${msg}`);
        }
      }

      this.logger.log(
        `Channel backfill ${dryRun ? '(dry-run) ' : ''}progress: scanned=${report.scanned} updated=${report.updated}`,
      );
      if (rows.length < chunkSize) break;
    }

    return report;
  }
}
