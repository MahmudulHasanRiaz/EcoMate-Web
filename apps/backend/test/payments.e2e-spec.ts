import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma/prisma.service'

describe('Payments (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let adminToken: string
  let customerId: string
  let productId: string
  let orderId: string

  const uniqueId = Date.now()
  const adminUser = {
    firstName: 'Pay',
    lastName: 'Admin',
    username: `e2e-pay-admin-${uniqueId}`,
    email: `e2e-pay-admin-${uniqueId}@test.com`,
    password: 'password123',
    phoneNumber: '01700000003',
  }

  const customerUser = {
    firstName: 'Pay',
    lastName: 'Customer',
    username: `e2e-pay-cust-${uniqueId}`,
    email: `e2e-pay-cust-${uniqueId}@test.com`,
    password: 'custpass123',
    phoneNumber: '01700000004',
    role: 'customer',
  }

  const testProduct = {
    name: `E2E Payment Product ${uniqueId}`,
    slug: `e2e-pay-product-${uniqueId}`,
    basePrice: 1000,
    stock: 50,
    type: 'simple',
  }

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleFixture.createNestApplication()
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }))
    await app.init()
    prisma = app.get(PrismaService)

    const registerRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send(adminUser)
      .expect(201)
    adminToken = registerRes.body.accessToken

    const customerRes = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(customerUser)
      .expect(201)
    customerId = customerRes.body.id

    const productRes = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(testProduct)
      .expect(201)
    productId = productRes.body.id

    const orderRes = await request(app.getHttpServer())
      .post('/orders')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customerId,
        items: [{ productId, quantity: 1, price: 1000 }],
        shippingCharge: 80,
      })
      .expect(201)
    orderId = orderRes.body.id
  })

  afterEach(async () => {
    try {
      await prisma.payment.deleteMany({ where: { orderId } })
      await prisma.orderItem.deleteMany({ where: { orderId } })
      await prisma.shipment.deleteMany({ where: { orderId } })
      await prisma.order.deleteMany({ where: { id: orderId } })
      await prisma.productVariant.deleteMany({ where: { productId } })
      await prisma.product.deleteMany({ where: { id: productId } })
      await prisma.userSettings.deleteMany({ where: { user: { email: { startsWith: 'e2e-pay-' } } } })
      await prisma.refreshToken.deleteMany({ where: { user: { email: { startsWith: 'e2e-pay-' } } } })
      await prisma.user.deleteMany({ where: { email: { startsWith: 'e2e-pay-' } } })
    } catch { /* ignore cleanup errors */ }
    await app.close()
  })

  it('POST /payments/:orderId → 201 creates payment for order', async () => {
    const res = await request(app.getHttpServer())
      .post(`/payments/${orderId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        method: 'bkash',
        amount: 1080,
        transactionId: `TXN-${uniqueId}`,
        notes: 'E2E test payment',
      })
      .expect(201)

    expect(res.body).toMatchObject({
      method: 'bkash',
      status: 'pending',
      orderId,
    })
  })

  it('PUT /payments/:id/verify → 200 changes payment status to verified', async () => {
    const createRes = await request(app.getHttpServer())
      .post(`/payments/${orderId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        method: 'nagad',
        amount: 1080,
        transactionId: `TXN-V-${uniqueId}`,
      })
      .expect(201)

    const paymentId = createRes.body.id

    const res = await request(app.getHttpServer())
      .put(`/payments/${paymentId}/verify`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'verified', notes: 'Verified by E2E test' })
      .expect(200)

    expect(res.body).toMatchObject({
      status: 'verified',
      verifiedBy: expect.any(String),
    })
    expect(res.body.verifiedAt).toBeTruthy()
  })

  it('GET /payments → 200 includes the created payment in list', async () => {
    const createRes = await request(app.getHttpServer())
      .post(`/payments/${orderId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        method: 'cod',
        amount: 1080,
        transactionId: `TXN-L-${uniqueId}`,
      })
      .expect(201)

    const paymentId = createRes.body.id

    const res = await request(app.getHttpServer())
      .get('/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)

    expect(res.body.data).toBeInstanceOf(Array)
    expect(res.body).toHaveProperty('meta')
    const payment = res.body.data.find((p: any) => p.id === paymentId)
    expect(payment).toBeTruthy()
    expect(payment).toMatchObject({
      method: 'cod',
      amount: '1080',
      status: 'pending',
    })
  })
})
