/**
 * Staging-like E2E smoke test: courier RETURNED event → Return Pending (stock
 * stays held) → manual Returned (stock restored exactly once, idempotent).
 *
 * Boots a minimal Nest context with the REAL services and the REAL local
 * PostgreSQL (no mocks). Compiled by `nest build` and run under plain Node —
 * same runtime as production.
 *
 * Run (from apps/backend):
 *   npx nest build && node dist/smoke/return-lifecycle-smoke.js
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

const SMOKE_SLUG = 'smoke-return-lifecycle-product';

interface Snapshot {
  onHand: number;
  reserved: number;
  itemReserved: boolean;
  itemDeducted: boolean;
  orderStatus: string;
  returnLedgerRows: number;
}

async function printLedgers(prisma: any, productId: string, label: string) {
  const rows = await prisma.managedStockLedger.findMany({
    where: { productId },
    orderBy: { reservedBefore: 'asc' },
  });
  if (!rows.length) {
    console.log(`  [ledger] ${label}: (none)`);
    return;
  }
  console.log(`  [ledger] ${label}:`);
  for (const r of rows) {
    console.log(
      `    type=${r.type} dir=${r.direction} qty=${r.quantity} stock ${Number(r.stockBefore)}->${Number(r.stockAfter)} reserved ${Number(r.reservedBefore)}->${Number(r.reservedAfter)} note=${r.note || ''}`,
    );
  }
}

function assert(label: string, ok: boolean, details: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} — ${details}`);
  if (!ok) process.exitCode = 1;
}

function print(tag: string, s: Snapshot) {
  console.log(
    `${tag}: onHand=${s.onHand} reserved=${s.reserved} itemReserved=${s.itemReserved} itemDeducted=${s.itemDeducted} orderStatus=${s.orderStatus} returnLedgerRows=${s.returnLedgerRows}`,
  );
}

async function main() {
  loadDotenv();
  const app = await NestFactory.createApplicationContext(SmokeModule);
  const prisma = app.get(PrismaService);
  const ordersService = app.get(OrdersService);
  const dispatchService = app.get(DispatchService);
  const reconcile = app.get(StockReconciliationService);

  const snapshot = async (orderId: string, productId: string): Promise<Snapshot> => {
    const [product, order] = await Promise.all([
      prisma.product.findUnique({ where: { id: productId } }),
      prisma.order.findUnique({
        where: { id: orderId },
        include: { status: true, items: true },
      }),
    ]);
    const item = order?.items[0];
    return {
      onHand: Number(product?.managedStockQuantity ?? 0),
      reserved: Number(product?.reservedStock ?? 0),
      itemReserved: Boolean(item?.managedStockReserved),
      itemDeducted: Boolean(item?.managedStockDeducted),
      orderStatus: order?.status?.name ?? '',
      returnLedgerRows: await prisma.managedStockLedger.count({
        where: { productId, type: { in: ['RETURN', 'CANCEL_RELEASE'] } },
      }),
    };
  };

  const guestPhone = `017${String(Date.now()).slice(-8)}`;
  const adminUser = await prisma.userProfile.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!adminUser) throw new Error('no user profile in DB for smoke');
  const adminUserId = adminUser.id;

  try {
    const previous = await prisma.product.findUnique({ where: { slug: SMOKE_SLUG } });
    if (previous) {
      await prisma.orderItem.deleteMany({ where: { productId: previous.id } });
      await prisma.managedStockLedger.deleteMany({ where: { productId: previous.id } });
      await prisma.product.delete({ where: { id: previous.id } });
    }

    console.log('\n== step 0: ensure lookup seeds (dev DB may be unseeded) ==');
    let codOption = await prisma.paymentOption.findUnique({ where: { type: 'CASH_ON_DELIVERY' } });
    if (!codOption) {
      codOption = await prisma.paymentOption.create({
        data: { type: 'CASH_ON_DELIVERY', name: 'Cash on Delivery', sortOrder: 3 },
      });
    }

    console.log('\n== step 1: create order (reserved state) ==');
    const product = await prisma.product.create({
      data: {
        slug: SMOKE_SLUG,
        name: 'Smoke Return Lifecycle Product',
        type: 'simple',
        basePrice: 500,
        manageStock: true,
        managedStockQuantity: 50,
        availabilityMode: 'MANAGED_STOCK',
      },
    });
    const productId = product.id;

    const created = await ordersService.create(
      {
        guestName: 'Smoke Tester',
        items: [{ productId, quantity: 3, price: 500 }],
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
    const orderId = (created as any).id;

    let snapA = await snapshot(orderId, productId);
    if (!snapA.itemReserved && snapA.reserved === 0) {
      const confirmed = await prisma.orderStatus.findUnique({ where: { name: 'Confirmed' } });
      if (confirmed) {
        await ordersService.updateStatus(
          orderId,
          { statusId: confirmed.id } as any,
          'smoke-staff',
          adminUserId,
        );
        snapA = await snapshot(orderId, productId);
      }
    }
    print('after create/confirm', snapA);
    assert(
      '1. stock is RESERVED',
      snapA.itemReserved && !snapA.itemDeducted && snapA.reserved === 3,
      `onHand=${snapA.onHand} reserved=${snapA.reserved} itemReserved=${snapA.itemReserved}`,
    );

    await printLedgers(prisma, productId, 'create/confirm');
    console.log('\n== step 2: courier RETURNED event ==');
    const dispatch = await prisma.dispatch.create({
      data: {
        orderId,
        courier: 'steadfast',
        consignmentId: `SMOKE-RET-${Date.now()}`,
        status: 'DISPATCHED',
      },
    });
    for (const st of ['HANDED_OVER', 'PICKED_UP', 'IN_TRANSIT', 'ASSIGNED_TO_RIDER', 'DELIVERED']) {
      await dispatchService.updateStatus(dispatch.id, st, 'courier_webhook');
    }
    const snapMid = await snapshot(orderId, productId);
    print('after HANDED_OVER..DELIVERED', snapMid);
    for (const st of ['RETURN_PENDING', 'RETURNED']) {
      await dispatchService.updateStatus(dispatch.id, st, 'courier_webhook');
    }

    const snapB = await snapshot(orderId, productId);
    print('after RETURNED event', snapB);
    await printLedgers(prisma, productId, 'after courier RETURNED (Return Pending)');
    assert('2a. order → Return Pending', snapB.orderStatus === 'Return Pending', `status=${snapB.orderStatus}`);
    assert(
      '2b. Return Pending HOLDS reservation (no restore, no release)',
      snapB.onHand === snapMid.onHand && snapB.reserved === snapA.reserved && snapB.returnLedgerRows === 0,
      `onHand ${snapMid.onHand}->${snapB.onHand} reserved ${snapMid.reserved}->${snapB.reserved} (HOLD re-established)`,
    );
    assert('2c. no return-restore ledger rows yet', snapB.returnLedgerRows === 0, `rows=${snapB.returnLedgerRows}`);

    console.log('\n== step 3: manual admin → Returned ==');
    const returned = await prisma.orderStatus.findUnique({ where: { name: 'Returned' } });
    if (!returned) throw new Error('Returned status not seeded');
    await ordersService.updateStatus(
      orderId,
      { statusId: returned.id, note: 'smoke: manually confirmed return' } as any,
      adminUserId,
      adminUserId,
    );

    const snapC = await snapshot(orderId, productId);
    print('after manual Returned', snapC);
    await printLedgers(prisma, productId, 'after manual Returned');
    assert('3a. order is Returned', snapC.orderStatus === 'Returned', `status=${snapC.orderStatus}`);
    assert(
      '3b. stock restored EXACTLY ONCE (+3 onHand, reservation consumed)',
      snapC.reserved === 0 && snapC.onHand === snapB.onHand + 3 && !snapC.itemDeducted && !snapC.itemReserved,
      `onHand ${snapB.onHand}->${snapC.onHand} reserved ${snapB.reserved}->${snapC.reserved}`,
    );
    assert('3c. exactly one return ledger row', snapC.returnLedgerRows === 1, `rows=${snapC.returnLedgerRows}`);

    console.log('\n== step 4: re-trigger Returned (idempotency) ==');
    let reResult = 'accepted';
    try {
      await ordersService.updateStatus(orderId, { statusId: returned.id } as any, adminUserId, adminUserId);
    } catch (e) {
      reResult = (e as Error).message.slice(0, 110);
    }
    const reTransitionGuard = reResult.startsWith('Cannot transition');
    const healOutcome = await reconcile.healOrder(orderId, 'Returned');

    const snapD = await snapshot(orderId, productId);
    print('after re-triggers', snapD);
    await printLedgers(prisma, productId, 'after re-triggers');
    assert(
      '4. no duplicate restoration after repeated Returned/heals',
      reTransitionGuard && snapD.reserved === 0 && snapD.onHand === snapC.onHand && snapD.returnLedgerRows === snapC.returnLedgerRows,
      `reTransition=${reResult} (guard rejects) heal=${healOutcome} onHand=${snapD.onHand} reserved=${snapD.reserved} restoreRows ${snapC.returnLedgerRows}->${snapD.returnLedgerRows}`,
    );

    const freshDispatch = await prisma.dispatch.findUnique({ where: { id: dispatch.id } });
    if (freshDispatch && freshDispatch.status !== 'RETURNED') {
      await dispatchService.updateStatus(dispatch.id, 'RETURNED', 'courier_webhook');
    }
    const snapE = await snapshot(orderId, productId);
    print('after courier RETURNED again', snapE);
    assert(
      '5. courier RETURNED after manual Returned is a no-op',
      snapE.orderStatus === 'Returned' && snapE.reserved === snapC.reserved && snapE.onHand === snapC.onHand && snapE.returnLedgerRows === snapC.returnLedgerRows,
      `status=${snapE.orderStatus} onHand=${snapE.onHand} reserved=${snapE.reserved} rows=${snapE.returnLedgerRows}`,
    );

    console.log('\n== before/after evidence ==');
    console.table([
      { step: '1. reserved', onHand: snapA.onHand, reserved: snapA.reserved, orderStatus: snapA.orderStatus },
      { step: '2. courier RETURNED', onHand: snapB.onHand, reserved: snapB.reserved, orderStatus: snapB.orderStatus },
      { step: '3. manual Returned', onHand: snapC.onHand, reserved: snapC.reserved, orderStatus: snapC.orderStatus },
      { step: '4. re-triggered', onHand: snapD.onHand, reserved: snapD.reserved, orderStatus: snapD.orderStatus },
      { step: '5. courier RET again', onHand: snapE.onHand, reserved: snapE.reserved, orderStatus: snapE.orderStatus },
    ]);

    console.log(
      process.exitCode
        ? '\nSMOKE TEST FAILED — see FAIL lines above.'
        : '\nSMOKE TEST PASSED — Return lifecycle verified on real DB (no mocks).',
    );
  } finally {
    try {
      const orders = await prisma.order.findMany({ where: { guestPhone } });
      for (const o of orders) {
        await prisma.dispatch.deleteMany({ where: { orderId: o.id } });
        await prisma.orderItem.deleteMany({ where: { orderId: o.id } });
      }
      await prisma.order.deleteMany({ where: { guestPhone } });
    } catch {
      /* cleanup is best-effort for the smoke DB */
    }
    await app.close();
  }
}

main().catch((e) => {
  console.error('SMOKE TEST CRASHED:', e);
  process.exit(1);
});
process.on('SIGTERM', () => process.exit(0));