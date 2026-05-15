import { Test, TestingModule } from '@nestjs/testing'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { PrismaService } from '../src/prisma/prisma.service'

describe('Auth (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService

  const uniqueId = Date.now()
  const testUser = {
    firstName: 'E2E',
    lastName: 'Tester',
    username: `e2e-auth-${uniqueId}`,
    email: `e2e-auth-${uniqueId}@test.com`,
    password: 'password123',
    phoneNumber: '01700000000',
  }

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()

    app = moduleFixture.createNestApplication()
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }))
    await app.init()
    prisma = app.get(PrismaService)
  })

  afterEach(async () => {
    try {
      await prisma.refreshToken.deleteMany({ where: { user: { email: testUser.email } } })
      await prisma.userSettings.deleteMany({ where: { user: { email: testUser.email } } })
      await prisma.user.deleteMany({ where: { email: testUser.email } })
    } catch { /* ignore cleanup errors */ }
    await app.close()
  })

  it('POST /auth/register → 201 with accessToken and user', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send(testUser)
      .expect(201)

    expect(res.body).toHaveProperty('accessToken')
    expect(res.body.user).toMatchObject({
      email: testUser.email,
      role: 'admin',
    })
  })

  it('POST /auth/login → 200 with accessToken', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send(testUser)

    await prisma.user.updateMany({
      where: { email: testUser.email },
      data: { status: 'active' },
    })

    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: testUser.email, password: testUser.password })
      .expect(200)

    expect(res.body).toHaveProperty('accessToken')
    expect(res.body.user).toMatchObject({ email: testUser.email })
  })

  it('GET /auth/me → 200 with user data when authenticated', async () => {
    const registerRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send(testUser)
    const token = registerRes.body.accessToken

    const res = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)

    expect(res.body).toMatchObject({
      email: testUser.email,
      firstName: testUser.firstName,
      lastName: testUser.lastName,
    })
  })

  it('GET /auth/me → 401 without token', async () => {
    await request(app.getHttpServer())
      .get('/auth/me')
      .expect(401)
  })

  it('POST /auth/change-password → 200 and old password no longer works', async () => {
    const registerRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send(testUser)
    const token = registerRes.body.accessToken

    const newPassword = 'newpassword456'

    await request(app.getHttpServer())
      .post('/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: testUser.password, newPassword })
      .expect(200)

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: testUser.email, password: testUser.password })
      .expect(401)

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: testUser.email, password: newPassword })
      .expect(200)

    expect(loginRes.body).toHaveProperty('accessToken')
  })

  it('POST /auth/login → 401 with invalid password', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send(testUser)

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: testUser.email, password: 'wrongpassword' })
      .expect(401)
  })
})
