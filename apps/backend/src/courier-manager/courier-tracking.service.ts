import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../cache/cache.service';
import { buildTrackingUrl } from './courier-webhook.service';

interface TrackingEvent {
  status: string;
  message: string;
  timestamp: string;
  location?: string;
}

export interface CourierTrackingResult {
  courier: string;
  phone: string;
  consignmentId: string;
  trackingCode?: string;
  trackingUrl?: string;
  configured: boolean;
  error?: string;
  stale?: boolean;
  staleAt?: string;
  currentStatus?: string;
  currentMessage?: string;
  events: TrackingEvent[];
  fetchedAt: string;
}

const CACHE_TTL_ACTIVE = 300_000;
const CACHE_TTL_TERMINAL = 86_400_000;

const TERMINAL_STATUSES = new Set([
  'delivered', 'partial', 'returned', 'cancelled',
]);

const TWO_MINUTES_MS = 120_000;

function cacheTtlFor(status: string | undefined): number {
  return status && TERMINAL_STATUSES.has(status.toLowerCase())
    ? CACHE_TTL_TERMINAL
    : CACHE_TTL_ACTIVE;
}

@Injectable()
export class CourierTrackingService {
  private readonly logger = new Logger(CourierTrackingService.name);
  private inflight = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async getOrderTracking(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        customerId: true,
        customer: { select: { phone: true } },
        guestPhone: true,
        dispatches: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!order) return { orderId, trackers: [] };

    const phone = this.normalizePhone(
      order.customer?.phone || order.guestPhone,
    );

    const trackers = await Promise.all(
      order.dispatches.map((d) =>
        this.getCourierTracking(
          d.courier as string,
          phone,
          d.consignmentId,
          d.trackingCode,
        ),
      ),
    );

