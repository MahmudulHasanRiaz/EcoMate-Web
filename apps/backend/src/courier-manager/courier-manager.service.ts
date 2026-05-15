import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const BASE_URLS: Record<string, string> = {
  steadfast: 'https://portal.packzy.com/api/v1',
  pathao: 'https://api-hermes.pathao.com',
  redx: 'https://api.redx.com.bd/v1.0.0-beta',
  carrybee: 'https://developers.carrybee.com',
};

@Injectable()
export class CourierManagerService {
  private readonly logger = new Logger(CourierManagerService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async getCreds(courier: string) {
    const c = await this.prisma.courierCredentials.findUnique({ where: { courier } });
    if (!c || !c.enabled) throw new BadRequestException(`${courier} is not configured or disabled`);
    return c;
  }

  private normalizePhone(raw?: string | null): string {
    const digits = (raw || '').replace(/\D/g, '');
    if (digits.length === 11) return digits;
    if (digits.length === 13 && digits.startsWith('88')) return digits.slice(-11);
    if (digits.length === 10) return `0${digits}`;
    return digits;
  }

  private async logDispatch(params: {
    orderId: string; courier: string; status: string; message?: string;
    requestPayload?: unknown; responsePayload?: unknown; consignmentId?: string; trackingCode?: string;
  }) {
    await this.prisma.courierDispatchLog.create({ data: params as any });
  }

  async dispatch(courier: string, orderIds: string[]) {
    const orders = await this.prisma.order.findMany({
      where: { id: { in: orderIds } },
      include: {
        customer: { select: { id: true, firstName: true, lastName: true, phoneNumber: true, email: true } },
        items: { include: { product: { select: { name: true } } } },
      },
    });

    const results: { id: string; ok: boolean; message?: string; consignmentId?: string; trackingCode?: string }[] = [];
    for (const order of orders) {
      try {
        const result = await this.dispatchOne(courier, order);
        results.push({ id: order.id, ok: true, ...result });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Dispatch failed';
        results.push({ id: order.id, ok: false, message: msg });
      }
    }
    return results;
  }

  private async dispatchOne(courier: string, order: any): Promise<{ consignmentId?: string; trackingCode?: string }> {
    const creds = await this.getCreds(courier);
    const base = BASE_URLS[courier];

    switch (courier) {
      case 'steadfast': return this.dispatchSteadfast(creds, base, order);
      case 'pathao': return this.dispatchPathao(creds, base, order);
      case 'redx': return this.dispatchRedx(creds, base, order);
      case 'carrybee': return this.dispatchCarrybee(creds, base, order);
      default: throw new BadRequestException(`Unknown courier: ${courier}`);
    }
  }

  private async dispatchSteadfast(creds: any, base: string, order: any) {
    const apiKey = creds.apiKey || creds.credentials?.['apiKey'];
    const secretKey = creds.secretKey || creds.credentials?.['secretKey'];
    if (!apiKey || !secretKey) throw new BadRequestException('Steadfast API key/secret not configured');

    const recipient = order.customer;
    const phone = this.normalizePhone(recipient.phoneNumber);
    const total = Number(order.total);
    const address = order.shippingAddress;

    const payload = {
      invoice: order.displayId,
      recipient_name: `${recipient.firstName} ${recipient.lastName}`.trim() || 'Customer',
      recipient_phone: phone,
      recipient_address: address?.address || (address ? `${address.district || ''}` : 'Dhaka'),
      cod_amount: total,
      note: order.officeNotes || undefined,
    };

    try {
      const res = await fetch(`${base}/create_order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Api-Key': apiKey, 'Secret-Key': secretKey },
        body: JSON.stringify(payload),
      });
      const data = await res.json() as Record<string, unknown>;

      if (data['status'] === 200 || data['consignment_id']) {
        const consignmentId = String(data['consignment_id'] || '');
        const trackingCode = String(data['tracking_code'] || '');
        await this.prisma.order.update({
          where: { id: order.id },
          data: { courierService: 'steadfast', courierConsignmentId: consignmentId, courierTrackingCode: trackingCode },
        });
        await this.logDispatch({ orderId: order.id, courier: 'steadfast', status: 'success', consignmentId, trackingCode, requestPayload: payload, responsePayload: data });
        return { consignmentId, trackingCode };
      }
      const msg = String(data['message'] || data['error'] || 'Steadfast dispatch failed');
      await this.logDispatch({ orderId: order.id, courier: 'steadfast', status: 'failed', message: msg, requestPayload: payload, responsePayload: data });
      throw new BadRequestException(msg);
    } catch (e: unknown) {
      if (e instanceof BadRequestException) throw e;
      throw new BadRequestException((e as Error).message);
    }
  }

  private async dispatchPathao(creds: any, base: string, order: any) {
    const clientId = creds.clientId || creds.credentials?.['clientId'];
    const clientSecret = creds.clientSecret || creds.credentials?.['clientSecret'];
    const username = creds.username || creds.credentials?.['username'];
    const password = creds.password || creds.credentials?.['password'];
    if (!clientId || !clientSecret || !username || !password) throw new BadRequestException('Pathao credentials not configured');

    const tokenRes = await fetch(`${base}/aladdin/api/v1/issue-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, username, password, grant_type: 'password' }),
    });
    const tokenData = await tokenRes.json() as Record<string, unknown>;
    if (!tokenData['access_token']) throw new BadRequestException(String(tokenData['message'] || 'Pathao auth failed'));
    const token = String(tokenData['access_token']);

    const storeId = creds.storeId || creds.credentials?.['storeId'] || '1';
    const recipient = order.customer;
    const phone = this.normalizePhone(recipient.phoneNumber);
    const total = Number(order.total);
    const address = order.shippingAddress;

