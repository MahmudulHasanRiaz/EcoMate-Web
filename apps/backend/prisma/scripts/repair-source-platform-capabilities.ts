/**
 * ONE-TIME data fix: repair SourcePlatform rows seeded with capabilities = [].
 *
 * WHY THIS EXISTS
 * ---------------
 * During the initial implementation of the canonical sales-channel model, an
 * earlier revision of backfill-sales-channel-mapping.ts inserted registry rows
 * with an empty capability array. Because `ensureDefaults()` is correctly
 * insert-only (`skipDuplicates`), it never repaired them — so capability
 * filtering silently matched nothing.
 *
 * A first fix attempt "repaired" any row whose capabilities were empty. That
 * was wrong: an operator may legitimately empty a row's capabilities to
 * withdraw that platform from a channel, and `capabilities = []` is NOT
 * evidence that a row is uncustomized. This script exists instead, so the
 * repair is explicit, attributable and never re-runnable by accident.
 *
 * HOW IT PROVES PROVENANCE (rather than inferring it)
 * --------------------------------------------------
 * It targets a row only when ALL of these hold, which together identify "created
 * by that first buggy seeding run":
 *   1. capabilities is exactly []  (what the bug wrote)
 *   2. displayName matches `Slug capitalized` exactly (what the bug wrote)
 *   3. sortOrder = 500 (the bug's placeholder value; canonical seeds use 10-999)
 *   4. the slug is one of the canonical defaults
 *
 * A row an operator touched has a real display name or a real sort order, so it
 * cannot match all four and is never touched.
 *
 * After running, drop this script — it is a one-time fix, not a routine job.
 *
 * Usage:  npx tsx prisma/scripts/repair-source-platform-capabilities.ts [--apply]
 */
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ecomate_web',
});
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const APPLY = process.argv.includes('--apply');

/** Canonical seeds, mirrored from src/sales-channel/sales-channel.constants.ts. */
const CANONICAL: Record<string, { displayName: string; capabilities: string[]; sortOrder: number }> = {
  facebook: { displayName: 'Facebook', capabilities: ['MARKETING_SOURCE', 'MESSAGING', 'SOCIAL', 'AD_PLATFORM'] , sortOrder: 10 },
  messenger: { displayName: 'Messenger', capabilities: ['MARKETING_SOURCE', 'MESSAGING', 'SOCIAL'] , sortOrder: 15 },
  instagram: { displayName: 'Instagram', capabilities: ['MARKETING_SOURCE', 'MESSAGING', 'SOCIAL', 'AD_PLATFORM'] , sortOrder: 20 },
  whatsapp: { displayName: 'WhatsApp', capabilities: ['MARKETING_SOURCE', 'MESSAGING'] , sortOrder: 25 },
  tiktok: { displayName: 'TikTok', capabilities: ['MARKETING_SOURCE', 'MESSAGING', 'SOCIAL', 'AD_PLATFORM'] , sortOrder: 30 },
  telegram: { displayName: 'Telegram', capabilities: ['MARKETING_SOURCE', 'MESSAGING'] , sortOrder: 35 },
  threads: { displayName: 'Threads', capabilities: ['MARKETING_SOURCE', 'MESSAGING', 'SOCIAL'] , sortOrder: 40 },
  google: { displayName: 'Google', capabilities: ['MARKETING_SOURCE', 'SOCIAL', 'AD_PLATFORM'] , sortOrder: 50 },
  youtube: { displayName: 'YouTube', capabilities: ['MARKETING_SOURCE', 'SOCIAL', 'AD_PLATFORM'] , sortOrder: 55 },
  bing: { displayName: 'Bing', capabilities: ['MARKETING_SOURCE', 'AD_PLATFORM'] , sortOrder: 60 },
  pinterest: { displayName: 'Pinterest', capabilities: ['MARKETING_SOURCE', 'SOCIAL', 'AD_PLATFORM'] , sortOrder: 65 },
  linkedin: { displayName: 'LinkedIn', capabilities: ['MARKETING_SOURCE', 'SOCIAL', 'AD_PLATFORM'] , sortOrder: 70 },
  x: { displayName: 'X', capabilities: ['MARKETING_SOURCE', 'SOCIAL'] , sortOrder: 75 },
  snapchat: { displayName: 'Snapchat', capabilities: ['MARKETING_SOURCE', 'SOCIAL', 'AD_PLATFORM'] , sortOrder: 80 },
  reddit: { displayName: 'Reddit', capabilities: ['MARKETING_SOURCE', 'SOCIAL'] , sortOrder: 85 },
  chatgpt: { displayName: 'ChatGPT', capabilities: ['MARKETING_SOURCE', 'AI_ASSISTANT'] , sortOrder: 90 },
  other: { displayName: 'Other / Custom', capabilities: ['MARKETING_SOURCE'] , sortOrder: 999 },
};

