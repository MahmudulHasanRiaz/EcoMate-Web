import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const CACHE_TTL_MS = 5 * 24 * 60 * 60 * 1000;

const BASE_URLS: Record<string, Record<string, string>> = {
  steadfast: {
    production: 'https://portal.packzy.com/api/v1',
    sandbox: 'https://portal.packzy.com/api/v1',
  },
  pathao: {
    production: 'https://api-hermes.pathao.com',
    sandbox: 'https://courier-api-sandbox.pathao.com',
  },
  redx: {
    production: 'https://openapi.redx.com.bd/v1.0.0-beta',
    sandbox: 'https://openapi.redx.com.bd/v1.0.0-beta',
  },
  carrybee: {
    production: 'https://developers.carrybee.com',
    sandbox: 'https://developers.carrybee.com',
  },
};

export interface CourierReport {
  success: number;
  cancel: number;
  total: number;
  successRatio: number;
}

@Injectable()
export class CourierCustomerHistoryService {
  private readonly logger = new Logger(CourierCustomerHistoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  private normalizePhone(raw?: string | null): string {
    const digits = (raw || '').replace(/\D/g, '');
    if (digits.length <= 11) {
      if (digits.length === 10) return `0${digits}`;
      return digits;
    }
    return digits.slice(-11);
  }

  private async fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async getCreds(courier: string) {
    return this.prisma.courierCredentials.findUnique({ where: { courier } });
  }

  private async getBaseUrl(courier: string): Promise<string> {
    const creds = await this.getCreds(courier);
    const mode = creds?.mode || 'production';
    return BASE_URLS[courier]?.[mode] || BASE_URLS[courier]?.['production'] || '';
  }

  async getCustomerHistory(courier: string, rawPhone: string): Promise<{ report: CourierReport | null; cached: boolean; fresh: boolean }> {
    const phone = this.normalizePhone(rawPhone);
    const cached = await this.prisma.courierReportCache.findUnique({
      where: { courier_phone: { courier, phone } },
    });

    const now = Date.now();
    const expired = !cached || (now - cached.fetchedAt.getTime() >= CACHE_TTL_MS);
    const hasData = cached?.report != null && cached?.courierStatus !== 'no_data' && cached?.courierStatus !== 'empty';

    if (!expired) {
      if (hasData) {
        return { report: cached!.report as unknown as CourierReport, cached: true, fresh: true };
      }
      return { report: null, cached: true, fresh: true };
    }

    const report = await this.fetchFromCourier(courier, phone).catch(() => null);
    if (report) {
      await this.saveToCache(courier, phone, report, 'fresh');
      return { report, cached: false, fresh: true };
    }

    if (hasData) {
      await this.saveToCache(courier, phone, cached!.report as unknown as CourierReport, 'stale');
      return { report: cached!.report as unknown as CourierReport, cached: true, fresh: false };
    }

    await this.saveToCache(courier, phone, null, 'no_data');
    return { report: null, cached: false, fresh: false };
  }

  async getAll(phone: string): Promise<Record<string, { report: CourierReport | null; cached: boolean; fresh: boolean } | null>> {
    const couriers = ['steadfast', 'pathao', 'redx', 'carrybee'];
    const results: Record<string, any> = {};
    for (const courier of couriers) {
      try {
        results[courier] = await this.getCustomerHistory(courier, phone);
      } catch {
        results[courier] = null;
      }
    }
    return results;
  }

  private async saveToCache(courier: string, phone: string, report: CourierReport | null, status = 'fresh') {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + CACHE_TTL_MS);
    const payload = report || { success: 0, cancel: 0, total: 0, successRatio: 0 };
    await this.prisma.courierReportCache.upsert({
      where: { courier_phone: { courier, phone } },
      create: { courier, phone, report: payload as any, courierStatus: status, fetchedAt: now, expiresAt },
      update: { report: payload as any, courierStatus: status, fetchedAt: now, expiresAt },
    });
  }

  private async fetchFromCourier(courier: string, phone: string): Promise<CourierReport | null> {
    try {
      switch (courier) {
        case 'steadfast':
          return this.fetchSteadfast(phone);
        case 'pathao':
          return this.fetchPathao(phone);
        case 'redx':
          return this.fetchRedx(phone);
        case 'carrybee':
          return this.fetchCarrybee(phone);
        default:
          return null;
      }
    } catch (e) {
      this.logger.error(`Failed to fetch ${courier} history for ${phone}: ${(e as Error).message}`);
      return null;
    }
  }

