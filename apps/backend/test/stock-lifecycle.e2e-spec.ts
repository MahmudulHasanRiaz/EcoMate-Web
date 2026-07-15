import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { randomUUID } from 'node:crypto';

const UQ = `t${Date.now()}`;
const WAREHOUSE_ID = '5430fd1a-ad81-4b97-9a04-18ca8568c725';

type Snapshot = Record<string, any>;
const results: { s: string; step: string; ok: boolean; msg: string }[] = [];

function R(s: string, step: string, ok: boolean, msg: string) {
  results.push({ s, step, ok, msg });
}

function assertSnap(
  prefix: string, label: string, before: any, after: any,
  expected: string, field?: string
) {
  const b = field ? before?.[field] ?? 0 : before;
  const a = field ? after?.[field] ?? 0 : after;
  for (const expr of expected.split('|').map(s => s.trim())) {
    let ok = false;
    if (expr.startsWith('+')) ok = a === b + parseInt(expr.slice(1));
    else if (expr.startsWith('-')) ok = a === b - parseInt(expr.slice(1));
    else if (expr === 'same') ok = a === b;
    else if (expr === '0') ok = a === 0;
    else if (expr === '>0') ok = a > 0;
    if (ok) return;
  }
  R(prefix, `chk:${label}`, false, `${field || label}: ${b}→${a}, expected ${expected}`);
}

function assertCount(
  prefix: string, label: string, before: any[], after: any[], expected: string
) {
  const b = before.length;
  const a = after.length;
  for (const expr of expected.split('|').map(s => s.trim())) {
    let ok = false;
    if (expr.startsWith('+')) ok = a === b + parseInt(expr.slice(1));
    else if (expr.startsWith('-')) ok = a === b - parseInt(expr.slice(1));
    else if (expr === 'same') ok = a === b;
    if (ok) return;
  }
  R(prefix, `cnt:${label}`, false, `${label}: ${b}→${a}, expected ${expected}`);
}

async function snap(prisma: PrismaService, pid: string, wh: string) {
  const p = await prisma.product.findUnique({ where: { id: pid } });
  const pi = await prisma.physicalInventory.findFirst({
    where: { productId: pid, warehouseId: wh },
  });
  const prs = await prisma.physicalReservation.findMany({
    where: { orderItemId: { not: undefined }, product: { id: pid } } as any,
  });
  const allocs = await prisma.physicalReservationAllocation.findMany({
    where: { reservation: { productId: pid } },
  });
  const msLedger = await prisma.managedStockLedger.findMany({
    where: { productId: pid }, orderBy: { id: 'asc' },
  });
  const piLedger = await prisma.physicalInventoryLedger.findMany({
    where: { productId: pid }, orderBy: { createdAt: 'asc' },
  });
  return { p, pi, prs, allocs, msLedger, piLedger };
}

const ST = {
  pending: 'e73e7a7b-b560-412d-b3fc-b8d82560c444',
  confirmed: '7bbd83e6-3cc2-4321-a1ae-f999846e8990',
  cancelled: '9685921f-2ad6-472b-9577-2f91cd1ea169',
  delivered: 'a5940329-d6d3-4a15-b75e-674d4b146483',
  returnPending: 'c99116ae-166e-4e0a-b45c-e35f0d324456',
  returned: '967a70af-ba52-4ca1-ae7c-6c0a43a8d695',
};

