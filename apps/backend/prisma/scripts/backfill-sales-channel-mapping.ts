/**
 * Backfill: historical orders → canonical sales-attribution dimensions.
 *
 * SAFETY MODEL
 * ------------
 * 1. BOUNDARY. A deterministic cutoff is captured once and only rows at or
 *    before it are processed. Anything created later was made by the new
 *    runtime, which writes canonical fields itself.
 *
 * 2. MARKER, NOT VALUE. The work set is `channelMappedAt IS NULL`. Using
 *    `channel IS NULL` as the guard would be a bug: for 278 of 449 historical
 *    orders a NULL channel is the CORRECT answer, so that guard would either
 *    skip them forever or re-process them on every run.
 *
 * 3. NEVER OVERWRITE. A row carrying `channelMappedAt` is skipped even if its
 *    canonical value is NULL — which is exactly the case the previous point
 *    protects.
 *
 * 4. LEGACY UNTOUCHED. Only four new columns plus the marker are written. No
 *    legacy column is read for update or rewritten, no order is deleted, and
 *    no campaign/UTM/click-id evidence is touched.
 *
 * 5. FK-SAFE. `sourceSlug` only ever receives a value present in the registry,
 *    seeded BEFORE the mapping runs.
 *
 * Usage:
 *   npx tsx prisma/scripts/backfill-sales-channel-mapping.ts             # dry run
 *   npx tsx prisma/scripts/backfill-sales-channel-mapping.ts --apply
 *   npx tsx prisma/scripts/backfill-sales-channel-mapping.ts --apply --boundary <ISO>
 */
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as fs from 'fs/promises';
import * as path from 'path';

const connectionString =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ecomate_web';
const pool = new Pool({ connectionString });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const boundaryArg = (() => {
  const i = argv.indexOf('--boundary');
  return i >= 0 ? argv[i + 1] : undefined;
})();

/**
 * Registry seeds, mirrored from sales-channel.constants.ts.
 *
 * MESSAGING is granted only to platforms that genuinely carry a conversation.
 * `google` is excluded because Google Business Profile's native chat was
 * discontinued on 2024-07-31, and `chatgpt` is a marketing/AI source that is
 * deliberately not a messaging platform.
 */
const REGISTRY_SEEDS: {
  slug: string; displayName: string; capabilities: string[]; sortOrder: number;
}[] = [
  { slug: 'facebook', displayName: 'Facebook', capabilities: ['MARKETING_SOURCE', 'MESSAGING', 'SOCIAL', 'AD_PLATFORM'], sortOrder: 10 },
  { slug: 'instagram', displayName: 'Instagram', capabilities: ['MARKETING_SOURCE', 'MESSAGING', 'SOCIAL', 'AD_PLATFORM'], sortOrder: 20 },
  { slug: 'whatsapp', displayName: 'WhatsApp', capabilities: ['MARKETING_SOURCE', 'MESSAGING'], sortOrder: 25 },
  { slug: 'tiktok', displayName: 'TikTok', capabilities: ['MARKETING_SOURCE', 'MESSAGING', 'SOCIAL', 'AD_PLATFORM'], sortOrder: 30 },
  { slug: 'telegram', displayName: 'Telegram', capabilities: ['MARKETING_SOURCE', 'MESSAGING'], sortOrder: 35 },
  { slug: 'threads', displayName: 'Threads', capabilities: ['MARKETING_SOURCE', 'MESSAGING', 'SOCIAL'], sortOrder: 40 },
  { slug: 'google', displayName: 'Google', capabilities: ['MARKETING_SOURCE', 'SOCIAL', 'AD_PLATFORM'], sortOrder: 50 },
  { slug: 'youtube', displayName: 'YouTube', capabilities: ['MARKETING_SOURCE', 'SOCIAL', 'AD_PLATFORM'], sortOrder: 55 },
  { slug: 'bing', displayName: 'Bing', capabilities: ['MARKETING_SOURCE', 'AD_PLATFORM'], sortOrder: 60 },
  { slug: 'pinterest', displayName: 'Pinterest', capabilities: ['MARKETING_SOURCE', 'SOCIAL', 'AD_PLATFORM'], sortOrder: 65 },
  { slug: 'linkedin', displayName: 'LinkedIn', capabilities: ['MARKETING_SOURCE', 'SOCIAL', 'AD_PLATFORM'], sortOrder: 70 },
  { slug: 'x', displayName: 'X', capabilities: ['MARKETING_SOURCE', 'SOCIAL'], sortOrder: 75 },
  { slug: 'snapchat', displayName: 'Snapchat', capabilities: ['MARKETING_SOURCE', 'SOCIAL', 'AD_PLATFORM'], sortOrder: 80 },
  { slug: 'reddit', displayName: 'Reddit', capabilities: ['MARKETING_SOURCE', 'SOCIAL'], sortOrder: 85 },
  { slug: 'chatgpt', displayName: 'ChatGPT', capabilities: ['MARKETING_SOURCE', 'AI_ASSISTANT'], sortOrder: 90 },
  { slug: 'other', displayName: 'Other / Custom', capabilities: ['MARKETING_SOURCE'], sortOrder: 999 },
];

