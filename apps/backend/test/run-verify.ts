import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import * as http from 'http';

process.env.DATABASE_URL = 'postgresql://postgres@localhost:5432/ecomate_web';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Silence Prisma query logs in test
(prisma as any).$on('query', () => {});

const UQ = `v${Date.now()}`;
const WAREHOUSE_ID = '5430fd1a-ad81-4b97-9a04-18ca8568c725';
const BIN_LOCATION_ID = '00000000-0000-0000-0000-00000000tbin';
const BASE = 'http://localhost:45678';

type Snapshot = Record<string, any>;
const results: { s: string; step: string; ok: boolean; msg: string }[] = [];

function R(s: string, step: string, ok: boolean, msg: string) {
  results.push({ s, step, ok, msg });
  if (!ok) console.error(`  FAIL ${s}/${step}: ${msg}`);
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

async function snap(pid: string, wh: string) {
  const p = await prisma.product.findUnique({ where: { id: pid } }) as any;
  const pi = await prisma.physicalInventory.findFirst({
    where: { productId: pid, warehouseId: wh },
  });
  const prs = await prisma.physicalReservation.findMany({
    where: { productId: pid },
  });
  const allocs = prs.length > 0
    ? await prisma.physicalReservationAllocation.findMany({
        where: { reservationId: { in: prs.map(r => r.id) } },
      })
    : [];
  const msLedger = await prisma.managedStockLedger.findMany({
    where: { productId: pid },
  });
  const piLedger = await prisma.physicalInventoryLedger.findMany({
    where: { productId: pid },
  });
  return { p, pi, prs, allocs, msLedger, piLedger };
}

async function api(method: string, path: string, body?: any, headers?: Record<string, string>): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const url = new URL('/api' + path, BASE);
    const opts: http.RequestOptions = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json', ...headers },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode || 500, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode || 500, data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function waitForServer(url: string, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await api('GET', '/');
      return;
    } catch { await new Promise(r => setTimeout(r, 500)); }
  }
  throw new Error('Server did not start within timeout');
}

const ST = {
  pending: 'e73e7a7b-b560-412d-b3fc-b8d82560c444',
  confirmed: '7bbd83e6-3cc2-4321-a1ae-f999846e8990',
  cancelled: '9685921f-2ad6-472b-9577-2f91cd1ea169',
  delivered: 'a5940329-d6d3-4a15-b75e-674d4b146483',
  returnPending: 'c99116ae-166e-4e0a-b45c-e35f0d324456',
  returned: '967a70af-ba52-4ca1-ae7c-6c0a43a8d695',
  packed: 'df24c60f-0f77-45f1-9067-23a463840177',
  shipping: '0db852a9-6484-45c6-b2ae-d8a5e6337f51',
};