    const payload = {
      store_id: parseInt(storeId),
      merchant_order_id: order.displayId,
      recipient_name: `${recipient.firstName} ${recipient.lastName}`.trim(),
      recipient_phone: phone,
      recipient_address: address?.address || 'Dhaka',
      recipient_city: address?.cityId || 1,
      recipient_zone: address?.zoneId || 1,
      delivery_type: 48,
      item_type: 2,
      item_quantity: order.items?.length || 1,
      item_weight: 0.5,
      amount_to_collect: total,
      special_instruction: order.officeNotes || '',
    };

    try {
      const res = await fetch(`${base}/aladdin/api/v1/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const data = await res.json() as Record<string, unknown>;
      if (data['data']?.['consignment_id']) {
        const cId = String((data['data'] as Record<string, unknown>)['consignment_id']);
        await this.prisma.order.update({ where: { id: order.id }, data: { courierService: 'pathao', courierConsignmentId: cId } });
        await this.logDispatch({ orderId: order.id, courier: 'pathao', status: 'success', consignmentId: cId, requestPayload: payload, responsePayload: data });
        return { consignmentId: cId, trackingCode: cId };
      }
      const msg = String(data['message'] || 'Pathao dispatch failed');
      await this.logDispatch({ orderId: order.id, courier: 'pathao', status: 'failed', message: msg, requestPayload: payload, responsePayload: data });
      throw new BadRequestException(msg);
    } catch (e: unknown) {
      if (e instanceof BadRequestException) throw e;
      throw new BadRequestException((e as Error).message);
    }
  }

  private async dispatchRedx(creds: any, base: string, order: any) {
    const apiKey = creds.apiKey || creds.credentials?.['apiKey'];
    if (!apiKey) throw new BadRequestException('RedX API key not configured');

    const recipient = order.customer;
    const phone = this.normalizePhone(recipient.phoneNumber);
    const total = Number(order.total);
    const address = order.shippingAddress;
    const name = `${recipient.firstName} ${recipient.lastName}`.trim();

    const payload = {
      merchant_invoice_id: order.displayId,
      customer_name: name || 'Customer',
      customer_phone: phone,
      delivery_area: address?.district || 'Dhaka',
      delivery_address: address?.address || 'N/A',
      merchant_order_amount: total,
      cash_collection_amount: total,
      parcel_weight_in_gram: 500,
      instruction: order.officeNotes || '',
      value: total,
      parcel_details: {
        name: order.items?.[0]?.product?.name || 'Product',
        category: 'Apparel',
      },
    };

    try {
      const res = await fetch(`${base}/parcel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'API-KEY': apiKey },
        body: JSON.stringify(payload),
      });
      const data = await res.json() as Record<string, unknown>;
      if (data['data']?.['tracking_id']) {
        const trackingCode = String((data['data'] as Record<string, unknown>)['tracking_id']);
        await this.prisma.order.update({ where: { id: order.id }, data: { courierService: 'redx', courierTrackingCode: trackingCode } });
        await this.logDispatch({ orderId: order.id, courier: 'redx', status: 'success', trackingCode, requestPayload: payload, responsePayload: data });
        return { trackingCode };
      }
      const msg = String(data['message'] || 'RedX dispatch failed');
      await this.logDispatch({ orderId: order.id, courier: 'redx', status: 'failed', message: msg, requestPayload: payload, responsePayload: data });
      throw new BadRequestException(msg);
    } catch (e: unknown) {
      if (e instanceof BadRequestException) throw e;
      throw new BadRequestException((e as Error).message);
    }
  }

  private async dispatchCarrybee(creds: any, base: string, order: any) {
    const clientId = creds.clientId || creds.credentials?.['clientId'];
    const clientSecret = creds.clientSecret || creds.credentials?.['clientSecret'];
    if (!clientId || !clientSecret) throw new BadRequestException('Carrybee credentials not configured');

    const recipient = order.customer;
    const phone = this.normalizePhone(recipient.phoneNumber);
    const total = Number(order.total);
    const address = order.shippingAddress;
    const name = `${recipient.firstName} ${recipient.lastName}`.trim();

    const payload = {
      full_name: name || 'Customer',
      mobile: phone,
      address: address?.address || 'Dhaka',
      city: address?.district || 'Dhaka',
      area: address?.area || '',
      merchant_order_id: order.displayId,
      amount_to_collect: Math.round(total),
      package_charge: order.shippingCharge ? Number(order.shippingCharge) : 100,
      item_description: order.items?.[0]?.product?.name || 'Product',
      item_quantity: order.items?.length || 1,
      instruction: order.officeNotes || '',
    };

    try {
      const res = await fetch(`${base}/api/shipments/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Client-ID': clientId, 'Client-Secret': clientSecret, 'Client-Context': 'merchant' },
        body: JSON.stringify(payload),
      });
      const data = await res.json() as Record<string, unknown>;
      if (data['success'] && data['data']?.['consignment_id']) {
        const cId = String((data['data'] as Record<string, unknown>)['consignment_id']);
        await this.prisma.order.update({ where: { id: order.id }, data: { courierService: 'carrybee', courierConsignmentId: cId } });
        await this.logDispatch({ orderId: order.id, courier: 'carrybee', status: 'success', consignmentId: cId, requestPayload: payload, responsePayload: data });
        return { consignmentId: cId };
      }
      const msg = String(data['message'] || 'Carrybee dispatch failed');
      await this.logDispatch({ orderId: order.id, courier: 'carrybee', status: 'failed', message: msg, requestPayload: payload, responsePayload: data });
      throw new BadRequestException(msg);
    } catch (e: unknown) {
      if (e instanceof BadRequestException) throw e;
      throw new BadRequestException((e as Error).message);
    }
  }
}