/** Every slug the FK column may reference. */
const REGISTRY_SLUGS = new Set(REGISTRY_SEEDS.map((s) => s.slug));

const LEGACY_PLATFORM_TO_SLUG: Record<string, string> = {
  GOOGLE: 'google', FACEBOOK: 'facebook', INSTAGRAM: 'instagram',
  TIKTOK: 'tiktok', WHATSAPP: 'whatsapp', THREADS: 'threads',
  TELEGRAM: 'telegram', YOUTUBE: 'youtube',
  BING: 'bing', PINTEREST: 'pinterest', LINKEDIN: 'linkedin',
  TWITTER: 'x', X: 'x', SNAPCHAT: 'snapchat', REDDIT: 'reddit',
  CHATGPT: 'chatgpt',
};
const NON_PLATFORM = new Set(['POS', 'PHONE', 'LEAD', 'EXTERNAL_STORE', 'DIRECT']);
const LEGACY_CHANNEL_TO_SOURCE: Record<string, string> = {
  FACEBOOK: 'facebook', INSTAGRAM: 'instagram', TIKTOK: 'tiktok',
  MESSENGER: 'facebook', WHATSAPP: 'whatsapp', THREADS: 'threads',
};

type Channel = 'WEBSITE' | 'MESSAGING' | 'PHONE_CALL' | 'POS' | null;
type Acquisition = 'PAID' | 'ORGANIC' | 'DIRECT' | 'UNKNOWN' | null;

interface Mapping {
  channel: Channel;
  channelEntity: string | null;
  sourceSlug: string | null;
  acquisitionType: Acquisition;
  reason: string;
}

const none = (reason: string): Mapping => ({
  channel: null, channelEntity: null, sourceSlug: null, acquisitionType: null, reason,
});

const ent = (v?: string | null) => (v ?? '').trim() || null;

function slugFor(platform?: string | null): string | null {
  const raw = (platform ?? '').trim();
  if (!raw) return null;
  const up = raw.toUpperCase();
  if (NON_PLATFORM.has(up)) return null;
  const slug = LEGACY_PLATFORM_TO_SLUG[up] ?? null;
  // Defence in depth: never write a slug the registry does not contain.
  return slug && REGISTRY_SLUGS.has(slug) ? slug : null;
}

function utmMedium(attribution: unknown): string | null {
  const m = (attribution as any)?.utm?.medium;
  return typeof m === 'string' ? m.trim().toLowerCase() || null : null;
}

const PAID_UTM = new Set(['cpc', 'ppc', 'paid', 'cpm', 'cpe', 'cpv', 'cpa']);
const PAID_METHODS = new Set(['click_id', 'utm', 'conversion_api', 'pixel']);