    return {
      orderId,
      phone,
      trackers: trackers.filter(Boolean) as CourierTrackingResult[],
    };
  }

  private normalizePhone(raw?: string | null): string {
    const digits = (raw || '').replace(/\D/g, '');
    if (digits.length <= 11) {
      if (digits.length === 10) return `0${digits}`;
      return digits;
    }
    return digits.slice(-11);
  }

  private async getCourierTracking(
    courier: string,
    phone: string,
    consignmentId: string,
    trackingCode?: string | null,
  ): Promise<CourierTrackingResult | null> {
    if (!consignmentId) return null;

    const redisKey = `courier-track:${courier}:${consignmentId}`;
    const dbKey = `${courier}:${phone}`;

    // 1. Redis / in-memory cache (fast path)
    const fresh = await this.cache.get<CourierTrackingResult>(redisKey);
    if (fresh) return { ...fresh, phone };

    // 2. DB cache hit
    const dbRow = await this.prisma.courierReportCache.findUnique({
      where: { courier_phone: { courier, phone } },
    });

    if (dbRow) {
      const dbResult = dbRow.report as unknown as CourierTrackingResult;
      const isExpired = dbRow.expiresAt <= new Date();

      if (!isExpired) {
        // Fresh DB data — populate Redis for next fast hit
        const ttl = cacheTtlFor(dbRow.courierStatus || undefined);
        await this.cache.set(redisKey, dbResult, Math.min(ttl, TWO_MINUTES_MS));
        return { ...dbResult, phone };
      }

      // Stale DB data — return immediately + background refresh
      this.refreshInBackground(dbKey, redisKey, courier, phone, consignmentId, trackingCode, dbRow.fetchedAt);
      return { ...dbResult, phone, stale: true, staleAt: dbResult.fetchedAt };
    }

    // 3. No cache at all — fetch from courier
    const result = await this.fetchAndCache(dbKey, redisKey, courier, phone, consignmentId, trackingCode);
    if (result) result.phone = phone;
    return result;
  }

  private async refreshInBackground(
    dbKey: string,
    redisKey: string,
    courier: string,
    phone: string,
    consignmentId: string,
    trackingCode: string | null | undefined,
    lastFetchedAt: Date,
  ) {
    if (this.inflight.has(dbKey)) {
      try { await this.inflight.get(dbKey); } catch { /* ignore */ }
      return;
    }

    const promise = this.fetchAndCache(dbKey, redisKey, courier, phone, consignmentId, trackingCode).then(() => {});
    this.inflight.set(dbKey, promise);

    try {
      await promise;
    } catch (e: any) {
      this.logger.warn(`Background refresh failed for ${dbKey}: ${e.message}`);
    } finally {
      this.inflight.delete(dbKey);
    }
  }

  private async fetchAndCache(
    dbKey: string,
    redisKey: string,
    courier: string,
    phone: string,
    consignmentId: string,
    trackingCode?: string | null,
  ): Promise<CourierTrackingResult | null> {
    try {
      const creds = await this.prisma.courierCredentials.findUnique({
        where: { courier },
      });

      if (!creds?.enabled) {
        const result: CourierTrackingResult = {
          courier, phone, consignmentId,
          trackingCode: trackingCode || undefined,
          trackingUrl: buildTrackingUrl(courier, trackingCode || null, consignmentId) || undefined,
          configured: false,
          events: [],
          fetchedAt: new Date().toISOString(),
        };
        await this.persistCache(dbKey, redisKey, result, null);
        return result;
      }

      const result = await this.fetchFromCourier(courier, consignmentId, creds);
      if (!result) return null;

      result.courier = courier;
      result.phone = phone;
      result.consignmentId = consignmentId;
      result.trackingCode = trackingCode || undefined;
      result.trackingUrl =
        buildTrackingUrl(courier, trackingCode || null, consignmentId) || undefined;

      const ttl = cacheTtlFor(result.currentStatus);
      await this.persistCache(dbKey, redisKey, result, ttl);
      return result;
    } catch (e: any) {
      this.logger.warn(`Tracking failed for ${courier}/${consignmentId}: ${e.message}`);

      // Fallback: check if we have stale DB data (race guard)
      const dbRow = await this.prisma.courierReportCache.findUnique({
        where: { courier_phone: { courier, phone } },
      });
      if (dbRow) {
        const staleResult = dbRow.report as unknown as CourierTrackingResult;
        return { ...staleResult, phone, stale: true, staleAt: staleResult.fetchedAt };
      }

      return {
        courier, phone, consignmentId,
        trackingCode: trackingCode || undefined,
        configured: true,
        error: e.message,
        events: [],
        fetchedAt: new Date().toISOString(),
      };
    }
  }

  private async persistCache(
    dbKey: string,
    redisKey: string,
    result: CourierTrackingResult,
    ttl: number | null,
  ) {
    const now = new Date();
    const effectiveTtl = ttl ?? CACHE_TTL_ACTIVE;
    const expiresAt = new Date(now.getTime() + effectiveTtl);

    await Promise.all([
      this.prisma.courierReportCache.upsert({
        where: { courier_phone: { courier: result.courier, phone: result.phone } },
        create: {
          courier: result.courier,
          phone: result.phone,
          report: result as any,
          courierStatus: result.currentStatus || null,
          fetchedAt: now,
          expiresAt,
        },
        update: {
          report: result as any,
          courierStatus: result.currentStatus || null,
          fetchedAt: now,
          expiresAt,
        },
      }),
      // Redis: shorter TTL to avoid stale reads when DB expiresAt differs
      this.cache.set(redisKey, result, Math.min(effectiveTtl, TWO_MINUTES_MS)),
    ]);
  }

  private async fetchFromCourier(
    courier: string,
    consignmentId: string,
    creds: any,
  ): Promise<CourierTrackingResult | null> {
    const base = this.getBaseUrl(courier, creds);
    const baseResult = {
      courier, phone: '', consignmentId,
      configured: true,
      fetchedAt: new Date().toISOString(),
    };

    switch (courier) {
      case 'steadfast':
        return this.trackSteadfast(consignmentId, creds, base, baseResult);
      case 'pathao':
        return this.trackPathao(consignmentId, creds, base, baseResult);
      case 'redx':
        return this.trackRedx(consignmentId, creds, base, baseResult);
      case 'carrybee':
        return this.trackCarrybee(consignmentId, creds, base, baseResult);
      default:
        return null;
    }
  }

  private getBaseUrl(courier: string, creds: any): string {
    const urls: Record<string, Record<string, string>> = {
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
    const mode = creds?.mode || 'production';
    return urls[courier]?.[mode] || urls[courier]?.['production'] || '';
  }

  private async fetchWithTimeout(
    url: string,
    options: RequestInit = {},
    timeoutMs = 10000,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async jsonFetch(
    url: string,
    options: RequestInit = {},
    timeoutMs = 10000,
  ): Promise<any> {
    const res = await this.fetchWithTimeout(url, options, timeoutMs);
    if (!res.ok) {
      const text = await res.text().catch(() => 'Unknown error');
      throw new Error(
        `HTTP ${res.status} from ${url.split('?')[0].split('/').slice(-2).join('/')}: ${text.slice(0, 200)}`,
      );
    }
    return res.json();
  }

  private async trackSteadfast(
    consignmentId: string,
    creds: any,
    base: string,
    baseResult: any,
  ): Promise<CourierTrackingResult> {
    const apiKey = creds.apiKey || creds.credentials?.['apiKey'];
    const secretKey = creds.secretKey || creds.credentials?.['secretKey'];
    if (!apiKey || !secretKey)
      return { ...baseResult, events: [] };

    const STEADFAST_STATUS_MAP: Record<string, string> = {
      pending: 'pending',
      picked: 'picked_up',
      transit: 'in_transit',
      delivered_customer: 'delivered',
      partial_delivered: 'partial',
      cancelled: 'cancelled',
      return_process: 'return_pending',
      returned: 'returned',
      hold: 'hold',
    };

    const data = await this.jsonFetch(
      `${base}/status_by_consignment/${consignmentId}`,
      {
        headers: {
          'Api-Key': apiKey,
          'Secret-Key': secretKey,
          'Content-Type': 'application/json',
        },
      },
    );

    const events: TrackingEvent[] = [];
    const trackingData = data?.['data'] || data;
    const rawStatus = String(trackingData?.['delivery_status'] || trackingData?.['status'] || '');
    const currentStatus = STEADFAST_STATUS_MAP[rawStatus] || rawStatus;

    if (trackingData?.['tracking_history']) {
      for (const h of trackingData['tracking_history']) {
        const raw = String(h['status'] || '');
        events.push({
          status: STEADFAST_STATUS_MAP[raw] || raw,
          message: String(h['message'] || ''),
          timestamp: String(h['time'] || h['timestamp'] || ''),
          location: h['location'] ? String(h['location']) : undefined,
        });
      }
    }

    if (events.length === 0) {
      const msgMap: Record<string, string> = {
        pending: 'Order Placed',
        picked: 'Picked Up',
        transit: 'In Transit',
        delivered_customer: 'Delivered',
        partial_delivered: 'Partially Delivered',
        cancelled: 'Cancelled',
        return_process: 'Return Initiated',
        returned: 'Returned',
        hold: 'On Hold',
      };
      events.push({
        status: currentStatus,
        message: msgMap[rawStatus] || trackingData?.['status'] || rawStatus,
        timestamp: String(trackingData?.['updated_at'] || new Date().toISOString()),
      });
    }

    events.sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    return {
      ...baseResult,
      currentStatus,
      currentMessage: events[events.length - 1]?.message,
      events,
    };
  }

  private async trackPathao(
    consignmentId: string,
    creds: any,
    base: string,
    baseResult: any,
  ): Promise<CourierTrackingResult> {
    const clientId = creds.clientId || creds.credentials?.['clientId'];
    const clientSecret = creds.clientSecret || creds.credentials?.['clientSecret'];
    const username = creds.username || creds.credentials?.['username'];
    const password = creds.password || creds.credentials?.['password'];
    if (!clientId || !clientSecret || !username || !password)
      return { ...baseResult, events: [] };

    const token = await this.getPathaoToken(base, clientId, clientSecret, username, password);
    const data = await this.jsonFetch(
      `${base}/aladdin/api/v1/orders/${consignmentId}/tracking`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    const trackingData = data?.['data'] || data;
    const events: TrackingEvent[] = [];
    const timeline = trackingData?.['timeline'] || trackingData?.['tracking'] || [];

    if (Array.isArray(timeline)) {
      for (const t of timeline) {
        events.push({
          status: String(t['status'] || t['event'] || ''),
          message: String(t['message'] || t['note'] || ''),
          timestamp: String(t['updated_at'] || t['timestamp'] || t['time'] || ''),
          location: t['location'] ? String(t['location']) : undefined,
        });
      }
    }

    events.sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    return {
      ...baseResult,
      currentStatus: String(trackingData?.['status'] || ''),
      currentMessage: String(trackingData?.['message'] || events[events.length - 1]?.message || ''),
      events,
    };
  }

  private async getPathaoToken(
    base: string,
    clientId: string,
    clientSecret: string,
    username: string,
    password: string,
  ): Promise<string> {
    const cacheKey = 'pathao:token';
    const cached = await this.cache.get<string>(cacheKey);
    if (cached) return cached;

    const data = await this.jsonFetch(`${base}/aladdin/api/v1/issue-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        username,
        password,
        grant_type: 'password',
      }),
    });

    const token = String(data?.['access_token'] || data?.['token'] || '');
    if (!token) throw new Error('Pathao token fetch returned no token');

    const expiresIn = Number(data?.['expires_in'] || 3600);
    await this.cache.set(cacheKey, token, (expiresIn - 60) * 1000);
    return token;
  }

  private async trackRedx(
    consignmentId: string,
    creds: any,
    base: string,
    baseResult: any,
  ): Promise<CourierTrackingResult> {
    const apiToken = creds.apiKey || creds.credentials?.['apiKey'];
    if (!apiToken)
      return { ...baseResult, events: [] };

    const data = await this.jsonFetch(`${base}/parcel/track/${consignmentId}`, {
      headers: {
        'Content-Type': 'application/json',
        'API-ACCESS-TOKEN': `Bearer ${apiToken}`,
      },
    });

    const events: TrackingEvent[] = [];
    const trackData = data?.['data'] || data;
    const trackHistory = trackData?.['tracking'] || trackData?.['tracking_history'] || [];

    if (Array.isArray(trackHistory)) {
      for (const t of trackHistory) {
        events.push({
          status: String(t['status'] || ''),
          message: String(t['message'] || t['note'] || ''),
          timestamp: String(t['timestamp'] || t['time'] || t['date'] || ''),
          location: t['location'] ? String(t['location']) : undefined,
        });
      }
    }

    if (events.length === 0) {
      events.push({
        status: String(trackData?.['status'] || ''),
        message: String(trackData?.['message'] || trackData?.['message_en'] || ''),
        timestamp: String(trackData?.['updated_at'] || trackData?.['timestamp'] || new Date().toISOString()),
      });
    }

    events.sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    return {
      ...baseResult,
      currentStatus: String(trackData?.['status'] || ''),
      currentMessage: String(trackData?.['message'] || trackData?.['message_en'] || events[events.length - 1]?.message || ''),
      events,
    };
  }

  private async trackCarrybee(
    consignmentId: string,
    creds: any,
    base: string,
    baseResult: any,
  ): Promise<CourierTrackingResult> {
    const apiKey = creds.apiKey || creds.credentials?.['apiKey'];
    if (!apiKey)
      return { ...baseResult, events: [] };

    const url = `${base}/api/shipments/${consignmentId}/track?api_key=${encodeURIComponent(apiKey)}`;
    const data = await this.jsonFetch(url);

    const events: TrackingEvent[] = [];
    const trackData = data?.['data'] || data;
    const trackHistory = trackData?.['tracking'] || trackData?.['tracking_history'] || trackData?.['events'] || [];

    if (Array.isArray(trackHistory)) {
      for (const t of trackHistory) {
        events.push({
          status: String(t['status'] || t['event'] || ''),
          message: String(t['message'] || t['note'] || t['remarks'] || ''),
          timestamp: String(t['timestamp'] || t['time'] || t['date'] || t['created_at'] || ''),
          location: t['location'] ? String(t['location']) : undefined,
        });
      }
    }

    if (events.length === 0) {
      events.push({
        status: String(trackData?.['status'] || ''),
        message: String(trackData?.['message'] || trackData?.['status_message'] || ''),
        timestamp: String(trackData?.['updated_at'] || trackData?.['created_at'] || new Date().toISOString()),
      });
    }

    events.sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    return {
      ...baseResult,
      currentStatus: String(trackData?.['status'] || ''),
      currentMessage: String(trackData?.['message'] || trackData?.['status_message'] || events[events.length - 1]?.message || ''),
      events,
    };
  }
}