  private async fetchSteadfast(phone: string): Promise<CourierReport | null> {
    const creds = await this.getCreds('steadfast');
    if (!creds?.enabled) return null;
    const apiKey = creds.apiKey || (creds.credentials as any)?.apiKey;
    const secretKey = creds.secretKey || (creds.credentials as any)?.secretKey;
    if (!apiKey || !secretKey) return null;

    const base = await this.getBaseUrl('steadfast');
    const res = await this.fetchWithTimeout(`${base}/fraud_check/${phone}`, {
      headers: {
        'Content-Type': 'application/json',
        'Api-Key': apiKey,
        'Secret-Key': secretKey,
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const success = Number(data['total_delivered'] ?? 0);
    const cancel = Number(data['total_cancelled'] ?? 0);
    const total = success + cancel;
    return { success, cancel, total, successRatio: total > 0 ? Math.round((success / total) * 10000) / 100 : 0 };
  }

  private ratingToSuccessRatio(rating: string): number {
    switch (rating) {
      case 'good_customer': return 90;
      case 'average_customer': return 70;
      case 'bad_customer': return 30;
      default: return 50;
    }
  }

  private async fetchPathao(phone: string): Promise<CourierReport | null> {
    const creds = await this.getCreds('pathao');
    if (!creds?.enabled) return null;
    const username = creds.username || (creds.credentials as any)?.username;
    const password = creds.password || (creds.credentials as any)?.password;
    if (!username || !password) return null;

    try {
      const result = await this.fetchPathaoViaMerchant(phone, { username, password });
      if (result) return result;
      return null;
    } catch (e) {
      this.logger.error(`Pathao error for ${phone}: ${(e as Error).message}`);
      return null;
    }
  }

  private async fetchPathaoViaMerchant(
    phone: string,
    creds: { username: string; password: string },
  ): Promise<CourierReport | null> {
    const loginRes = await this.fetchWithTimeout('https://merchant.pathao.com/api/v1/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: creds.username, password: creds.password }),
    });
    if (!loginRes.ok) return null;
    const loginData = await loginRes.json();
    const token = loginData['access_token'] || loginData['accessToken'];
    if (!token) return null;

    const successRes = await this.fetchWithTimeout('https://merchant.pathao.com/api/v1/user/success', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ phone }),
    });
    if (!successRes.ok) return null;
    const body = await successRes.json();
    const d = (body as any)?.data as Record<string, unknown> | undefined;
    if (!d) return null;

    const rating = (d['customer_rating'] as string) || '';
    const totalOrders = (d as any)?.total_orders ?? (d as any)?.totalOrders ?? (d as any)?.total_delivery ?? null;

    if (totalOrders !== null) {
      const successRatio = this.ratingToSuccessRatio(rating);
      const total = Number(totalOrders);
      const success = Math.round(total * successRatio / 100);
      const cancel = total - success;
      return { success, cancel, total, successRatio };
    }