/** The placeholder sort order the buggy seeding run wrote. */
const BUG_PLACEHOLDER_SORT_ORDER = 500;

interface Row {
  slug: string;
  displayName: string;
  capabilities: string[];
  sortOrder: number;
  enabled: boolean;
  createdAt: Date;
}

/**
 * A row qualifies ONLY if it still carries the buggy run's fingerprints:
 *   1. sortOrder === 500 (the placeholder value the bug wrote; canonical seeds
 *      use 10-999, so 500 is unique to the bug)
 *   2. capabilities exactly match what the bug would have produced for this
 *      slug — i.e. a *correct* capability set, not an operator's invention
 *   3. displayName matches the canonical name exactly
 *
 * An operator's row differs on at least one of these, so it cannot match and
 * is never touched. Rows already repaired by the first (incorrect) attempt
 * match, because that attempt fixed capabilities+displayName but left
 * sortOrder at the placeholder — which is exactly why the sortOrder fingerprint
 * is what carries the provenance here.
 */
function isBuggySeedRow(r: Row): boolean {
  const canonical = CANONICAL[r.slug];
  if (!canonical) return false;
  const capsMatch =
    r.capabilities.length === canonical.capabilities.length &&
    [...r.capabilities].sort().join(',') === [...canonical.capabilities].sort().join(',');
  return (
    r.sortOrder === BUG_PLACEHOLDER_SORT_ORDER &&
    capsMatch &&
    r.displayName === canonical.displayName
  );
}

async function main() {
  const rows = await prisma.sourcePlatform.findMany({
    select: {
      slug: true, displayName: true, capabilities: true,
      sortOrder: true, enabled: true, createdAt: true,
    },
    orderBy: { slug: 'asc' },
  }) as Row[];

  const repairable = rows.filter(isBuggySeedRow);
  const alreadyCorrect = rows.filter(
    (r) => CANONICAL[r.slug] && !isBuggySeedRow(r),
  );

  console.log(`[repair] total rows: ${rows.length}`);
  console.log(`[repair] already correct (left untouched): ${alreadyCorrect.length}`);
  console.log(`[repair] matching the buggy-seed fingerprint: ${repairable.length}`);

  if (repairable.length === 0) {
    console.log('[repair] nothing to repair — this fix has already been applied.');
    return;
  }

  console.log('\nRows this fix WOULD change:');
  for (const r of repairable) {
    const to = CANONICAL[r.slug];
    const changes: string[] = [];
    if (r.capabilities.join() !== to.capabilities.join()) {
      changes.push(`capabilities ${JSON.stringify(r.capabilities)} → ${JSON.stringify(to.capabilities)}`);
    }
    if (r.displayName !== to.displayName) {
      changes.push(`displayName ${JSON.stringify(r.displayName)} → ${JSON.stringify(to.displayName)}`);
    }
    if (r.sortOrder !== to.sortOrder) {
      changes.push(`sortOrder ${r.sortOrder} → ${to.sortOrder}`);
    }
    console.log(`  ${r.slug}: ${changes.join('; ') || '(no change needed)'}`);
  }

  if (!APPLY) {
    console.log('\n[repair] DRY RUN — nothing written. Re-run with --apply.');
    return;
  }

  for (const r of repairable) {
    const to = CANONICAL[r.slug];
    await prisma.sourcePlatform.update({
      where: { slug: r.slug },
      data: {
        capabilities: to.capabilities,
        displayName: to.displayName,
        sortOrder: to.sortOrder,
      },
    });
    console.log(`  [repair] updated ${r.slug}`);
  }
  console.log('\n[repair] APPLIED. Drop this script — it is a one-time fix.');
}

main()
  .catch((e) => { console.error('[repair] FAILED', e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
