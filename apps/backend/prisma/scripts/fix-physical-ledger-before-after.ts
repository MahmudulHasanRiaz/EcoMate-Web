import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('[Migration] Starting PhysicalInventoryLedger before/after recalculation...');

  // Fetch all ledger entries ordered by product, warehouse, then time
  const allEntries = await prisma.physicalInventoryLedger.findMany({
    orderBy: [
      { productId: 'asc' },
      { warehouseId: 'asc' },
      { createdAt: 'asc' },
    ],
  });

  console.log(`[Migration] Total ledger entries: ${allEntries.length}`);

  // Group by (productId, warehouseId)
  const groups = new Map<string, typeof allEntries>();
  for (const entry of allEntries) {
    const key = `${entry.productId}::${entry.warehouseId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(entry);
  }

  console.log(`[Migration] Unique (productId, warehouseId) groups: ${groups.size}`);

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const [key, entries] of groups) {
    let runningStock = 0;

    for (const entry of entries) {
      const expectedBefore = runningStock;
      const delta = entry.direction === 'IN' ? entry.quantity : -entry.quantity;
      const expectedAfter = runningStock + delta;

      if (entry.stockBefore !== expectedBefore || entry.stockAfter !== expectedAfter) {
        try {
          await prisma.physicalInventoryLedger.update({
            where: { id: entry.id },
            data: {
              stockBefore: expectedBefore,
              stockAfter: expectedAfter,
            },
          });
          updated++;
          if (updated <= 5 || updated % 50 === 0) {
            console.log(
              `[Migration] Fixed ${entry.id.slice(0, 8)}: Before ${entry.stockBefore}→${expectedBefore}, After ${entry.stockAfter}→${expectedAfter}`
            );
          }
        } catch (err) {
          console.error(`[Migration] Error updating entry ${entry.id}:`, err);
          errors++;
        }
      } else {
        skipped++;
      }

      runningStock = expectedAfter;
    }

    // Log group summary for context
    const finalStock = runningStock;
    const actualPhysical = await prisma.physicalInventory.findFirst({
      where: {
        productId: entries[0].productId,
        warehouseId: entries[0].warehouseId,
        binLocationId: null,
      },
      select: { quantity: true },
    });
    const physicalQty = actualPhysical?.quantity ?? 0;

    if (finalStock !== physicalQty) {
      console.log(
        `[Migration] ⚠ Group ${key.slice(0, 16)}... running final=${finalStock}, PhysicalInventory qty=${physicalQty}`
      );
    }
  }

  console.log(`[Migration] Done. Updated: ${updated}, Skipped (already correct): ${skipped}, Errors: ${errors}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