    return null;
  }

  private toBdPhone(raw: string): string {
    const digits = raw.replace(/\D/g, '');
    const local = digits.length > 11 ? digits.slice(-11) : digits;
    return `880${local.replace(/^0?/, '')}`;
  }

  private async fetchRedx(phone: string): Promise<CourierReport | null> {
    const creds = await this.getCreds('redx');
    if (!creds?.enabled) return null;

    const loginPhone = creds.username || (creds.credentials as any)?.username;
    const loginPassword = creds.password || (creds.credentials as any)?.password;

    if (!loginPhone || !loginPassword) return null;

    try {
      const loginRes = await this.fetchWithTimeout('https://api.redx.com.bd/v4/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ phone: this.toBdPhone(loginPhone), password: loginPassword }),
      });
      if (!loginRes.ok) return null;
      const loginData = await loginRes.json();
      const accessToken = (loginData as any)?.data?.accessToken || (loginData as any)?.accessToken;
      if (!accessToken) return null;

      const dataRes = await this.fetchWithTimeout(
        `https://redx.com.bd/api/redx_se/admin/parcel/customer-success-return-rate?phoneNumber=${this.toBdPhone(phone)}`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0',
            'Accept': 'application/json, text/plain, */*',
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
          },
        },
      );
      if (!dataRes.ok) return null;
      const data = await dataRes.json();
      const d = (data as any)?.data;
      const success = Number(d?.deliveredParcels ?? d?.delivered ?? 0);
      const total = Number(d?.totalParcels ?? d?.total ?? 0);
      if (total > 0) {
        const cancel = Number(d?.cancelledParcels ?? d?.cancelled ?? Math.max(0, total - success));
        return { success, cancel, total, successRatio: Math.round((success / total) * 10000) / 100 };
      }
      return null;
    } catch (e) {
      this.logger.error(`RedX error for ${phone}: ${(e as Error).message}`);
      return null;
    }
  }

  private parseCookies(resp: Response): Map<string, string> {
    const cookies = new Map<string, string>();
    const setCookie = (resp.headers as any).getSetCookie?.() || [];
    for (const entry of setCookie) {
      const [keyval] = entry.split(';');
      const [key, ...valParts] = keyval.split('=');
      cookies.set(key.trim(), valParts.join('='));
    }
    return cookies;
  }

  private async fetchCarrybee(phone: string): Promise<CourierReport | null> {
    const creds = await this.getCreds('carrybee');
    if (!creds?.enabled) return null;
    const loginPhone = creds.username || (creds.credentials as any)?.username;
    const loginPassword = creds.password || (creds.credentials as any)?.password;
    if (!loginPhone || !loginPassword) return null;

    const userAgent = 'Mozilla/5.0 width/1920 height/1080';

    let jar = new Map<string, string>();
    const getCookieHeader = () => Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');

    const csrfRes = await this.fetchWithTimeout('https://merchant.carrybee.com/api/auth/csrf', {
      headers: { 'User-Agent': userAgent, 'Accept': 'application/json', 'Referer': 'https://merchant.carrybee.com/login' },
    });
    if (!csrfRes.ok) return null;
    const csrfResCookies = this.parseCookies(csrfRes);
    csrfResCookies.forEach((v, k) => jar.set(k, v));
    const csrfData = await csrfRes.json();
    const csrfToken = (csrfData as any)?.csrfToken;
    if (!csrfToken) return null;

    const rawLoginPhone = this.normalizePhone(loginPhone);
    const loginRes = await this.fetchWithTimeout('https://merchant.carrybee.com/api/auth/callback/login', {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'User-Agent': userAgent,
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': 'https://merchant.carrybee.com/login',
        'Cookie': getCookieHeader(),
      },
      body: new URLSearchParams({
        phone: rawLoginPhone,
        password: loginPassword,
        csrfToken,
        callbackUrl: 'https://merchant.carrybee.com/login',
      }).toString(),
    });
    const loginCookies = this.parseCookies(loginRes);
    loginCookies.forEach((v, k) => jar.set(k, v));
    const redirectUrl = (loginRes.headers as any).get?.('location') || '';
    if (!redirectUrl) return null;

    const followRes = await this.fetchWithTimeout(redirectUrl, {
      redirect: 'manual',
      headers: { 'User-Agent': userAgent, 'Accept': 'application/json', 'Cookie': getCookieHeader() },
    });
    const followCookies = this.parseCookies(followRes);
    followCookies.forEach((v, k) => jar.set(k, v));

    if (!jar.has('__Secure-authjs.session-token') && !jar.has('next-auth.session-token')) return null;

    const sessionRes = await this.fetchWithTimeout('https://merchant.carrybee.com/api/auth/session', {
      headers: { 'User-Agent': userAgent, 'Accept': 'application/json', 'Cookie': getCookieHeader() },
    });
    if (!sessionRes.ok) return null;
    const sessionData = await sessionRes.json();
    const accessToken = (sessionData as any)?.accessToken;
    if (!accessToken) return null;

    const businessId = (sessionData as any)?.user?.selectedBusinessId;
    if (!businessId) return null;

    const cleanPhone = `+880${phone.replace(/^(?:\+?880?)?0?/, '')}`;
    const customerRes = await this.fetchWithTimeout(
      `https://api-merchant.carrybee.com/api/v2/businesses/${businessId}/customers/${cleanPhone}`,
      {
        headers: {
          'User-Agent': userAgent,
          'Accept': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
      },
    );
    if (!customerRes.ok) return null;
    const customerData = await customerRes.json();
    const d = (customerData as any)?.data;
    const totalOrder = Number(d?.total_order ?? d?.totalOrder ?? 0);
    const cancelledOrder = Number(d?.cancelled_order ?? d?.cancel ?? 0);
    const deliveredOrder = Number(d?.delivered_order ?? d?.delivered ?? 0);
    const success = deliveredOrder > 0 ? deliveredOrder : Math.max(0, totalOrder - cancelledOrder);
    const successRate = Number(d?.success_rate ?? d?.successRatio ?? 0);
    return {
      success,
      cancel: cancelledOrder,
      total: totalOrder,
      successRatio: successRate > 0 ? successRate : totalOrder > 0 ? Math.round((success / totalOrder) * 10000) / 100 : 0,
    };
  }
}
