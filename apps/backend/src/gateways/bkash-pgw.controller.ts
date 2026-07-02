import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  Res,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PaymentStatus } from '@prisma/client';
import { BkashPgwService } from './bkash-pgw.service';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../common/decorators/public.decorator';
import { Throttle } from '@nestjs/throttler';
import type { FastifyReply } from 'fastify';

@Controller('payments/bkash')
export class BkashPgwController {
  constructor(
    private readonly bkash: BkashPgwService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Post('create')
  async create(
    @Body() dto: { amount: number; orderId: string; invoiceNo: string },
  ) {
    return this.bkash.createPayment(dto.amount, dto.orderId, dto.invoiceNo);
  }

  @Get('callback')
  async callback(@Query() query: any, @Res() res: FastifyReply) {
    const { paymentID, status, orderId: queryOrderId } = query;
    const storefrontUrl =
      process.env['STOREFRONT_URL'] || 'http://localhost:3000';
    const orderId = queryOrderId || '';

    let resolvedOrderId = orderId;
    let viewToken: string | null = null;

    if (status === 'success' && paymentID) {
      try {
        const { token } = await this.bkash.grantToken();
        const result = await this.bkash.executePayment(paymentID, token);
        if (result.transactionStatus === 'Completed') {
          if (result.payerReference) {
            await this.prisma.payment.updateMany({
              where: {
                orderId: result.payerReference,
                gatewayCode: 'bkash_pgw',
              },
              data: {
                status: PaymentStatus.PAID,
                transactionId: result.trxID,
                gatewayCode: 'bkash',
                verifiedAt: new Date(),
              },
            });
            resolvedOrderId = result.payerReference;
          }
          const orderRow = await this.prisma.order.findUnique({
            where: { id: resolvedOrderId },
            select: { viewToken: true },
          });
          viewToken = orderRow?.viewToken ?? null;
          const tokenQuery = viewToken ? `&t=${viewToken}` : '';
          res.redirect(
            `${storefrontUrl}/checkout/thank-you?orderId=${resolvedOrderId || orderId}${tokenQuery}`,
          );
          return;
        }
      } catch (err) {
        Logger.error(`bKash callback error: ${err}`, 'BkashPgwController');
        throw new InternalServerErrorException(
          'bKash payment processing failed',
        );
      }
    }
    const orderRow = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { viewToken: true },
    });
    const tokenQuery = orderRow?.viewToken ? `&t=${orderRow.viewToken}` : '';
    res.redirect(
      `${storefrontUrl}/checkout/thank-you?orderId=${orderId}&pending=true${tokenQuery}`,
    );
  }
}
