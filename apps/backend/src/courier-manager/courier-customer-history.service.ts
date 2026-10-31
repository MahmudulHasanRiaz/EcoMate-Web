import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SteadfastCredentialSetsService } from './steadfast-credential-sets.service';

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
    sandbox: 'https://sandbox.carrybee.com',
  },
};

export type CourierReportSource = 'actual' | 'normalized' | 'new' | 'none';

export type SteadfastVolumeBand = 'none' | 'low' | 'medium' | 'high' | 'very_high';

/**
 * Owner-locked fraud spec (Steadfast `GET /fraud_check/score/{phone}` — the
 * same stored record the dashboard customer check reads).
 * - Ratios are whole percents, each rounded DOWN on its own (sums of 99 are
 *   deliberate — never derive one side as 100 minus the other).
 * - Counts are null when not shown (no regular booking) — null is "not
 *   shown", never 0. Ratios are null when nothing finished — "we do not
 *   know", never a clean record.
 * - `score`/`level`/`reasons` are always null/empty upstream (scoring
 *   disabled) and are NEVER persisted.
 */
export interface SteadfastFraudDetail {
  deliveryRatio: number | null;
  cancellationRatio: number | null;
  volumeBand: SteadfastVolumeBand | null;
  volumeRange: string | null;
  deliveredCount: number | null;
  cancelledCount: number | null;
  totalReports: number;
  fraudCategories: Record<string, number>;
}

export interface CourierReport {
  success: number;
  cancel: number;
  total: number;
  successRatio: number | null;
  source: CourierReportSource;
  rating?: string;
  schemaVersion?: number;
  steadfastFraud?: SteadfastFraudDetail | null;
}

const REPORT_SCHEMA_VERSION = 3;
const STEADFAST_VOLUME_BANDS: readonly SteadfastVolumeBand[] = [
  'none',
  'low',
  'medium',
  'high',
  'very_high',
];

/**
 * Parse the exact `GET /fraud_check/score/{phone}` field names
 * (delivery_ratio, cancellation_ratio, volume_band, volume_range,
 * delivered_count, cancelled_count, total_reports, fraud_categories).
 * `fraud_categories` arrives as code => times (worst first) or `[]` when
 * empty; its sum may sit below `total_reports` (pre-category reports) and is
 * never validated. `score`/`level`/`reasons` are dropped on the floor.
 */
export function parseSteadfastScoreResponse(
  data: Record<string, unknown>,
): SteadfastFraudDetail {
  const numOrNull = (v: unknown): number | null => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const deliveryRaw = numOrNull(data['delivery_ratio']);
  const cancellationRaw = numOrNull(data['cancellation_ratio']);
  const bandRaw =
    typeof data['volume_band'] === 'string' ? data['volume_band'] : null;
  const rangeRaw = data['volume_range'];
  const deliveredCount = numOrNull(data['delivered_count']);
  const cancelledCount = numOrNull(data['cancelled_count']);
  const totalReportsRaw = numOrNull(data['total_reports']);
  let fraudCategories: Record<string, number> = {};
  const fc = data['fraud_categories'];
  if (fc && typeof fc === 'object' && !Array.isArray(fc)) {
    for (const [k, v] of Object.entries(fc as Record<string, unknown>)) {
      const n = Number(v);
      if (Number.isFinite(n)) fraudCategories[k] = Math.max(0, Math.floor(n));
    }
  }
  return {
    deliveryRatio: deliveryRaw == null ? null : Math.floor(deliveryRaw),
    cancellationRatio:
      cancellationRaw == null ? null : Math.floor(cancellationRaw),
    volumeBand: STEADFAST_VOLUME_BANDS.includes(bandRaw as SteadfastVolumeBand)
      ? (bandRaw as SteadfastVolumeBand)
      : null,
    volumeRange:
      typeof rangeRaw === 'string'
        ? rangeRaw
        : rangeRaw == null
          ? null
          : String(rangeRaw),
    deliveredCount,
    cancelledCount,
    totalReports:
      totalReportsRaw == null ? 0 : Math.max(0, Math.floor(totalReportsRaw)),
    fraudCategories,
  };
}

