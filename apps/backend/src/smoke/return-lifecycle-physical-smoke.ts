/**
 * Physical-engine E2E smoke: courier RETURNED → Return Pending (physical
 * reservation HOLD) → manual Returned (physical quantity restored + hold
 * released, exactly once). Companion to return-lifecycle-smoke.ts (managed).
 *
 * Runs the REAL StockService / OrdersService / DispatchService against the
 * REAL local PostgreSQL. Compiled by `nest build`, run under plain Node.
 *
 * Run (from apps/backend):
 *   npx nest build && node dist/smoke/return-lifecycle-physical-smoke.js
 */
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { config as loadDotenv } from 'dotenv';
import { PrismaModule } from '../prisma/prisma.module';
import { OrdersModule } from '../orders/orders.module';
import { DispatchModule } from '../dispatch/dispatch.module';
import { StockModule } from '../stock/stock.module';
import { CacheModule } from '../cache/cache.module';
import { SecurityModule } from '../security/security.module';
import { QueueModule } from '../queue/queue.module';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { DispatchService } from '../dispatch/dispatch.service';
import { StockReconciliationService } from '../stock/stock-reconciliation.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    CacheModule,
    QueueModule,
    SecurityModule,
    StockModule,
    OrdersModule,
    DispatchModule,
  ],
})
class SmokeModule {}

const SMOKE_SLUG = 'smoke-return-physical-product';
const SMOKE_WAREHOUSE_SLUG = 'smoke-return-physical-warehouse';

interface Snapshot {
  msOnHand: number;
  msReserved: number;
  piQuantity: number;
  piReserved: number;
  reservationStatus: string;
  msReturnLedgerRows: number;
  piReturnLedgerRows: number;
  orderStatus: string;
}

async function printManagedLedgers(prisma: any, productId: string, label: string) {
  const rows = await prisma.managedStockLedger.findMany({
    where: { productId },
    orderBy: { reservedBefore: 'asc' },
  });
  if (!rows.length) return;
  console.log(`  [ms-ledger] ${label}:`);
  for (const r of rows) {
    console.log(
      `    type=${r.type} dir=${r.direction} qty=${r.quantity} stock ${Number(r.stockBefore)}->${Number(r.stockAfter)} reserved ${Number(r.reservedBefore)}->${Number(r.reservedAfter)}`,
    );
  }
}

async function printPhysicalLedgers(
  prisma: any,
  productId: string,
  warehouseId: string,
  label: string,
) {
  const rows = await prisma.physicalInventoryLedger.findMany({
    where: { productId, warehouseId },
    orderBy: { createdAt: 'asc' },
  });
  if (!rows.length) return;
  console.log(`  [pi-ledger] ${label}:`);
  for (const r of rows) {
    console.log(
      `    type=${r.type} dir=${r.direction} qty=${r.quantity} stock ${Number(r.stockBefore)}->${Number(r.stockAfter)} reserved ${Number(r.reservedBefore ?? 0)}->${Number(r.reservedAfter ?? 0)}`,
    );
  }
}

