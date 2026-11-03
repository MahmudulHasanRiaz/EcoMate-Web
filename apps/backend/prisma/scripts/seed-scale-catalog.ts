/**
 * Scale-test catalog seeder (Round-3 perf program, 2026-11-04).
 *
 * Staging carries ~13 products, so every speed score measured there is a
 * best case. Real clients run thousands of products with 10–20 images
 * each, their own logos and banners — the speed target has to hold at
 * THAT scale. This script seeds a realistic catalog through the REAL
 * media pipeline (originals on disk + BullMQ 'media' queue → the running
 * backend generates the genuine derivative manifests), then creates
 * products that reference those media URLs exactly like admin uploads do.
 *
 * Deliberately src-free (Prisma + BullMQ + sharp only) so it runs inside
 * the production backend image, where prisma/ is copied but src/ is not:
 *
 *   docker exec -it <backend-container> sh -c \
 *     "cd /app && npx tsx prisma/scripts/seed-scale-catalog.ts --apply"
 *
 * Invocation: (a) manually via container console, or (b) automatically in
 * the background at container startup — startup.sh does that ONLY when
 * ALLOW_SCALE_SEED=1 is set in the stack env (no stack sets it by
 * default; staging only, added deliberately via Portainer). Either way
 * it refuses to write unless BOTH production guards pass (see
 * PROD_DOMAINS / assertSeedAllowed below): the stack must not be a known
 * client production domain, and ALLOW_SCALE_SEED=1 must be present.
 *
 * LOCAL STORAGE ONLY: originals are written to <cwd>/uploads, mirroring
 * StorageService.uploadToLocal (`<uuid><ext>`, url `/uploads/<name>`).
 * On an R2 tenant the queue processor would not find the originals and
 * the jobs would fail loudly in the summary — do not use it there.
 *
 * DRY-RUN is the default (prints the plan, writes nothing).
 *
 * Flags:
 *   --apply               actually seed (required for any write)
 *   --products=1500       number of products
 *   --images-per=12       gallery size per product (drawn from the pool)
 *   --unique-images=240   distinct source images generated + processed
 *   --huge-every=12       every Nth source is a 4000px PNG (worst-case
 *                         client upload, several MB)
 *   --timeout-min=45      max wait for the derivative queue to drain
 *   --cleanup             remove everything this seeder created
 *                         (products/categories slug prefix `scale-seed-`,
 *                         media alt `SCALE-SEED`, files + derivative dirs)
 *
 * Safety: refuses to seed twice (existing scale-seed products) unless
 * --force is passed. Cleanup only ever touches scale-seed artefacts.
 */
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const ALT_TAG = 'SCALE-SEED';
const SLUG_PREFIX = 'scale-seed-';

/**
 * Production safety guards (owner requirement, 2026-11-04). This script
 * ships inside every backend image, so a manual run on the WRONG stack
 * must be impossible, not just unlikely:
 *
 *   Guard A — known client production domains (keep in sync with
 *   .github/clients.json): seeding is refused unconditionally, even if
 *   the opt-in flag were set there by mistake.
 *   Guard B — explicit opt-in: ALLOW_SCALE_SEED=1 must be present in the
 *   environment. No stack sets it by default; it has to be added to the
 *   staging stack's env on purpose before this script will write.
 *
 * Cleanup is guarded by A only (it can solely delete scale-seed
 * artefacts, which should never exist on a client).
 */
const PROD_DOMAINS = ['fixedplus.com.bd', 'avelto.bd'];

function currentHosts(): string[] {
  const hosts = new Set<string>();
  const domain = (process.env.CLIENT_DOMAIN || '').toLowerCase().trim();
  if (domain) hosts.add(domain.replace(/^www\./, ''));
  try {
    const h = new URL(process.env.BETTER_AUTH_URL || '').hostname.toLowerCase();
    if (h) hosts.add(h.replace(/^www\./, ''));
  } catch {
    /* BETTER_AUTH_URL unset/malformed — CLIENT_DOMAIN is the signal */
  }
  return [...hosts];
}

function assertNotProduction(): void {
  const hit = currentHosts().find((h) => PROD_DOMAINS.includes(h));
  if (hit) {
    throw new Error(
      `REFUSED: this stack is a known PRODUCTION client (${hit}). The scale seeder never runs there.`,
    );
  }
}

function assertSeedAllowed(): void {
  assertNotProduction();
  if (process.env.ALLOW_SCALE_SEED !== '1') {
    throw new Error(
      'REFUSED: ALLOW_SCALE_SEED=1 is not set. Add it to the STAGING stack env (Portainer) to enable the scale seeder there — never on a client stack.',
    );
  }
}