function mapOrder(o: any): Mapping {
  const platform = (o.sourcePlatform ?? '').trim().toUpperCase();
  const type = (o.sourceType ?? '').trim().toUpperCase();
  const channel = (o.salesChannel ?? '').trim().toUpperCase();
  const e = ent(o.sourceEntity);

  // Stronger evidence first.
  if (platform === 'POS' && type === 'SHOWROOM') {
    return { channel: 'POS', channelEntity: e, sourceSlug: null, acquisitionType: null,
      reason: 'showroom evidence (sourcePlatform=POS, sourceType=SHOWROOM)' };
  }
  if (type === 'SHOWROOM') {
    return { channel: 'POS', channelEntity: e, sourceSlug: null, acquisitionType: null,
      reason: 'showroom evidence (sourceType=SHOWROOM)' };
  }
  if (platform === 'EXTERNAL_STORE') {
    // An integration, not a marketing platform.
    return { channel: 'WEBSITE', channelEntity: e, sourceSlug: null, acquisitionType: null,
      reason: 'external store integration (not a marketing platform)' };
  }

  if (type === 'AD') {
    const method = (o.attributionMethod ?? '').trim().toLowerCase();
    const medium = utmMedium(o.attribution);
    const corrob = PAID_METHODS.has(method)
      ? `+ ${method} attribution`
      : medium && PAID_UTM.has(medium) ? `+ utm medium '${medium}'` : null;
    return { channel: 'WEBSITE', channelEntity: e, sourceSlug: slugFor(o.sourcePlatform),
      acquisitionType: 'PAID', reason: `paid evidence (sourceType=AD${corrob ? ` ${corrob}` : ''})` };
  }

  if (type === 'DIRECT') {
    const slug = slugFor(o.sourcePlatform);
    if (slug) {
      return { channel: channel === 'CALL' ? 'PHONE_CALL' : 'WEBSITE', channelEntity: e,
        sourceSlug: slug, acquisitionType: 'ORGANIC',
        reason: 'known referrer platform, unpaid (sourceType=DIRECT)' };
    }
    // Resolver no-signal default — NOT organic.
    return { channel: channel === 'CALL' ? 'PHONE_CALL' : 'WEBSITE', channelEntity: e,
      sourceSlug: null, acquisitionType: 'DIRECT',
      reason: 'no marketing referrer established (sourceType=DIRECT, no platform)' };
  }

  if (type === 'CHAT') {
    return { channel: 'MESSAGING', channelEntity: e, sourceSlug: slugFor(o.sourcePlatform),
      acquisitionType: null, reason: 'chat entry evidence (sourceType=CHAT)' };
  }

  switch (channel) {
    case 'WEBSITE':
      return { channel: 'WEBSITE', channelEntity: e, sourceSlug: null,
        acquisitionType: 'UNKNOWN', reason: 'venue explicit; resolver ran and matched no platform' };
    case 'POS':
      return { channel: 'POS', channelEntity: e, sourceSlug: null, acquisitionType: null,
        reason: 'venue explicit (POS); no acquisition evidence' };
    case 'CALL':
      return { channel: 'PHONE_CALL', channelEntity: e, sourceSlug: null, acquisitionType: null,
        reason: 'venue explicit (phone call); no acquisition evidence' };
    case 'FACEBOOK': case 'INSTAGRAM': case 'TIKTOK':
    case 'MESSENGER': case 'WHATSAPP': case 'THREADS':
      return { channel: 'MESSAGING', channelEntity: e,
        sourceSlug: LEGACY_CHANNEL_TO_SOURCE[channel] ?? null, acquisitionType: null,
        reason: `legacy salesChannel '${channel}' named a platform, not a venue` };
    case 'WALK_IN':
      return none(`insufficient evidence: 'WALK_IN' does not establish a venue (not mapped to POS)`);
    case 'OFFLINE':
      return none(`insufficient evidence: 'OFFLINE' names no venue and no chat evidence`);
    case 'OTHER':
      return none(`insufficient evidence: 'OTHER' states nothing about the venue`);
    default:
      return none(`insufficient evidence: no channel recorded (salesChannel=${channel || 'NULL'})`);
  }
}