function assert(label: string, ok: boolean, details: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} — ${details}`);
  if (!ok) process.exitCode = 1;
}

function print(tag: string, s: Snapshot) {
  console.log(
    `${tag}: ms onHand=${s.msOnHand} reserved=${s.msReserved} | PI qty=${s.piQuantity} reserved=${s.piReserved} reservation=${s.reservationStatus} orderStatus=${s.orderStatus}`,
  );
}

async function main() {
  loadDotenv();
  const app = await NestFactory.createApplicationContext(SmokeModule);
  const prisma = app.get(PrismaService);
  const ordersService = app.get(OrdersService);
  const dispatchService = app.get(DispatchService);
  const reconcile = app.get(StockReconciliationService);

  const snapshot = async (
    orderId: string,
    productId: string,
    warehouseId: string,
  ): Promise<Snapshot> => {
    const [product, order, pi, cycle] = await Promise.all([
      prisma.product.findUnique({ where: { id: productId } }),
      prisma.order.findUnique({
        where: { id: orderId },
        include: { status: true },
      }),
      prisma.physicalInventory.findFirst({ where: { productId, warehouseId } }),
      prisma.orderItem.findFirst({ where: { orderId } }),
    ]);
    let reservationStatus = 'NONE';
    const item = await prisma.orderItem.findFirst({ where: { orderId } });
    if (item) {
      const res = await prisma.physicalReservation.findFirst({
        where: { orderItemId: item.id },
        orderBy: { createdAt: 'asc' },
      });
      reservationStatus = res?.status ?? 'NONE';
    }
    return {
      msOnHand: Number(product?.managedStockQuantity ?? 0),
      msReserved: Number(product?.reservedStock ?? 0),
      piQuantity: Number(pi?.quantity ?? 0),
      piReserved: Number(pi?.reservedQuantity ?? 0),
      reservationStatus,
      msReturnLedgerRows: await prisma.managedStockLedger.count({
        where: { productId, type: 'RETURN' },
      }),
      piReturnLedgerRows: await prisma.physicalInventoryLedger.count({
        where: { productId, warehouseId, type: 'RESTORATION' },
      }),
      orderStatus: order?.status?.name ?? '',
    };
  };

  const guestPhone = `017${String(Date.now()).slice(-8)}`;
  const adminUser = await prisma.userProfile.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!adminUser) throw new Error('no user profile in DB for smoke');
  const adminUserId = adminUser.id;

  let previousSetting: string | null = null;
  let productId = '';
  let warehouseId = '';
  let orderId = '';

  try {
    console.log('\n== step 0: ensure IM setting + lookup seeds ==');
    const setting = await prisma.systemSetting.findUnique({
      where: { key: 'inventory_enabled' },
    });
    if (setting) previousSetting = setting.value;
    await prisma.systemSetting.upsert({
      where: { key: 'inventory_enabled' },
      update: { value: 'true' },
      create: { key: 'inventory_enabled', value: 'true' },
    });

    let codOption = await prisma.paymentOption.findUnique({ where: { type: 'CASH_ON_DELIVERY' } });
    if (!codOption) {
      codOption = await prisma.paymentOption.create({
        data: { type: 'CASH_ON_DELIVERY', name: 'Cash on Delivery', sortOrder: 3 },
      });
    }

    const previousProduct = await prisma.product.findUnique({ where: { slug: SMOKE_SLUG } });
    if (previousProduct) {
      await prisma.managedStockLedger.deleteMany({ where: { productId: previousProduct.id } });
      await prisma.physicalInventoryLedger.deleteMany({ where: { productId: previousProduct.id } });
      await prisma.physicalInventory.deleteMany({ where: { productId: previousProduct.id } });
      await prisma.product.delete({ where: { id: previousProduct.id } });
    }
    const prevWh = await prisma.warehouse.findUnique({ where: { slug: SMOKE_WAREHOUSE_SLUG } });
    if (prevWh) await prisma.warehouse.delete({ where: { id: prevWh.id } });

    console.log('\n== step 1: physical inventory setup ==');
    const warehouse = await prisma.warehouse.create({
      data: { name: 'Smoke Return PH Warehouse', slug: SMOKE_WAREHOUSE_SLUG },
    });
    warehouseId = warehouse.id;

    const product = await prisma.product.create({
      data: {
        slug: SMOKE_SLUG,
        name: 'Smoke Return Physical Product',
        type: 'simple',
        basePrice: 400,
        manageStock: true,
        managedStockQuantity: 50,
        availabilityMode: 'MANAGED_STOCK',
        warehouseId,
      },
    });
    productId = product.id;
    const pi = await prisma.physicalInventory.create({
      data: { productId, warehouseId, quantity: 20 },
    });

    console.log('\n== step 2: create + confirm order (reserve + allocate) ==');
    const created = await ordersService.create(
      {
        guestName: 'Smoke Phys Tester',
        items: [{ productId, quantity: 3, price: 400 }],
        shippingCharge: 60,
        shippingAddress: { address: 'Dhanmondi 27', city: 'Dhaka' },
        district: 'Dhaka',
        thana: 'Dhanmondi',
        salesChannel: 'WEBSITE',
        paymentOptionType: 'CASH_ON_DELIVERY',
      } as any,
      undefined,
      { userId: 'smoke-staff', role: 'admin' } as any,
    );
    orderId = (created as any).id;

    let snapA = await snapshot(orderId, productId, warehouseId);
    if (!snapA.piReserved) {
      const confirmed = await prisma.orderStatus.findUnique({ where: { name: 'Confirmed' } });
      if (confirmed) {
        await ordersService.updateStatus(
          orderId,
          { statusId: confirmed.id } as any,
          adminUserId,
          adminUserId,
        );
        snapA = await snapshot(orderId, productId, warehouseId);
      }
    }
    print('after create/confirm', snapA);
    assert(
      '1. physical allocated + managed reserved',
      snapA.msReserved === 3 && snapA.piReserved === 3 && snapA.reservationStatus === 'ACTIVE',
      `ms reserved=${snapA.msReserved} pi reserved=${snapA.piReserved} reservation=${snapA.reservationStatus}`,
    );

    console.log('\n== step 3: dispatch HANDED_OVER..DELIVERED (deduct both engines) ==');
    const dispatch = await prisma.dispatch.create({
      data: {
        orderId,
        courier: 'steadfast',
        consignmentId: `SMOKE-PHY-${Date.now()}`,
        status: 'DISPATCHED',
      },
    });
    for (const st of ['HANDED_OVER', 'PICKED_UP', 'IN_TRANSIT', 'ASSIGNED_TO_RIDER', 'DELIVERED']) {
      await dispatchService.updateStatus(dispatch.id, st, 'courier_webhook');
    }
    const snapMid = await snapshot(orderId, productId, warehouseId);
    print('after HANDED_OVER..DELIVERED', snapMid);
    assert(
      '2. deduction consumed BOTH engines',
      snapMid.msOnHand === 47 && snapMid.msReserved === 0 &&
        snapMid.piQuantity === 17 && snapMid.piReserved === 0 &&
        snapMid.reservationStatus === 'CONSUMED',
      `ms ${snapMid.msOnHand}/${snapMid.msReserved} pi ${snapMid.piQuantity}/${snapMid.piReserved} reservation=${snapMid.reservationStatus}`,
    );

    console.log('\n== step 4: courier RETURNED → Return Pending (HOLD) ==');
    for (const st of ['RETURN_PENDING', 'RETURNED']) {
      await dispatchService.updateStatus(dispatch.id, st, 'courier_webhook');
    }
    const snapB = await snapshot(orderId, productId, warehouseId);
    print('after RETURNED event', snapB);
    await printManagedLedgers(prisma, productId, 'after courier RETURNED (Return Pending)');
    await printPhysicalLedgers(prisma, productId, warehouseId, 'PY after courier RETURNED (Return Pending)');
    assert('4a. order → Return Pending', snapB.orderStatus === 'Return Pending', `status=${snapB.orderStatus}`);
    assert(
      '4b. Return Pending HOLDS physical reservation (no restore, no release)',
      snapB.piQuantity === snapMid.piQuantity &&
        snapB.piReserved === snapA.piReserved &&
        snapB.reservationStatus === 'CONSUMED' &&
        snapB.piReturnLedgerRows === 0,
      `pi qty ${snapMid.piQuantity}->${snapB.piQuantity} pi reserved ${snapMid.piReserved}->${snapB.piReserved} reservation=${snapB.reservationStatus}`,
    );
    assert(
      '4c. managed side also held',
      snapB.msOnHand === snapMid.msOnHand && snapB.msReserved === snapA.msReserved,
      `ms onHand ${snapMid.msOnHand}->${snapB.msOnHand} reserved ${snapMid.msReserved}->${snapB.msReserved}`,
    );
    assert('4d. no physical restoration rows yet', snapB.piReturnLedgerRows === 0, `rows=${snapB.piReturnLedgerRows}`);

    console.log('\n== step 5: manual admin → Returned (restore both engines) ==');
    const returned = await prisma.orderStatus.findUnique({ where: { name: 'Returned' } });
    if (!returned) throw new Error('Returned status not seeded');
    await ordersService.updateStatus(
      orderId,
      { statusId: returned.id, note: 'smoke: manually confirmed return' } as any,
      adminUserId,
      adminUserId,
    );
    const snapC = await snapshot(orderId, productId, warehouseId);
    print('after manual Returned', snapC);
    await printManagedLedgers(prisma, productId, 'after manual Returned');
    await printPhysicalLedgers(prisma, productId, warehouseId, 'after manual Returned');
    assert('5a. order is Returned', snapC.orderStatus === 'Returned', `status=${snapC.orderStatus}`);
    assert(
      '5b. physical stock RESTORED exactly +3 and held reservation RELEASED',
      snapC.piQuantity === snapMid.piQuantity + 3 &&
        snapC.piReserved === 0 &&
        snapC.reservationStatus === 'RESTORED',
      `pi qty ${snapMid.piQuantity}->${snapC.piQuantity} pi reserved ${snapB.piReserved}->${snapC.piReserved} reservation=${snapC.reservationStatus}`,
    );
    assert(
      '5c. managed stock also restored exactly once',
      snapC.msOnHand === snapMid.msOnHand + 3 && snapC.msReserved === 0,
      `ms onHand ${snapMid.msOnHand}->${snapC.msOnHand} reserved ${snapB.msReserved}->${snapC.msReserved}`,
    );
    assert('5d. exactly one RESTORATION row', snapC.piReturnLedgerRows === 1, `rows=${snapC.piReturnLedgerRows}`);

    console.log('\n== step 6: re-trigger Returned (idempotency) ==');
    let reResult = 'accepted';
    try {
      await ordersService.updateStatus(orderId, { statusId: returned.id } as any, adminUserId, adminUserId);
    } catch (e) {
      reResult = (e as Error).message.slice(0, 110);
    }
    const reTransitionGuard = reResult.startsWith('Cannot transition');
    const healOutcome = await reconcile.healOrder(orderId, 'Returned');
    const snapD = await snapshot(orderId, productId, warehouseId);
    print('after re-triggers', snapD);
    assert(
      '6a. no duplicate physical restoration/release after re-triggers/heal',
      reTransitionGuard &&
        snapD.piQuantity === snapC.piQuantity &&
        snapD.piReserved === 0 &&
        snapD.reservationStatus === 'RESTORED' &&
        snapD.piReturnLedgerRows === snapC.piReturnLedgerRows,
      `reTransition=${reResult} (guard rejects) heal=${healOutcome} pi qty=${snapD.piQuantity} reserved=${snapD.piReserved} rows ${snapC.piReturnLedgerRows}->${snapD.piReturnLedgerRows}`,
    );

    const freshDispatch = await prisma.dispatch.findUnique({ where: { id: dispatch.id } });
    if (freshDispatch && freshDispatch.status !== 'RETURNED') {
      await dispatchService.updateStatus(dispatch.id, 'RETURNED', 'courier_webhook');
    }
    const snapE = await snapshot(orderId, productId, warehouseId);
    print('after courier RETURNED again', snapE);
    assert(
      '6b. courier RETURNED after manual Returned is a no-op',
      snapE.orderStatus === 'Returned' &&
        snapE.piReserved === snapC.piReserved &&
        snapE.piQuantity === snapC.piQuantity &&
        snapE.msReserved === snapC.msReserved &&
        snapE.piReturnLedgerRows === snapC.piReturnLedgerRows,
      `status=${snapE.orderStatus} pi ${snapE.piQuantity}/${snapE.piReserved} ms ${snapE.msOnHand}/${snapE.msReserved} rows=${snapE.piReturnLedgerRows}`,
    );

    console.log('\n== before/after evidence (physical engine) ==');
    console.table([
      { step: '1. create/confirm (allocate)', piQty: snapA.piQuantity, piReserved: snapA.piReserved, reservation: snapA.reservationStatus, msReserved: snapA.msReserved },
      { step: '2. HANDED_OVER..DELIVERED', piQty: snapMid.piQuantity, piReserved: snapMid.piReserved, reservation: snapMid.reservationStatus, msReserved: snapMid.msReserved },
      { step: '3. courier RETURNED (Return Pending)', piQty: snapB.piQuantity, piReserved: snapB.piReserved, reservation: snapB.reservationStatus, msReserved: snapB.msReserved },
      { step: '4. manual Returned', piQty: snapC.piQuantity, piReserved: snapC.piReserved, reservation: snapC.reservationStatus, msReserved: snapC.msReserved },
      { step: '5. re-trigged', piQty: snapD.piQuantity, piReserved: snapD.piReserved, reservation: snapD.reservationStatus, msReserved: snapD.msReserved },
    ]);

    console.log(
      process.exitCode
        ? '\nPHYSICAL SMOKE TEST FAILED — see FAIL lines above.'
        : '\nPHYSICAL SMOKE TEST PASSED — physical engine verified on real DB (no mocks).',
    );
  } finally {
    try {
      if (orderId) {
        const items = await prisma.orderItem.findMany({ where: { orderId } });
        await prisma.physicalReservation.deleteMany({
          where: { orderItemId: { in: items.map((i) => i.id) } },
        });
        await prisma.orderItem.deleteMany({ where: { orderId } });
        await prisma.dispatch.deleteMany({ where: { orderId } });
        await prisma.order.delete({ where: { id: orderId } });
      }
      if (productId) {
        await prisma.physicalInventoryLedger.deleteMany({ where: { productId } });
        await prisma.physicalInventory.deleteMany({ where: { productId } });
        await prisma.managedStockLedger.deleteMany({ where: { productId } });
        await prisma.product.deleteMany({ where: { id: productId } });
      }
      if (warehouseId) {
        await prisma.warehouse.deleteMany({ where: { id: warehouseId } });
      }
      const setting = await prisma.systemSetting.findUnique({ where: { key: 'inventory_enabled' } });
      if (previousSetting === null) {
        await prisma.systemSetting.deleteMany({ where: { key: 'inventory_enabled' } });
      } else {
        await prisma.systemSetting.update({ where: { key: 'inventory_enabled' }, data: { value: previousSetting } });
      }
    } catch {
      /* cleanup is best-effort for the smoke DB */
    }
    await app.close();
  }
}

main().catch((e) => {
  console.error('PHYSICAL SMOKE TEST CRASHED:', e);
  process.exit(1);
});
process.on('SIGTERM', () => process.exit(0));