/**
 * Build the stored Steadfast report from the parsed fraud detail.
 * Top-level success/cancel/total mirror the exact counts when shown (0
 * placeholders when null — the nulls themselves live in `steadfastFraud`
 * and the UI renders them as "তথ্য নেই", never as a clean 0). `successRatio`
 * mirrors the floored delivery ratio so cross-courier aggregates keep
 * working; null ratios stay null so the row is excluded, never clean.
 */
export function buildSteadfastReport(
  detail: SteadfastFraudDetail,
): CourierReport {
  const success = detail.deliveredCount ?? 0;
  const cancel = detail.cancelledCount ?? 0;
  const hasSignal =
    detail.deliveryRatio != null ||
    detail.deliveredCount != null ||
    detail.totalReports > 0 ||
    Object.keys(detail.fraudCategories).length > 0;
  return {
    success,
    cancel,
    total: success + cancel,
    successRatio: detail.deliveryRatio,
    source: hasSignal ? 'actual' : 'none',
    schemaVersion: REPORT_SCHEMA_VERSION,
    steadfastFraud: detail,
  };
}
const CALIBRATION_KEY = 'pathao_rating_calibration';
// Last-resort normalized scale when Pathao has no counts AND no other courier
// has cached history for the phone yet. Real production data (another courier's
// actual parcel total) is always preferred over this fixed base.
const REPORT_SCALE_FALLBACK = 100;

export type PathaoRatingLevel = 'excellent' | 'good' | 'moderate' | 'risky' | 'new';

const DEFAULT_CALIBRATION: Record<Exclude<PathaoRatingLevel, 'new'>, number> = {
  excellent: 90,
  good: 80,
  moderate: 70,
  risky: 40,
};

@Injectable()
export class CourierCustomerHistoryService {
  private readonly logger = new Logger(CourierCustomerHistoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly steadfastSets?: SteadfastCredentialSetsService,
  ) {}

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

  async getCustomerHistory(
    courier: string,
    rawPhone: string,
    opts: { force?: boolean } = {},
  ): Promise<{ report: CourierReport | null; cached: boolean; fresh: boolean; fetchedAt: Date | null }> {
    const phone = this.normalizePhone(rawPhone);
    const cachedRow = await this.prisma.courierReportCache.findUnique({
      where: { courier_phone: { courier, phone } },
    });

    const now = Date.now();
    const cached = cachedRow ? this.coerceCached(courier, cachedRow.report) : null;
    const hasData = cached != null && cachedRow?.courierStatus !== 'no_data' && cachedRow?.courierStatus !== 'empty';
    const schemaStale = cachedRow?.report != null && cached == null;
    const expired = !cachedRow || schemaStale || now - cachedRow.fetchedAt.getTime() >= CACHE_TTL_MS || opts.force === true;

    if (!expired) {
      if (hasData) {
        return { report: cached, cached: true, fresh: true, fetchedAt: cachedRow?.fetchedAt ?? null };
      }
      return { report: null, cached: true, fresh: true, fetchedAt: cachedRow?.fetchedAt ?? null };
    }

    const report = await this.fetchFromCourier(courier, phone).catch(() => null);
    if (report) {
      await this.saveToCache(courier, phone, report, 'fresh');
      return { report, cached: false, fresh: true, fetchedAt: new Date() };
    }

    if (hasData) {
      await this.saveToCache(courier, phone, cached, 'stale');
      return { report: cached, cached: true, fresh: false, fetchedAt: cachedRow?.fetchedAt ?? null };
    }

    await this.saveToCache(courier, phone, null, 'no_data');
    return { report: null, cached: false, fresh: false, fetchedAt: cachedRow?.fetchedAt ?? new Date() };
  }

  async getAll(
    phone: string,
    opts: { force?: boolean } = {},
  ): Promise<Record<string, { report: CourierReport | null; cached: boolean; fresh: boolean; fetchedAt: Date | null } | null>> {
    const couriers = ['steadfast', 'pathao', 'redx', 'carrybee'];
    const results: Record<string, any> = {};
    for (const courier of couriers) {
      try {
        results[courier] = await this.getCustomerHistory(courier, phone, opts);
      } catch {
        results[courier] = null;
      }
    }
    return results;
  }

