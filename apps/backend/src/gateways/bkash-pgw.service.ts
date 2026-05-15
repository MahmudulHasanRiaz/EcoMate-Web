import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BkashPgwService {
  private readonly logger = new Logger(BkashPgwService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async getCredentials() {
    const config = await this.prisma.paymentGatewayConfig.findUnique({ where: { gateway: 'bkash_pgw' } });
    if (!config || !config.enabled) throw new BadRequestException('bKash PGW is not enabled');

    const creds = config.credentials as any || {};
    const env = config.mode || 'sandbox';
    const baseUrl = env === 'production'
      ? 'https://tokenized.pay.bka.sh/v1.2.0-beta'
      : 'https://tokenized.sandbox.bka.sh/v1.2.0-beta';

    if (!creds.appKey || !creds.appSecret || !creds.username || !creds.password) {
      throw new BadRequestException('bKash PGW credentials not configured');
    }
    return { ...creds, baseUrl, phoneNumber: config.phoneNumber };
  }

  async grantToken() {
    const creds = await this.getCredentials();
    try {
      const res = await fetch(`${creds.baseUrl}/tokenized/checkout/token/grant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', username: creds.username, password: creds.password },
        body: JSON.stringify({ app_key: creds.appKey, app_secret: creds.appSecret }),
      });
      const data = await res.json();
      if (data.statusCode !== '0000') throw new BadRequestException(data.statusMessage || 'bKash grant token failed');
      return { token: data.id_token, refreshToken: data.refresh_token, expiresIn: data.expires_in };
    } catch (e: any) { throw new BadRequestException(e.message || 'bKash token error'); }
  }

  async createPayment(amount: number, orderId: string, invoiceNo: string) {
    const creds = await this.getCredentials();
    const { token } = await this.grantToken();

    const callbackBase = process.env['APP_URL'] || `http://localhost:${process.env['PORT'] || 4000}`;

    try {
      const res = await fetch(`${creds.baseUrl}/tokenized/checkout/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', Authorization: token, 'X-APP-Key': creds.appKey },
        body: JSON.stringify({
          mode: '0011',
          payerReference: orderId,
          callbackURL: `${callbackBase}/api/payments/bkash/callback`,
          amount: String(amount),
          currency: 'BDT',
          intent: 'sale',
          merchantInvoiceNumber: `ECO-${invoiceNo}`,
        }),
      });
      const data = await res.json();
      if (data.statusCode !== '0000') throw new BadRequestException(data.statusMessage || 'bKash create payment failed');
      return { paymentID: data.paymentID, bkashURL: data.bkashURL, token };
    } catch (e: any) { throw new BadRequestException(e.message || 'bKash create error'); }
  }

  async executePayment(paymentID: string, token: string) {
    const creds = await this.getCredentials();
    try {
      const res = await fetch(`${creds.baseUrl}/tokenized/checkout/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', Authorization: token, 'X-APP-Key': creds.appKey },
        body: JSON.stringify({ paymentID }),
      });
      const data = await res.json();
      if (data.statusCode !== '0000') throw new BadRequestException(data.statusMessage || 'bKash execute failed');
      return data;
    } catch (e: any) { throw new BadRequestException(e.message || 'bKash execute error'); }
  }

  async queryPayment(paymentID: string, token: string) {
    const creds = await this.getCredentials();
    try {
      const res = await fetch(`${creds.baseUrl}/tokenized/checkout/payment/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', Authorization: token, 'X-APP-Key': creds.appKey },
        body: JSON.stringify({ paymentID }),
      });
      return await res.json();
    } catch (e: any) { throw new BadRequestException(e.message || 'bKash query error'); }
  }
}
