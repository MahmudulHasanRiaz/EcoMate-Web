import { Controller, Post, Get, Body, Param, Query, Res } from '@nestjs/common';
import { BkashPgwService } from './bkash-pgw.service';
import { PrismaService } from '../prisma/prisma.service';
import type { Response } from 'express';

@Controller('payments/bkash')
export class BkashPgwController {
  constructor(
    private readonly bkash: BkashPgwService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('create')
  async create(
    @Body() dto: { amount: number; orderId: string; invoiceNo: string },
  ) {
    return this.bkash.createPayment(dto.amount, dto.orderId, dto.invoiceNo);
  }

  @Get('callback')
  async callback(@Query() query: any, @Res() res: Response) {
    const { paymentID, status } = query;
    const frontendUrl = process.env['APP_URL'] || 'http://localhost:5173';

    if (status === 'success' && paymentID) {
      try {
        const { token } = await this.bkash.grantToken();
        const result = await this.bkash.executePayment(paymentID, token);
        if (result.transactionStatus === 'Completed') {
          res.redirect(
            `${frontendUrl}/admin/orders?bkash=success&trxID=${result.trxID}`,
          );
          return;
        }
      } catch {
        /* fall through */
      }
    }
    res.redirect(`${frontendUrl}/admin/orders?bkash=failed`);
  }
}