  async refresh(phone: string, courier?: string) {
    return courier
      ? this.getCustomerHistory(courier, phone, { force: true })
      : this.getAll(phone, { force: true });
  }

  private async saveToCache(courier: string, phone: string, report: CourierReport | null, status = 'fresh') {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + CACHE_TTL_MS);
    const payload = report || {
      success: 0,
      cancel: 0,
      total: 0,
      successRatio: null,
      source: 'none' as const,
      schemaVersion: REPORT_SCHEMA_VERSION,
    };
    await this.prisma.courierReportCache.upsert({
      where: { courier_phone: { courier, phone } },
      create: { courier, phone, report: payload as any, courierStatus: status, fetchedAt: now, expiresAt },
      update: { report: payload as any, courierStatus: status, fetchedAt: now, expiresAt },
    });
  }

  private coerceCached(courier: string, raw: unknown): CourierReport | null {
    const r = raw as CourierReport | null | undefined;
    if (!r) return null;
    if (courier === 'steadfast') return this.readCachedSteadfastReport(raw);
    if (courier === 'pathao' && r.schemaVersion !== REPORT_SCHEMA_VERSION) {
      // Legacy Pathao rows predate actual-counts-first (v3): v1 synthesized
      // fake counts from an unknown default rating (50% success) and v2 holds
      // rating-calibrated estimates that Pathao's real quantities (when the
      // merchant API reports them) must replace — both carry no usable actual
      // counts, so they must be refetched.
      return null;
    }
    return {
      success: Number(r.success ?? 0),
      cancel: Number(r.cancel ?? 0),
      total: Number(r.total ?? 0),
      successRatio: r.successRatio != null ? Number(r.successRatio) : null,
      source: r.source ?? 'actual',
      rating: r.rating,
      schemaVersion: REPORT_SCHEMA_VERSION,
    };
  }

  /**
   * SINGLE READER for the stored Steadfast record. Both the customer-history
   * endpoint (`getCustomerHistory('steadfast')`) and the dashboard check
   * (`getSteadfastCheck`) coerce the SAME cached JSON through this function,
   * so the two can never disagree — per the doc, "they read the same stored
   * record". Null fraud fields are preserved as null (never coerced to 0);
   * legacy rows without `steadfastFraud` keep their counts verbatim.
   */
  private readCachedSteadfastReport(raw: unknown): CourierReport | null {
    const r = raw as (CourierReport & Record<string, unknown>) | null | undefined;
    if (!r || typeof r !== 'object') return null;
    const numOrNull = (v: unknown): number | null => {
      if (v == null || v === '') return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    let fraud: SteadfastFraudDetail | null = null;
    const fraudRaw = (r as Record<string, unknown>)['steadfastFraud'];
    if (fraudRaw && typeof fraudRaw === 'object' && !Array.isArray(fraudRaw)) {
      const f = fraudRaw as Record<string, unknown>;
      const bandRaw = typeof f['volumeBand'] === 'string' ? f['volumeBand'] : null;
      const rangeRaw = f['volumeRange'];
      let categories: Record<string, number> = {};
      const fc = f['fraudCategories'];
      if (fc && typeof fc === 'object' && !Array.isArray(fc)) {
        for (const [k, v] of Object.entries(fc as Record<string, unknown>)) {
          const n = Number(v);
          if (Number.isFinite(n)) categories[k] = n;
        }
      }
      fraud = {
        deliveryRatio: numOrNull(f['deliveryRatio']),
        cancellationRatio: numOrNull(f['cancellationRatio']),
        volumeBand: STEADFAST_VOLUME_BANDS.includes(
          bandRaw as SteadfastVolumeBand,
        )
          ? (bandRaw as SteadfastVolumeBand)
          : null,
        volumeRange:
          typeof rangeRaw === 'string'
            ? rangeRaw
            : rangeRaw == null
              ? null
              : String(rangeRaw),
        deliveredCount: numOrNull(f['deliveredCount']),
        cancelledCount: numOrNull(f['cancelledCount']),
        totalReports: (() => {
          const n = numOrNull(f['totalReports']);
          return n == null ? 0 : Math.max(0, Math.floor(n));
        })(),
        fraudCategories: categories,
      };
    }
    const out: CourierReport = {
      success: Number(r.success ?? 0),
      cancel: Number(r.cancel ?? 0),
      total: Number(r.total ?? 0),
      successRatio: r.successRatio != null ? Number(r.successRatio) : null,
      source: r.source ?? 'actual',
      schemaVersion: REPORT_SCHEMA_VERSION,
    };
    if (fraud) out.steadfastFraud = fraud;
    return out;
  }

  private stampReport(courier: string, report: CourierReport | null): CourierReport | null {
    if (!report) return null;
    return {
      ...report,
      successRatio: report.successRatio != null ? Number(report.successRatio) : null,
      source: report.source ?? 'actual',
      schemaVersion: REPORT_SCHEMA_VERSION,
    };
  }

  private async fetchFromCourier(courier: string, phone: string): Promise<CourierReport | null> {
    try {
      switch (courier) {
        case 'steadfast':
          return this.stampReport(courier, await this.fetchSteadfast(phone));
        case 'pathao':
          return this.stampReport(courier, await this.fetchPathao(phone));
        case 'redx':
          return this.stampReport(courier, await this.fetchRedx(phone));
        case 'carrybee':
          return this.stampReport(courier, await this.fetchCarrybee(phone));
        default:
          return null;
      }
    } catch (e) {
      this.logger.error(`Failed to fetch ${courier} history for ${phone}: ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * Dashboard customer check. Reads the SAME stored Steadfast record as the
   * customer-history endpoint (delegates to `getCustomerHistory`, which
   * coerces the cached JSON through the single `readCachedSteadfastReport`
   * reader) — the two cannot disagree.
   */
  async getSteadfastCheck(
    rawPhone: string,
    opts: { force?: boolean } = {},
  ): Promise<{ report: CourierReport | null; cached: boolean; fresh: boolean; fetchedAt: Date | null }> {
    return this.getCustomerHistory('steadfast', rawPhone, opts);
  }

  private async fetchSteadfast(phone: string): Promise<CourierReport | null> {
    const creds = await this.getCreds('steadfast');
    if (!creds?.enabled) return null;
    // Task 8: fraud-check (no per-order record context) uses the DEFAULT
    // set — booking-set routing applies to dispatch/tracking/webhooks.
    let apiKey = creds.apiKey || (creds.credentials as any)?.apiKey;
    let secretKey = creds.secretKey || (creds.credentials as any)?.secretKey;
    if (this.steadfastSets) {
      try {
        const auth = await this.steadfastSets.resolveAuth({});
        apiKey = auth.apiKey;
        secretKey = auth.secretKey;
      } catch {
        return null;
      }
    }
    if (!apiKey || !secretKey) return null;

    const base = await this.getBaseUrl('steadfast');
    // The old /fraud_check/{phone} counts path is deleted (retired upstream;
    // limit shared with this endpoint) — exactly ONE call shape per refresh.
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const res = await this.fetchWithTimeout(`${base}/fraud_check/score/${phone}`, {
        headers: {
          'Content-Type': 'application/json',
          'Api-Key': apiKey,
          'Secret-Key': secretKey,
        },
      });
      if (res.status === 429) {
        // Shared rate limit (roughly four checks per parcel on the busiest
        // day + ten): back off, never loop hot.
        if (attempt < maxAttempts) {
          await new Promise((resolve) =>
            setTimeout(resolve, 250 * 2 ** (attempt - 1)),
          );
          continue;
        }
        this.logger.warn(
          `Steadfast fraud-check rate limited (429) for ${phone} — backing off`,
        );
        return null;
      }
      if (!res.ok) return null;
      let data: Record<string, unknown>;
      try {
        data = (await res.json()) as Record<string, unknown>;
      } catch {
        return null;
      }
      if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
      return this.stampReport(
        'steadfast',
        buildSteadfastReport(parseSteadfastScoreResponse(data)),
      );
    }
    return null;
  }

  private normalizeRatingLabel(raw: string): string {
    return (raw || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private ratingLevel(raw: string): PathaoRatingLevel | 'unknown' {
    switch (this.normalizeRatingLabel(raw)) {
      case 'new customer':
      case 'new':
        return 'new';
      case 'risky':
      case 'risky customer':
      case 'bad customer':
        return 'risky';
      case 'moderate':
      case 'moderate customer':
      case 'average customer':
        return 'moderate';
      case 'good':
      case 'good customer':
        return 'good';
      case 'excellent':
      case 'excellent customer':
        return 'excellent';
      default:
        return 'unknown';
    }
  }

  private async getCalibration(): Promise<Record<Exclude<PathaoRatingLevel, 'new'>, number>> {
    try {
      const setting = await this.prisma.systemSetting.findUnique({
        where: { key: CALIBRATION_KEY },
      });
      if (!setting?.value) return { ...DEFAULT_CALIBRATION };
      const parsed = JSON.parse(setting.value) as Record<string, unknown>;
      const out = { ...DEFAULT_CALIBRATION };
      for (const level of Object.keys(DEFAULT_CALIBRATION) as (keyof typeof DEFAULT_CALIBRATION)[]) {
        const v = Number(parsed[level]);
        if (Number.isFinite(v) && v >= 0 && v <= 100) out[level] = v;
      }
      return out;
    } catch {
      return { ...DEFAULT_CALIBRATION };
    }
  }

  /**
   * Smart scale for Pathao rating-only responses: normalize against the largest
   * REAL parcel total this customer has with any other courier (cached), so the
   * normalized report is comparable in magnitude with the other couriers'
   * actual counts (e.g. 25 parcels → 23/2 instead of always 90/10 on 100).
   * Falls back to REPORT_SCALE_FALLBACK only when no other courier has data.
   */
  private async smartScaleFor(phone: string): Promise<number> {
    try {
      const rows = await this.prisma.courierReportCache.findMany({
        where: { phone, courier: { not: 'pathao' } },
      });
      let max = 0;
      for (const row of rows) {
        const t = Number((row.report as any)?.total);
        if (Number.isFinite(t) && t > max) max = t;
      }
      return max > 0 ? max : REPORT_SCALE_FALLBACK;
    } catch {
      return REPORT_SCALE_FALLBACK;
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

  /**
   * Actual Pathao quantities (merchant `POST /api/v1/user/success` v2 shape):
   * `data.customer = { total_delivery, successful_delivery }` gated by
   * `data.show_count`. Returns a validated { total, success } pair, or null
   * when Pathao reports no usable quantities (then the caller falls back to
   * the rating-based smart strategy, or to no report when no rating either).
   * `show_count === false` means Pathao itself hides the counts, so the
   * numbers are treated as absent even when present in the payload.
   */
  private extractPathaoActual(d: Record<string, unknown>): { total: number; success: number } | null {
    if ((d as any)?.show_count === false) return null;
    const customer = (d as any)?.customer as Record<string, unknown> | undefined;
    const num = (v: unknown): number | null => {
      if (typeof v === 'boolean' || v == null || v === '') return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const total =
      num(customer?.total_delivery) ??
      num(customer?.total_orders) ??
      num(customer?.total) ??
      num((d as any)?.total_orders) ??
      num((d as any)?.totalOrders) ??
      num((d as any)?.total_delivery) ??
      num((d as any)?.total);
    const success =
      num(customer?.successful_delivery) ??
      num(customer?.success_delivery) ??
      num(customer?.successful_orders) ??
      num(customer?.delivered) ??
      num((d as any)?.successful_delivery) ??
      num((d as any)?.successful_orders);
    if (total == null || success == null) return null;
    if (total <= 0 || success < 0 || success > total) return null;
    return { total, success };
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
    if (!loginRes.ok) {
      this.logger.warn(`Pathao history: merchant login failed (HTTP ${loginRes.status}) for ${phone}`);
      return null;
    }
    const loginData = await loginRes.json();
    const token = loginData['access_token'] || loginData['accessToken'];
    if (!token) {
      this.logger.warn(`Pathao history: merchant login returned no token for ${phone}`);
      return null;
    }

    const successRes = await this.fetchWithTimeout('https://merchant.pathao.com/api/v1/user/success', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ phone }),
    });
    if (!successRes.ok) {
      const preview = (await successRes.text()).slice(0, 200);
      this.logger.warn(`Pathao history: lookup failed (HTTP ${successRes.status}) for ${phone}: ${preview}`);
      return null;
    }
    const body = await successRes.json();
    const d = (body as any)?.data as Record<string, unknown> | undefined;
    if (!d) {
      this.logger.warn(`Pathao history: lookup response missing data for ${phone}: ${JSON.stringify(body).slice(0, 200)}`);
      return null;
    }

    const rating = (d['customer_rating'] as string) || '';
    const level = this.ratingLevel(rating);
    if (level === 'unknown' && rating) {
      this.logger.warn(`Pathao history: unrecognized rating value "${rating}" for ${phone}`);
    }

    // Actual counts first: when Pathao reports real quantities, show them
    // verbatim — the rating-calibrated smart strategy below is only a fallback
    // for rating-without-quantities, never a replacement for real numbers.
    const actual = this.extractPathaoActual(d);
    if (actual) {
      return {
        success: actual.success,
        cancel: actual.total - actual.success,
        total: actual.total,
        successRatio: Math.round((actual.success / actual.total) * 10000) / 100,
        source: 'actual' as const,
        rating,
        schemaVersion: REPORT_SCHEMA_VERSION,
      };
    }

    // Pathao's own total (legacy top-level keys, or the v2 nested customer
    // object without a usable success split) scales the normalized estimate.
    // Hidden counts (show_count === false) are excluded — they fall through to
    // the cross-courier smart scale instead.
    const countsVisible = (d as any)?.show_count !== false;
    const customer = (d as any)?.customer as Record<string, unknown> | undefined;
    const totalOrders =
      (d as any)?.total_orders ??
      (d as any)?.totalOrders ??
      (d as any)?.total_delivery ??
      (d as any)?.total ??
      (countsVisible ? (customer?.total_delivery ?? customer?.total_orders ?? customer?.total ?? null) : null);

    if (level !== 'unknown') {
      // Rating-based response (Pathao's current format — counts are 0/absent).
      // Scale to the customer's real parcel base from other couriers when
      // Pathao itself carries no counts (a fixed 100-unit base misrepresents
      // customers whose actual history is, e.g., 25 parcels).
      const calibrated = level === 'new' ? null : (await this.getCalibration())[level];
      const realTotal = Number(totalOrders);
      if (calibrated == null) {
        return {
          success: 0,
          cancel: 0,
          total: Number.isFinite(realTotal) && realTotal > 0 ? realTotal : 0,
          successRatio: null,
          source: 'new' as const,
          rating,
          schemaVersion: REPORT_SCHEMA_VERSION,
        };
      }
      const total =
        Number.isFinite(realTotal) && realTotal > 0 ? realTotal : await this.smartScaleFor(phone);
      // Integer split: Math.round keeps success integral, cancel absorbs the rest.
      const success = Math.round((total * calibrated) / 100);
      return {
        success,
        cancel: total - success,
        total,
        successRatio: calibrated,
        source: 'normalized' as const,
        rating,
        schemaVersion: REPORT_SCHEMA_VERSION,
      };
    }

    if (totalOrders === null) return null;
    const total = Number(totalOrders);
    if (total <= 0) return null;

    // Counts present but no rating — neutral (never fabricate a ratio).
    return {
      success: 0,
      cancel: 0,
      total,
      successRatio: null,
      source: 'new' as const,
      rating,
      schemaVersion: REPORT_SCHEMA_VERSION,
    };
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
        return { success, cancel, total, successRatio: Math.round((success / total) * 10000) / 100, source: 'actual' as const };
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
      source: 'actual' as const,
    };
  }
}
