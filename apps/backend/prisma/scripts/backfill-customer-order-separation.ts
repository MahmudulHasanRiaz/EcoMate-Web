/**
 * Backfill for the customer/order data-separation migration
 * (20260930020000_customer_order_data_separation).
 *
 * Safety rules this script enforces, deliberately:
 *
 *  - DRY RUN IS THE DEFAULT. Nothing is written without `--apply`.
 *  - `Order.billingAddress` is NEVER backfilled. Fabricating a billing address
 *    from the shipping address would invent order history. Orders that did not
 *    capture a billing address keep an empty billing snapshot permanently.
 *  - `CustomerAddress` rows are NOT seeded by default. Seeding asserts canonical
 *    reusable customer data, which an order alone does not authorise. Opt in
 *    with `--seed-addresses` (requires `--apply`).
 *  - Latest-order selection is deterministic: `createdAt DESC, id DESC`. The id
 *    tiebreaker makes equal timestamps resolve to exactly one row on every run.
 *  - Latest-order telemetry is a MAX() over the customer's orders, so a
 *    customer can only move forward, never backward.
 *
 * Usage:
 *   npx tsx prisma/scripts/backfill-customer-order-separation.ts            # dry run
 *   npx tsx prisma/scripts/backfill-customer-order-separation.ts --apply
 *   npx tsx prisma/scripts/backfill-customer-order-separation.ts --apply --seed-addresses
 */
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

const connectionString =
  process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ecomate_web';
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const SEED_ADDRESSES = argv.includes('--seed-addresses');

interface Report {
  runAt: string;
  mode: 'apply' | 'dry-run';
  seedAddresses: boolean;
  lastOrderTelemetry: { scanned: number; updated: number; skippedAlreadyCurrent: number };
  billingAddress: { touched: number; note: string };
  customerAddresses: { seeded: number; skipped: number; note: string };
}

const report: Report = {
  runAt: new Date().toISOString(),
  mode: APPLY ? 'apply' : 'dry-run',
  seedAddresses: SEED_ADDRESSES,
  lastOrderTelemetry: { scanned: 0, updated: 0, skippedAlreadyCurrent: 0 },
  billingAddress: { touched: 0, note: 'never backfilled — see header comment' },
  customerAddresses: { seeded: 0, skipped: 0, note: 'not seeded unless --seed-addresses' },
};

/** Mirror of customer-address.util normalisation (kept inline to avoid an import cycle). */
function norm(v?: string | null): string {
  if (!v) return '';
  return String(v)
    .replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d)))
    .toLowerCase()
    .replace(/[.,/#\\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fingerprint(a: Record<string, any>): string {
  const parts = [
    a.fullName, a.phone, a.addressLine, a.area, a.thana,
    a.district, a.postalCode, a.country || 'bangladesh',
  ].map(norm);
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
}

function readAddress(json: unknown): Record<string, any> | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const a = json as Record<string, any>;
  const line = a.addressLine || a.address || a.street || a.house || '';
  if (!line) return null;
  return {
    fullName: a.fullName || a.name || '',
    phone: a.phone || a.phoneNumber || '',
    addressLine: line,
    area: a.area || '',
    thana: a.thana || a.upazila || '',
    district: a.district || a.city || '',
    division: a.division || a.state || '',
    postalCode: a.postalCode || a.postCode || a.zip || a.zipCode || '',
    country: a.country || 'Bangladesh',
  };
}

