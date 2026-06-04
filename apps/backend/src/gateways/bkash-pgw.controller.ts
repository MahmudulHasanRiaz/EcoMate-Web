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

    let resolvedOrderId = orderId;
    let viewToken: string | null = null;

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
      } catch {
        /* fall through */
      }
    }
    const orderRow = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { viewToken: true },
    });
    const tokenQuery = orderRow?.viewToken ? `&t=${orderRow.viewToken}` : '';
    res.redirect(`${storefrontUrl}/checkout/thank-you?orderId=${orderId}&pending=true${tokenQuery}`);
  }
}