function arg(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!raw) return fallback;
  const n = Number(raw.split('=')[1]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');
const CLEANUP = process.argv.includes('--cleanup');
const PRODUCTS = arg('products', 1500);
const IMAGES_PER = arg('images-per', 12);
const UNIQUE_IMAGES = arg('unique-images', 240);
const HUGE_EVERY = arg('huge-every', 12);
const TIMEOUT_MIN = arg('timeout-min', 45);

const uploadsDir = resolve(process.cwd(), 'uploads');

/** Deterministic PRNG so re-runs generate the same scenes. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A photo-like synthetic scene (gradient + shapes + index) as SVG. */
function sceneSvg(w: number, h: number, idx: number): string {
  const rnd = mulberry32(idx * 7919 + 13);
  const hue = Math.floor(rnd() * 360);
  const shapes: string[] = [];
  for (let i = 0; i < 26; i++) {
    const x = Math.floor(rnd() * w);
    const y = Math.floor(rnd() * h);
    const r = Math.floor(30 + rnd() * (w / 5));
    const hh = Math.floor(hue + rnd() * 90 - 45);
    shapes.push(
      `<circle cx="${x}" cy="${y}" r="${r}" fill="hsl(${hh},55%,${35 + rnd() * 35}%)" opacity="0.75"/>`,
    );
  }
  for (let i = 0; i < 10; i++) {
    const x = Math.floor(rnd() * w);
    const y = Math.floor(rnd() * h);
    const rw = Math.floor(60 + rnd() * (w / 3));
    const rh = Math.floor(40 + rnd() * (h / 3));
    const hh = Math.floor(hue + rnd() * 140 - 70);
    shapes.push(
      `<rect x="${x}" y="${y}" width="${rw}" height="${rh}" rx="18" fill="hsl(${hh},60%,${30 + rnd() * 40}%)" opacity="0.7"/>`,
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="hsl(${hue},65%,72%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360},65%,38%)"/>
</linearGradient></defs>
<rect width="${w}" height="${h}" fill="url(#g)"/>${shapes.join('')}
<text x="${w / 2}" y="${h / 2}" font-family="sans-serif" font-size="${Math.floor(w / 9)}" font-weight="bold" fill="rgba(255,255,255,0.85)" text-anchor="middle">SCALE ${idx}</text>
</svg>`;
}

async function makeSourceImage(
  sharp: any,
  idx: number,
): Promise<{ buffer: Buffer; ext: string; mimeType: string; width: number; height: number }> {
  const huge = idx % HUGE_EVERY === 0;
  if (huge) {
    const width = 4000;
    const height = 2250;
    const buffer = await sharp(Buffer.from(sceneSvg(width, height, idx)))
      .png()
      .toBuffer();
    return { buffer, ext: '.png', mimeType: 'image/png', width, height };
  }
  const width = 1600;
  const height = 1200;
  const buffer = await sharp(Buffer.from(sceneSvg(width, height, idx)))
    .jpeg({ quality: 84 })
    .toBuffer();
  return { buffer, ext: '.jpg', mimeType: 'image/jpeg', width, height };
}

async function cleanup(prisma: PrismaClient): Promise<void> {
  const media = await prisma.media.findMany({
    where: { alt: ALT_TAG },
    select: { id: true, filename: true },
  });
  const products = await prisma.product.count({
    where: { slug: { startsWith: SLUG_PREFIX } },
  });
  console.log(
    `[seed-scale] cleanup plan: ${products} products, ${media.length} media rows + files`,
  );
  if (!APPLY) {
    console.log('[seed-scale] DRY-RUN — pass --apply --cleanup to execute');
    return;
  }
  await prisma.product.deleteMany({ where: { slug: { startsWith: SLUG_PREFIX } } });
  await prisma.category.deleteMany({ where: { slug: { startsWith: SLUG_PREFIX } } });
  let files = 0;
  for (const m of media) {
    await rm(join(uploadsDir, m.filename), { force: true });
    await rm(join(uploadsDir, 'derivatives', m.id), { recursive: true, force: true });
    files++;
  }
  await prisma.media.deleteMany({ where: { alt: ALT_TAG } });
  console.log(`[seed-scale] cleanup done: removed files for ${files} media`);
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    if (CLEANUP) {
      assertNotProduction();
      await cleanup(prisma);
      return;
    }
    assertSeedAllowed();

    const existing = await prisma.product.count({
      where: { slug: { startsWith: SLUG_PREFIX } },
    });
    console.log(
      `[seed-scale] plan: products=${PRODUCTS} imagesPer=${IMAGES_PER} uniqueImages=${UNIQUE_IMAGES} hugeEvery=${HUGE_EVERY} existingSeeded=${existing} mode=${APPLY ? 'APPLY' : 'DRY-RUN'}`,
    );
    if (!APPLY) {
      console.log('[seed-scale] DRY-RUN — pass --apply to seed');
      return;
    }
    if (existing > 0 && !FORCE) {
      throw new Error(
        `Refusing to seed: ${existing} scale-seed products already exist (use --cleanup first, or --force)`,
      );
    }
    if (!existsSync(uploadsDir)) {
      throw new Error(`Uploads dir not found: ${uploadsDir} (run inside the backend container)`);
    }

    const sharp = (await import('sharp')).default;

    // ── 1. Source images through the real pipeline ──────────────────────
    const startedAt = Date.now();
    const mediaIds: string[] = [];
    const mediaUrls: string[] = [];
    for (let i = 1; i <= UNIQUE_IMAGES; i++) {
      const img = await makeSourceImage(sharp, i);
      const filename = `${randomUUID()}${img.ext}`;
      await writeFile(join(uploadsDir, filename), img.buffer);
      const hash = createHash('sha256').update(img.buffer).digest('hex');
      const created = await prisma.media.create({
        data: {
          filename,
          url: `/uploads/${filename}`,
          mimeType: img.mimeType,
          size: img.buffer.length,
          hash,
          alt: ALT_TAG,
          width: img.width,
          height: img.height,
          uploadedBy: 'scale-seed-script',
          processingStatus: 'UPLOADED',
        },
      });
      mediaIds.push(created.id);
      mediaUrls.push(created.url);
      if (i % 25 === 0) console.log(`[seed-scale] ingested ${i}/${UNIQUE_IMAGES} originals`);
    }

    const redisUrl = new URL(process.env.REDIS_URL || 'redis://redis:6379');
    const queue = new Queue('media', {
      connection: {
        host: redisUrl.hostname,
        port: Number(redisUrl.port || 6379),
        password: redisUrl.password || undefined,
      },
    });
    await queue.addBulk(
      mediaIds.map((mediaId) => ({
        name: 'process',
        data: { mediaId },
        opts: {
          jobId: `media-${mediaId}`,
          attempts: 3,
          backoff: { type: 'exponential' as const, delay: 5000 },
          removeOnComplete: true,
        },
      })),
    );
    console.log(`[seed-scale] queued ${mediaIds.length} derivative jobs — waiting for the backend to process…`);

    // ── 2. Wait for the queue to drain (measures pipeline throughput) ──
    const deadline = Date.now() + TIMEOUT_MIN * 60_000;
    let ready = 0;
    let failed = 0;
    for (;;) {
      const grouped = await prisma.media.groupBy({
        by: ['processingStatus'],
        where: { id: { in: mediaIds } },
        _count: { _all: true },
      });
      const by = Object.fromEntries(grouped.map((g) => [g.processingStatus, g._count._all]));
      ready = by['READY'] ?? 0;
      failed = by['FAILED'] ?? 0;
      const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
      console.log(
        `[seed-scale] processing: ready=${ready} failed=${failed} pending=${mediaIds.length - ready - failed} elapsed=${elapsed}s`,
      );
      if (ready + failed >= mediaIds.length) break;
      if (Date.now() > deadline) {
        console.log('[seed-scale] TIMEOUT waiting for derivatives — continuing with what is READY');
        break;
      }
      await new Promise((r) => setTimeout(r, 10_000));
    }
    await queue.close();
    const readyUrls = (
      await prisma.media.findMany({
        where: { id: { in: mediaIds }, processingStatus: 'READY' },
        select: { url: true },
      })
    ).map((m) => m.url);
    if (readyUrls.length === 0) {
      throw new Error('No media became READY — is the backend running and storage LOCAL?');
    }
    const minutes = (Date.now() - startedAt) / 60_000;
    console.log(
      `[seed-scale] pipeline: ${ready} READY in ${minutes.toFixed(1)} min (${(ready / Math.max(minutes, 0.01)).toFixed(1)} images/min), ${failed} FAILED`,
    );

    // ── 3. Categories + products ────────────────────────────────────────
    const categories = await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        prisma.category.upsert({
          where: { slug: `${SLUG_PREFIX}cat-${n}` },
          create: { name: `SCALE-SEED Category ${n}`, slug: `${SLUG_PREFIX}cat-${n}` },
          update: {},
        }),
      ),
    );
    const rows = Array.from({ length: PRODUCTS }, (_, k) => {
      const i = k + 1;
      const images = Array.from({ length: IMAGES_PER }, (_, j) => {
        return readyUrls[(i * 7 + j * 13) % readyUrls.length];
      });
      const base = 500 + ((i * 37) % 9500);
      const managed = i % 5 === 0;
      return {
        name: `SCALE-SEED Product ${i}`,
        slug: `${SLUG_PREFIX}${i}`,
        sku: `SCALE-${i}`,
        basePrice: base.toFixed(2),
        salePrice: i % 3 === 0 ? Math.round(base * 0.85).toFixed(2) : null,
        availabilityMode: (managed ? 'MANAGED_STOCK' : 'ALWAYS_IN_STOCK') as never,
        managedStockQuantity: managed ? 25 : 0,
        manageStock: managed,
        isFeatured: i <= 12,
        categoryId: categories[k % categories.length].id,
        images,
        tags: ['scale-seed'],
        status: 'active',
        isActive: true,
      };
    });
    for (let b = 0; b < rows.length; b += 100) {
      await prisma.product.createMany({ data: rows.slice(b, b + 100) as never });
      console.log(`[seed-scale] products ${Math.min(b + 100, rows.length)}/${rows.length}`);
    }
    console.log(
      `[seed-scale] DONE: ${PRODUCTS} products, ${readyUrls.length} processed images in the pool, ${((Date.now() - startedAt) / 60_000).toFixed(1)} min total`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[seed-scale] FAILED:', err);
  process.exit(1);
});
