import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, BadRequestException } from '@nestjs/common';
import request from 'supertest';
import { HrPaymentsController } from '../hr-payments.controller';
import { HrPaymentsService } from '../hr-payments.service';

/**
 * Part 1 (P0) — `POST /payroll/payslips/:id/payments` used to 400 on every
 * legitimate request: `payslipId` was declared as a required body field while
 * the controller only supplied it from the path, and Nest validates `@Body()`
 * BEFORE the handler runs, so `{ ...dto, payslipId: id }` never executed.
 *
 * These tests exercise the real HTTP + ValidationPipe boundary (the layer the
 * service unit tests bypass), with the same pipe configuration as app.module.ts.
 */
describe('HrPaymentsController — payslip id comes from the path, not the body', () => {
  let app: INestApplication;
  const createPayment = jest.fn();

  beforeEach(async () => {
    createPayment.mockReset();
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [HrPaymentsController],
      providers: [
        {
          provide: HrPaymentsService,
          useValue: {
            createPayment,
            findPayments: jest.fn(),
            voidPayment: jest.fn(),
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('accepts a body WITHOUT payslipId and reaches the service with the path id merged', async () => {
    createPayment.mockResolvedValue({
      payment: { id: 'pp-1', amount: 10000 },
      payslip: { id: 'ps-1', status: 'paid' },
    });

    await request(app.getHttpServer())
      .post('/payroll/payslips/ps-1/payments')
      .send({
        amount: 10000,
        method: 'bkash',
        accountId: 'acc-1',
        referenceNo: 'REF-1',
      })
      .expect(201);

    expect(createPayment).toHaveBeenCalledTimes(1);
    expect(createPayment).toHaveBeenCalledWith(
      {
        amount: 10000,
        method: 'bkash',
        accountId: 'acc-1',
        referenceNo: 'REF-1',
        payslipId: 'ps-1',
      },
      undefined,
    );
  });

  it('always uses the URL payslip id, even when a body sends a different one', async () => {
    createPayment.mockResolvedValue({ payment: {}, payslip: {} });

    await request(app.getHttpServer())
      .post('/payroll/payslips/ps-1/payments')
      .send({ amount: 500, payslipId: 'someone-elses-payslip' })
      .expect(201);

    expect(createPayment).toHaveBeenCalledWith(
      expect.objectContaining({ payslipId: 'ps-1', amount: 500 }),
      undefined,
    );
  });

  it('still rejects a payment against a non-approved payslip', async () => {
    createPayment.mockRejectedValue(
      new BadRequestException('Payslip must be approved before payment'),
    );

    const res = await request(app.getHttpServer())
      .post('/payroll/payslips/ps-1/payments')
      .send({ amount: 10000 })
      .expect(400);

    expect(res.body.message).toBe('Payslip must be approved before payment');
    expect(createPayment).toHaveBeenCalledTimes(1);
  });

  it('still validates the remaining body fields (the pipe is really in force)', async () => {
    // No amount: the request must not reach the service.
    await request(app.getHttpServer())
      .post('/payroll/payslips/ps-1/payments')
      .send({ method: 'bkash' })
      .expect(400);

    expect(createPayment).not.toHaveBeenCalled();
  });
});
