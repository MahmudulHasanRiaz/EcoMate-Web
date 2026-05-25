import { Controller, Post, Get, Body, Param, Query, Res } from '@nestjs/common';
import { BkashPgwService } from './bkash-pgw.service';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../common/decorators/public.decorator';
import type { Response } from 'express';

@Controller('payments/bkash')
export class BkashPgwController {
  constructor(
    private readonly bkash: BkashPgwService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Post('create')
  async create(
    @Body() dto: { amount: number; orderId: string; invoiceNo: string },
  ) {
    return this.bkash.createPayment(dto.amount, dto.orderId, dto.invoiceNo);
  }

  @Get('callback')
  async callback(@Query() query: any, @Res() res: Response) {
    const { paymentID, status, orderId: queryOrderId } = query;
    const storefrontUrl = process.env['STOREFRONT_URL'] || 'http://localhost:3000';
    const orderId = queryOrderId || '';

    if (status === 'success' && paymentID) {
      try {
        const { token } = await this.bkash.grantToken();
        const result = await this.bkash.executePayment(paymentID, token);
        if (result.transactionStatus === 'Completed') {
          if (result.payerReference) {
            await this.prisma.payment.updateMany({
              where: { orderId: result.payerReference, method: 'online' },
              data: {
                status: 'verified',
                transactionId: result.trxID,
                method: 'bkash',
                verifiedAt: new Date(),
              },
            });
          }
          res.redirect(
            `${storefrontUrl}/checkout/thank-you?orderId=${result.payerReference || orderId}`,
          );
          return;
        }
      } catch {
        /* fall through */
      }
    }
    res.redirect(`${storefrontUrl}/checkout/thank-you?orderId=${orderId}&pending=true`);
  }
}