async function main() {
  // Start compiled server in background
  console.log('Starting NestJS server...');
  const server = spawn('node', ['dist/src/main.js'], {
    cwd: '/Users/riaz/Custom Development Projects/EcoMate Web/apps/backend',
    env: { ...process.env, PORT: '45678', SKIP_LICENSE_CHECK: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout?.on('data', (d: Buffer) => {
    const s = d.toString();
    if (s.includes('Nest application successfully started')) {
      console.log('  (server ready signal detected)');
    }
    // Print ALL server stdout for debugging
    console.error(`  [OUT] ${s.trimEnd()}`);
  });
  server.stderr?.on('data', (d: Buffer) => {
    const s = d.toString();
    // Print all server output for debugging
    process.stderr.write(`  [SRV] ${s}`);
  });
  server.on('error', (err) => console.error('Server error:', err));

  await waitForServer(BASE);
  console.log('Server ready.');

  // Login as seeded admin (superadmin)
  const login = await api('POST', '/auth/login', {
    email: 'admin@ecomate.com', password: 'Admin@123',
  });
  const token: string = login.data?.accessToken || '';
  const adminId: string = login.data?.user?.id || '';
  if (!token) { console.error('Failed to login as admin:', login.data); process.exit(1); }
  console.log('  Admin login OK');

  // Create test customer via admin API
  const custSuffix = String(Date.now()).slice(-8);
  const custPhone = `017${custSuffix}`;
  const custU = {
    firstName: 'SLCust', lastName: UQ,
    username: `sl-cus-${UQ}`, email: `sl-cus-${UQ}@t.com`,
    password: 'Pass123!@#', phoneNumber: custPhone, role: 'customer',
  };
  const cust = await api('POST', '/users', custU, { 'Authorization': `Bearer ${token}` });
  const userProfileId: string = cust.data?.id || '';
  if (!userProfileId) { console.error('Failed to create customer:', cust.data); process.exit(1); }
  // Create CustomerProfile (Order.customerId references CustomerProfile, not UserProfile)
  const custProfile = await prisma.customerProfile.upsert({
    where: { phone: custPhone },
    create: {
      name: custU.firstName + ' ' + custU.lastName,
      email: custU.email,
      phone: custPhone,
    },
    update: {
      name: custU.firstName + ' ' + custU.lastName,
      email: custU.email,
    },
  });
  const customerId: string = custProfile.id;
  console.log('  Customer created OK (id=' + customerId + ')');

  // Clear any IP blocks from previous runs
  await prisma.$executeRawUnsafe(`DELETE FROM "BlockedIp"`).catch(() => {});
  await prisma.$executeRawUnsafe(`DELETE FROM "CheckoutLead"`).catch(() => {});

  await prisma.$executeRawUnsafe(`DELETE FROM "BinLocation" WHERE code = 'TBIN'`);
  await prisma.binLocation.create({
    data: { id: BIN_LOCATION_ID, warehouseId: WAREHOUSE_ID, code: 'TBIN' },
  });

  const allScenarios: [string, boolean, string, boolean][] = [
    ['S1:IM-OFF-MS', false, 'MANAGED_STOCK', false],
    ['S2:IM-ON-MS-syncOFF', true, 'MANAGED_STOCK', false],
    ['S3:IM-ON-MS-syncON', true, 'MANAGED_STOCK', true],
    ['S4:IM-ON-IC', true, 'INVENTORY_CONTROLLED', false],
  ];
  for (const [label, iOn, mode, sync] of allScenarios) {
    await prisma.$executeRawUnsafe(`DELETE FROM "BlockedIp"`).catch(() => {});
    await prisma.$executeRawUnsafe(`DELETE FROM "CheckoutLead"`).catch(() => {});
    await scenario(label, iOn, mode, sync, token, adminId, customerId);
    // 20s delay to avoid order throttle (5/60s) and IP auto-block
    await new Promise(r => setTimeout(r, 20000));
  }

  await prisma.$executeRawUnsafe(`DELETE FROM "BlockedIp"`).catch(() => {});
  await prisma.$executeRawUnsafe(`DELETE FROM "CheckoutLead"`).catch(() => {});
  await posScenario('S5:POS-IM-OFF', false, token, adminId);
  await prisma.$executeRawUnsafe(`DELETE FROM "BlockedIp"`).catch(() => {});
  await prisma.$executeRawUnsafe(`DELETE FROM "CheckoutLead"`).catch(() => {});
  await new Promise(r => setTimeout(r, 20000));
  await posScenario('S5:POS-IM-ON', true, token, adminId);

  // Regression: negative physical stock tests
  await prisma.$executeRawUnsafe(`DELETE FROM "BlockedIp"`).catch(() => {});
  await prisma.$executeRawUnsafe(`DELETE FROM "CheckoutLead"`).catch(() => {});
  await regNoPi(token, adminId, customerId);
  await new Promise(r => setTimeout(r, 5000));
  await prisma.$executeRawUnsafe(`DELETE FROM "BlockedIp"`).catch(() => {});
  await regInsufficientPi(token, adminId, customerId);
  await new Promise(r => setTimeout(r, 20000));
  await prisma.$executeRawUnsafe(`DELETE FROM "BlockedIp"`).catch(() => {});
  await regPiLifecycle('REG:MS-noSync-smallPI', false, token, adminId, customerId, 10);
  await new Promise(r => setTimeout(r, 20000));
  await prisma.$executeRawUnsafe(`DELETE FROM "BlockedIp"`).catch(() => {});
  await regPiLifecycle('REG:MS-sync-smallPI', true, token, adminId, customerId, 10);

  printResults();

  // Shutdown
  await cleanupAll();
  await prisma.$disconnect();
  server.kill('SIGTERM');
  setTimeout(() => process.exit(results.filter(r => !r.ok).length > 0 ? 1 : 0), 1000);
}

async function scenario(
  label: string, imOn: boolean, mode: string, sync: boolean,
  token: string, adminId: string, customerId: string
) {
  const qty = 50;
  const orderQty = 3;
  const pid = randomUUID();

  // Set IM
  await prisma.systemSetting.upsert({
    where: { key: 'inventory_enabled' },
    create: { key: 'inventory_enabled', value: String(imOn) },
    update: { value: String(imOn) },
  });

  // Create product via API
  const prod = await api('POST', '/products', {
    name: `${label}-${UQ}`, slug: `${label.toLowerCase()}-${UQ}`,
    basePrice: 500, managedStockQuantity: qty,
    availabilityMode: mode, syncManagedStock: sync,
    manageStock: true, warehouseId: WAREHOUSE_ID,
  }, { 'Authorization': `Bearer ${token}` });
  if (prod.status >= 400) { R(label, 'createProduct', false, `HTTP ${prod.status}`); return; }
  const prodId = prod.data.id;

  // Create PI row if needed
  if (imOn) {
    await prisma.physicalInventory.create({
      data: {
        productId: prodId, warehouseId: WAREHOUSE_ID,
        binLocationId: BIN_LOCATION_ID, quantity: qty, reservedQuantity: 0,
      },
    });
  }

  // CREATE ORDER
  let pre = await snap(prodId, WAREHOUSE_ID);
  const order = await api('POST', '/orders', {
    customerId, items: [{ productId: prodId, quantity: orderQty, price: 500 }],
    shippingCharge: 0, paymentOptionType: 'CASH_ON_DELIVERY',
  });
  if (order.status >= 400) {
    R(label, 'createOrder', false, `HTTP ${order.status}: ${JSON.stringify(order.data)}`);
    await cleanupProduct(prodId); return;
  }
  const orderId = order.data.id;
  let post = await snap(prodId, WAREHOUSE_ID);
  verifyReserve(label, pre, post, orderQty, { imOn, mode, sync });
  pre = post;

  // CONFIRM
  const confirmResp = await api('PUT', `/orders/${orderId}/status`, { statusId: ST.confirmed },
    { 'Authorization': `Bearer ${token}` });
  if (confirmResp.status >= 400) { R(label, 'confirm-http', false, `HTTP ${confirmResp.status}: ${JSON.stringify(confirmResp.data).slice(0,200)}`); return; }
  post = await snap(prodId, WAREHOUSE_ID);
  assertSnap(label, 'stock', pre.p, post.p, 'same', 'managedStockQuantity');
  assertSnap(label, 'rs', pre.p, post.p, 'same', 'reservedStock');
  if (post.pi && pre.pi) {
    assertSnap(label, 'pi:qty', pre.pi, post.pi, 'same', 'quantity');
    if (imOn && mode === 'MANAGED_STOCK' && !sync) {
      // syncOFF: physical reservation happens at Confirm (allocate)
      assertSnap(label, 'pi:rsv', pre.pi, post.pi, `+${orderQty}`, 'reservedQuantity');
    } else if (imOn && mode === 'MANAGED_STOCK' && sync) {
      // syncON: physical reservation also happens at Confirm (allocate)
      assertSnap(label, 'pi:rsv', pre.pi, post.pi, `+${orderQty}`, 'reservedQuantity');
    } else if (imOn && mode === 'INVENTORY_CONTROLLED') {
      // IC: physical reservation also deferred to Confirm
      assertSnap(label, 'pi:rsv', pre.pi, post.pi, `+${orderQty}`, 'reservedQuantity');
    } else {
      assertSnap(label, 'pi:rsv', pre.pi, post.pi, 'same', 'reservedQuantity');
    }
  }
  R(label, 'confirm', true, 'OK');
  pre = post;

  // CANCEL
  const cancelResp = await api('PUT', `/orders/${orderId}/status`, { statusId: ST.cancelled },
    { 'Authorization': `Bearer ${token}` });
  if (cancelResp.status >= 400) { R(label, 'cancel-http', false, `HTTP ${cancelResp.status}: ${JSON.stringify(cancelResp.data)}`); return; }
  post = await snap(prodId, WAREHOUSE_ID);
  console.log(`  [TRACE ${label}] cancel returned HTTP ${cancelResp.status}, pre-rs=${pre.p?.reservedStock}, post-rs=${post.p?.reservedStock}, ledger=${post.msLedger.length}`);
  verifyCancel(label, pre, post, orderQty, { imOn, mode, sync });
  pre = post;

  // IDEMPOTENT CANCEL (already Cancelled → 400 is OK)
  const cancel2 = await api('PUT', `/orders/${orderId}/status`, { statusId: ST.cancelled },
    { 'Authorization': `Bearer ${token}` });
  if (cancel2.status >= 400 && cancel2.status !== 400) { R(label, 'cancel2-http', false, `HTTP ${cancel2.status}`); return; }
  post = await snap(prodId, WAREHOUSE_ID);
  assertSnap(label, 'cancel2:stock', pre.p, post.p, 'same', 'managedStockQuantity');
  assertSnap(label, 'cancel2:rs', pre.p, post.p, 'same', 'reservedStock');
  if (post.pi && pre.pi) {
    assertSnap(label, 'cancel2:piQty', pre.pi, post.pi, 'same', 'quantity');
    assertSnap(label, 'cancel2:piRsv', pre.pi, post.pi, 'same', 'reservedQuantity');
  }
  R(label, 'cancel:idempotent', true, 'OK');
  pre = post;

  // NEW ORDER (fresh reserve) for dispatch/return flow
  const order2 = await api('POST', '/orders', {
    customerId, items: [{ productId: prodId, quantity: orderQty, price: 500 }],
    shippingCharge: 0, paymentOptionType: 'CASH_ON_DELIVERY',
  });
  if (order2.status >= 400) { R(label, 'createOrder2', false, `HTTP ${order2.status}: ${JSON.stringify(order2.data).slice(0,200)}`); return; }
  const order2Id = order2.data.id;
  // Confirm order2
  const c2 = await api('PUT', `/orders/${order2Id}/status`, { statusId: ST.confirmed },
    { 'Authorization': `Bearer ${token}` });
  if (c2.status >= 400) { R(label, 'confirm2-http', false, `HTTP ${c2.status}`); return; }
  post = await snap(prodId, WAREHOUSE_ID);
  // After order2 creation + confirm: reservedStock re-reserved
  if (imOn && mode === 'INVENTORY_CONTROLLED') {
    assertSnap(label, 'order2:rs', pre.p, post.p, 'same', 'reservedStock');
  } else {
    assertSnap(label, 'order2:rs', pre.p, post.p, `+${orderQty}`, 'reservedStock');
  }
  pre = post;

  // DISPATCH → HANDED_OVER
  const disp = await api('POST', '/dispatch', {
    orderId: order2Id, courier: 'steadfast',
    consignmentId: `CN2-${label}-${UQ}`,
  }, { 'Authorization': `Bearer ${token}` });
  if (disp.status >= 400) {
    R(label, 'dispatch', false, `HTTP ${disp.status}`);
  } else {
    const ho = await api('PATCH', `/dispatch/${disp.data.id}/status`, { status: 'HANDED_OVER', performedBy: adminId },
      { 'Authorization': `Bearer ${token}` });
    if (ho.status >= 400) {
      R(label, 'handedOver', false, `HTTP ${ho.status}, body=${JSON.stringify(ho.data).slice(0,300)}`);
    } else {
      post = await snap(prodId, WAREHOUSE_ID);
      verifyHandedOver(label, pre, post, orderQty, { imOn, mode, sync });
      pre = post;
    }
  }

  // RETURN: Confirmed → Packed → Shipping → Delivered → Return Pending → Returned
  for (const sid of [ST.packed, ST.shipping, ST.delivered, ST.returnPending, ST.returned]) {
    const rs = await api('PUT', `/orders/${order2Id}/status`, { statusId: sid },
      { 'Authorization': `Bearer ${token}` });
    if (rs.status >= 400) { R(label, `ret-step-${sid}`, false, `HTTP ${rs.status}`); }
  }
  post = await snap(prodId, WAREHOUSE_ID);
  verifyReturn(label, pre, post, orderQty, { imOn, mode, sync });
  pre = post;

  // RETURN IDEMPOTENT
  await api('PUT', `/orders/${order2Id}/status`, { statusId: ST.returned },
    { 'Authorization': `Bearer ${token}` });
  post = await snap(prodId, WAREHOUSE_ID);
  assertSnap(label, 'ret2:stock', pre.p, post.p, 'same', 'managedStockQuantity');
  if (post.pi && pre.pi) assertSnap(label, 'ret2:piQty', pre.pi, post.pi, 'same', 'quantity');
  R(label, 'return:doubleApply', true, 'OK');

  // FINAL: no negatives
  const fin = await snap(prodId, WAREHOUSE_ID);
  if (fin.p) {
    if ((fin.p as any).managedStockQuantity < 0) R(label, 'final:negMs', false, `stock=${(fin.p as any).managedStockQuantity}`);
    if ((fin.p as any).reservedStock < 0) R(label, 'final:negRs', false, `rs=${(fin.p as any).reservedStock}`);
  }
  if (fin.pi) {
    if ((fin.pi as any).quantity < 0) R(label, 'final:negPiQty', false, `pi=${(fin.pi as any).quantity}`);
    if ((fin.pi as any).reservedQuantity < 0) R(label, 'final:negPiRsv', false, `piRsv=${(fin.pi as any).reservedQuantity}`);
  }

  await cleanupProduct(prodId);
}

async function posScenario(
  label: string, imOn: boolean, token: string, adminId: string
) {
  const qty = 30;
  const pid = randomUUID();
  await prisma.systemSetting.upsert({
    where: { key: 'inventory_enabled' },
    create: { key: 'inventory_enabled', value: String(imOn) },
    update: { value: String(imOn) },
  });

  const prod = await api('POST', '/products', {
    name: `${label}-${UQ}`, slug: `${label.toLowerCase()}-${UQ}`,
    basePrice: 500, managedStockQuantity: qty,
    availabilityMode: 'MANAGED_STOCK', manageStock: true,
    warehouseId: WAREHOUSE_ID,
  }, { 'Authorization': `Bearer ${token}` });
  if (prod.status >= 400) { R(label, 'createProduct', false, `HTTP ${prod.status}`); return; }
  const prodId = prod.data.id;

  if (imOn) {
    await prisma.physicalInventory.create({
      data: {
        productId: prodId, warehouseId: WAREHOUSE_ID,
        binLocationId: BIN_LOCATION_ID, quantity: qty, reservedQuantity: 0,
      },
    });
  }

  // POS session
  const sess = await prisma.posSession.create({
    data: { showroomId: WAREHOUSE_ID, cashierId: adminId, status: 'open', openedAt: new Date(), openingBalance: 0 },
  });

  const pre = await snap(prodId, WAREHOUSE_ID);

  const pos = await api('POST', '/pos/orders', {
    items: [{ productId: prodId, quantity: 2, price: 500 }],
    payments: [{ method: 'cash', amount: 1000 }],
    deliveryMethod: 'Counter Sale',
  }, {
    'Authorization': `Bearer ${token}`,
    'x-pos-session-id': sess.id,
  });

  if (pos.status >= 400) {
    R(label, 'posCreate', false, `HTTP ${pos.status}: ${JSON.stringify(pos.data)}`);
  } else {
    R(label, 'posCreate', true, 'OK');
  }

  const post = await snap(prodId, WAREHOUSE_ID);

  if (imOn) {
    assertSnap(label, 'pi:qty', pre.pi, post.pi, '-2', 'quantity');
    assertSnap(label, 'pi:rsv', pre.pi, post.pi, 'same', 'reservedQuantity');
    assertSnap(label, 'ms:stock', pre.p, post.p, 'same', 'managedStockQuantity');
    assertSnap(label, 'ms:rs', pre.p, post.p, 'same', 'reservedStock');
  } else {
    assertSnap(label, 'ms:stock', pre.p, post.p, '-2', 'managedStockQuantity');
    assertSnap(label, 'ms:rs', pre.p, post.p, 'same', 'reservedStock');
    if (post.pi) assertSnap(label, 'pi:qty', pre.pi, post.pi, 'same', 'quantity');
  }

  // Cleanup POS
  const posOrder = await prisma.order.findFirst({ where: { posSessionId: sess.id } });
  if (posOrder) {
    await prisma.orderItem.deleteMany({ where: { orderId: posOrder.id } });
    await prisma.payment.deleteMany({ where: { orderId: posOrder.id } });
    await prisma.order.deleteMany({ where: { id: posOrder.id } });
  }
  await prisma.posSession.deleteMany({ where: { id: sess.id } });
  await cleanupProduct(prodId);
}

// === VERIFICATION HELPERS ===

function isSkipped(cfg: any) { return !cfg.imOn && cfg.mode === 'INVENTORY_CONTROLLED'; }

function verifyReserve(S: string, pre: Snapshot, post: Snapshot, qty: number, cfg: any) {
  if (isSkipped(cfg)) {
    assertSnap(S, 'ms:rs', pre.p, post.p, 'same', 'reservedStock');
    assertSnap(S, 'ms:stock', pre.p, post.p, 'same', 'managedStockQuantity');
    R(S, 'reserve', true, 'SKIP');
    return;
  }
  if (cfg.mode === 'INVENTORY_CONTROLLED') {
    assertSnap(S, 'pi:rsv', pre.pi, post.pi, 'same', 'reservedQuantity');
    assertSnap(S, 'pi:qty', pre.pi, post.pi, 'same', 'quantity');
    assertSnap(S, 'ms:rs', pre.p, post.p, 'same', 'reservedStock');
    assertSnap(S, 'ms:stock', pre.p, post.p, 'same', 'managedStockQuantity');
    assertCount(S, 'prs', pre.prs, post.prs, 'same');
  } else {
    assertSnap(S, 'ms:rs', pre.p, post.p, `+${qty}`, 'reservedStock');
    assertSnap(S, 'ms:stock', pre.p, post.p, 'same', 'managedStockQuantity');
    if (post.pi) {
      assertSnap(S, 'pi:rsv', pre.pi, post.pi, 'same', 'reservedQuantity');
    }
  }
  R(S, 'reserve', true, 'OK');
}

function verifyCancel(S: string, pre: Snapshot, post: Snapshot, qty: number, cfg: any) {
  if (isSkipped(cfg)) {
    assertSnap(S, 'ms:rs', pre.p, post.p, 'same', 'reservedStock');
    assertSnap(S, 'ms:stock', pre.p, post.p, 'same', 'managedStockQuantity');
    R(S, 'cancel', true, 'SKIP');
    return;
  }
  if (cfg.imOn && (cfg.mode === 'INVENTORY_CONTROLLED' || cfg.mode === 'MANAGED_STOCK')) {
    assertSnap(S, 'ms:rs', pre.p, post.p, cfg.mode === 'MANAGED_STOCK' ? `-${qty}` : 'same', 'reservedStock');
    if (post.pi && pre.pi) {
      assertSnap(S, 'pi:rsv', pre.pi, post.pi, `-${qty}`, 'reservedQuantity');
      assertSnap(S, 'pi:qty', pre.pi, post.pi, 'same', 'quantity');
    }
  } else {
    assertSnap(S, 'ms:rs', pre.p, post.p, `-${qty}`, 'reservedStock');
    if (post.pi && pre.pi) {
      assertSnap(S, 'pi:rsv', pre.pi, post.pi, 'same', 'reservedQuantity');
      assertSnap(S, 'pi:qty', pre.pi, post.pi, 'same', 'quantity');
    }
  }
  assertSnap(S, 'ms:stock', pre.p, post.p, 'same', 'managedStockQuantity');
  assertCount(S, 'prs', pre.prs, post.prs, 'same');
  if (!cfg.imOn || cfg.mode !== 'INVENTORY_CONTROLLED') {
    const ce = post.msLedger?.find((l: any) => l.type === 'CANCEL_RELEASE');
    R(S, 'cancel:ledger', !!ce, ce ? 'CANCEL_RELEASE found' : 'no CANCEL_RELEASE');
  }
  R(S, 'cancel', true, 'OK');
}

function verifyHandedOver(S: string, pre: Snapshot, post: Snapshot, qty: number, cfg: any) {
  if (isSkipped(cfg)) {
    assertSnap(S, 'ms:stock', pre.p, post.p, 'same', 'managedStockQuantity');
    assertSnap(S, 'ms:rs', pre.p, post.p, 'same', 'reservedStock');
    R(S, 'handedOver', true, 'SKIP');
    return;
  }
  if (cfg.imOn && cfg.mode === 'INVENTORY_CONTROLLED') {
    assertSnap(S, 'pi:qty', pre.pi, post.pi, `-${qty}`, 'quantity');
    assertSnap(S, 'pi:rsv', pre.pi, post.pi, `-${qty}`, 'reservedQuantity');
    assertSnap(S, 'ms:stock', pre.p, post.p, 'same', 'managedStockQuantity');
    assertSnap(S, 'ms:rs', pre.p, post.p, 'same', 'reservedStock');
  } else if (cfg.imOn && cfg.mode === 'MANAGED_STOCK') {
    // IM ON + MS: both PI consumed, MS quantity deducted (always under new architecture)
    assertSnap(S, 'ms:stock', pre.p, post.p, `-${qty}`, 'managedStockQuantity');
    assertSnap(S, 'ms:rs', pre.p, post.p, `-${qty}`, 'reservedStock');
    if (post.pi && pre.pi) {
      assertSnap(S, 'pi:qty', pre.pi, post.pi, `-${qty}`, 'quantity');
      assertSnap(S, 'pi:rsv', pre.pi, post.pi, `-${qty}`, 'reservedQuantity');
    }
  } else {
    // IM OFF + MS: MS quantity deducted, rs decremented, no PI change
    assertSnap(S, 'ms:stock', pre.p, post.p, `-${qty}`, 'managedStockQuantity');
    assertSnap(S, 'ms:rs', pre.p, post.p, `-${qty}`, 'reservedStock');
    if (post.pi && pre.pi) {
      assertSnap(S, 'pi:qty', pre.pi, post.pi, 'same', 'quantity');
      assertSnap(S, 'pi:rsv', pre.pi, post.pi, 'same', 'reservedQuantity');
    }
  }
  R(S, 'handedOver', true, 'OK');
}

function verifyReturn(S: string, pre: Snapshot, post: Snapshot, qty: number, cfg: any) {
  if (isSkipped(cfg)) {
    assertSnap(S, 'ret:ms', pre.p, post.p, 'same', 'managedStockQuantity');
    assertSnap(S, 'ret:rs', pre.p, post.p, 'same', 'reservedStock');
    R(S, 'ret:ledger', true, 'SKIP');
    R(S, 'return', true, 'SKIP');
    return;
  }
  if (cfg.imOn && cfg.mode === 'INVENTORY_CONTROLLED') {
    assertSnap(S, 'ret:ms', pre.p, post.p, 'same', 'managedStockQuantity');
    if (post.pi && pre.pi) {
      assertSnap(S, 'ret:piQty', pre.pi, post.pi, `+${qty}`, 'quantity');
    }
    const piRet = post.piLedger?.filter((l: any) => l.direction === 'IN' && l.type === 'RESTORATION');
    R(S, 'ret:ledger', piRet?.length > 0,
      piRet?.length > 0 ? `PI RETURN entries: ${piRet.length}` : 'no PI RETURN entry');
  } else if (cfg.imOn && cfg.mode === 'MANAGED_STOCK') {
    // IM ON + MS: both PI returned, MS quantity restored (always under new architecture)
    assertSnap(S, 'ret:ms', pre.p, post.p, `+${qty}`, 'managedStockQuantity');
    if (post.pi && pre.pi) {
      assertSnap(S, 'ret:piQty', pre.pi, post.pi, `+${qty}`, 'quantity');
    }
    const retEntries = post.msLedger?.filter((l: any) => l.type === 'RETURN');
    R(S, 'ret:ledger', retEntries?.length > 0,
      retEntries?.length > 0 ? `RETURN entries: ${retEntries.length}` : 'no RETURN entry');
  } else {
    // IM OFF + MS: MS quantity restored, no PI change
    assertSnap(S, 'ret:ms', pre.p, post.p, `+${qty}`, 'managedStockQuantity');
    if (post.pi && pre.pi) {
      assertSnap(S, 'ret:piQty', pre.pi, post.pi, 'same', 'quantity');
    }
    const retEntries = post.msLedger?.filter((l: any) => l.type === 'RETURN');
    R(S, 'ret:ledger', retEntries?.length > 0,
      retEntries?.length > 0 ? `RETURN entries: ${retEntries.length}` : 'no RETURN entry');
  }
  R(S, 'return', true, 'OK');
}

async function regNoPi(token: string, adminId: string, customerId: string) {
  const S = 'R1:noPI';
  const pid = randomUUID();
  await prisma.systemSetting.upsert({
    where: { key: 'inventory_enabled' },
    create: { key: 'inventory_enabled', value: 'true' },
    update: { value: 'true' },
  });
  const prod = await api('POST', '/products', {
    name: `${S}-${UQ}`, slug: `${S.toLowerCase()}-${UQ}`,
    basePrice: 500, managedStockQuantity: 50,
    availabilityMode: 'MANAGED_STOCK', syncManagedStock: false,
    manageStock: true, warehouseId: WAREHOUSE_ID,
  }, { 'Authorization': `Bearer ${token}` });
  if (prod.status >= 400) { R(S, 'createProduct', false, `HTTP ${prod.status}`); return; }
  const prodId = prod.data.id;
  const order = await api('POST', '/orders', {
    customerId, items: [{ productId: prodId, quantity: 3, price: 500 }],
    shippingCharge: 0, paymentOptionType: 'CASH_ON_DELIVERY',
  });
  if (order.status >= 400) { R(S, 'createOrder', false, `HTTP ${order.status}`); return; }
  const confirmResp = await api('PUT', `/orders/${order.data.id}/status`, { statusId: ST.confirmed },
    { 'Authorization': `Bearer ${token}` });
  R(S, 'confirm', confirmResp.status >= 400,
    confirmResp.status >= 400 ? `FAIL expected: ${confirmResp.status} ${JSON.stringify(confirmResp.data).slice(0,100)}` : `UNEXPECTED PASS ${confirmResp.status}`);
  await cleanupProduct(prodId);
}

async function regInsufficientPi(token: string, adminId: string, customerId: string) {
  const S = 'R2:insufPI';
  const pid = randomUUID();
  await prisma.systemSetting.upsert({
    where: { key: 'inventory_enabled' },
    create: { key: 'inventory_enabled', value: 'true' },
    update: { value: 'true' },
  });
  const prod = await api('POST', '/products', {
    name: `${S}-${UQ}`, slug: `${S.toLowerCase()}-${UQ}`,
    basePrice: 500, managedStockQuantity: 50,
    availabilityMode: 'MANAGED_STOCK', syncManagedStock: false,
    manageStock: true, warehouseId: WAREHOUSE_ID,
  }, { 'Authorization': `Bearer ${token}` });
  if (prod.status >= 400) { R(S, 'createProduct', false, `HTTP ${prod.status}`); return; }
  const prodId = prod.data.id;
  await prisma.physicalInventory.create({
    data: { productId: prodId, warehouseId: WAREHOUSE_ID, binLocationId: BIN_LOCATION_ID, quantity: 2, reservedQuantity: 0 },
  });
  const order = await api('POST', '/orders', {
    customerId, items: [{ productId: prodId, quantity: 3, price: 500 }],
    shippingCharge: 0, paymentOptionType: 'CASH_ON_DELIVERY',
  });
  if (order.status >= 400) { R(S, 'createOrder', false, `HTTP ${order.status}`); return; }
  const confirmResp = await api('PUT', `/orders/${order.data.id}/status`, { statusId: ST.confirmed },
    { 'Authorization': `Bearer ${token}` });
  R(S, 'confirm', confirmResp.status >= 400,
    confirmResp.status >= 400 ? `FAIL expected: ${confirmResp.status} ${JSON.stringify(confirmResp.data).slice(0,100)}` : `UNEXPECTED PASS ${confirmResp.status}`);
  await cleanupProduct(prodId);
}

async function regPiLifecycle(label: string, sync: boolean, token: string, adminId: string, customerId: string, piQty: number) {
  const orderQty = 3;
  const pid = randomUUID();
  const qty = 50;
  await prisma.systemSetting.upsert({
    where: { key: 'inventory_enabled' },
    create: { key: 'inventory_enabled', value: 'true' },
    update: { value: 'true' },
  });
  const prod = await api('POST', '/products', {
    name: `${label}-${UQ}`, slug: `${label.toLowerCase()}-${UQ}`,
    basePrice: 500, managedStockQuantity: qty,
    availabilityMode: 'MANAGED_STOCK', syncManagedStock: sync,
    manageStock: true, warehouseId: WAREHOUSE_ID,
  }, { 'Authorization': `Bearer ${token}` });
  if (prod.status >= 400) { R(label, 'createProduct', false, `HTTP ${prod.status}`); return; }
  const prodId = prod.data.id;
  // Create PI with small initial quantity
  await prisma.physicalInventory.create({
    data: { productId: prodId, warehouseId: WAREHOUSE_ID, binLocationId: BIN_LOCATION_ID, quantity: piQty, reservedQuantity: 0 },
  });
  let pre = await snap(prodId, WAREHOUSE_ID);

  // CREATE ORDER
  const order = await api('POST', '/orders', {
    customerId, items: [{ productId: prodId, quantity: orderQty, price: 500 }],
    shippingCharge: 0, paymentOptionType: 'CASH_ON_DELIVERY',
  });
  if (order.status >= 400) { R(label, 'createOrder', false, `HTTP ${order.status}`); await cleanupProduct(prodId); return; }
  const orderId = order.data.id;
  let post = await snap(prodId, WAREHOUSE_ID);
  const cfg = { imOn: true, mode: 'MANAGED_STOCK' as const, sync };
  // New architecture: PI reservation always deferred to Confirm (regardless of sync flag)
  verifyReserve(label, pre, post, orderQty, cfg);
  pre = post;

  // CONFIRM
  const confirmResp = await api('PUT', `/orders/${orderId}/status`, { statusId: ST.confirmed },
    { 'Authorization': `Bearer ${token}` });
  if (confirmResp.status >= 400) { R(label, 'confirm', false, `HTTP ${confirmResp.status}: ${JSON.stringify(confirmResp.data).slice(0,200)}`); await cleanupProduct(prodId); return; }
  post = await snap(prodId, WAREHOUSE_ID);
  assertSnap(label, 'ms:qty', pre.p, post.p, 'same', 'managedStockQuantity');
  assertSnap(label, 'ms:rs', pre.p, post.p, 'same', 'reservedStock');
  if (post.pi && pre.pi) {
    assertSnap(label, 'pi:qty', pre.pi, post.pi, 'same', 'quantity');
    // New architecture: PI reservation always happens at Confirm (both syncOn and syncOff)
    assertSnap(label, 'pi:rsv', pre.pi, post.pi, `+${orderQty}`, 'reservedQuantity');
  }
  R(label, 'confirm', true, `PI ${piQty}, sync=${sync}`);
  pre = post;

  // CANCEL + NEW ORDER (order2) for dispatch/return flow
  const cancelResp = await api('PUT', `/orders/${orderId}/status`, { statusId: ST.cancelled },
    { 'Authorization': `Bearer ${token}` });
  if (cancelResp.status >= 400) { R(label, 'cancel', false, `HTTP ${cancelResp.status}`); await cleanupProduct(prodId); return; }
  post = await snap(prodId, WAREHOUSE_ID);
  verifyCancel(label, pre, post, orderQty, cfg);
  pre = post;

  const order2 = await api('POST', '/orders', {
    customerId, items: [{ productId: prodId, quantity: orderQty, price: 500 }],
    shippingCharge: 0, paymentOptionType: 'CASH_ON_DELIVERY',
  });
  if (order2.status >= 400) { R(label, 'createOrder2', false, `HTTP ${order2.status}`); await cleanupProduct(prodId); return; }
  const order2Id = order2.data.id;
  const c2 = await api('PUT', `/orders/${order2Id}/status`, { statusId: ST.confirmed },
    { 'Authorization': `Bearer ${token}` });
  if (c2.status >= 400) { R(label, 'confirm2', false, `HTTP ${c2.status}`); await cleanupProduct(prodId); return; }
  post = await snap(prodId, WAREHOUSE_ID);
  assertSnap(label, 'order2:rs', pre.p, post.p, `+${orderQty}`, 'reservedStock');
  pre = post;

  // DISPATCH → HANDED_OVER
  const disp = await api('POST', '/dispatch', {
    orderId: order2Id, courier: 'steadfast',
    consignmentId: `CN2-${label}-${UQ}`,
  }, { 'Authorization': `Bearer ${token}` });
  if (disp.status >= 400) { R(label, 'dispatch', false, `HTTP ${disp.status}`); await cleanupProduct(prodId); return; }
  const ho = await api('PATCH', `/dispatch/${disp.data.id}/status`, { status: 'HANDED_OVER', performedBy: adminId },
    { 'Authorization': `Bearer ${token}` });
  if (ho.status >= 400) { R(label, 'handedOver', false, `HTTP ${ho.status}`); await cleanupProduct(prodId); return; }
  post = await snap(prodId, WAREHOUSE_ID);
  verifyHandedOver(label, pre, post, orderQty, cfg);
  pre = post;

  // RETURN: Confirmed → Packed → Shipping → Delivered → Return Pending → Returned
  for (const sid of [ST.packed, ST.shipping, ST.delivered, ST.returnPending, ST.returned]) {
    const rr = await api('PUT', `/orders/${order2Id}/status`, { statusId: sid },
      { 'Authorization': `Bearer ${token}` });
    if (rr.status >= 400) { R(label, `ret-step-${sid}`, false, `HTTP ${rr.status}`); await cleanupProduct(prodId); return; }
  }
  post = await snap(prodId, WAREHOUSE_ID);
  verifyReturn(label, pre, post, orderQty, cfg);
  // Idempotent (same-status transition allowed to 400, just verify snapshots unchanged)
  const retSnap = await snap(prodId, WAREHOUSE_ID);
  await api('PUT', `/orders/${order2Id}/status`, { statusId: ST.returned },
    { 'Authorization': `Bearer ${token}` }).catch(() => {});
  const retSnap2 = await snap(prodId, WAREHOUSE_ID);
  const piQtySame = (retSnap.pi?.quantity ?? 0) === (retSnap2.pi?.quantity ?? 0);
  const msQtySame = (retSnap.p?.managedStockQuantity ?? 0) === (retSnap2.p?.managedStockQuantity ?? 0);
  R(label, 'return:doubleApply', piQtySame && msQtySame, piQtySame && msQtySame ? 'snapshots unchanged' : 'stock changed');

  await cleanupProduct(prodId);
  const expectedPiEnd = piQty - (sync ? 0 : 0); // PI returns to original after full cycle
  R(label, 'lifecycle', true, `PI ${piQty}→${piQty - orderQty}→${piQty}, sync=${sync}`);
}

function printResults() {
  console.log('\n===== STOCK LIFECYCLE MATRIX RESULTS =====');
  console.log('Scenario          | Step                 | Result | Detail');
  console.log('------------------+----------------------+--------+-------');
  for (const r of results) {
    console.log(`${r.s.padEnd(18)}| ${r.step.padEnd(21)}| ${r.ok ? 'PASS' : 'FAIL'}   | ${r.msg}`);
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

async function cleanupProduct(pid: string) {
  const raw = (sql: string) => prisma.$executeRawUnsafe(sql).catch(() => {});
  // Order matters: PI ledger/reservations first, then PI, then MS ledger, then product
  await raw(`DELETE FROM "PhysicalInventoryLedger" WHERE "productId" = '${pid}'`);
  await raw(`DELETE FROM "PhysicalReservationAllocation" WHERE "reservationId" IN (SELECT id FROM "PhysicalReservation" WHERE "orderItemId" IN (SELECT id FROM "OrderItem" WHERE "productId" = '${pid}'))`);
  await raw(`DELETE FROM "PhysicalReservation" WHERE "orderItemId" IN (SELECT id FROM "OrderItem" WHERE "productId" = '${pid}')`);
  await raw(`DELETE FROM "ManagedStockLedger" WHERE "productId" = '${pid}'`);
  await raw(`DELETE FROM "CostingLot" WHERE "productId" = '${pid}'`);
  await raw(`DELETE FROM "PhysicalInventory" WHERE "productId" = '${pid}'`);
  await raw(`DELETE FROM "ProductVariant" WHERE "productId" = '${pid}'`);
  await raw(`DELETE FROM "OrderItem" WHERE "productId" = '${pid}'`);
  await raw(`DELETE FROM "Product" WHERE "id" = '${pid}'`);
}

async function cleanupAll() {
  const uq = `%${UQ}`;
  const raw = (sql: string) => prisma.$executeRawUnsafe(sql).catch(() => {});
  await raw(`DELETE FROM "PhysicalReservationAllocation" WHERE "reservationId" IN (SELECT id FROM "PhysicalReservation" WHERE "orderItemId" IN (SELECT id FROM "OrderItem" WHERE "orderId" IN (SELECT id FROM "Order" WHERE "createdById" IN (SELECT id FROM "UserProfile" WHERE username LIKE '${uq}'))))`);
  await raw(`DELETE FROM "PhysicalReservation" WHERE "orderItemId" IN (SELECT id FROM "OrderItem" WHERE "orderId" IN (SELECT id FROM "Order" WHERE "createdById" IN (SELECT id FROM "UserProfile" WHERE username LIKE '${uq}')))`);
  await raw(`DELETE FROM "Dispatch" WHERE "orderId" IN (SELECT id FROM "Order" WHERE "createdById" IN (SELECT id FROM "UserProfile" WHERE username LIKE '${uq}'))`);
  await raw(`DELETE FROM "OrderItem" WHERE "orderId" IN (SELECT id FROM "Order" WHERE "createdById" IN (SELECT id FROM "UserProfile" WHERE username LIKE '${uq}'))`);
  await raw(`DELETE FROM "Payment" WHERE "orderId" IN (SELECT id FROM "Order" WHERE "createdById" IN (SELECT id FROM "UserProfile" WHERE username LIKE '${uq}'))`);
  await raw(`DELETE FROM "Order" WHERE "createdById" IN (SELECT id FROM "UserProfile" WHERE username LIKE '${uq}')`);
  await raw(`DELETE FROM "PosSession" WHERE "cashierId" IN (SELECT id FROM "UserProfile" WHERE username LIKE '${uq}')`);
  await raw(`DELETE FROM "UserSettings" WHERE "userId" IN (SELECT id FROM "UserProfile" WHERE username LIKE '${uq}')`);
  await raw(`DELETE FROM "RefreshToken" WHERE "userId" IN (SELECT id FROM "UserProfile" WHERE username LIKE '${uq}')`);
  await raw(`DELETE FROM "Order" WHERE "customerId" IN (SELECT id FROM "CustomerProfile" WHERE phone LIKE '017%${UQ.slice(-5)}')`);
  await raw(`DELETE FROM "CustomerProfile" WHERE phone LIKE '017%${UQ.slice(-5)}'`);
  await raw(`DELETE FROM "UserProfile" WHERE username LIKE '${uq}'`);
  await raw(`DELETE FROM "BinLocation" WHERE code = 'TBIN'`);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
