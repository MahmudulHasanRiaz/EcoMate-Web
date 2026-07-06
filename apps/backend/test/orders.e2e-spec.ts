import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Orders (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let customerId: string;
  let productId: string;
  let createdOrderIds: string[] = [];

  const uniqueId = Date.now();
  const adminUser = {
    firstName: 'Order',
    lastName: 'Admin',
    username: `e2e-orders-admin-${uniqueId}`,
    email: `e2e-orders-admin-${uniqueId}@test.com`,
    password: 'password123',
    phoneNumber: '01700000001',
  };

  const customerUser = {
    firstName: 'Order',
    lastName: 'Customer',
    username: `e2e-orders-cust-${uniqueId}`,
    email: `e2e-orders-cust-${uniqueId}@test.com`,
    password: 'custpass123',
    phoneNumber: '01700000002',
    role: 'customer',
  };

  const testProduct = {
    name: `E2E Order Product ${uniqueId}`,
    slug: `e2e-order-product-${uniqueId}`,
    basePrice: 500,
    stock: 100,
    type: 'simple',
  };

  beforeEach(async () => {
    createdOrderIds = [];
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    const registerRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send(adminUser)
      .expect(201);
    adminToken = registerRes.body.accessToken;

    const customerRes = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(customerUser)
      .expect(201);
    customerId = customerRes.body.id;

    const productRes = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(testProduct)
      .expect(201);
    productId = productRes.body.id;
  });

  afterEach(async () => {
    try {
      for (const id of createdOrderIds) {
        await prisma.payment.deleteMany({ where: { orderId: id } });
        await prisma.orderItem.deleteMany({ where: { orderId: id } });
        await prisma.shipment.deleteMany({ where: { orderId: id } });
        await prisma.order.deleteMany({ where: { id } });
      }
      await prisma.productVariant.deleteMany({ where: { productId } });
      await prisma.product.deleteMany({ where: { id: productId } });
      await prisma.userSettings.deleteMany({
        where: { user: { email: { startsWith: 'e2e-orders-' } } },
      });
      await prisma.refreshToken.deleteMany({
        where: { user: { email: { startsWith: 'e2e-orders-' } } },
      });
      await prisma.userProfile.deleteMany({
        where: { email: { startsWith: 'e2e-orders-' } },
      });
    } catch {
      /* ignore cleanup errors */
    }
    await app.close();
  });

  const createOrder = async (overrides: any = {}) => {
    const res = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId,
        items: [{ productId, quantity: 2, price: 500 }],
        ...overrides,
      })
      .expect(201);
    createdOrderIds.push(res.body.id);
    return res.body;
  };

  it('POST /orders → 201 with displayId and items', async () => {
    const order = await createOrder({
      shippingCharge: 60,
      shippingAddress: { address: '123 Test St', city: 'Dhaka' },
    });

    expect(order).toHaveProperty('displayId');
    expect(order.displayId).toMatch(/^ORD-\d{6}-\d{4}$/);
    expect(order.items).toHaveLength(1);
    expect(order.items[0]).toMatchObject({ quantity: 2 });
  });

  it('GET /orders/:id → 200 with order details and items', async () => {
    const order = await createOrder({
      items: [{ productId, quantity: 3, price: 500 }],
    });

    const res = await request(app.getHttpServer())
      .get(`/orders/${order.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.customer).toMatchObject({
      firstName: customerUser.firstName,
    });
    expect(res.body).toHaveProperty('status');
  });

  it('PUT /orders/:id/status → 200 when transitioning to valid next status', async () => {
    const order = await createOrder();

    const statusesRes = await request(app.getHttpServer())
      .get('/order-statuses')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const currentStatus = statusesRes.body.find(
      (s: any) => s.id === order.statusId,
    );
    const nextStatusIds: string[] = currentStatus?.nextStatuses || [];

    if (nextStatusIds.length > 0) {
      const res = await request(app.getHttpServer())
        .put(`/orders/${order.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ statusId: nextStatusIds[0] })
        .expect(200);

      expect(res.body.statusId).toBe(nextStatusIds[0]);
    }
  });

  it('PUT /orders/:id/status → 400 for invalid status transition', async () => {
    const order = await createOrder();

    const statusesRes = await request(app.getHttpServer())
      .get('/order-statuses')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const currentStatus = statusesRes.body.find(
      (s: any) => s.id === order.statusId,
    );
    const nextStatusIds: string[] = currentStatus?.nextStatuses || [];

    const invalidStatus = statusesRes.body.find(
      (s: any) => !nextStatusIds.includes(s.id) && s.id !== order.statusId,
    );

    if (invalidStatus) {
      await request(app.getHttpServer())
        .put(`/orders/${order.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ statusId: invalidStatus.id })
        .expect(400);
    }
  });

  it('PUT /orders/:id → 200 with updated shipping charge', async () => {
    const order = await createOrder({ shippingCharge: 60 });

    const res = await request(app.getHttpServer())
      .put(`/orders/${order.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ shippingCharge: 120 })
      .expect(200);

    expect(res.body.shippingCharge).toBe('120');
  });

  it('PUT /orders/:id → 200 with updated shipping address', async () => {
    const order = await createOrder();

    const newAddress = { address: '456 Updated Ave', city: 'Chittagong' };
    const res = await request(app.getHttpServer())
      .put(`/orders/${order.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ shippingAddress: newAddress })
      .expect(200);

    expect(res.body.shippingAddress).toMatchObject(newAddress);
  });
});