async function main() {
  const startedAt = Date.now();

  // Deterministic boundary: explicit when supplied, otherwise the max order
  // createdAt at the moment the run begins. Either way it is recorded, so a
  // re-run can be given the identical boundary.
  const boundary = boundaryArg
    ? new Date(boundaryArg)
    : new Date(
        (await prisma.order.aggregate({ _max: { createdAt: true } }))._max.createdAt ??
          Date.now(),
      );
  if (Number.isNaN(boundary.getTime())) {
    throw new Error(`Invalid --boundary value: ${boundaryArg}`);
  }

  // Ensure every slug the FK may reference EXISTS, before mapping runs.
  // This is INSERT-ONLY and deliberately never updates an existing row. A row
  // that already exists is left completely alone — an operator may have
  // emptied its capabilities to withdraw a platform from a channel, and
  // "capabilities = []" must never be read as "uncustomized". Repairing rows
  // seeded incorrectly by an earlier run belongs in a one-time controlled
  // data-fix, not here.
  const existing = await prisma.sourcePlatform.findMany({ select: { slug: true } });
  const existingSlugs = new Set(existing.map((r) => r.slug));

  for (const seed of REGISTRY_SEEDS) {
    if (existingSlugs.has(seed.slug)) continue;
    await prisma.sourcePlatform.create({
      data: {
        slug: seed.slug,
        displayName: seed.displayName,
        capabilities: seed.capabilities,
        sortOrder: seed.sortOrder,
      },
    });
  }

  const rows = await prisma.$queryRaw<
    {
      id: string; sourcePlatform: string | null; sourceType: string | null;
      salesChannel: string | null; sourceEntity: string | null;
      attribution: unknown; attributionMethod: string | null;
    }[]
  >`
    SELECT o.id,
           o."sourcePlatform", o."sourceType", o."salesChannel"::text AS "salesChannel",
           o."sourceEntity", o.attribution,
           a."method" AS "attributionMethod"
      FROM "Order" o
      LEFT JOIN "OrderAttribution" a ON a."orderId" = o.id
     WHERE o."channelMappedAt" IS NULL
       AND o."createdAt" <= ${boundary}
     ORDER BY o."createdAt" ASC, o.id ASC
  `;

  const updates: { id: string; mapping: Mapping }[] = [];
  const byChannel: Record<string, number> = {};
  const byAcquisition: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  const platformReport = new Map<string, { slug: string | null; channel: Channel; acquisition: Acquisition; count: number; reason: string }>();
  let nullChannel = 0, nullSource = 0, nullAcquisition = 0;

  for (const r of rows) {
    const m = mapOrder(r);
    updates.push({ id: r.id, mapping: m });

    const chKey = m.channel ?? 'NULL';
    const acKey = m.acquisitionType ?? 'NULL';
    const soKey = m.sourceSlug ?? 'NULL';
    byChannel[chKey] = (byChannel[chKey] ?? 0) + 1;
    byAcquisition[acKey] = (byAcquisition[acKey] ?? 0) + 1;
    bySource[soKey] = (bySource[soKey] ?? 0) + 1;
    if (!m.channel) nullChannel++;
    if (!m.sourceSlug) nullSource++;
    if (!m.acquisitionType) nullAcquisition++;

    // [C5] Every distinct legacy platform value appears in the report.
    const pk = (r.sourcePlatform ?? 'NULL').toUpperCase();
    const prev = platformReport.get(pk);
    if (prev) prev.count++;
    else {
      platformReport.set(pk, {
        slug: m.sourceSlug, channel: m.channel, acquisition: m.acquisitionType,
        count: 1, reason: m.reason,
      });
    }
  }

  if (APPLY) {
    // Transactional: a mid-run failure leaves every row untouched.
    await prisma.$transaction(async (tx) => {
      for (const u of updates) {
        await tx.order.update({
          where: { id: u.id },
          data: {
            channel: u.mapping.channel,
            channelEntity: u.mapping.channelEntity,
            sourceSlug: u.mapping.sourceSlug,
            acquisitionType: u.mapping.acquisitionType,
            channelMappedAt: new Date(),
          },
        });
      }
    });
  }

  const report = {
    runAt: new Date().toISOString(),
    mode: APPLY ? 'apply' : 'dry-run',
    boundary: boundary.toISOString(),
    durationMs: Date.now() - startedAt,
    candidates: rows.length,
    written: APPLY ? updates.length : 0,
    byChannel, byAcquisition, bySource,
    nullCounts: { channel: nullChannel, source: nullSource, acquisition: nullAcquisition },
    platformMapping: [...platformReport.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .map(([platform, v]) => ({ platform, ...v })),
  };

  const json = JSON.stringify(report, null, 2);
  if (APPLY) {
    const dir = path.join(process.cwd(), 'backfill-reports');
    await fs.mkdir(dir, { recursive: true });
    const out = path.join(dir, `sales-channel-mapping-${Date.now()}.json`);
    await fs.writeFile(out, json, 'utf8');
    console.log(`[backfill] APPLIED. Report: ${out}`);
  } else {
    console.log('[backfill] DRY RUN — nothing written. Re-run with --apply.');
  }
  console.log(json);
}

main()
  .catch((e) => { console.error('[backfill] FAILED', e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