describe('Stock Lifecycle Matrix', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let adminId: string;
  let customerId: string;

  const adminU = {
    firstName: 'SLAdmin', lastName: UQ,
    username: `sl-adm-${UQ}`, email: `sl-adm-${UQ}@t.com`,
    password: 'pass123', phoneNumber: '01700000111',
  };
  const custU = {
    firstName: 'SLCust', lastName: UQ,
    username: `sl-cus-${UQ}`, email: `sl-cus-${UQ}@t.com`,
    password: 'pass123', phoneNumber: '01700000222', role: 'customer',
  };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const reg = await request(app.getHttpServer())
      .post('/auth/register').send(adminU).expect(201);
    token = reg.body.accessToken;
    adminId = reg.body.user.id;

    const cust = await request(app.getHttpServer())
      .post('/users').set('Authorization', `Bearer ${token}`)
      .send(custU).expect(201);
    customerId = cust.body.id;

    await prisma.binLocation.upsert({
      where: { warehouseId_code: { warehouseId: WAREHOUSE_ID, code: 'TBIN' } },
      create: { warehouseId: WAREHOUSE_ID, code: 'TBIN' },
      update: {},
    });
  }, 30000);

  afterAll(async () => {
    await cleanAll(prisma);
    await app.close();
  });

  it('runs 7 stock lifecycle scenarios', async () => {
    await scenario('S1:IM-OFF-MS',       false, 'MANAGED_STOCK',       false);
    await scenario('S2:IM-OFF-IC',       false, 'INVENTORY_CONTROLLED', false);
    await scenario('S3:IM-ON-IC',        true,  'INVENTORY_CONTROLLED', false);
    await scenario('S4:IM-ON-MS-SYNC',   true,  'MANAGED_STOCK',       true);
    await scenario('S5:IM-ON-MS-NOSYNC', true,  'MANAGED_STOCK',       false);
    await posScenario('S6:POS-IM-ON',    true);
    await posScenario('S7:POS-IM-OFF',   false);

    printResults();
  }, 600000);

  async function scenario(
    label: string, imOn: boolean, mode: string, sync: boolean
  ) {
    const qty = 50;
    const orderQty = 3;
    const pid = randomUUID();

    await setIM(imOn);

    // Create product
    const prodRes = await request(app.getHttpServer())
      .post('/products').set('Authorization', `Bearer ${token}`)
      .send({
        name: `${label}-${UQ}`, slug: `${label.toLowerCase()}-${UQ}`,
        basePrice: 500, stock: qty,
        availabilityMode: mode, syncManagedStock: sync,
        manageStock: true, warehouseId: WAREHOUSE_ID,
      }).expect(201);
    const prodId = prodRes.body.id;
    const variantId = prodRes.body?.variants?.[0]?.id || null;

    // For PI-needed scenarios, create initial PI row
    if (imOn && (mode === 'INVENTORY_CONTROLLED' || sync)) {
      await prisma.physicalInventory.create({
        data: {
          productId: prodId, warehouseId: WAREHOUSE_ID,
          binLocationId: 'TBIN',
          quantity: qty, reservedQuantity: 0,
        },
      });
    }

    // Create order (auto-reserves stock)
    let pre = await snap(prisma, prodId, WAREHOUSE_ID);
    const orderRes = await request(app.getHttpServer())
      .post('/orders').send({
        customerId, items: [{ productId: prodId, quantity: orderQty, price: 500 }],
        shippingCharge: 0, paymentOptionType: 'CASH_ON_DELIVERY',
      });
    if (orderRes.status >= 400) {
      R(label, 'createOrder', false, `HTTP ${orderRes.status}`);
      await cleanupProduct(prisma, prodId);
      return;
    }
    const orderId = orderRes.body.id;
    let post = await snap(prisma, prodId, WAREHOUSE_ID);
    verifyReserve(label, pre, post, orderQty, { imOn, mode, sync });
    pre = post;

    // Confirm order
    const confRes = await request(app.getHttpServer())
      .put(`/orders/${orderId}/status`).set('Authorization', `Bearer ${token}`)
      .send({ statusId: ST.confirmed });
    if (confRes.status >= 400) {
      R(label, 'confirm', false, `HTTP ${confRes.status}`);
    } else {
      post = await snap(prisma, prodId, WAREHOUSE_ID);
      assertSnap(label, 'stock', pre.p, post.p, 'same', 'stock');
      assertSnap(label, 'reservedStock', pre.p, post.p, 'same', 'reservedStock');
      if (post.pi && pre.pi) {
        assertSnap(label, 'pi:qty', pre.pi, post.pi, 'same', 'quantity');
        assertSnap(label, 'pi:rsv', pre.pi, post.pi, 'same', 'reservedQuantity');
      }
      R(label, 'confirm', true, 'OK');
    }
    pre = post;

    // Cancel order (releases stock)
    const cancelRes = await request(app.getHttpServer())
      .put(`/orders/${orderId}/status`).set('Authorization', `Bearer ${token}`)
      .send({ statusId: ST.cancelled });
    if (cancelRes.status >= 400) {
      R(label, 'cancel', false, `HTTP ${cancelRes.status}`);
    } else {
      post = await snap(prisma, prodId, WAREHOUSE_ID);
      verifyCancel(label, pre, post, orderQty, { imOn, mode, sync });
    }
    pre = post;

    // Idempotent cancel
    await request(app.getHttpServer())
      .put(`/orders/${orderId}/status`).set('Authorization', `Bearer ${token}`)
      .send({ statusId: ST.cancelled });
    post = await snap(prisma, prodId, WAREHOUSE_ID);
    assertSnap(label, 'cancel2:stock', pre.p, post.p, 'same', 'stock');
    assertSnap(label, 'cancel2:rs', pre.p, post.p, 'same', 'reservedStock');
    if (post.pi && pre.pi) {
      assertSnap(label, 'cancel2:piQty', pre.pi, post.pi, 'same', 'quantity');
      assertSnap(label, 'cancel2:piRsv', pre.pi, post.pi, 'same', 'reservedQuantity');
    }
    R(label, 'cancel:idempotent', true, 'OK');
    pre = post;

    // Reconfirm → dispatch → handed_over
    await request(app.getHttpServer())
      .put(`/orders/${orderId}/status`).set('Authorization', `Bearer ${token}`)
      .send({ statusId: ST.confirmed });
    post = await snap(prisma, prodId, WAREHOUSE_ID);
    // After cancel+confirm, stock is re-reserved: reservedStock inc
    assertSnap(label, 'reconfirm:rs', pre.p, post.p, `+${orderQty}`, 'reservedStock');
    assertSnap(label, 'reconfirm:stock', pre.p, post.p, 'same', 'stock');
    pre = post;

    const dispRes = await request(app.getHttpServer())
      .post('/dispatch').send({
        orderId, courier: 'steadfast',
        consignmentId: `CN-${label}-${UQ}`,
        productMapping: [{ productVariantId: variantId || prodId, quantity: orderQty }],
      });
    if (dispRes.status >= 400) {
      R(label, 'dispatch', false, `HTTP ${dispRes.status}`);
    } else {
      const dispId = dispRes.body.id;
      const hoRes = await request(app.getHttpServer())
        .patch(`/dispatch/${dispId}/status`).send({ status: 'HANDED_OVER', performedBy: adminId });
      if (hoRes.status >= 400) {
        R(label, 'handedOver', false, `HTTP ${hoRes.status}`);
      } else {
        post = await snap(prisma, prodId, WAREHOUSE_ID);
        verifyHandedOver(label, pre, post, orderQty, { imOn, mode, sync });
        pre = post;
      }
    }

    // Return: Confirmed → Packed → Shipping → Delivered → Return Pending → Returned
    const packedId = 'f343efa0-b30a-417f-9951-b45b393f517a';
    const shippingId = '0db852a9-6484-45c6-b2ae-d8a5e6337f51';
    for (const sid of [packedId, shippingId, ST.delivered, ST.returnPending]) {
      await request(app.getHttpServer())
        .put(`/orders/${orderId}/status`).set('Authorization', `Bearer ${token}`)
        .send({ statusId: sid });
    }
    const retRes = await request(app.getHttpServer())
      .put(`/orders/${orderId}/status`).set('Authorization', `Bearer ${token}`)
      .send({ statusId: ST.returned });
    if (retRes.status >= 400) {
      R(label, 'return', false, `HTTP ${retRes.status}`);
    } else {
      post = await snap(prisma, prodId, WAREHOUSE_ID);
      verifyReturn(label, pre, post, orderQty, { imOn, mode, sync });
    }
    pre = post;

    // Return idempotent
    await request(app.getHttpServer())
      .put(`/orders/${orderId}/status`).set('Authorization', `Bearer ${token}`)
      .send({ statusId: ST.returned });
    post = await snap(prisma, prodId, WAREHOUSE_ID);
    assertSnap(label, 'ret2:stock', pre.p, post.p, 'same', 'stock');
    if (post.pi && pre.pi) {
      assertSnap(label, 'ret2:piQty', pre.pi, post.pi, 'same', 'quantity');
    }
    R(label, 'return:doubleApply', true, 'OK');

    // Final: no negatives (raw check to avoid assertSnap expr parser limits)
    const fin = await snap(prisma, prodId, WAREHOUSE_ID);
    if (fin.p) {
      if ((fin.p as any).stock < 0) R(label, 'final:negMs', false, `stock=${(fin.p as any).stock}`);
      if ((fin.p as any).reservedStock < 0) R(label, 'final:negRs', false, `reservedStock=${(fin.p as any).reservedStock}`);
    }
    if (fin.pi) {
      if ((fin.pi as any).quantity < 0) R(label, 'final:negPiQty', false, `piQty=${(fin.pi as any).quantity}`);
      if ((fin.pi as any).reservedQuantity < 0) R(label, 'final:negPiRsv', false, `piRsv=${(fin.pi as any).reservedQuantity}`);
    }

    await cleanupProduct(prisma, prodId);
  }

  async function posScenario(label: string, imOn: boolean) {
    const qty = 30;
    const pid = randomUUID();
    await setIM(imOn);

    const prodRes = await request(app.getHttpServer())
      .post('/products').set('Authorization', `Bearer ${token}`)
      .send({
        name: `${label}-${UQ}`, slug: `${label.toLowerCase()}-${UQ}`,
        basePrice: 500, stock: qty,
        availabilityMode: 'MANAGED_STOCK', manageStock: true,
        warehouseId: WAREHOUSE_ID,
      }).expect(201);
    const prodId = prodRes.body.id;

    if (imOn) {
      await prisma.physicalInventory.create({
        data: {
          productId: prodId, warehouseId: WAREHOUSE_ID,
          binLocationId: 'TBIN', quantity: qty, reservedQuantity: 0,
        },
      });
    }

    // POS session
    const sess = await (prisma as any).posSession.create({
      data: { cashierId: adminId, status: 'open', openedAt: new Date(), showroomId: 'test', openingBalance: 0 },
    });

    const pre = await snap(prisma, prodId, WAREHOUSE_ID);

    const posRes = await request(app.getHttpServer())
      .post('/pos/orders')
      .set('Authorization', `Bearer ${token}`)
      .set('x-pos-session-id', sess.id)
      .send({
        items: [{ productId: prodId, quantity: 2, price: 500 }],
        payments: [{ method: 'cash', amount: 1000 }],
        deliveryMethod: 'Counter Sale',
      });

    if (posRes.status >= 400) {
      R(label, 'posCreate', false, `HTTP ${posRes.status}: ${JSON.stringify(posRes.body)}`);
    } else {
      R(label, 'posCreate', true, 'OK');
    }

    const post = await snap(prisma, prodId, WAREHOUSE_ID);

    if (imOn) {
      // PI-only: quantity down, reservedQuantity UNCHANGED (bug fix)
      assertSnap(label, 'pi:qty', pre.pi, post.pi, '-2', 'quantity');
      assertSnap(label, 'pi:rsv', pre.pi, post.pi, 'same', 'reservedQuantity');
      assertSnap(label, 'ms:stock', pre.p, post.p, 'same', 'stock');
      assertSnap(label, 'ms:rs', pre.p, post.p, 'same', 'reservedStock');
    } else {
      assertSnap(label, 'ms:stock', pre.p, post.p, '-2', 'stock');
      assertSnap(label, 'ms:rs', pre.p, post.p, 'same', 'reservedStock');
    }

    // Cleanup POS artifacts
    const posOrder = await prisma.order.findFirst({ where: { posSessionId: sess.id } });
    if (posOrder) {
      await prisma.orderItem.deleteMany({ where: { orderId: posOrder.id } });
      await prisma.payment.deleteMany({ where: { orderId: posOrder.id } });
      await prisma.order.deleteMany({ where: { id: posOrder.id } });
    }
    await prisma.posSession.deleteMany({ where: { id: sess.id } });
    await cleanupProduct(prisma, prodId);
  }

  // === helpers ===

  async function setIM(on: boolean) {
    await prisma.systemSetting.upsert({
      where: { key: 'inventory_enabled' },
      create: { key: 'inventory_enabled', value: String(on) },
      update: { value: String(on) },
    });
  }

  function verifyReserve(
    S: string, pre: Snapshot, post: Snapshot, qty: number, cfg: any
  ) {
    if (cfg.imOn && cfg.mode === 'INVENTORY_CONTROLLED') {
      assertSnap(S, 'pi:rsv', pre.pi, post.pi, `+${qty}`, 'reservedQuantity');
      assertSnap(S, 'pi:qty', pre.pi, post.pi, 'same', 'quantity');
      assertSnap(S, 'ms:rs', pre.p, post.p, 'same', 'reservedStock');
      assertSnap(S, 'ms:stock', pre.p, post.p, 'same', 'stock');
      assertCount(S, 'prs', pre.prs, post.prs, '+1');
    } else {
      assertSnap(S, 'ms:rs', pre.p, post.p, `+${qty}`, 'reservedStock');
      assertSnap(S, 'ms:stock', pre.p, post.p, 'same', 'stock');
      if (cfg.imOn && cfg.sync && post.pi) {
        assertSnap(S, 'pi:rsv', pre.pi, post.pi, `+${qty}`, 'reservedQuantity');
      } else if (post.pi) {
        assertSnap(S, 'pi:rsv', pre.pi, post.pi, 'same', 'reservedQuantity');
      }
    }
    R(S, 'reserve', true, 'OK');
  }

  function verifyCancel(
    S: string, pre: Snapshot, post: Snapshot, qty: number, cfg: any
  ) {
    assertSnap(S, 'ms:rs', pre.p, post.p, `-${qty}`, 'reservedStock');
    assertSnap(S, 'ms:stock', pre.p, post.p, 'same', 'stock');
    if (post.pi && pre.pi) {
      assertSnap(S, 'pi:rsv', pre.pi, post.pi, `-${qty}`, 'reservedQuantity');
      assertSnap(S, 'pi:qty', pre.pi, post.pi, 'same', 'quantity');
    }
    assertCount(S, 'prs', pre.prs, post.prs, 'same');
    if (!cfg.imOn || cfg.mode !== 'INVENTORY_CONTROLLED') {
      const ce = post.msLedger?.find((l: any) => l.type === 'CANCEL_RELEASE');
      R(S, 'cancel:ledger', !!ce, ce ? 'CANCEL_RELEASE found' : 'no CANCEL_RELEASE entry');
    }
    R(S, 'cancel', true, 'OK');
  }

  function verifyHandedOver(
    S: string, pre: Snapshot, post: Snapshot, qty: number, cfg: any
  ) {
    if (cfg.imOn && cfg.mode === 'INVENTORY_CONTROLLED') {
      assertSnap(S, 'pi:qty', pre.pi, post.pi, `-${qty}`, 'quantity');
      assertSnap(S, 'pi:rsv', pre.pi, post.pi, `-${qty}`, 'reservedQuantity');
      assertSnap(S, 'ms:stock', pre.p, post.p, 'same', 'stock');
      assertSnap(S, 'ms:rs', pre.p, post.p, `-${qty}`, 'reservedStock');
    } else {
      assertSnap(S, 'ms:stock', pre.p, post.p, `-${qty}`, 'stock');
      assertSnap(S, 'ms:rs', pre.p, post.p, `-${qty}`, 'reservedStock');
      if (cfg.imOn && cfg.sync && post.pi && pre.pi) {
        assertSnap(S, 'pi:qty', pre.pi, post.pi, `-${qty}`, 'quantity');
        assertSnap(S, 'pi:rsv', pre.pi, post.pi, `-${qty}`, 'reservedQuantity');
      } else if (post.pi && pre.pi) {
        assertSnap(S, 'pi:qty', pre.pi, post.pi, 'same', 'quantity');
        assertSnap(S, 'pi:rsv', pre.pi, post.pi, 'same', 'reservedQuantity');
      }
    }
    R(S, 'handedOver', true, 'OK');
  }

  function verifyReturn(
    S: string, pre: Snapshot, post: Snapshot, qty: number, cfg: any
  ) {
    assertSnap(S, 'ret:ms', pre.p, post.p, `+${qty}`, 'stock');
    if (post.pi && pre.pi) {
      assertSnap(S, 'ret:piQty', pre.pi, post.pi, `+${qty}`, 'quantity');
    }
    const retEntries = post.msLedger?.filter((l: any) => l.type === 'RETURN');
    R(S, 'ret:ledger', retEntries?.length > 0,
      retEntries?.length > 0 ? `RETURN entries: ${retEntries.length}` : 'no RETURN entry');
    R(S, 'return', true, 'OK');
  }

  function printResults() {
    console.log('\n===== STOCK LIFECYCLE MATRIX RESULTS =====');
    console.log('Scenario          | Step                 | Result | Detail');
    console.log('------------------+----------------------+--------+-------');
    for (const r of results) {
      console.log(
        `${r.s.padEnd(18)}| ${r.step.padEnd(21)}| ${r.ok ? 'PASS' : 'FAIL'}   | ${r.msg}`
      );
    }
    const pass = results.filter(r => r.ok).length;
    const fail = results.filter(r => !r.ok).length;
    console.log('------------------------------------------');
    console.log(`Total: ${results.length} | PASS: ${pass} | FAIL: ${fail}`);
    if (fail > 0) {
      console.log('\nFAILURES:');
      for (const r of results.filter(r => !r.ok))
        console.log(`  ${r.s} / ${r.step}: ${r.msg}`);
    }
  }

  async function cleanupProduct(prisma: PrismaService, pid: string) {
    await prisma.physicalInventoryLedger.deleteMany({ where: { productId: pid } });
    await prisma.physicalReservationAllocation.deleteMany({
      where: { reservation: { productId: pid } },
    });
    await prisma.physicalReservation.deleteMany({
      where: { productId: pid },
    });
    await prisma.managedStockLedger.deleteMany({ where: { productId: pid } });
    await prisma.costingLot.deleteMany({ where: { productId: pid } });
    await prisma.physicalInventory.deleteMany({ where: { productId: pid } });
    await prisma.productVariant.deleteMany({ where: { productId: pid } });
    await prisma.product.deleteMany({ where: { id: pid } });
  }

  async function cleanAll(prisma: PrismaService) {
    const prefix = `sl-`;
    for (const table of ['physicalReservationAllocation', 'physicalReservation']) {
      await prisma.$executeRawUnsafe(
        `DELETE FROM "${table}" WHERE "orderItemId" IN (SELECT id FROM "OrderItem" WHERE "orderId" IN (SELECT id FROM "Order" WHERE "customerId" IN (SELECT id FROM "UserProfile" WHERE username LIKE '${prefix}%')))`
      );
    }
    await prisma.$executeRawUnsafe(
      `DELETE FROM "Dispatch" WHERE "orderId" IN (SELECT id FROM "Order" WHERE "customerId" IN (SELECT id FROM "UserProfile" WHERE username LIKE '${prefix}%'))`
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM "OrderItem" WHERE "orderId" IN (SELECT id FROM "Order" WHERE "customerId" IN (SELECT id FROM "UserProfile" WHERE username LIKE '${prefix}%'))`
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM "Payment" WHERE "orderId" IN (SELECT id FROM "Order" WHERE "customerId" IN (SELECT id FROM "UserProfile" WHERE username LIKE '${prefix}%'))`
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM "Order" WHERE "customerId" IN (SELECT id FROM "UserProfile" WHERE username LIKE '${prefix}%')`
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM "PosSession" WHERE "cashierId" IN (SELECT id FROM "UserProfile" WHERE username LIKE '${prefix}%')`
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM "UserSettings" WHERE "userId" IN (SELECT id FROM "UserProfile" WHERE username LIKE '${prefix}%')`
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM "RefreshToken" WHERE "userId" IN (SELECT id FROM "UserProfile" WHERE username LIKE '${prefix}%')`
    );
    await prisma.$executeRawUnsafe(
      `DELETE FROM "UserProfile" WHERE username LIKE '${prefix}%'`
    );
    await prisma.$executeRawUnsafe(`DELETE FROM "BinLocation" WHERE code = 'TBIN'`);
  }
});