async function backfillLastOrderTelemetry() {
  // Deterministic latest order per customer: createdAt DESC, id DESC.
  // The id tiebreaker guarantees exactly one winner when timestamps tie.
  const rows = await prisma.$queryRaw<{ id: string; createdAt: Date; ipAddress: string | null }[]>`
    SELECT DISTINCT ON ("customerId")
      "customerId" AS id, "createdAt", "ipAddress"
    FROM "Order"
    WHERE "customerId" IS NOT NULL
    ORDER BY "customerId", "createdAt" DESC, id DESC
  `;
  report.lastOrderTelemetry.scanned = rows.length;

  for (const row of rows) {
    // MAX() semantics — a customer can only move forward in time.
    const where = {
      id: row.id,
      OR: [{ lastOrderAt: null as Date | null }, { lastOrderAt: { lt: row.createdAt } }],
    };
    if (!APPLY) {
      // Dry run must not write. Probe with the same guard so the report
      // reflects what --apply WOULD change, without touching a row.
      const current = await prisma.customerProfile.findFirst({
        where: { id: row.id },
        select: { lastOrderAt: true },
      });
      if (!current?.lastOrderAt || current.lastOrderAt < row.createdAt) {
        report.lastOrderTelemetry.updated += 1;
      } else {
        report.lastOrderTelemetry.skippedAlreadyCurrent += 1;
      }
      continue;
    }
    const res = await prisma.customerProfile.updateMany({ where, data: {
      lastOrderAt: row.createdAt,
      lastOrderIp: row.ipAddress ?? null,
    } });
    if (res.count > 0) report.lastOrderTelemetry.updated += res.count;
    else report.lastOrderTelemetry.skippedAlreadyCurrent += 1;
  }
}

async function seedCustomerAddresses() {
  if (!SEED_ADDRESSES) return;
  const orders = await prisma.order.findMany({
    where: { customerId: { not: null } },
    orderBy: { createdAt: 'desc' },
    take: 5000,
  });

  const seen = new Set<string>();
  for (const order of orders) {
    if (!order.customerId) continue;
    const shipping = readAddress(order.shippingAddress);
    const billing = readAddress(order.billingAddress);

    const candidates: { type: 'SHIPPING' | 'BILLING'; addr: Record<string, any> }[] = [];
    if (shipping) candidates.push({ type: 'SHIPPING', addr: shipping });
    if (billing) candidates.push({ type: 'BILLING', addr: billing });
    else if (shipping) {
      // Address-book role seeding is allowed to mirror shipping into a BILLING
      // role record. This is NOT writing an order billing snapshot — the two
      // operations are deliberately independent.
      candidates.push({ type: 'BILLING', addr: shipping });
    }

    for (const { type, addr } of candidates) {
      const hash = fingerprint(addr);
      const key = `${order.customerId}|${type}|${hash}`;
      if (seen.has(key)) {
        report.customerAddresses.skipped += 1;
        continue;
      }
      seen.add(key);
      if (APPLY) {
        await prisma.customerAddress.upsert({
          where: {
            customerProfileId_type_normalizedHash: {
              customerProfileId: order.customerId as string,
              type,
              normalizedHash: hash,
            },
          },
          create: {
            customerProfileId: order.customerId as string,
            type,
            normalizedHash: hash,
            fullName: addr.fullName,
            phone: addr.phone,
            addressLine: addr.addressLine,
            area: addr.area || null,
            thana: addr.thana || null,
            district: addr.district || null,
            division: addr.division || null,
            postalCode: addr.postalCode || null,
            country: addr.country,
            sourceOrderId: order.id,
          },
          update: {},
        });
      }
      report.customerAddresses.seeded += 1;
    }
  }
}

async function main() {
  console.log(`[backfill] mode=${report.mode} seedAddresses=${report.seedAddresses}`);

  await backfillLastOrderTelemetry();
  console.log(
    `[backfill] lastOrderTelemetry: scanned=${report.lastOrderTelemetry.scanned} ` +
      `updated=${report.lastOrderTelemetry.updated} ` +
      `skippedAlreadyCurrent=${report.lastOrderTelemetry.skippedAlreadyCurrent}`,
  );

  console.log(`[backfill] billingAddress: ${report.billingAddress.note}`);

  await seedCustomerAddresses();
  console.log(
    `[backfill] customerAddresses: seeded=${report.customerAddresses.seeded} ` +
      `skippedDuplicate=${report.customerAddresses.skipped}`,
  );

  const json = JSON.stringify(report, null, 2);
  if (APPLY) {
    const dir = path.join(process.cwd(), 'backfill-reports');
    await fs.mkdir(dir, { recursive: true });
    const out = path.join(dir, `backfill-customer-order-separation-${Date.now()}.json`);
    await fs.writeFile(out, json, 'utf8');
    console.log(`[backfill] APPLIED. Audit report written to ${out}`);
    console.log(json);
  } else {
    console.log('[backfill] DRY RUN — no rows were written. Re-run with --apply to write.');
    console.log(json);
  }
}

main()
  .catch((e) => {
    console.error('[backfill] FAILED', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
