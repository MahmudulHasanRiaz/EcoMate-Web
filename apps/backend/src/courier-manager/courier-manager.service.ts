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
    const c = await this.prisma.courierCredentials.findUnique({
      where: { courier },
    });
    if (!c || !c.enabled)
      throw new BadRequestException(`${courier} is not configured or disabled`);
    return c;
  }

private normalizePhone(raw?: string | null): string {
    const digits = (raw || '').replace(/\D/g, '');
    if (digits.length <= 11) {
      if (digits.length === 10) return `0${digits}`;
      return digits;
    }
    return digits.slice(-11);
  }

  private async logDispatch(params: {
    orderId: string;
    courier: string;
    status: string;
    message?: string;
    requestPayload?: unknown;
    responsePayload?: unknown;
    consignmentId?: string;
    trackingCode?: string;
  }) {
    await this.prisma.courierDispatchLog.create({ data: params as any });
  }

  async dispatch(courier: string, orderIds: string[]) {
    const orders = await this.prisma.order.findMany({
      where: { id: { in: orderIds } },
      include: {
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phoneNumber: true,
            email: true,
          },
        },
        items: { include: { product: { select: { name: true } } } },
      },
    });

    const results: {
      id: string;
      ok: boolean;
      message?: string;
      consignmentId?: string;
      trackingCode?: string;
    }[] = [];
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

  private async dispatchOne(
    courier: string,
    order: any,
  ): Promise<{ consignmentId?: string; trackingCode?: string }> {
    const creds = await this.getCreds(courier);
    const base = BASE_URLS[courier];

    switch (courier) {
      case 'steadfast':
        return this.dispatchSteadfast(creds, base, order);
      case 'pathao':
        return this.dispatchPathao(creds, base, order);
      case 'redx':
        return this.dispatchRedx(creds, base, order);
      case 'carrybee':
        return this.dispatchCarrybee(creds, base, order);
      default:
        throw new BadRequestException(`Unknown courier: ${courier}`);
    }
  }

  private async dispatchSteadfast(creds: any, base: string, order: any) {
    const apiKey = creds.apiKey || creds.credentials?.['apiKey'];
    const secretKey = creds.secretKey || creds.credentials?.['secretKey'];
    if (!apiKey || !secretKey)
      throw new BadRequestException('Steadfast API key/secret not configured');

    const recipient = order.customer;
    const phone = this.normalizePhone(recipient.phoneNumber);
    const total = Number(order.total);
    const address = order.shippingAddress as Record<string, unknown> | null;

    const itemDescription =
      order.items
        ?.map((item: any) => item.product?.name || 'Product')
        .join(', ') || undefined;

    const payload: Record<string, unknown> = {
      invoice: order.displayId,
      recipient_name:
        `${recipient.firstName} ${recipient.lastName}`.trim() || 'Customer',
      recipient_phone: phone,
      recipient_address:
        address?.address ||
        (address?.district ? `${address.district}` : 'Dhaka'),
      cod_amount: total,
      note: order.officeNotes || undefined,
      item_description: itemDescription,
      delivery_type: address?.deliveryType === 'hub' ? 1 : 0,
    };

    if (recipient.email) {
      payload.recipient_email = recipient.email;
    }

    if (address?.phone && address.phone !== phone) {
      payload.alternative_phone = this.normalizePhone(address.phone as string);
    }

    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch(`${base}/create_order`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Api-Key': apiKey,
            'Secret-Key': secretKey,
          },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as Record<string, unknown>;

      const consignment = data['consignment'] as
        | Record<string, unknown>
        | undefined;
      const statusCode = data['status'];

      if (
        statusCode === 200 ||
        (consignment && consignment['consignment_id'])
      ) {
        const consignmentId = String(
          consignment?.['consignment_id'] || data['consignment_id'] || '',
        );
        const trackingCode = String(
          consignment?.['tracking_code'] || data['tracking_code'] || '',
        );
        await this.prisma.order.update({
          where: { id: order.id },
          data: {
            courierService: 'steadfast',
            courierConsignmentId: consignmentId,
            courierTrackingCode: trackingCode,
          },
        });
        await this.logDispatch({
          orderId: order.id,
          courier: 'steadfast',
          status: 'success',
          consignmentId,
          trackingCode,
          requestPayload: payload,
          responsePayload: data,
        });
        return { consignmentId, trackingCode };
      }
      const msg = String(
          data['message'] || data['error'] || 'Steadfast dispatch failed',
        );
        await this.logDispatch({
          orderId: order.id,
          courier: 'steadfast',
          status: 'failed',
          message: msg,
          requestPayload: payload,
          responsePayload: data,
        });
        throw new BadRequestException(msg);
      } catch (e: unknown) {
        lastError = e instanceof Error ? e : new Error(String(e));
        this.logger.warn(
          `Steadfast dispatch attempt ${attempt}/${maxRetries} failed: ${lastError.message}`,
        );
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }
    }

    await this.logDispatch({
      orderId: order.id,
      courier: 'steadfast',
      status: 'failed',
      message: lastError?.message || 'All retry attempts failed',
      requestPayload: payload,
    });
    throw new BadRequestException(
      lastError?.message || 'Steadfast dispatch failed after retries',
    );
  }

  private async dispatchPathao(creds: any, base: string, order: any) {
    const clientId = creds.clientId || creds.credentials?.['clientId'];
    const clientSecret =
      creds.clientSecret || creds.credentials?.['clientSecret'];
    const username = creds.username || creds.credentials?.['username'];
    const password = creds.password || creds.credentials?.['password'];
    if (!clientId || !clientSecret || !username || !password)
      throw new BadRequestException('Pathao credentials not configured');

    const tokenRes = await fetch(`${base}/aladdin/api/v1/issue-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        username,
        password,
        grant_type: 'password',
      }),
    });
    const tokenData = (await tokenRes.json()) as Record<string, unknown>;
    if (!tokenData['access_token'])
      throw new BadRequestException(
        String(tokenData['message'] || 'Pathao auth failed'),
      );
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
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (data['data']?.['consignment_id']) {
        const cId = String(
          (data['data'] as Record<string, unknown>)['consignment_id'],
        );
        await this.prisma.order.update({
          where: { id: order.id },
          data: { courierService: 'pathao', courierConsignmentId: cId },
        });
        await this.logDispatch({
          orderId: order.id,
          courier: 'pathao',
          status: 'success',
          consignmentId: cId,
          requestPayload: payload,
          responsePayload: data,
        });
        return { consignmentId: cId, trackingCode: cId };
      }
      const msg = String(data['message'] || 'Pathao dispatch failed');
      await this.logDispatch({
        orderId: order.id,
        courier: 'pathao',
        status: 'failed',
        message: msg,
        requestPayload: payload,
        responsePayload: data,
      });
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
      const data = (await res.json()) as Record<string, unknown>;
      if (data['data']?.['tracking_id']) {
        const trackingCode = String(
          (data['data'] as Record<string, unknown>)['tracking_id'],
        );
        await this.prisma.order.update({
          where: { id: order.id },
          data: { courierService: 'redx', courierTrackingCode: trackingCode },
        });
        await this.logDispatch({
          orderId: order.id,
          courier: 'redx',
          status: 'success',
          trackingCode,
          requestPayload: payload,
          responsePayload: data,
        });
        return { trackingCode };
      }
      const msg = String(data['message'] || 'RedX dispatch failed');
      await this.logDispatch({
        orderId: order.id,
        courier: 'redx',
        status: 'failed',
        message: msg,
        requestPayload: payload,
        responsePayload: data,
      });
      throw new BadRequestException(msg);
    } catch (e: unknown) {
      if (e instanceof BadRequestException) throw e;
      throw new BadRequestException((e as Error).message);
    }
  }

  private async dispatchCarrybee(creds: any, base: string, order: any) {
    const clientId = creds.clientId || creds.credentials?.['clientId'];
    const clientSecret =
      creds.clientSecret || creds.credentials?.['clientSecret'];
    if (!clientId || !clientSecret)
      throw new BadRequestException('Carrybee credentials not configured');

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
        headers: {
          'Content-Type': 'application/json',
          'Client-ID': clientId,
          'Client-Secret': clientSecret,
          'Client-Context': 'merchant',
        },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (data['success'] && data['data']?.['consignment_id']) {
        const cId = String(
          (data['data'] as Record<string, unknown>)['consignment_id'],
        );
        await this.prisma.order.update({
          where: { id: order.id },
          data: { courierService: 'carrybee', courierConsignmentId: cId },
        });
        await this.logDispatch({
          orderId: order.id,
          courier: 'carrybee',
          status: 'success',
          consignmentId: cId,
          requestPayload: payload,
          responsePayload: data,
        });
        return { consignmentId: cId };
      }
      const msg = String(data['message'] || 'Carrybee dispatch failed');
      await this.logDispatch({
        orderId: order.id,
        courier: 'carrybee',
        status: 'failed',
        message: msg,
        requestPayload: payload,
        responsePayload: data,
      });
      throw new BadRequestException(msg);
    } catch (e: unknown) {
      if (e instanceof BadRequestException) throw e;
      throw new BadRequestException((e as Error).message);
    }
  }

  async getSteadfastBalance(): Promise<{ current_balance: number }> {
    const creds = await this.getCreds('steadfast');
    const apiKey = creds.apiKey || creds.credentials?.['apiKey'];
    const secretKey = creds.secretKey || creds.credentials?.['secretKey'];
    if (!apiKey || !secretKey)
      throw new BadRequestException('Steadfast API key/secret not configured');

    const base = BASE_URLS['steadfast'];
    const res = await fetch(`${base}/get_balance`, {
      method: 'GET',
      headers: {
        'Api-Key': apiKey,
        'Secret-Key': secretKey,
        'Content-Type': 'application/json',
      },
    });
    const data = (await res.json()) as Record<string, unknown>;
    return { current_balance: Number(data['current_balance'] || 0) };
  }

  async createSteadfastReturnRequest(params: {
    consignment_id?: string;
    invoice?: string;
    tracking_code?: string;
    reason?: string;
  }) {
    const creds = await this.getCreds('steadfast');
    const apiKey = creds.apiKey || creds.credentials?.['apiKey'];
    const secretKey = creds.secretKey || creds.credentials?.['secretKey'];
    if (!apiKey || !secretKey)
      throw new BadRequestException('Steadfast API key/secret not configured');

    const base = BASE_URLS['steadfast'];
    const payload: Record<string, unknown> = {};
    if (params.consignment_id) payload.consignment_id = params.consignment_id;
    if (params.invoice) payload.invoice = params.invoice;
    if (params.tracking_code) payload.tracking_code = params.tracking_code;
    if (params.reason) payload.reason = params.reason;

    const res = await fetch(`${base}/create_return_request`, {
      method: 'POST',
      headers: {
        'Api-Key': apiKey,
        'Secret-Key': secretKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    return res.json();
  }

  async getSteadfastReturnRequest(id: string) {
    const creds = await this.getCreds('steadfast');
    const apiKey = creds.apiKey || creds.credentials?.['apiKey'];
    const secretKey = creds.secretKey || creds.credentials?.['secretKey'];
    if (!apiKey || !secretKey)
      throw new BadRequestException('Steadfast API key/secret not configured');

    const base = BASE_URLS['steadfast'];
    const res = await fetch(`${base}/get_return_request/${id}`, {
      method: 'GET',
      headers: {
        'Api-Key': apiKey,
        'Secret-Key': secretKey,
        'Content-Type': 'application/json',
      },
    });
    return res.json();
  }

  async getSteadfastReturnRequests() {
    const creds = await this.getCreds('steadfast');
    const apiKey = creds.apiKey || creds.credentials?.['apiKey'];
    const secretKey = creds.secretKey || creds.credentials?.['secretKey'];
    if (!apiKey || !secretKey)
      throw new BadRequestException('Steadfast API key/secret not configured');

    const base = BASE_URLS['steadfast'];
    const res = await fetch(`${base}/get_return_requests`, {
      method: 'GET',
      headers: {
        'Api-Key': apiKey,
        'Secret-Key': secretKey,
        'Content-Type': 'application/json',
      },
    });
    return res.json();
  }

  async getSteadfastPayments() {
    const creds = await this.getCreds('steadfast');
    const apiKey = creds.apiKey || creds.credentials?.['apiKey'];
    const secretKey = creds.secretKey || creds.credentials?.['secretKey'];
    if (!apiKey || !secretKey)
      throw new BadRequestException('Steadfast API key/secret not configured');

    const base = BASE_URLS['steadfast'];
    const res = await fetch(`${base}/payments`, {
      method: 'GET',
      headers: {
        'Api-Key': apiKey,
        'Secret-Key': secretKey,
        'Content-Type': 'application/json',
      },
    });
    return res.json();
  }

  async getSteadfastPaymentWithConsignments(paymentId: string) {
    const creds = await this.getCreds('steadfast');
    const apiKey = creds.apiKey || creds.credentials?.['apiKey'];
    const secretKey = creds.secretKey || creds.credentials?.['secretKey'];
    if (!apiKey || !secretKey)
      throw new BadRequestException('Steadfast API key/secret not configured');

    const base = BASE_URLS['steadfast'];
    const res = await fetch(`${base}/payments/${paymentId}`, {
      method: 'GET',
      headers: {
        'Api-Key': apiKey,
        'Secret-Key': secretKey,
        'Content-Type': 'application/json',
      },
    });
    return res.json();
  }

  async getSteadfastPoliceStations() {
    const creds = await this.getCreds('steadfast');
    const apiKey = creds.apiKey || creds.credentials?.['apiKey'];
    const secretKey = creds.secretKey || creds.credentials?.['secretKey'];
    if (!apiKey || !secretKey)
      throw new BadRequestException('Steadfast API key/secret not configured');

    const base = BASE_URLS['steadfast'];
    const res = await fetch(`${base}/police_stations`, {
      method: 'GET',
      headers: {
        'Api-Key': apiKey,
        'Secret-Key': secretKey,
        'Content-Type': 'application/json',
      },
    });
    return res.json();
  }

  async bulkCreateSteadfastOrders(orders: any[]) {
    const creds = await this.getCreds('steadfast');
    const apiKey = creds.apiKey || creds.credentials?.['apiKey'];
    const secretKey = creds.secretKey || creds.credentials?.['secretKey'];
    if (!apiKey || !secretKey)
      throw new BadRequestException('Steadfast API key/secret not configured');

    if (orders.length > 500)
      throw new BadRequestException(
        'Maximum 500 orders allowed per bulk request',
      );

    const base = BASE_URLS['steadfast'];
    const data = orders.map((order) => ({
      invoice: order.displayId,
      recipient_name:
        `${order.customer?.firstName || ''} ${order.customer?.lastName || ''}`.trim() ||
        'Customer',
      recipient_phone: this.normalizePhone(order.customer?.phoneNumber),
      recipient_address:
        order.shippingAddress?.address ||
        order.shippingAddress?.district ||
        'Dhaka',
      cod_amount: Number(order.total),
      note: order.officeNotes || null,
    }));

    const res = await fetch(`${base}/create_order/bulk-order`, {
      method: 'POST',
      headers: {
        'Api-Key': apiKey,
        'Secret-Key': secretKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ data }),
    });
    const response = (await res.json()) as Record<string, unknown>;

    const results = (response['data'] as Array<Record<string, unknown>>) || [];
    const successResults: {
      orderId: string;
      consignmentId: string;
      trackingCode: string;
    }[] = [];
    const failedResults: { orderId: string; message: string }[] = [];

    for (const result of results) {
      const invoice = result['invoice'] as string;
      const status = result['status'] as string;
      if (status === 'success' && result['consignment_id']) {
        successResults.push({
          orderId: invoice,
          consignmentId: String(result['consignment_id']),
          trackingCode: String(result['tracking_code']),
        });
      } else {
        failedResults.push({
          orderId: invoice,
          message: String(result['message'] || 'Failed'),
        });
      }
    }

    return { success: successResults, failed: failedResults };
  }
}
