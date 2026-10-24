import { Injectable, BadRequestException, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CourierTokenService } from './courier-token.service';
import type { SteadfastCredentialSetsService } from './steadfast-credential-sets.service';
import { formatCourierAddress } from './address-format';
import {
  courierSafeRecipientName,
  orderRecipientPhone,
  orderRecipientEmail,
  orderRecipientRawName,
} from '../orders/order-recipient';
import {
  COURIER_FIELD_LIMITS,
  courierAddressLimit,
  sanitizeCourierText,
} from './courier-settle-guard';

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

/**
 * Fix 5: mask credential-shaped values inside raw courier body text before the
 * text is embedded in an error message, timeline note, or log row.
 * The object-key redactor (`sanitizeDispatchPayload`) cannot cover free-form
 * text (headers, query strings, HTML error pages), so this works on strings:
 * `Api-Key: live…` / `"secret_key": "…"` / `password=…` / Bearer tokens.
 * Field names and validation sentences are left intact (never redacted).
 */
export function redactSecrets(text: string): string {
  if (!text) return text;
  let out = text;
  // JSON string values under secret-shaped keys: "api_key": "..." etc.
  out = out.replace(
    /("(?:api[_-]?key|secret[_-]?key|client[_-]?secret|app[_-]?secret|access[_-]?token|refresh[_-]?token|password|passwd|authorization|webhook[_-]?secret)"\s*:\s*)"[^"]*"/gi,
    '$1"[REDACTED]"',
  );
  // Header / query / assignment style: Api-Key: <tok>, password=<tok>,
  // Authorization: Bearer <tok>. The separator MUST contain : = or - so
  // ordinary prose ("password must be 8 characters") is never mangled;
  // value must be a single token (no spaces).
  out = out.replace(
    /(api[_-]?key|secret[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|authorization|password|passwd)([\s"']*[:=\-][\s"':=\-]*)(Bearer\s+)?[^\s,;&}"']+/gi,
    (_m, key: string, sep: string, bearer: string) =>
      `${key}${sep}${bearer || ''}[REDACTED]`,
  );
  return out;
}

const COURIER_DISPLAY: Record<string, string> = {
  steadfast: 'Steadfast',
  pathao: 'Pathao',
  redx: 'RedX',
  carrybee: 'Carrybee',
};

/**
 * Fix 5: the thrown shape for every courier dispatch failure.
 * `{courier, status, message, errors, orderId}` — `status` is the HTTP status
 * (0 when the request was never sent: local validation or exhausted network
 * retries), `errors` is the courier's field-level object verbatim
 * (Steadfast `errors`, Pathao envelope extras, RedX `errors`, Carrybee
 * `causes`), `message` names the exact field+rule for toasts/timeline.
 */
export class CourierDispatchError extends BadRequestException {
  readonly courier: string;
  readonly statusCode: number;
  readonly errors?: Record<string, unknown>;
  readonly orderId?: string;

  constructor(init: {
    courier: string;
    status: number;
    message: string;
    errors?: Record<string, unknown>;
    orderId?: string;
  }) {
    super({
      courier: init.courier,
      status: init.status,
      message: init.message,
      errors: init.errors,
      orderId: init.orderId,
    });
    this.courier = init.courier;
    this.statusCode = init.status;
    this.errors = init.errors;
    this.orderId = init.orderId;
    // BadRequestException defaults message to 'Bad Request Exception' —
    // dispatch() reads e.message, so it must be OUR field+rule text.
    this.message = init.message;
  }
}

/**
 * Fix 5: retry discipline. ONLY 5xx or network-level failures (no HTTP
 * response at all) may be retried. NEVER 4xx — including 401 (wrong/revoked
 * keys: retrying only burns the Steadfast 10-failures/5min → 429-for-60min
 * lockout budget) and 429 (already locked out: back off, do not loop).
 */
function isRetryableStatus(status: number | null): boolean {
  if (status === null) return true;
  return status >= 500;
}

function backoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** (attempt - 1), 8000);
}

function authHint(courier: string, status: number): string {
  const display = COURIER_DISPLAY[courier] || courier;
  if (status === 401)
    return (
      ` Fix the ${display} API keys — do not retry.` +
      (courier === 'steadfast'
        ? ' (Steadfast locks out after 10 failures in 5 minutes — 429 for 60 minutes, correct keys included.)'
        : '')
    );
  if (status === 429)
    return (
      ` Rate limited / locked out — back off, do not retry in a loop.` +
      (courier === 'steadfast'
        ? ' (Steadfast refuses for 60 minutes after 10 failures in 5 minutes.)'
        : '')
    );
  return '';
}

/**
 * Task 6: doc-optional RedX pickup_store_id. No dedicated column exists on
 * CourierCredentials, so it is read from the free-form credentials JSON
 * and omitted entirely when unconfigured.
 */
function redxPickupStoreId(creds: any): string | undefined {
  const raw =
    creds?.credentials?.['pickupStoreId'] ?? creds?.credentials?.['pickup_store_id'];
  if (raw === undefined || raw === null || String(raw).trim() === '')
    return undefined;
  return String(raw);
}

/** First human-readable rule per field, for `field 'x' <rule>` segments. */
function firstRule(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const first = value[0];
    if (typeof first === 'string') return first;
    if (first && typeof first === 'object') {
      const rec = first as Record<string, unknown>;
      if (typeof rec['type'] === 'string') return String(rec['type']);
      return JSON.stringify(first).slice(0, 160);
    }
    return String(first ?? '');
  }
  if (value && typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    if (typeof rec['type'] === 'string') return String(rec['type']);
    return JSON.stringify(value).slice(0, 160);
  }
  return String(value ?? '');
}

function fieldSegments(errors: Record<string, unknown>): string {
  return Object.entries(errors)
    .map(([field, rule]) => `field '${field}' ${firstRule(rule)}`)
    .join('; ');
}

function parseJsonBody(
  rawBody: string,
): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      return parsed as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

/** What lands in courierDispatchLog.responsePayload (secrets masked). */
function responsePayloadFor(
  rawBody: string,
  parsed: Record<string, unknown> | null,
): unknown {
  if (parsed) return parsed;
  return { raw: redactSecrets(rawBody).slice(0, 4000) };
}

/**
 * Steadfast bulk per-entry error codes → `field 'x' <rule>` sentences.
 * From the Steadfast API doc error-codes table (bulk entries carry
 * `status: null` + `error`, a JSON-encoded ARRAY of these codes).
 */
const STEADFAST_BULK_ERROR_RULES: Record<string, string> = {
  INVOICE_IS_REQUIRED: "field 'invoice' is required",
  INVOICE_MUST_BE_ALPHA_NUM_DASH_UNDERSCORE:
    "field 'invoice' must use only letters, digits, hyphens and underscores",
  INVOICE_LENGTH_SHOULD_BE_LESS_THAN_100_CHARS:
    "field 'invoice' must be shorter than 100 chars",
  THIS_INVOICE_ALREADY_EXISTS:
    "field 'invoice' already booked — safe to skip, a retry will not double-book",
  RECEIVER_NAME_IS_REQUIRED: "field 'recipient_name' is required",
  RECEIVER_NAME_LENGTH_SHOULD_BE_LESS_THAN_100_CHARS:
    "field 'recipient_name' must be shorter than 100 chars",
  RECEIVER_PHONE_IS_REQUIRED: "field 'recipient_phone' is required",
  RECEIVER_PHONE_LENGTH_SHOULD_BE_LESS_THAN_40_CHARS:
    "field 'recipient_phone' must be shorter than 40 chars",
  RECEIVER_ADDRESS_IS_REQUIRED: "field 'recipient_address' is required",
  RECEIVER_ADDRESS_LENGTH_SHOULD_BE_LESS_THAN_500_CHARS:
    "field 'recipient_address' must be shorter than 500 chars",
  RECEIVER_NOTE_LENGTH_SHOULD_BE_LESS_THAN_500_CHARS:
    "field 'note' must be shorter than 500 chars",
  COD_AMOUNT_ERROR: "field 'cod_amount' is required",
  ERROR: "field 'cod_amount' must be a number",
};

@Injectable()
export class CourierManagerService {
  private readonly logger = new Logger(CourierManagerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenStore: CourierTokenService,
    @Optional() private readonly steadfastSets?: SteadfastCredentialSetsService,
  ) {}

  private async fetchWithTimeout(
    url: string,
    options: RequestInit = {},
    timeoutMs = 15000,
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
    timeoutMs = 15000,
  ): Promise<Record<string, unknown>> {
    const res = await this.fetchWithTimeout(url, options, timeoutMs);
    const rawBody = await res.text().catch(() => '');
    if (!res.ok) {
      throw new BadRequestException(
        `HTTP ${res.status} from courier API: ${(rawBody || '(empty response body)').slice(0, 200)}`,
      );
    }
    try {
      return JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      throw new BadRequestException(
        `Courier API returned non-JSON (HTTP ${res.status}): ${(rawBody || '(empty response body)').slice(0, 200)}`,
      );
    }
  }

  private async getBaseUrl(courier: string): Promise<string> {
    const creds = await this.getCreds(courier);
    const mode = creds?.mode || 'production';
    return (
      BASE_URLS[courier]?.[mode] || BASE_URLS[courier]?.['production'] || ''
    );
  }

  private async getCreds(courier: string) {
    const c = await this.prisma.courierCredentials.findUnique({
      where: { courier },
    });
    if (!c || !c.enabled)
      throw new BadRequestException(`${courier} is not configured or disabled`);
    return c;
  }

  /**
   * Task 8: Steadfast set-resolution (order override → record set → default
   * → legacy single row). Resolves EXACTLY ONE profile upfront — callers
   * never fall through to the next profile on 401 (fail fast with the
   * wrong-profile hint instead of burning the lockout budget).
   */
  private async resolveSteadfastAuth(opts?: {
    overrideSetId?: string | null;
    consignmentId?: string | null;
  }): Promise<{ apiKey: string; secretKey: string; setId: string | null }> {
    if (this.steadfastSets) return this.steadfastSets.resolveAuth(opts);
    const creds = await this.getCreds('steadfast');
    const apiKey = creds.apiKey || (creds.credentials as any)?.['apiKey'];
    const secretKey = creds.secretKey || (creds.credentials as any)?.['secretKey'];
    if (!apiKey || !secretKey)
      throw new BadRequestException('Steadfast API key/secret not configured');
    return { apiKey, secretKey, setId: null };
  }

  /** Task 8: 401 hint gains the wrong-profile suffix when >1 set exists. */
  private async steadfastProfileHint(): Promise<string> {
    if (!this.steadfastSets) return '';
    return this.steadfastSets.wrongProfileHint();
  }

  /**
   * Task 8: Steadfast auth hint with the wrong-profile suffix. Computed once
   * per failure (never a retry loop across profiles — ONE set was resolved
   * upfront and a 401 fails fast here).
   */
  private async steadfastAuthHint(status: number): Promise<string> {
    return authHint('steadfast', status) + (await this.steadfastProfileHint());
  }

  private describeSteadfastError(status: number, rawBody: string): string {
    const body = (rawBody || '').trim();
    if (body) {
      return `Steadfast API rejected the request (HTTP ${status}): ${body.slice(0, 200)}`;
    }
    return `Steadfast API rejected the request (HTTP ${status}) — empty response body`;
  }

  private normalizePhone(raw?: string | null): string {
    const digits = (raw || '').replace(/\D/g, '');
    if (digits.length <= 11) {
      if (digits.length === 10) return `0${digits}`;
      return digits;
    }
    return digits.slice(-11);
  }

  /**
   * Courier office note policy (Hotfix 2, architect-clarified):
   * - The default note is copied into the order AT CREATE TIME (orders.service).
   * - An order's stored officeNotes is authoritative forever: dispatch sends the
   *   stored value verbatim, never today's system default (so an existing order
   *   never silently inherits a later-changed default; a cleared '' stays empty).
   * - Legacy orders created before the hotfix with officeNotes = NULL dispatch
   *   with no note (empty) — documented, not backfilled silently.
   * No dispatch-time default lookup is performed here.
   */

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

  /**
   * Fix 5a (owner-locked, Task 2: Mx. prepend is Pathao-ONLY): resolve the
   * courier-safe recipient name. Short snapshot names go out as
   * `'Mx. ' + full` for Pathao only (gender-neutral prefix);
   * Steadfast/RedX/Carrybee go verbatim (truncated to their max);
   * long names are truncated per courier max,
   * and the STORED order/customer is never mutated (pure helper — payload +
   * dispatch record carry the transformed value only). Empty/missing →
   * throws a Fix 5 field error (never prefixed, never a 'Customer'
   * placeholder), shaped so dispatch() can thread it to the UI untouched.
   */
  private resolveCourierName(
    order: any,
    courier: string,
    payloadField: string,
  ): { sent: string; raw: string } {
    const raw = orderRecipientRawName(order);
    const sent = courierSafeRecipientName(order, courier);
    if (!sent) {
      throw new CourierDispatchError({
        courier,
        status: 0,
        message: `Courier: field '${payloadField}' is required — order '${order.displayId || order.id}' has no recipient name`,
        errors: { [payloadField]: ['required'] },
        orderId: order.id,
      });
    }
    return { sent, raw };
  }

  /** Timeline note, ONLY when the courier name was transformed. */
  private courierNameNote(sent: string, raw: string): string | null {
    if (sent === raw) return null;
    return `courier name sent as '${sent}' — order keeps '${raw}'`;
  }

  private async noteCourierNameTransform(
    orderId: string,
    courier: string,
    sent: string,
    raw: string,
  ): Promise<void> {
    const note = this.courierNameNote(sent, raw);
    if (!note) return;
    try {
      const current = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: { timeline: true },
      });
      const timeline = ((current?.timeline as unknown[]) || []) as any[];
      timeline.push({
        type: 'courier',
        courier,
        status: 'DISPATCHED',
        timestamp: new Date().toISOString(),
        note,
      });
      await this.prisma.order.update({
        where: { id: orderId },
        data: { timeline: timeline as any },
      });
    } catch (err) {
      this.logger.warn(
        `Courier name timeline note skipped: ${(err as Error).message}`,
      );
    }
  }

  /** Timeline note for a FAILED dispatch — same field+rule text as the toast. */
  private async noteDispatchFailure(
    orderId: string,
    courier: string,
    message: string,
  ): Promise<void> {
    try {
      const current = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: { timeline: true },
      });
      const timeline = ((current?.timeline as unknown[]) || []) as any[];
      timeline.push({
        type: 'courier',
        courier,
        status: 'DISPATCH_FAILED',
        timestamp: new Date().toISOString(),
        note: message,
      });
      await this.prisma.order.update({
        where: { id: orderId },
        data: { timeline: timeline as any },
      });
    } catch (err) {
      this.logger.warn(
        `Courier failure timeline note skipped: ${(err as Error).message}`,
      );
    }
  }

  async dispatch(
    courier: string,
    orderIds: string[],
    opts?: { credentialSetId?: string | null },
  ) {
    const orders = await this.prisma.order.findMany({
      where: { id: { in: orderIds }, trashedAt: null },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
            email: true,
          },
        },
        items: {
          include: {
            // weightGram rides along for the Q12 dispatch weight rule.
            product: { select: { name: true, weightGram: true } },
          },
        },
        payments: true,
      },
    });

    const existing = await this.prisma.dispatch.findMany({
      where: {
        orderId: { in: orderIds },
        courier: courier as any,
        status: { not: 'CANCELLED' },
      },
      select: { orderId: true, status: true },
    });
    const alreadyDispatched = new Set(existing.map((e) => e.orderId));

    const results: {
      id: string;
      ok: boolean;
      message?: string;
      consignmentId?: string;
      trackingCode?: string;
      courier?: string;
      status?: number;
      errors?: Record<string, unknown>;
    }[] = [];
    for (const order of orders) {
      if (alreadyDispatched.has(order.id)) {
        results.push({ id: order.id, ok: false, message: 'Already dispatched' });
        continue;
      }
      // D19-B (owner rule): an order with ANY payment still awaiting
      // verification (status PENDING — customer-submitted manual payment, or
      // staff entry while staff-auto-verify is OFF) must NEVER be sent to a
      // courier, even though its money rows exist. The gate lives here, in
      // the single booking entry point every courier shares, so no courier
      // path and no UI can bypass it; the admin toast surfaces this message
      // verbatim. Pure-COD orders (no payment rows at all) pass: there is
      // nothing awaiting verification, the courier collects on delivery.
      // Terminal rows (PAID / FAILED / CANCELLED / VOID) are not pending.
      if (
        (order.payments || []).some((p: any) => p.status === 'PENDING')
      ) {
        results.push({
          id: order.id,
          ok: false,
          message:
            'Cannot dispatch: order has payment(s) awaiting verification — verify or reject them first',
        });
        continue;
      }
      try {
        const result = await this.dispatchOne(courier, order, opts?.credentialSetId);
        results.push({ id: order.id, ok: true, ...result });
      } catch (e: unknown) {
        // Fix 5: thread the shaped error ({courier, status, errors}) to the
        // admin UI untouched — toasts/timeline name the exact field+rule.
        if (e instanceof CourierDispatchError) {
          results.push({
            id: order.id,
            ok: false,
            message: e.message,
            courier: e.courier,
            status: e.statusCode,
            errors: e.errors,
          });
          continue;
        }
        const msg = e instanceof Error ? e.message : 'Dispatch failed';
        results.push({ id: order.id, ok: false, message: msg, courier });
      }
    }
    return results;
  }

  private async dispatchOne(
    courier: string,
    order: any,
    credentialSetId?: string | null,
  ): Promise<{ consignmentId?: string; trackingCode?: string }> {
    const creds = await this.getCreds(courier);
    const mode = creds?.mode || 'production';
    const base =
      BASE_URLS[courier]?.[mode] || BASE_URLS[courier]?.['production'] || '';
    if (!base)
      throw new BadRequestException(`No base URL for ${courier} (${mode})`);

    switch (courier) {
      case 'steadfast':
        return this.dispatchSteadfast(creds, base, order, credentialSetId);
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

  getCollectableAmount(order: any): number {
    if (
      order.paymentStatus === 'PAID' ||
      order.paymentOptionType === 'FULL_PAYMENT'
    ) {
      return 0;
    }
    const orderTotal = Number(order.total || 0);
    const paidSum = (order.payments || [])
      .filter((p: any) => p.status === 'PAID')
      .reduce((sum: number, p: any) => sum + Number(p.amount || 0), 0);
    if (paidSum > 0) {
      return Math.max(0, orderTotal - paidSum);
    }
    if (order.paymentOptionType === 'PARTIAL_PAYMENT' && order.partialAmount) {
      return Math.max(0, orderTotal - Number(order.partialAmount));
    }
    return orderTotal;
  }

  private async dispatchSteadfast(
    _legacyCreds: any,
    base: string,
    order: any,
    credentialSetId?: string | null,
  ) {
    // Task 8: ONE profile resolved upfront (order override → default →
    // legacy). A 401 below never falls through to the next profile.
    const auth = await this.resolveSteadfastAuth({
      overrideSetId: credentialSetId,
    });
    const apiKey = auth.apiKey;
    const secretKey = auth.secretKey;
    const bookingSetId = auth.setId;
    if (!apiKey || !secretKey)
      throw new BadRequestException('Steadfast API key/secret not configured');

    // D-A: the order snapshot is the recipient source of truth — the linked
    // CustomerProfile is never read here (it may hold pre-correction values).
    const phone = this.normalizePhone(orderRecipientPhone(order));
    const collectAmount = this.getCollectableAmount(order);
    const address = order.shippingAddress as Record<string, unknown> | null;

    const itemDescription =
      order.items
        ?.map((item: any) => item.product?.name || 'Product')
        .join(', ') || undefined;

    // Fix 5a: courier-safe name (Mx. prefix / truncate); stored order kept.
    const { sent: safeName, raw: rawName } = this.resolveCourierName(
      order,
      'steadfast',
      'recipient_name',
    );

    const payload: Record<string, unknown> = {
      // Task 10: pre-check lengths + strip `{ } ; < > $` (Steadfast doc
      // limits: invoice 100, name 100, phone 40, address 490, note 480).
      // safeName already carries the Mx./100-cut; sanitize re-applies the
      // strip + cap defensively (idempotent).
      invoice: sanitizeCourierText(order.displayId, COURIER_FIELD_LIMITS.invoice),
      recipient_name: sanitizeCourierText(safeName, COURIER_FIELD_LIMITS.name),
      recipient_phone: sanitizeCourierText(phone, COURIER_FIELD_LIMITS.phone),
      recipient_address: sanitizeCourierText(
        formatCourierAddress(address) ?? 'Dhaka',
        courierAddressLimit('steadfast'),
      ),
      cod_amount: collectAmount,
      note: order.officeNotes
        ? sanitizeCourierText(String(order.officeNotes), COURIER_FIELD_LIMITS.note)
        : undefined,
      item_description: itemDescription
        ? sanitizeCourierText(itemDescription, COURIER_FIELD_LIMITS.note)
        : undefined,
      delivery_type: address?.deliveryType === 'hub' ? 1 : 0,
    };

    const recipientEmail = orderRecipientEmail(order);
    if (recipientEmail) {
      payload.recipient_email = recipientEmail;
    }

    // Secondary contact: the order's staff-entered secondaryPhone wins;
    // otherwise keep the legacy shippingAddress.phone fallback.
    const secondaryPhone =
      this.normalizePhone(order.secondaryPhone) ||
      (address?.phone && address.phone !== phone
        ? this.normalizePhone(address.phone as string)
        : null);
    if (secondaryPhone) {
      payload.alternative_phone = secondaryPhone;
    }

    // Fix 5 retry discipline: ONLY 5xx/network are retried (exponential
    // backoff); NEVER 4xx (401/429 carry a fix-keys/back-off hint instead —
    // retrying 401 burns the 10-failures/5min → 429-for-60min lockout budget).
    // Retry safety: every attempt sends the SAME payload with the SAME
    // invoice (order.displayId) — duplicate invoices are refused, so a retry
    // cannot double-book (per the Steadfast doc: "Retry with the same
    // invoice").
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      let res: Response;
      try {
        res = await this.fetchWithTimeout(`${base}/create_order`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Api-Key': apiKey,
            'Secret-Key': secretKey,
          },
          body: JSON.stringify(payload),
        });
      } catch (netErr: unknown) {
        // No HTTP response (timeout/reset) — retryable.
        lastError = netErr instanceof Error ? netErr : new Error(String(netErr));
        this.logger.warn(
          `Steadfast dispatch attempt ${attempt}/${maxRetries} failed (network): ${lastError.message}`,
        );
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt)));
        }
        continue;
      }

      // Read the body once as text: a failed JSON.parse must not consume the
      // body, so a plain-text error (e.g. "Account is not active!") is
      // captured before attempting to parse. The FULL body is kept (never
      // just `message`) and secrets are masked before it reaches any message.
      const rawBody = await res.text().catch(() => '');
      const data = parseJsonBody(rawBody);

      if (!res.ok) {
        if (isRetryableStatus(res.status)) {
          lastError = new Error(
            `Steadfast API error (HTTP ${res.status}): ${redactSecrets(rawBody).slice(0, 500) || '(empty response body)'}`,
          );
          this.logger.warn(
            `Steadfast dispatch attempt ${attempt}/${maxRetries} failed (retryable HTTP ${res.status}): ${lastError.message}`,
          );
          if (attempt < maxRetries) {
            await new Promise((resolve) =>
              setTimeout(resolve, backoffMs(attempt)),
            );
          }
          continue;
        }
        throw await this.permanentSteadfastError(res.status, rawBody, data, order, payload);
      }

      if (data === null) {
        // 2xx but not JSON (proxy/captive page) — transient, retry bounded.
        // Secrets masked like the 4xx path (Fix 5 redact consistency).
        lastError = new BadRequestException(
          this.describeSteadfastError(res.status, redactSecrets(rawBody)),
        );
        this.logger.warn(
          `Steadfast dispatch attempt ${attempt}/${maxRetries} failed (non-JSON 2xx): ${lastError.message}`,
        );
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt)));
        }
        continue;
      }

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
          const trackingUrl = String(
            consignment?.['tracking_link'] || data['tracking_link'] || '',
          );

          try {
            await this.prisma.order.update({
              where: { id: order.id },
              data: {
                courierService: 'steadfast',
                courierConsignmentId: consignmentId,
                courierTrackingCode: trackingCode,
              },
            });
            await this.prisma.dispatch.upsert({
              where: {
                courier_consignmentId: { courier: 'steadfast', consignmentId },
              },
              update: { trackingCode, trackingUrl, status: 'DISPATCHED' },
              create: {
                orderId: order.id,
                courier: 'steadfast',
                consignmentId,
                trackingCode,
                trackingUrl,
                status: 'DISPATCHED',
                // Task 8: booking set id (null = legacy default). Tracking /
                // status / webhooks resolve the set from THIS record, never
                // the current default.
                ...{ credentialSetId: bookingSetId },
                // Persist the amount actually sent as cod_amount (Feature A:
                // post-dispatch COD mismatch source of truth). Persist-only —
                // the getCollectableAmount calc itself is untouched.
                courierAmount: collectAmount,
                // Fix 5a: dispatch record stores the sent name (only when
                // transformed; the stored order keeps the original).
                ...(this.courierNameNote(safeName, rawName)
                  ? {
                      notes: `courier name sent as '${safeName}'`,
                    }
                  : {}),
              },
            });
            await this.noteCourierNameTransform(
              order.id,
              'steadfast',
              safeName,
              rawName,
            );
            await this.logDispatch({
              orderId: order.id,
              courier: 'steadfast',
              status: 'success',
              consignmentId,
              trackingCode,
              requestPayload: payload,
              responsePayload: data,
            });
          } catch (dbErr) {
            this.logger.error(
              `Steadfast dispatch succeeded but DB update failed: ${(dbErr as Error).message}`,
            );
          }

          return { consignmentId, trackingCode };
        }
        const apiMsg = String(data['message'] || data['error'] || '');
        const errors =
          data['errors'] && typeof data['errors'] === 'object'
            ? (data['errors'] as Record<string, unknown>)
            : undefined;
        // Fix 5: business-level rejection (HTTP 200 with no consignment, or a
        // parsed error envelope) is permanent — never retried.
        const msg = errors
          ? `Steadfast: ${apiMsg || 'request rejected'} — ${fieldSegments(errors)}`
          : apiMsg
            ? `Steadfast: ${apiMsg}`
            : `Steadfast API error (HTTP ${res.status}): ${JSON.stringify(data).slice(0, 500)}`;
        const failure = new CourierDispatchError({
          courier: 'steadfast',
          status: res.status,
          message: msg + (await this.steadfastAuthHint(res.status)),
          errors,
          orderId: order.id,
        });
        await this.logDispatch({
          orderId: order.id,
          courier: 'steadfast',
          status: 'failed',
          message: failure.message,
          requestPayload: payload,
          responsePayload: responsePayloadFor(rawBody, data),
        });
        await this.noteDispatchFailure(order.id, 'steadfast', failure.message);
        throw failure;
    }

    const exhausted = new CourierDispatchError({
      courier: 'steadfast',
      status: 0,
      message:
        lastError instanceof CourierDispatchError
          ? lastError.message
          : `Steadfast: ${lastError?.message || 'dispatch failed after retries'} (retried ${maxRetries} attempts with the same invoice '${order.displayId}' — no double booking)`,
      errors:
        lastError instanceof CourierDispatchError
          ? lastError.errors
          : undefined,
      orderId: order.id,
    });
    await this.logDispatch({
      orderId: order.id,
      courier: 'steadfast',
      status: 'failed',
      message: exhausted.message,
      requestPayload: payload,
    });
    await this.noteDispatchFailure(order.id, 'steadfast', exhausted.message);
    throw exhausted;
  }

  /**
   * Fix 5: permanent (never-retried) Steadfast 4xx. Reads the FULL body —
   * JSON `errors` (field names per the doc: `{"status":400,"errors":{...}}`)
   * or plain text ("Account is not active!") — masks secrets, and names the
   * exact field+rule for the admin toast + order timeline.
   */
  private async permanentSteadfastError(
    status: number,
    rawBody: string,
    data: Record<string, unknown> | null,
    order: any,
    payload: unknown,
  ): Promise<CourierDispatchError> {
    let failure: CourierDispatchError;
    if (data === null) {
      failure = new CourierDispatchError({
        courier: 'steadfast',
        status,
        message:
          `${this.describeSteadfastError(status, redactSecrets(rawBody))}` +
          (await this.steadfastAuthHint(status)),
        orderId: order.id,
      });
    } else {
      const apiMsg = String(data['message'] || data['error'] || '');
      const errors =
        data['errors'] && typeof data['errors'] === 'object'
          ? (data['errors'] as Record<string, unknown>)
          : undefined;
      const base = errors
        ? `Steadfast: ${apiMsg || 'request rejected'} — ${fieldSegments(errors)}`
        : apiMsg
          ? `Steadfast: ${apiMsg}`
          : `Steadfast API error (HTTP ${status}): ${redactSecrets(rawBody).slice(0, 500) || '(empty response body)'}`;
      failure = new CourierDispatchError({
        courier: 'steadfast',
        status,
        message: base + (await this.steadfastAuthHint(status)),
        errors,
        orderId: order.id,
      });
    }
    await this.logDispatch({
      orderId: order.id,
      courier: 'steadfast',
      status: 'failed',
      message: failure.message,
      requestPayload: payload,
      responsePayload: responsePayloadFor(rawBody, data),
    });
    await this.noteDispatchFailure(order.id, 'steadfast', failure.message);
    return failure;
  }

  /**
   * Task 9(a): per-order Pathao payload builder (doc: Create Order + Bulk
   * Order share the same order-object shape). Extracted so single dispatch
   * and bulk dispatch send byte-identical entries — bulk reuses this verbatim.
   */
  buildPathaoOrderPayload(order: any, storeId: string | number): Record<string, unknown> {
    // D-A: the order snapshot is the recipient source of truth — the linked
    // CustomerProfile is never read here (it may hold pre-correction values).
    const phone = this.normalizePhone(orderRecipientPhone(order));
    const total = this.getCollectableAmount(order);
    const address = order.shippingAddress as Record<string, unknown> | null;

    const itemDescription =
      order.items
        ?.map((item: any) => item.product?.name || 'Product')
        .join(', ') || undefined;

    // Fix 5a: courier-safe name (Mx. prefix / truncate); stored order kept.
    const { sent: safeName } = this.resolveCourierName(
      order,
      'pathao',
      'recipient_name',
    );

    const payload: Record<string, unknown> = {
      // Task 10: same strip + pre-check (Pathao doc states name 3–100;
      // invoice/phone/note caps unstated → Steadfast 100/40/480 applied as
      // the safe default, noted here). Address cap is Pathao's OWN doc
      // limit (10–220 chars) since owner Q10 (2026-10-23).
      store_id: parseInt(String(storeId)),
      recipient_name: sanitizeCourierText(safeName, COURIER_FIELD_LIMITS.name),
      recipient_phone: sanitizeCourierText(phone, COURIER_FIELD_LIMITS.phone),
      recipient_address: sanitizeCourierText(
        formatCourierAddress(address) ?? 'Dhaka',
        courierAddressLimit('pathao'),
      ),
      delivery_type: 48,
      item_type: 2,
      item_quantity: order.items?.length || 1,
      // Owner Q12 (2026-10-23): product weightGram wins when set; the
      // long-standing 0.5 kg stays as the fallback. Pathao doc range is
      // 0.5–10 kg — clamped, never rejected.
      item_weight: this.resolvePathaoWeightKg(order),
      amount_to_collect: total,
    };

    if (order.displayId) {
      payload.merchant_order_id = sanitizeCourierText(
        String(order.displayId),
        COURIER_FIELD_LIMITS.invoice,
      );
    }
    if (order.officeNotes) {
      payload.special_instruction = sanitizeCourierText(
        String(order.officeNotes),
        COURIER_FIELD_LIMITS.note,
      );
    }
    if (itemDescription) {
      payload.item_description = sanitizeCourierText(itemDescription, COURIER_FIELD_LIMITS.note);
    }
    if (address?.cityId) {
      payload.recipient_city = address.cityId;
    }
    if (address?.zoneId) {
      payload.recipient_zone = address.zoneId;
    }
    if (address?.areaId) {
      payload.recipient_area = address.areaId;
    }
    // Secondary contact: the order's staff-entered secondaryPhone wins;
    // otherwise keep the legacy shippingAddress.phone fallback.
    const secondaryPhone =
      this.normalizePhone(order.secondaryPhone) ||
      (address?.phone && address.phone !== phone
        ? this.normalizePhone(address.phone as string)
        : null);
    if (secondaryPhone) {
      payload.recipient_secondary_phone = secondaryPhone;
    }
    return payload;
  }

  private async dispatchPathao(creds: any, base: string, order: any) {
    const clientId = creds.clientId || creds.credentials?.['clientId'];
    const clientSecret =
      creds.clientSecret || creds.credentials?.['clientSecret'];
    const username = creds.username || creds.credentials?.['username'];
    const password = creds.password || creds.credentials?.['password'];
    if (!clientId || !clientSecret || !username || !password)
      throw new BadRequestException('Pathao credentials not configured');

    const storeId = creds.storeId || creds.credentials?.['storeId'] || '1';
    const address = order.shippingAddress as Record<string, unknown> | null;
    const phone = this.normalizePhone(orderRecipientPhone(order));
    const total = this.getCollectableAmount(order);

    // Fix 5a: courier-safe name (Mx. prefix / truncate); stored order kept.
    const { sent: safeName, raw: rawName } = this.resolveCourierName(
      order,
      'pathao',
      'recipient_name',
    );

    const payload = this.buildPathaoOrderPayload(order, storeId);

    // Fix 5: `res.ok` is checked BEFORE parsing — error bodies are read as
    // FULL text and parsed into the Pathao error envelope
    // `{message, type, code}` (+ field `errors` when present) instead of
    // throwing a raw SyntaxError inside the retry loop. Retry ONLY
    // 5xx/network with exponential backoff; NEVER 4xx.
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      let token: string;
      try {
        token = await this.getPathaoToken(
          base,
          clientId,
          clientSecret,
          username,
          password,
        );
      } catch (tokErr: unknown) {
        if (tokErr instanceof CourierDispatchError) throw tokErr;
        // Token-endpoint failure (usually network) — bounded retries only,
        // never an unbounded loop.
        lastError =
          tokErr instanceof Error ? tokErr : new Error(String(tokErr));
        this.logger.warn(
          `Pathao dispatch attempt ${attempt}/${maxRetries} failed (token): ${lastError.message}`,
        );
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt)));
        }
        continue;
      }

      let res: Response;
      try {
        res = await this.fetchWithTimeout(
          `${base}/aladdin/api/v1/orders`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
          },
        );
      } catch (netErr: unknown) {
        lastError = netErr instanceof Error ? netErr : new Error(String(netErr));
        this.logger.warn(
          `Pathao dispatch attempt ${attempt}/${maxRetries} failed (network): ${lastError.message}`,
        );
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt)));
        }
        continue;
      }

      const rawBody = await res.text().catch(() => '');
      const data = parseJsonBody(rawBody);

      if (!res.ok) {
        if (isRetryableStatus(res.status)) {
          lastError = new Error(
            `Pathao API error (HTTP ${res.status}): ${redactSecrets(rawBody).slice(0, 500) || '(empty response body)'}`,
          );
          this.logger.warn(
            `Pathao dispatch attempt ${attempt}/${maxRetries} failed (retryable HTTP ${res.status}): ${lastError.message}`,
          );
          if (attempt < maxRetries) {
            await new Promise((resolve) =>
              setTimeout(resolve, backoffMs(attempt)),
            );
          }
          continue;
        }
        throw await this.permanentPathaoError(res.status, rawBody, data, order, payload);
      }

      if (data === null) {
        lastError = new BadRequestException(
          `Pathao API returned non-JSON (HTTP ${res.status}): ${(redactSecrets(rawBody) || '(empty response body)').slice(0, 500)}`,
        );
        this.logger.warn(
          `Pathao dispatch attempt ${attempt}/${maxRetries} failed (non-JSON 2xx): ${lastError.message}`,
        );
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt)));
        }
        continue;
      }
        if (data['data']?.['consignment_id']) {
          const cId = String(
            (data['data'] as Record<string, unknown>)['consignment_id'],
          );
          const trackingUrl = `https://merchant.pathao.com/tracking?consignment_id=${encodeURIComponent(cId)}`;
          try {
            await this.prisma.order.update({
              where: { id: order.id },
              data: { courierService: 'pathao', courierConsignmentId: cId },
            });
            await this.prisma.dispatch.upsert({
              where: {
                courier_consignmentId: { courier: 'pathao', consignmentId: cId },
              },
              update: { trackingCode: cId, trackingUrl, status: 'DISPATCHED' },
              create: {
                orderId: order.id,
                courier: 'pathao',
                consignmentId: cId,
                trackingCode: cId,
                trackingUrl,
                status: 'DISPATCHED',
                // Persist the amount actually sent as amount_to_collect
                // (Feature A). Persist-only — the calc itself is untouched.
                courierAmount: total,
                // Fix 5a: dispatch record stores the sent name (transformed only).
                ...(this.courierNameNote(safeName, rawName)
                  ? {
                      notes: `courier name sent as '${safeName}'`,
                    }
                  : {}),
              },
            });
            await this.noteCourierNameTransform(
              order.id,
              'pathao',
              safeName,
              rawName,
            );
          } catch (dbErr) {
            this.logger.error(`Pathao dispatch DB save failed: ${(dbErr as Error).message}`);
          }
          await this.logDispatch({
            orderId: order.id,
            courier: 'pathao',
            status: 'success',
            consignmentId: cId,
            trackingCode: cId,
            requestPayload: payload,
            responsePayload: data,
          });
          return { consignmentId: cId, trackingCode: cId };
        }
        // Fix 5: business-level rejection (HTTP 200 without a consignment) is
        // permanent — the envelope names the exact field+rule.
        throw await this.permanentPathaoError(res.status, rawBody, data, order, payload);
    }

    const exhausted = new CourierDispatchError({
      courier: 'pathao',
      status: 0,
      message:
        lastError instanceof CourierDispatchError
          ? lastError.message
          : `Pathao: ${lastError?.message || 'dispatch failed after retries'} (retried ${maxRetries} attempts)`,
      errors:
        lastError instanceof CourierDispatchError
          ? lastError.errors
          : undefined,
      orderId: order.id,
    });
    await this.logDispatch({
      orderId: order.id,
      courier: 'pathao',
      status: 'failed',
      message: exhausted.message,
      requestPayload: payload,
    });
    await this.noteDispatchFailure(order.id, 'pathao', exhausted.message);
    throw exhausted;
  }

  /**
   * Fix 5: permanent (never-retried) Pathao 4xx / business rejection. Parses
   * the doc's error envelope `{message, type, code}` plus a field-level
   * `errors` object when the courier sends one, into the shared error shape.
   */
  private async permanentPathaoError(
    status: number,
    rawBody: string,
    data: Record<string, unknown> | null,
    order: any,
    payload: unknown,
  ): Promise<CourierDispatchError> {
    const envelope = data
      ? String(data['message'] || 'Pathao dispatch failed')
      : `Pathao API error (HTTP ${status}): ${(redactSecrets(rawBody) || '(empty response body)').slice(0, 500)}`;
    const fieldErrors =
      data &&
      typeof data['errors'] === 'object' &&
      data['errors'] !== null
        ? (data['errors'] as Record<string, unknown>)
        : undefined;
    const type = data?.['type'];
    const code = data?.['code'];
    const envelopeRef =
      type !== undefined || code !== undefined
        ? ` (type: ${String(type ?? '?')}, code: ${String(code ?? '?')})`
        : '';
    const message =
      `Pathao: ${envelope}` +
      (fieldErrors ? ` — ${fieldSegments(fieldErrors)}` : '') +
      envelopeRef +
      authHint('pathao', status);
    const errors: Record<string, unknown> | undefined = fieldErrors
      ? { ...fieldErrors }
      : type !== undefined || code !== undefined
        ? {
            ...(type !== undefined ? { type } : {}),
            ...(code !== undefined ? { code } : {}),
          }
        : undefined;
    const failure = new CourierDispatchError({
      courier: 'pathao',
      status,
      message,
      errors,
      orderId: order.id,
    });
    await this.logDispatch({
      orderId: order.id,
      courier: 'pathao',
      status: 'failed',
      message: failure.message,
      requestPayload: payload,
      responsePayload: responsePayloadFor(rawBody, data),
    });
    await this.noteDispatchFailure(order.id, 'pathao', failure.message);
    return failure;
  }

  private async getPathaoToken(
    base: string,
    clientId: string,
    clientSecret: string,
    username: string,
    password: string,
  ): Promise<string> {
    return this.tokenStore.getAccessToken({
      courier: 'pathao',
      baseUrl: base,
      clientId,
      clientSecret,
      username,
      password,
    });
  }

  /**
   * Task 9(a): Pathao bulk create — POST /aladdin/api/v1/orders/bulk.
   * Doc (Pathao Courier API Documenttation.md, "Create a Bulk Order"):
   * request `{orders: [<single-order-object>...]}` (same shape as the
   * single-order builder — reused verbatim); success is HTTP 202
   * `{type:'success', code:202, data:true}` with message "Your bulk order
   * creation request is accepted, please wait some time to complete order
   * creation." — i.e. ACCEPTED/async, NOT created. There are NO per-entry
   * consignment ids in the response, so one accepted-state Dispatch row is
   * persisted per entry (NULL consignment, merchant_order_id in notes) and
   * Order.courierService is stamped — the async order.created webhooks then
   * complete the visible rows via the merchant_order_id → displayId fallback
   * (fillManualDispatchIdentifiers, no duplicate row). Each input order is
   * reported as `{ok:true, accepted:true, merchant_order_id, displayId,
   * message:'accepted, processing — ...'}`; staff track completion in the
   * dispatch list ("Pending webhook" until the consignment lands), or verify
   * a known consignment via getPathaoOrderInfo.
   * Retry ONLY 5xx/network with backoff; NEVER 4xx.
   */
  async bulkCreatePathaoOrders(orders: any[]): Promise<{
    accepted: boolean;
    message: string;
    count: number;
    results: {
      id: string;
      merchant_order_id: string;
      displayId?: string;
      ok: boolean;
      accepted: boolean;
      message: string;
    }[];
  }> {
    if (!orders || orders.length === 0)
      throw new BadRequestException('No orders to dispatch');
    const creds = await this.getCreds('pathao');
    const mode = creds?.mode || 'production';
    const base =
      BASE_URLS['pathao']?.[mode] || BASE_URLS['pathao']?.['production'] || '';
    const clientId = creds.clientId || (creds.credentials as any)?.['clientId'];
    const clientSecret =
      creds.clientSecret || (creds.credentials as any)?.['clientSecret'];
    const username = creds.username || (creds.credentials as any)?.['username'];
    const password = creds.password || (creds.credentials as any)?.['password'];
    if (!clientId || !clientSecret || !username || !password)
      throw new BadRequestException('Pathao credentials not configured');
    const storeId =
      creds.storeId || (creds.credentials as any)?.['storeId'] || '1';

    const entries = orders.map((o) => this.buildPathaoOrderPayload(o, storeId));
    const body = JSON.stringify({ orders: entries });

    const maxRetries = 3;
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      let token: string;
      try {
        token = await this.getPathaoToken(base, clientId, clientSecret, username, password);
      } catch (tokErr: unknown) {
        lastError = tokErr instanceof Error ? tokErr : new Error(String(tokErr));
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, backoffMs(attempt)));
        }
        continue;
      }
      let res: Response;
      try {
        res = await this.fetchWithTimeout(`${base}/aladdin/api/v1/orders/bulk`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=UTF-8',
            Authorization: `Bearer ${token}`,
          },
          body,
        });
      } catch (netErr: unknown) {
        lastError = netErr instanceof Error ? netErr : new Error(String(netErr));
        this.logger.warn(
          `Pathao bulk dispatch attempt ${attempt}/${maxRetries} failed (network): ${lastError.message}`,
        );
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, backoffMs(attempt)));
        }
        continue;
      }
      const rawBody = await res.text().catch(() => '');
      const data = parseJsonBody(rawBody);
      if (!res.ok) {
        if (isRetryableStatus(res.status)) {
          lastError = new Error(
            `Pathao bulk API error (HTTP ${res.status}): ${redactSecrets(rawBody).slice(0, 500) || '(empty response body)'}`,
          );
          this.logger.warn(
            `Pathao bulk dispatch attempt ${attempt}/${maxRetries} failed (retryable HTTP ${res.status}): ${lastError.message}`,
          );
          if (attempt < maxRetries) {
            await new Promise((r) => setTimeout(r, backoffMs(attempt)));
          }
          continue;
        }
        const msg = data
          ? `Pathao bulk: ${String(data['message'] || 'bulk dispatch failed')}`
          : `Pathao bulk API error (HTTP ${res.status}): ${(redactSecrets(rawBody) || '(empty response body)').slice(0, 500)}`;
        throw new CourierDispatchError({
          courier: 'pathao',
          status: res.status,
          message: msg + authHint('pathao', res.status),
          errors:
            data && typeof data['errors'] === 'object' && data['errors'] !== null
              ? (data['errors'] as Record<string, unknown>)
              : undefined,
        });
      }
      if (data === null) {
        lastError = new Error(
          `Pathao bulk returned non-JSON (HTTP ${res.status}): ${(redactSecrets(rawBody) || '(empty response body)').slice(0, 500)}`,
        );
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, backoffMs(attempt)));
        }
        continue;
      }
      const accepted = data['data'] === true && (data['code'] === 202 || res.status === 202);
      if (!accepted) {
        throw new CourierDispatchError({
          courier: 'pathao',
          status: res.status,
          message: `Pathao bulk: ${String(data['message'] || 'bulk request not accepted')}`,
          errors:
            typeof data['errors'] === 'object' && data['errors'] !== null
              ? (data['errors'] as Record<string, unknown>)
              : undefined,
        });
      }
      const message =
        'Pathao bulk accepted, processing — results arrive automatically; check the dispatch list.';
      try {
        // Review MAJOR fix: the 202 carries NO per-order ids, so persist one
        // accepted-state Dispatch row per entry (manual-row pattern: NULL
        // consignment, merchant ref in notes) and stamp Order.courierService.
        // Without these the async webhooks complete nothing visible (silent
        // stuck-accepted) and the merchant_order_id → displayId fallback in
        // findPathaoOrder cannot resolve. Retries skip orders that already
        // own a live row, so a re-sent bulk never duplicates.
        const live = await this.prisma.dispatch.findMany({
          where: {
            orderId: { in: orders.map((o: any) => o.id) },
            courier: 'pathao' as any,
            status: { not: 'CANCELLED' },
          },
          select: { orderId: true },
        });
        const liveIds = new Set((live || []).map((r: any) => r.orderId));
        for (let i = 0; i < orders.length; i++) {
          const o = orders[i];
          await this.logDispatch({
            orderId: o.id,
            courier: 'pathao',
            status: 'accepted',
            message,
            requestPayload: { orders: entries },
            responsePayload: data,
          });
          if (liveIds.has(o.id)) continue;
          const merchantRef =
            o.displayId || entries[i]?.['merchant_order_id'] || o.id;
          // Fix 5a: sent-name audit for this entry (recomputed pure; the
          // entries above already carry .sent via buildPathaoOrderPayload).
          const bulkSent = courierSafeRecipientName(o, 'pathao');
          const bulkRaw = orderRecipientRawName(o);
          const bulkNameNote = this.courierNameNote(bulkSent, bulkRaw);
          await this.prisma.dispatch.create({
            data: {
              orderId: o.id,
              courier: 'pathao' as any,
              consignmentId: null,
              status: 'DISPATCHED',
              // Synthetic running state (never a courier verbatim label):
              // marks the row as bulk-accepted/awaiting-webhook. The sync
              // mapper yields null for it, so no workflow change is forced.
              courierStatus: 'bulk_accepted',
              notes: `bulk accepted — merchant_order_id ${merchantRef}; results arrive automatically, check the dispatch list${bulkNameNote ? `; ${bulkNameNote}` : ''}`,
              // Persist the amount actually sent as amount_to_collect
              // (Feature A, persist-only — the calc itself is untouched).
              ...(typeof entries[i]?.['amount_to_collect'] === 'number'
                ? { courierAmount: entries[i]['amount_to_collect'] as number }
                : {}),
            },
          });
          // Fix 5a: timeline notes the transformation (stored order keeps
          // raw). No-op when the name needed no transform.
          await this.noteCourierNameTransform(o.id, 'pathao', bulkSent, bulkRaw);
        }
        // Identifier-less stamp (manual-row parity): lets the
        // merchant_order_id → displayId webhook fallback resolve. The guard
        // never steals an order already claimed by a consignment/courier.
        await (this.prisma.order as any).updateMany({
          where: {
            id: { in: orders.map((o: any) => o.id) },
            courierConsignmentId: null,
            courierService: null,
          },
          data: { courierService: 'pathao' },
        });
      } catch (dbErr) {
        this.logger.error(`Pathao bulk DB log failed: ${(dbErr as Error).message}`);
      }
      return {
        accepted: true,
        message,
        count: orders.length,
        results: orders.map((o: any, i: number) => ({
          id: o.id,
          merchant_order_id: (o.displayId ||
            entries[i]?.['merchant_order_id'] ||
            o.id) as string,
          displayId: o.displayId || undefined,
          ok: true,
          accepted: true,
          message: `accepted, processing — ${o.displayId || o.id}; results arrive automatically, check the dispatch list`,
        })),
      };
    }
    throw new CourierDispatchError({
      courier: 'pathao',
      status: 0,
      message: `Pathao bulk: ${lastError?.message || 'dispatch failed after retries'} (retried ${maxRetries} attempts)`,
    });
  }

  /**
   * Task 9(a): Pathao order short-info verification —
   * GET /aladdin/api/v1/orders/{consignment_id}/info (doc "Get Order Short
   * Info"). Used to verify bulk-accepted entries after the async completion
   * window (bulk returns no consignment ids immediately).
   */
  async getPathaoOrderInfo(consignmentId: string): Promise<Record<string, unknown>> {
    const id = String(consignmentId || '').trim();
    if (!id) throw new BadRequestException('consignmentId is required');
    const creds = await this.getCreds('pathao');
    const mode = creds?.mode || 'production';
    const base =
      BASE_URLS['pathao']?.[mode] || BASE_URLS['pathao']?.['production'] || '';
    const clientId = creds.clientId || (creds.credentials as any)?.['clientId'];
    const clientSecret =
      creds.clientSecret || (creds.credentials as any)?.['clientSecret'];
    const username = creds.username || (creds.credentials as any)?.['username'];
    const password = creds.password || (creds.credentials as any)?.['password'];
    if (!clientId || !clientSecret || !username || !password)
      throw new BadRequestException('Pathao credentials not configured');
    const token = await this.getPathaoToken(base, clientId, clientSecret, username, password);
    const data = await this.jsonFetch(
      `${base}/aladdin/api/v1/orders/${encodeURIComponent(id)}/info`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const inner = data['data'];
    if (inner && typeof inner === 'object') return inner as Record<string, unknown>;
    return data;
  }

  /**
   * Pathao cancel — POST /aladdin/api/v1/orders/{consignment_id}/cancel.
   *
   * The local Pathao documentation set covers creation/info but not cancel;
   * the endpoint is the one used by Pathao merchant integrations
   * (codeboxr/pathao-courier, kejubayer/pathao-api-integration both POST it
   * with an empty body). It cancels the order/pickup BEFORE collection —
   * after the parcel is picked up Pathao refuses, and the dispatch-cancel
   * eligibility gate already blocks every post-pickup dispatch. Pathao's
   * `{type, code, message, data}` envelope is returned verbatim for the
   * dispatch audit; an error envelope is a rejection even on HTTP 200.
   */
  async cancelPathaoOrder(consignmentId: string, _reason: string) {
    const id = String(consignmentId || '').trim();
    if (!id) throw new BadRequestException('consignmentId is required');
    const creds = await this.getCreds('pathao');
    const mode = creds?.mode || 'production';
    const base =
      BASE_URLS['pathao']?.[mode] || BASE_URLS['pathao']?.['production'] || '';
    const clientId = creds.clientId || (creds.credentials as any)?.['clientId'];
    const clientSecret =
      creds.clientSecret || (creds.credentials as any)?.['clientSecret'];
    const username = creds.username || (creds.credentials as any)?.['username'];
    const password = creds.password || (creds.credentials as any)?.['password'];
    if (!clientId || !clientSecret || !username || !password)
      throw new BadRequestException('Pathao credentials not configured');
    const token = await this.getPathaoToken(
      base,
      clientId,
      clientSecret,
      username,
      password,
    );
    const data = await this.jsonFetch(
      `${base}/aladdin/api/v1/orders/${encodeURIComponent(id)}/cancel`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      },
    );
    if (
      data['type'] === 'error' ||
      (typeof data['code'] === 'number' && data['code'] >= 400)
    ) {
      throw new BadRequestException(
        `Pathao cancel rejected: ${String(data['message'] || 'request not accepted')}`,
      );
    }
    return data;
  }

  private async dispatchRedx(creds: any, base: string, order: any) {
    const apiToken = creds.apiKey || creds.credentials?.['apiKey'];
    if (!apiToken)
      throw new BadRequestException('RedX API token not configured');

    // D-A: the order snapshot is the recipient source of truth — the linked
    // CustomerProfile is never read here (it may hold pre-correction values).
    const phone = this.normalizePhone(orderRecipientPhone(order));
    const total = Number(order.total);
    const address = order.shippingAddress as Record<string, unknown> | null;
    // Hoisted single call — the payload and the persisted row share one
    // value. The getCollectableAmount calc itself is untouched.
    const collectable = this.getCollectableAmount(order);

    const district = (address?.district as string) || 'Dhaka';
    // Owner Q11 (2026-10-23): NO silent area 1. The old `|| 1` fallback
    // booked every RedX parcel into area 1 (Malibag per the doc sample)
    // whenever the order carried no area — misrouted parcels with no
    // signal. The RedX doc marks delivery_area_id required; a missing or
    // invalid value now fails the dispatch loudly with the field named,
    // exactly like the charge-preview guard. The value must be present on
    // the order's shipping address (deliveryAreaId / areaId).
    const deliveryAreaId = Number(address?.deliveryAreaId ?? address?.areaId);
    if (!Number.isFinite(deliveryAreaId) || deliveryAreaId <= 0) {
      throw new CourierDispatchError({
        courier: 'redx',
        status: 0,
        message:
          `RedX: field 'delivery_area_id' is required — order ${order.displayId ?? order.id} ` +
          'has no RedX delivery area on its shipping address, and no default area is assumed.',
        errors: { delivery_area_id: ['required'] },
        orderId: order.id,
      });
    }

    // Fix 5a: courier-safe name (Mx. prefix / truncate); stored order kept.
    const { sent: safeName, raw: rawName } = this.resolveCourierName(
      order,
      'redx',
      'customer_name',
    );

    const itemDescription =
      order.items
        ?.map((item: any) => item.product?.name || 'Product')
        .join(', ') || 'Product';

    const payload: Record<string, unknown> = {
      // Task 6 doc-literal payload (REDx API and Webhook Documentation.md,
      // Create Parcel table + sample). Choices, one per ambiguity:
      // - parcel_weight: doc table says STRING grams (sample shows a bare
      //   {{parcel_weight}} placeholder) → send String grams. Renamed from
      //   the non-doc key parcel_weight_in_gram.
      // - value: doc table says STRING (sample bare {{value}}) → String.
      // - cash_collection_amount: doc table says STRING → String.
      // - merchant_order_amount: NOT in doc → DROPPED (value + cash
      //   collection already carry declared value and COD).
      // - is_closed_box: NOT in the doc table but IS in the doc sample →
      //   KEPT (sample-literal).
      // - parcel_details_json: doc table prose says "object" but the sample
      //   sends an ARRAY of {name, category, value} and the Parcel Details
      //   Object table describes item objects → ARRAY (sample-literal);
      //   item value stays INTEGER per the detail table.
      // - pickup_store_id: doc OPTIONAL string; no config field exists, so
      //   it is sent only when set in creds.credentials.pickupStoreId.
      // - type: doc OPTIONAL, reverse-shipments only → omitted (we never
      //   book reverse). merchant_invoice_id=displayId kept (doc optional).
      // Task 10: strip `{ } ; < > $` + pre-check lengths (RedX doc states no
      //   field lengths → Steadfast 100/40/490/480 applied as safe default).
      merchant_invoice_id: sanitizeCourierText(
        String(order.displayId),
        COURIER_FIELD_LIMITS.invoice,
      ),
      customer_name: sanitizeCourierText(safeName, COURIER_FIELD_LIMITS.name),
      customer_phone: sanitizeCourierText(phone, COURIER_FIELD_LIMITS.phone),
      delivery_area: district,
      delivery_area_id: deliveryAreaId,
      customer_address: sanitizeCourierText(
        formatCourierAddress(address) ?? 'N/A',
        courierAddressLimit('redx'),
      ),
      cash_collection_amount: String(collectable),
      // Owner Q12: product weightGram wins; 500 g fallback (pre-Q12 value).
      parcel_weight: String(this.resolveOrderWeightGrams(order)),
      instruction: order.officeNotes
        ? sanitizeCourierText(String(order.officeNotes), COURIER_FIELD_LIMITS.note)
        : '',
      value: String(total),
      is_closed_box: false,
      parcel_details_json: order.items?.map((item: any) => ({
        name: item.product?.name || 'Product',
        category: 'Apparel',
        value: Number(item.price || 0),
      })) || [{ name: itemDescription, category: 'Apparel', value: total }],
      // Doc-optional: include only when the merchant configured a store.
      ...(redxPickupStoreId(creds) !== undefined
        ? { pickup_store_id: redxPickupStoreId(creds) }
        : {}),
    };

    // Fix 5: FULL body text is read before parsing (never `res.json()` blind —
    // an error body threw a raw SyntaxError inside the retry loop). Retry
    // ONLY 5xx/network with exponential backoff; NEVER 4xx.
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      let res: Response;
      try {
        res = await this.fetchWithTimeout(`${base}/parcel`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'API-ACCESS-TOKEN': `Bearer ${apiToken}`,
          },
          body: JSON.stringify(payload),
        });
      } catch (netErr: unknown) {
        lastError = netErr instanceof Error ? netErr : new Error(String(netErr));
        this.logger.warn(
          `RedX dispatch attempt ${attempt}/${maxRetries} failed (network): ${lastError.message}`,
        );
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt)));
        }
        continue;
      }

      const rawBody = await res.text().catch(() => '');
      const data = parseJsonBody(rawBody);

      if (!res.ok) {
        if (isRetryableStatus(res.status)) {
          lastError = new Error(
            `RedX API error (HTTP ${res.status}): ${redactSecrets(rawBody).slice(0, 500) || '(empty response body)'}`,
          );
          this.logger.warn(
            `RedX dispatch attempt ${attempt}/${maxRetries} failed (retryable HTTP ${res.status}): ${lastError.message}`,
          );
          if (attempt < maxRetries) {
            await new Promise((resolve) =>
              setTimeout(resolve, backoffMs(attempt)),
            );
          }
          continue;
        }
        throw await this.permanentRedxError(res.status, rawBody, data, order, payload);
      }

      if (data === null) {
        lastError = new BadRequestException(
          `RedX API returned non-JSON (HTTP ${res.status}): ${(redactSecrets(rawBody) || '(empty response body)').slice(0, 500)}`,
        );
        this.logger.warn(
          `RedX dispatch attempt ${attempt}/${maxRetries} failed (non-JSON 2xx): ${lastError.message}`,
        );
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt)));
        }
        continue;
      }

        // Task 6 tolerant parse: doc sample returns TOP-LEVEL {tracking_id};
        // older integrations observed nested data.tracking_id — accept either,
        // doc shape first.
        const nested =
          data['data'] && typeof data['data'] === 'object'
            ? (data['data'] as Record<string, unknown>)['tracking_id']
            : undefined;
        const rawTrackingId = data['tracking_id'] ?? nested;
        if (typeof rawTrackingId === 'string' && rawTrackingId.trim() !== '') {
          const trackingCode = rawTrackingId;
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
          await this.prisma.dispatch.create({
            data: {
              orderId: order.id,
              courier: 'redx',
              consignmentId: trackingCode,
              status: 'DISPATCHED',
              // Persist the amount actually sent as cash_collection_amount
              // (Feature A). Persist-only — the calc itself is untouched.
              courierAmount: collectable,
              // Fix 5a: dispatch record stores the sent name (transformed only).
              ...(this.courierNameNote(safeName, rawName)
                ? {
                    notes: `courier name sent as '${safeName}'`,
                  }
                : {}),
            },
          });
          const currentOrder = await this.prisma.order.findUnique({
            where: { id: order.id },
            select: { timeline: true },
          });
          const timeline = ((currentOrder?.timeline as unknown[]) || []);
          timeline.push({
            type: 'courier',
            courier: 'redx',
            status: 'DISPATCHED',
            timestamp: new Date().toISOString(),
            note: 'redx: Parcel created',
          });
          // Fix 5a: timeline notes the transformation (stored order keeps raw).
          const nameNote = this.courierNameNote(safeName, rawName);
          if (nameNote) {
            timeline.push({
              type: 'courier',
              courier: 'redx',
              status: 'DISPATCHED',
              timestamp: new Date().toISOString(),
              note: nameNote,
            });
          }
          await this.prisma.order.update({
            where: { id: order.id },
            data: { timeline: timeline as any },
          });
          return { trackingCode };
        }
        // Fix 5: business-level rejection (HTTP 200 without a tracking_id) is
        // permanent — the envelope names the exact field+rule.
        throw await this.permanentRedxError(res.status, rawBody, data, order, payload);
    }

    const exhausted = new CourierDispatchError({
      courier: 'redx',
      status: 0,
      message:
        lastError instanceof CourierDispatchError
          ? lastError.message
          : `RedX: ${lastError?.message || 'dispatch failed after retries'} (retried ${maxRetries} attempts)`,
      errors:
        lastError instanceof CourierDispatchError
          ? lastError.errors
          : undefined,
      orderId: order.id,
    });
    await this.logDispatch({
      orderId: order.id,
      courier: 'redx',
      status: 'failed',
      message: exhausted.message,
      requestPayload: payload,
    });
    await this.noteDispatchFailure(order.id, 'redx', exhausted.message);
    throw exhausted;
  }

  /**
   * Fix 5: permanent (never-retried) RedX 4xx / business rejection. Reads the
   * FULL body — `{message}` plus a field-level `errors` object when the
   * courier sends one — into the shared error shape.
   */
  private async permanentRedxError(
    status: number,
    rawBody: string,
    data: Record<string, unknown> | null,
    order: any,
    payload: unknown,
  ): Promise<CourierDispatchError> {
    const envelope = data
      ? String(data['message'] || data['error'] || 'RedX dispatch failed')
      : `RedX API error (HTTP ${status}): ${(redactSecrets(rawBody) || '(empty response body)').slice(0, 500)}`;
    const fieldErrors =
      data && typeof data['errors'] === 'object' && data['errors'] !== null
        ? (data['errors'] as Record<string, unknown>)
        : undefined;
    const message =
      `RedX: ${envelope}` +
      (fieldErrors ? ` — ${fieldSegments(fieldErrors)}` : '') +
      authHint('redx', status);
    const failure = new CourierDispatchError({
      courier: 'redx',
      status,
      message,
      errors: fieldErrors ? { ...fieldErrors } : undefined,
      orderId: order.id,
    });
    await this.logDispatch({
      orderId: order.id,
      courier: 'redx',
      status: 'failed',
      message: failure.message,
      requestPayload: payload,
      responsePayload: responsePayloadFor(rawBody, data),
    });
    await this.noteDispatchFailure(order.id, 'redx', failure.message);
    return failure;
  }

  private async dispatchCarrybee(creds: any, base: string, order: any) {
    const headers = this.carrybeeHeaders(creds);

    // Task 7 (owner-locked): store_id is REQUIRED — fail fast with a shaped
    // field error (Fix 5 shape) instead of letting the API 422.
    const storeId = creds.storeId || creds.credentials?.['storeId'];
    if (!storeId || String(storeId).trim() === '') {
      throw new CourierDispatchError({
        courier: 'carrybee',
        status: 0,
        message: `Carrybee: field 'store_id' is required — configure the Store ID in courier settings`,
        errors: { store_id: ['required'] },
        orderId: order.id,
      });
    }

    // D-A: the order snapshot is the recipient source of truth — the linked
    // CustomerProfile is never read here (it may hold pre-correction values).
    const phone = this.normalizePhone(orderRecipientPhone(order));
    const address = order.shippingAddress as Record<string, unknown> | null;
    // Fix 5a: Carrybee-exempt safe name (verbatim, truncated to 99, never Mx.).
    const { sent: safeName, raw: rawName } = this.resolveCourierName(
      order,
      'carrybee',
      'recipient_name',
    );

    // Task 7: v2 dispatch payload, doc-literal field names
    // (CarryBee API Docs.md, POST /api/v2/orders). delivery_type 1=Normal,
    // product_type 1=Parcel (doc defaults; no per-order override UI exists).
    // `recipient_secendary_phone` keeps the doc's spelling verbatim.
    // Pre-flight: collectable_amount is capped at 100000 by the courier —
    // NEVER silently clamp (a 150k COD order reporting success at 100k is
    // money loss). Reject with a shaped field error instead.
    const collectable = Math.round(this.getCollectableAmount(order));
    if (collectable > 100000) {
      throw new CourierDispatchError({
        courier: 'carrybee',
        status: 0,
        message: `Carrybee: field 'collectable_amount' exceeds maximum 100000 — order value ${collectable} cannot be collected in one shipment`,
        errors: { collectable_amount: ['max 100000'] },
        orderId: order.id,
      });
    }
    // Pre-flight: item_quantity is capped at 200 by the courier — NEVER
    // silently clamp (dropping lines mis-states the parcel). Reject instead.
    const lineCount = order.items?.length || 1;
    if (lineCount > 200) {
      throw new CourierDispatchError({
        courier: 'carrybee',
        status: 0,
        message: `Carrybee: field 'item_quantity' exceeds maximum 200 — order has ${lineCount} lines`,
        errors: { item_quantity: ['max 200'] },
        orderId: order.id,
      });
    }
    const payload: Record<string, unknown> = {
      // Task 10: strip + pre-check (Carrybee doc: name 2–99 — safeName already
      // 99-cut; address 10–200 doc-verified via resolveCarrybeeAddress; invoice
      // /phone/note unstated → Steadfast 100/40/480 safe default, noted here).
      store_id: String(storeId),
      merchant_order_id: sanitizeCourierText(
        String(order.displayId),
        COURIER_FIELD_LIMITS.invoice,
      ),
      delivery_type: 1,
      product_type: 1,
      recipient_phone: sanitizeCourierText(phone, COURIER_FIELD_LIMITS.phone),
      recipient_name: sanitizeCourierText(safeName, 99),
      recipient_address: this.resolveCarrybeeAddress(order),
      item_weight: this.resolveCarrybeeWeightGrams(order),
      item_quantity: Math.max(1, lineCount),
      collectable_amount: Math.max(0, collectable),
    };
    // Secondary contact: the order's staff-entered secondaryPhone wins;
    // otherwise keep the legacy shippingAddress.phone fallback.
    const secondaryPhone =
      this.normalizePhone(order.secondaryPhone) ||
      (address?.phone && address.phone !== phone
        ? this.normalizePhone(address.phone as string)
        : null);
    if (secondaryPhone) {
      payload.recipient_secendary_phone = secondaryPhone;
    }
    // Guard falsy first: Number('') is 0 (finite) — an empty city/zone/area
    // must be omitted, never sent as 0.
    const cityRaw = address?.cityId;
    if (cityRaw !== undefined && cityRaw !== null && String(cityRaw).trim() !== '') {
      const cityId = Number(cityRaw);
      if (Number.isFinite(cityId)) payload.city_id = cityId;
    }
    const zoneRaw = address?.zoneId;
    if (zoneRaw !== undefined && zoneRaw !== null && String(zoneRaw).trim() !== '') {
      const zoneId = Number(zoneRaw);
      if (Number.isFinite(zoneId)) payload.zone_id = zoneId;
    }
    const areaRaw = address?.areaId;
    if (areaRaw !== undefined && areaRaw !== null && String(areaRaw).trim() !== '') {
      const areaId = Number(areaRaw);
      if (Number.isFinite(areaId)) payload.area_id = areaId;
    }
    if (order.officeNotes) {
      // Task 10: strip applied; 254 kept (Carrybee-side bound, noted).
      payload.special_instruction = sanitizeCourierText(String(order.officeNotes), 254);
    }
    const itemDescription =
      order.items
        ?.map((item: any) => item.product?.name || 'Product')
        .join(', ') || undefined;
    if (itemDescription) {
      payload.product_description = sanitizeCourierText(itemDescription, 254);
    }

    // Fix 5: same discipline as the other couriers — FULL body text first,
    // retry ONLY 5xx/network with exponential backoff, NEVER 4xx. The doc's
    // error shape is `{error, message}` + 422 `causes`
    // (`{field: [{type, attribute}]}`) → field-level `errors`.
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      let res: Response;
      try {
        res = await this.fetchWithTimeout(`${base}/api/v2/orders`, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });
      } catch (netErr: unknown) {
        lastError = netErr instanceof Error ? netErr : new Error(String(netErr));
        this.logger.warn(
          `Carrybee dispatch attempt ${attempt}/${maxRetries} failed (network): ${lastError.message}`,
        );
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt)));
        }
        continue;
      }

      const rawBody = await res.text().catch(() => '');
      const data = parseJsonBody(rawBody);

      if (!res.ok) {
        if (isRetryableStatus(res.status)) {
          lastError = new Error(
            `Carrybee API error (HTTP ${res.status}): ${redactSecrets(rawBody).slice(0, 500) || '(empty response body)'}`,
          );
          this.logger.warn(
            `Carrybee dispatch attempt ${attempt}/${maxRetries} failed (retryable HTTP ${res.status}): ${lastError.message}`,
          );
          if (attempt < maxRetries) {
            await new Promise((resolve) =>
              setTimeout(resolve, backoffMs(attempt)),
            );
          }
          continue;
        }
        throw await this.permanentCarrybeeError(res.status, rawBody, data, order, payload);
      }

      if (data === null) {
        lastError = new BadRequestException(
          `Carrybee API returned non-JSON (HTTP ${res.status}): ${(redactSecrets(rawBody) || '(empty response body)').slice(0, 500)}`,
        );
        this.logger.warn(
          `Carrybee dispatch attempt ${attempt}/${maxRetries} failed (non-JSON 2xx): ${lastError.message}`,
        );
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt)));
        }
        continue;
      }
      // Task 7: v2 success is 201 `{error:false,
      // data:{order:{consignment_id}}}` (any 2xx with that shape accepted).
      const orderNode =
        data && typeof data['data'] === 'object' && data['data'] !== null
          ? ((data['data'] as Record<string, unknown>)['order'] as
              | Record<string, unknown>
              | undefined)
          : undefined;
      if (data?.['error'] === false && orderNode?.['consignment_id']) {
        const cId = String(orderNode['consignment_id']);
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
        // Fix 5a: no Dispatch row exists on this path — the log payload above
        // stores the sent name; the timeline notes a transform (if any).
        await this.noteCourierNameTransform(
          order.id,
          'carrybee',
          safeName,
          rawName,
        );
        return { consignmentId: cId };
      }
      // Fix 5: business-level rejection (HTTP 200 with error:true) is
      // permanent — `causes` names the exact field+rule.
      throw await this.permanentCarrybeeError(res.status, rawBody, data, order, payload);
    }

    const exhausted = new CourierDispatchError({
      courier: 'carrybee',
      status: 0,
      message:
        lastError instanceof CourierDispatchError
          ? lastError.message
          : `Carrybee: ${lastError?.message || 'dispatch failed after retries'} (retried ${maxRetries} attempts)`,
      errors:
        lastError instanceof CourierDispatchError
          ? lastError.errors
          : undefined,
      orderId: order.id,
    });
    await this.logDispatch({
      orderId: order.id,
      courier: 'carrybee',
      status: 'failed',
      message: exhausted.message,
      requestPayload: payload,
    });
    await this.noteDispatchFailure(order.id, 'carrybee', exhausted.message);
    throw exhausted;
  }

  /**
   * Fix 5: permanent (never-retried) Carrybee 4xx / business rejection.
   * Parses the doc's `{error, message}` + 422 `causes`
   * (`{field: [{type, attribute}]}`) into the shared error shape.
   */
  private async permanentCarrybeeError(
    status: number,
    rawBody: string,
    data: Record<string, unknown> | null,
    order: any,
    payload: unknown,
  ): Promise<CourierDispatchError> {
    const envelope = data
      ? String(data['message'] || 'Carrybee dispatch failed')
      : `Carrybee API error (HTTP ${status}): ${(redactSecrets(rawBody) || '(empty response body)').slice(0, 500)}`;
    const causes =
      data && typeof data['causes'] === 'object' && data['causes'] !== null
        ? (data['causes'] as Record<string, unknown>)
        : undefined;
    const message =
      `Carrybee: ${envelope}` +
      (causes ? ` — ${fieldSegments(causes)}` : '') +
      authHint('carrybee', status);
    const failure = new CourierDispatchError({
      courier: 'carrybee',
      status,
      message,
      errors: causes ? { ...causes } : undefined,
      orderId: order.id,
    });
    await this.logDispatch({
      orderId: order.id,
      courier: 'carrybee',
      status: 'failed',
      message: failure.message,
      requestPayload: payload,
      responsePayload: responsePayloadFor(rawBody, data),
    });
    await this.noteDispatchFailure(order.id, 'carrybee', failure.message);
    return failure;
  }

  /**
   * Task 7: v2 auth headers for every Carrybee request (doc: Client-ID,
   * Client-Secret, Client-Context on ALL endpoints). The legacy `apiKey`
   * query-param style is dead — nothing reads creds.apiKey on this path.
   */
  private carrybeeHeaders(creds: any): Record<string, string> {
    const clientId = creds.clientId || creds.credentials?.['clientId'];
    const clientSecret =
      creds.clientSecret || creds.credentials?.['clientSecret'];
    const clientContext =
      creds.clientContext || creds.credentials?.['clientContext'] || 'merchant';
    if (!clientId || !clientSecret)
      throw new BadRequestException('Carrybee credentials not configured');
    return {
      'Content-Type': 'application/json',
      'Client-ID': String(clientId),
      'Client-Secret': String(clientSecret),
      'Client-Context': String(clientContext),
    };
  }

  /**
   * Task 7: `recipient_address` must be 10–200 chars. The shared formatter
   * can return a short string (e.g. district-only 'Dhaka' dedupes to 5
   * chars), so pad with wider components + 'Bangladesh' before sending
   * rather than eating a 422. Capped at 200.
   */
  private resolveCarrybeeAddress(order: any): string {
    const address = order.shippingAddress as Record<string, unknown> | null;
    let out = formatCourierAddress(address) ?? '';
    const included = (s: string) =>
      out.toLowerCase().includes(s.toLowerCase());
    const extras = [
      address?.district,
      address?.division,
      address?.country,
      'Bangladesh',
    ];
    for (const extra of extras) {
      if (out.length >= 10) break;
      if (typeof extra !== 'string' || !extra.trim()) continue;
      if (included(extra.trim())) continue;
      out = out ? `${out}, ${extra.trim()}` : extra.trim();
    }
    // Task 10: strip `{ } ; < > $` (200-cap kept — Carrybee doc-verified).
    return sanitizeCourierText(out, 200);
  }

  /**
   * Owner Q12 (2026-10-23): parcel weight resolution shared by every
   * courier that books by weight. An explicit per-order gram value wins;
   * otherwise the sum of per-product `Product.weightGram` × quantity over
   * the items (products with no weight set contribute nothing); when
   * nothing anywhere sets a weight, the courier fallback applies — the
   * pre-Q12 defaults (500 g RedX/Carrybee, 0.5 kg Pathao).
   */
  private resolveOrderWeightGrams(order: any, fallbackGrams = 500): number {
    const num = (v: unknown): number | null => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    let grams =
      num(order?.shippingWeightGram) ?? num(order?.totalWeightGram) ?? 0;
    if (!grams && Array.isArray(order?.items)) {
      for (const item of order.items) {
        const w = num(item?.weightGram) ?? num(item?.product?.weightGram);
        if (w) grams += w * (Number(item?.quantity) || 1);
      }
    }
    if (!grams) grams = fallbackGrams;
    return Math.round(grams);
  }

  /** Carrybee doc: `item_weight` REQUIRED, integer grams 1–25000. */
  private resolveCarrybeeWeightGrams(order: any): number {
    return Math.min(25000, Math.max(1, this.resolveOrderWeightGrams(order)));
  }

  /** Pathao doc: `item_weight` float kg, minimum 0.5, maximum 10. */
  private resolvePathaoWeightKg(order: any): number {
    const kg = this.resolveOrderWeightGrams(order) / 1000;
    return Math.min(10, Math.max(0.5, Math.round(kg * 100) / 100));
  }

  /**
   * Task 7: v2 order details — GET /api/v2/orders/{id}/details. Accepts the
   * Carrybee consignment ID or the merchant tracking ID (doc). Returns the
   * `data` object verbatim; `{error:true}` throws.
   */
  async getCarrybeeOrderDetails(consignmentId: string) {
    const creds = await this.getCreds('carrybee');
    const headers = this.carrybeeHeaders(creds);
    const base = await this.getBaseUrl('carrybee');
    const data = await this.jsonFetch(
      `${base}/api/v2/orders/${encodeURIComponent(consignmentId)}/details`,
      { headers },
    );
    if (data['error'] === true) {
      throw new BadRequestException(
        `Carrybee details rejected: ${String(data['message'] || 'request not accepted')}`,
      );
    }
    return data['data'] ?? data;
  }

  /**
   * Task 7: v2 cancel — POST /api/v2/orders/{id}/cancel +
   * `{cancellation_reason}` (required, <200 chars) → 202. `{error:true}`
   * throws; transport failures throw via jsonFetch.
   */
  async cancelCarrybeeOrder(consignmentId: string, reason: string) {
    const cancellation_reason = String(reason || '').trim();
    if (!cancellation_reason) {
      throw new BadRequestException(
        'Carrybee cancellation_reason is required',
      );
    }
    if (cancellation_reason.length >= 200) {
      throw new BadRequestException(
        'Carrybee cancellation_reason must be shorter than 200 chars',
      );
    }
    const creds = await this.getCreds('carrybee');
    const headers = this.carrybeeHeaders(creds);
    const base = await this.getBaseUrl('carrybee');
    const data = await this.jsonFetch(
      `${base}/api/v2/orders/${encodeURIComponent(consignmentId)}/cancel`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ cancellation_reason }),
      },
    );
    if (data['error'] === true) {
      throw new BadRequestException(
        `Carrybee cancel rejected: ${String(data['message'] || 'request not accepted')}`,
      );
    }
    return { success: true, message: data['message'] ?? 'Cancellation confirmed' };
  }

  async getSteadfastBalance(opts?: {
    credentialSetId?: string | null;
  }): Promise<{ current_balance: number }> {
    // Task 8: balance resolves the override set or the default (no record
    // context on a global read) — never the wrong profile silently.
    const { apiKey, secretKey } = await this.resolveSteadfastAuth({
      overrideSetId: opts?.credentialSetId,
    });
    if (!apiKey || !secretKey)
      throw new BadRequestException('Steadfast API key/secret not configured');

    const base = await this.getBaseUrl('steadfast');
    const data = await this.jsonFetch(`${base}/get_balance`, {
      method: 'GET',
      headers: {
        'Api-Key': apiKey,
        'Secret-Key': secretKey,
        'Content-Type': 'application/json',
      },
    });
    return { current_balance: Number(data['current_balance'] || 0) };
  }

  /**
   * Task 5 (owner-locked): Steadfast return-status read.
   * GET /status_with_return_status_by_cid/{id} — the ONLY endpoint that tells
   * whether a returned parcel is actually back with the merchant (doc:
   * "Use this one if you reconcile stock"). Feeds reconcileSteadfastReturn;
   * never called from the hot tracking path (status answers are cached
   * 60s server-side; reconcile is on-demand).
   */
  async getSteadfastReturnStatus(
    consignmentId: string,
    opts?: { credentialSetId?: string | null },
  ): Promise<{ deliveryStatus: string }> {
    // Task 8: return-status resolves the BOOKING set from the dispatch
    // record (override wins when given) — never the current default.
    const { apiKey, secretKey } = await this.resolveSteadfastAuth({
      overrideSetId: opts?.credentialSetId,
      consignmentId,
    });
    if (!apiKey || !secretKey)
      throw new BadRequestException('Steadfast API key/secret not configured');

    const base = await this.getBaseUrl('steadfast');
    const data = await this.jsonFetch(
      `${base}/status_with_return_status_by_cid/${encodeURIComponent(consignmentId)}`,
      {
        method: 'GET',
        headers: {
          'Api-Key': apiKey,
          'Secret-Key': secretKey,
          'Content-Type': 'application/json',
        },
      },
    );
    const deliveryStatus = String(data?.['delivery_status'] ?? '').trim();
    if (!deliveryStatus)
      throw new BadRequestException(
        'Steadfast return-status answer carried no delivery_status',
      );
    return { deliveryStatus };
  }

  async createSteadfastReturnRequest(params: {
    consignment_id?: string;
    invoice?: string;
    tracking_code?: string;
    reason?: string;
    credentialSetId?: string | null;
  }) {
    // Task 8: return-request resolves the booking set from the record when
    // the consignment is known (override wins when given).
    const { apiKey, secretKey } = await this.resolveSteadfastAuth({
      overrideSetId: params.credentialSetId,
      consignmentId: params.consignment_id,
    });
    if (!apiKey || !secretKey)
      throw new BadRequestException('Steadfast API key/secret not configured');

    const base = await this.getBaseUrl('steadfast');
    const payload: Record<string, unknown> = {};
    if (params.consignment_id) payload.consignment_id = params.consignment_id;
    if (params.invoice) payload.invoice = params.invoice;
    if (params.tracking_code) payload.tracking_code = params.tracking_code;
    if (params.reason) payload.reason = params.reason;

    return this.jsonFetch(`${base}/create_return_request`, {
      method: 'POST',
      headers: {
        'Api-Key': apiKey,
        'Secret-Key': secretKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  }

  async getSteadfastReturnRequest(
    id: string,
    opts?: { credentialSetId?: string | null },
  ) {
    const { apiKey, secretKey } = await this.resolveSteadfastAuth({
      overrideSetId: opts?.credentialSetId,
    });
    if (!apiKey || !secretKey)
      throw new BadRequestException('Steadfast API key/secret not configured');

    const base = await this.getBaseUrl('steadfast');
    return this.jsonFetch(`${base}/get_return_request/${id}`, {
      method: 'GET',
      headers: {
        'Api-Key': apiKey,
        'Secret-Key': secretKey,
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Task 9(b): paginated return-requests list. Doc (Steadfast API Docs.md,
   * "GET /get_return_requests — Your return requests, newest first, ten to a
   * page. Paginated: add `?page=2` for the next ten."): loop `?page=` until
   * an empty page and aggregate. `page` fetches ONE page (legacy callers);
   * default fetches ALL pages. The envelope shape is preserved (first page's
   * keys) with the list key replaced by the aggregate + `pages`.
   */
  async getSteadfastReturnRequests(opts?: {
    credentialSetId?: string | null;
    page?: number;
    all?: boolean;
  }) {
    const { apiKey, secretKey } = await this.resolveSteadfastAuth({
      overrideSetId: opts?.credentialSetId,
    });
    if (!apiKey || !secretKey)
      throw new BadRequestException('Steadfast API key/secret not configured');

    const base = await this.getBaseUrl('steadfast');
    const headers = {
      'Api-Key': apiKey,
      'Secret-Key': secretKey,
      'Content-Type': 'application/json',
    };
    const fetchPage = (page: number) =>
      this.jsonFetch(`${base}/get_return_requests?page=${page}`, {
        method: 'GET',
        headers,
      });
    if (opts?.page) return fetchPage(opts.page);
    if (opts?.all === false) {
      return this.jsonFetch(`${base}/get_return_requests`, {
        method: 'GET',
        headers,
      });
    }
    const all: unknown[] = [];
    let first: Record<string, unknown> | null = null;
    let listKey: string | null = null;
    for (let page = 1; page <= 100; page++) {
      const res = await fetchPage(page);
      if (!first) {
        first = res;
        listKey = this.firstArrayKey(res);
      }
      const items = listKey ? ((res[listKey] as unknown[]) || []) : [];
      if (!Array.isArray(items) || items.length === 0) break;
      all.push(...items);
    }
    if (!first) return { data: all, pages: 0 };
    if (!listKey) return { ...first, pages: all.length === 0 ? 1 : 1 };
    return { ...first, [listKey]: all, pages: all.length === 0 ? 0 : undefined } as Record<string, unknown>;
  }

  /** First top-level array key in a courier envelope (data/payments/…). */
  private firstArrayKey(res: Record<string, unknown>): string | null {
    for (const k of ['data', 'return_requests', 'returns', 'payments', 'results', 'items']) {
      if (Array.isArray(res[k])) return k;
    }
    for (const k of Object.keys(res)) {
      if (Array.isArray((res as any)[k])) return k;
    }
    return null;
  }

  /**
   * Task 9(b): paginated payments list. Doc (Steadfast API Docs.md,
   * "GET /payments — Payouts we have made to you, ten to a page."): loop
   * `?page=` until an empty page and aggregate `payments`. Same single/all
   * contract as getSteadfastReturnRequests.
   */
  async getSteadfastPayments(opts?: {
    credentialSetId?: string | null;
    page?: number;
    all?: boolean;
  }) {
    const { apiKey, secretKey } = await this.resolveSteadfastAuth({
      overrideSetId: opts?.credentialSetId,
    });
    if (!apiKey || !secretKey)
      throw new BadRequestException('Steadfast API key/secret not configured');

    const base = await this.getBaseUrl('steadfast');
    const headers = {
      'Api-Key': apiKey,
      'Secret-Key': secretKey,
      'Content-Type': 'application/json',
    };
    const fetchPage = (page: number) =>
      this.jsonFetch(`${base}/payments?page=${page}`, {
        method: 'GET',
        headers,
      });
    if (opts?.page) return fetchPage(opts.page);
    if (opts?.all === false) {
      return this.jsonFetch(`${base}/payments`, {
        method: 'GET',
        headers,
      });
    }
    const all: unknown[] = [];
    let first: Record<string, unknown> | null = null;
    for (let page = 1; page <= 100; page++) {
      const res = await fetchPage(page);
      if (!first) first = res;
      const items = (res['payments'] as unknown[]) || (res['data'] as unknown[]) || [];
      if (!Array.isArray(items) || items.length === 0) break;
      all.push(...items);
    }
    if (!first) return { payments: all, pages: 0 };
    return { ...first, payments: all };
  }

  async getSteadfastPaymentWithConsignments(
    paymentId: string,
    opts?: { credentialSetId?: string | null },
  ) {
    const { apiKey, secretKey } = await this.resolveSteadfastAuth({
      overrideSetId: opts?.credentialSetId,
    });
    if (!apiKey || !secretKey)
      throw new BadRequestException('Steadfast API key/secret not configured');

    const base = await this.getBaseUrl('steadfast');
    return this.jsonFetch(`${base}/payments/${paymentId}`, {
      method: 'GET',
      headers: {
        'Api-Key': apiKey,
        'Secret-Key': secretKey,
        'Content-Type': 'application/json',
      },
    });
  }

  async getSteadfastPoliceStations(opts?: {
    credentialSetId?: string | null;
  }) {
    const { apiKey, secretKey } = await this.resolveSteadfastAuth({
      overrideSetId: opts?.credentialSetId,
    });
    if (!apiKey || !secretKey)
      throw new BadRequestException('Steadfast API key/secret not configured');

    const base = await this.getBaseUrl('steadfast');
    return this.jsonFetch(`${base}/police_stations`, {
      method: 'GET',
      headers: {
        'Api-Key': apiKey,
        'Secret-Key': secretKey,
        'Content-Type': 'application/json',
      },
    });
  }

  async bulkCreateSteadfastOrders(
    orders: any[],
    opts?: { credentialSetId?: string | null },
  ) {
    // Task 8: bulk resolves ONE profile upfront (override → default →
    // legacy); per-entry booking rows below store the same booking set id.
    // MEDIUM bulk-silent note: the bulk path has NO per-order account
    // picker, so when >1 Steadfast sets are configured every parcel in the
    // batch books with the DEFAULT account. The admin bulk bar shows a
    // visible "Bulk books with the default Steadfast account" warning in
    // that case (see features/orders/index.tsx) instead of silently
    // ignoring per-order overrides.
    const { apiKey, secretKey, setId: bulkSetId } =
      await this.resolveSteadfastAuth({
        overrideSetId: opts?.credentialSetId,
      });
    if (!apiKey || !secretKey)
      throw new BadRequestException('Steadfast API key/secret not configured');

    if (orders.length > 500)
      throw new BadRequestException(
        'Maximum 500 orders allowed per bulk request',
      );

    const base = await this.getBaseUrl('steadfast');
    // Per-entry name errors must NOT abort the batch: an order with no
    // recipient name becomes a failed entry (same {orderId, message, courier,
    // errors} shape the response loop below produces) and the rest dispatch.
    const bodyData: Record<string, unknown>[] = [];
    const preFailed: {
      orderId: string;
      message: string;
      courier: string;
      errors?: Record<string, unknown>;
    }[] = [];
    for (const order of orders) {
      try {
        // D-A: snapshot authority — never the linked CustomerProfile.
        // Fix 5a: Mx. prefix / truncate; empty throws a field error (invoice in msg).
        const { sent: safeName } = this.resolveCourierName(
          order,
          'steadfast',
          'recipient_name',
        );
        const bulkAddress = order.shippingAddress as
          | Record<string, unknown>
          | null;
        const bulkPhone = this.normalizePhone(orderRecipientPhone(order));
        const entry: Record<string, unknown> = {
          invoice: order.displayId,
          recipient_name: safeName,
          recipient_phone: bulkPhone,
          // Owner Q10: cap at Steadfast's 490 like single dispatch (bulk
          // previously sent the address uncapped).
          recipient_address: sanitizeCourierText(
            formatCourierAddress(bulkAddress) ?? 'Dhaka',
            courierAddressLimit('steadfast'),
          ),
          cod_amount: this.getCollectableAmount(order),
          note: order.officeNotes || null,
        };
        // Owner Q13 (2026-10-23): the /extended bulk endpoint accepts
        // these PER ORDER (the legacy endpoint read them from the top
        // level instead) — mirror single dispatch's fields.
        const bulkEmail = orderRecipientEmail(order);
        if (bulkEmail) entry.recipient_email = bulkEmail;
        const bulkSecondary =
          this.normalizePhone(order.secondaryPhone) ||
          (bulkAddress?.phone && bulkAddress.phone !== bulkPhone
            ? this.normalizePhone(bulkAddress.phone as string)
            : null);
        if (bulkSecondary) entry.alternative_phone = bulkSecondary;
        const bulkDescription = order.items
          ?.map((item: any) => item.product?.name || 'Product')
          .join(', ');
        if (bulkDescription) {
          entry.item_description = sanitizeCourierText(
            bulkDescription,
            COURIER_FIELD_LIMITS.note,
          );
        }
        const bulkLot = Array.isArray(order.items)
          ? order.items.reduce(
              (sum: number, item: any) => sum + (Number(item?.quantity) || 0),
              0,
            )
          : 0;
        if (bulkLot > 0) entry.total_lot = bulkLot;
        bodyData.push(entry);
      } catch (e: unknown) {
        // Fix 5: resolveCourierName throws the shaped field error already.
        if (e instanceof CourierDispatchError) {
          preFailed.push({
            orderId: order.displayId ?? order.id ?? 'unknown',
            message: e.message,
            courier: e.courier,
            errors: e.errors,
          });
          continue;
        }
        const msg = e instanceof Error ? e.message : 'Dispatch failed';
        preFailed.push({
          orderId: order.displayId ?? order.id ?? 'unknown',
          message: msg,
          courier: 'steadfast',
        });
      }
    }

    if (bodyData.length === 0) {
      return { success: [], failed: preFailed };
    }

    // Fix 5: transport with the same retry discipline as single dispatch —
    // ONLY 5xx/network are retried, NEVER 4xx (with the fix-keys hint).
    // Retry safety: the retried body carries the SAME invoices, and duplicate
    // invoices are refused, so a retry cannot double-book (per the doc:
    // "Retry with the same invoice; duplicate invoices are refused").
    const bulkBody = JSON.stringify({ data: bodyData });
    const bulkHeaders = {
      'Api-Key': apiKey,
      'Secret-Key': secretKey,
      'Content-Type': 'application/json',
    };
    const bulkMaxRetries = 3;
    let response: Record<string, unknown> | null = null;
    let bulkStatus = 0;
    for (let attempt = 1; attempt <= bulkMaxRetries; attempt++) {
      let res: Response;
      try {
        // Owner Q13 (2026-10-23): /extended — same `data` array, but
        // per-entry failures come back as readable sentences
        // (status: "error") instead of codes, and recipient_email /
        // alternative_phone / item_description / total_lot are read per
        // order. describeSteadfastBulkEntry already parses both shapes.
        res = await this.fetchWithTimeout(`${base}/create_order/bulk-order/extended`, {
          method: 'POST',
          headers: bulkHeaders,
          body: bulkBody,
        });
      } catch (netErr: unknown) {
        this.logger.warn(
          `Steadfast bulk dispatch attempt ${attempt}/${bulkMaxRetries} failed (network): ${(netErr as Error).message}`,
        );
        if (attempt < bulkMaxRetries) {
          await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt)));
        }
        continue;
      }
      bulkStatus = res.status;
      const rawBody = await res.text().catch(() => '');
      const parsed = parseJsonBody(rawBody);
      if (!res.ok) {
        if (isRetryableStatus(res.status)) {
          this.logger.warn(
            `Steadfast bulk dispatch attempt ${attempt}/${bulkMaxRetries} failed (retryable HTTP ${res.status})`,
          );
          if (attempt < bulkMaxRetries) {
            await new Promise((resolve) =>
              setTimeout(resolve, backoffMs(attempt)),
            );
          }
          continue;
        }
        throw new CourierDispatchError({
          courier: 'steadfast',
          status: res.status,
          message:
            `Steadfast bulk: ${parsed ? String(parsed['message'] || 'request rejected') : (redactSecrets(rawBody) || '(empty response body)').slice(0, 500)}` +
            (await this.steadfastAuthHint(res.status)),
          errors:
            parsed && typeof parsed['errors'] === 'object' && parsed['errors'] !== null
              ? { ...(parsed['errors'] as Record<string, unknown>) }
              : undefined,
        });
      }
      if (parsed === null) {
        this.logger.warn(
          `Steadfast bulk dispatch attempt ${attempt}/${bulkMaxRetries} failed (non-JSON 2xx)`,
        );
        if (attempt < bulkMaxRetries) {
          await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt)));
        }
        continue;
      }
      response = parsed;
      break;
    }
    if (response === null) {
      throw new CourierDispatchError({
        courier: 'steadfast',
        status: bulkStatus || 0,
        message: `Steadfast bulk: no usable response after ${bulkMaxRetries} attempts with the same invoices (HTTP ${bulkStatus || 'network failure'}) — safe to retry, duplicate invoices are refused`,
      });
    }

    const results = (response['data'] as Array<Record<string, unknown>>) || [];
    const successResults: {
      orderId: string;
      consignmentId: string;
      trackingCode: string;
      trackingUrl: string;
    }[] = [];
    const failedResults: {
      orderId: string;
      message: string;
      courier: string;
      errors?: Record<string, unknown>;
    }[] = [];

    for (const result of results) {
      const invoice = result['invoice'] as string;
      const status = result['status'] as string;
      const consignmentId = String(result['consignment_id'] || '');
      const trackingCode = String(result['tracking_code'] || '');
      const trackingUrl = String(result['tracking_link'] || '');

      if (status === 'success' && consignmentId) {
        try {
          const order = await this.prisma.order.findFirst({
            where: { displayId: invoice, trashedAt: null },
            select: { id: true },
          });
          // Match the invoice back to the input order (carries payments) so
          // the persisted courierAmount equals the cod_amount actually sent.
          const bulkOrder = orders.find((o: any) => o.displayId === invoice);
          if (!bulkOrder) {
            this.logger.warn(
              `Bulk Steadfast dispatch: no input order matched invoice ${invoice} — courierAmount omitted, COD alert coverage skipped for this consignment`,
            );
          }
          // Fix 5a: sent-name audit for this invoice (recomputed pure; the
          // payload above already carries .sent).
          const bulkSent = bulkOrder
            ? courierSafeRecipientName(bulkOrder, 'steadfast')
            : '';
          const bulkRaw = bulkOrder ? orderRecipientRawName(bulkOrder) : '';
          if (order) {
            await this.prisma.order.update({
              where: { id: order.id },
              data: {
                courierService: 'steadfast',
                courierConsignmentId: consignmentId,
                courierTrackingCode: trackingCode,
              },
            });

            await this.prisma.dispatch.upsert({
              where: {
                courier_consignmentId: { courier: 'steadfast', consignmentId },
              },
              update: { trackingCode, trackingUrl, status: 'DISPATCHED' },
              create: {
                orderId: order.id,
                courier: 'steadfast',
                consignmentId,
                trackingCode,
                trackingUrl,
                status: 'DISPATCHED',
                // Task 8: bulk booking set id (null = legacy default).
                ...{ credentialSetId: bulkSetId },
                // Persist the amount actually sent as cod_amount for this
                // invoice's order (Feature A). Resolved from the input orders
                // (which carry payments); missing ⇒ omitted, never 0.
                // Persist-only — the getCollectableAmount calc is untouched.
                ...(bulkOrder
                  ? { courierAmount: this.getCollectableAmount(bulkOrder) }
                  : {}),
                // Fix 5a: dispatch record stores the sent name (transformed only).
                ...(this.courierNameNote(bulkSent, bulkRaw)
                  ? {
                      notes: `courier name sent as '${bulkSent}'`,
                    }
                  : {}),
              },
            });

            await this.noteCourierNameTransform(
              order.id,
              'steadfast',
              bulkSent,
              bulkRaw,
            );

            await this.logDispatch({
              orderId: order.id,
              courier: 'steadfast',
              status: 'success',
              consignmentId,
              trackingCode,
              requestPayload: bodyData,
              responsePayload: response,
            });
          }

          successResults.push({
            orderId: invoice,
            consignmentId,
            trackingCode,
            trackingUrl,
          });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : 'Failed to process';
          failedResults.push({ orderId: invoice, message: msg, courier: 'steadfast' });
        }
      } else {
        // Fix 5: read the per-entry `error` codes — a failed legacy-bulk
        // entry carries `status: null` + `error`, a JSON-encoded ARRAY of
        // codes (e.g. '["THIS_INVOICE_ALREADY_EXISTS"]'), NOT `message`
        // (which is absent → the old code surfaced a literal 'Failed').
        // The extended endpoint instead sends `status: "error"` + `error`
        // as readable sentences. Both land here, verbatim, with field+rule
        // naming for the admin UI.
        const entry = this.describeSteadfastBulkEntry(result);
        failedResults.push({
          orderId: invoice,
          message: entry.message,
          courier: 'steadfast',
          errors: entry.errors,
        });
      }
    }

    return { success: successResults, failed: [...preFailed, ...failedResults] };
  }

  /**
   * Fix 5: surface a failed Steadfast bulk entry's `error` codes/sentences.
   * Legacy shape: `{status: null, error: '["CODE", ...]'}` (JSON-encoded
   * string). Extended shape: `{status: "error", error: ["sentence", ...]}`.
   * Known codes map to `field 'x' <rule>` sentences; unknown codes and
   * sentences pass through verbatim (never a bare 'Failed').
   */
  private describeSteadfastBulkEntry(result: Record<string, unknown>): {
    message: string;
    errors: Record<string, unknown>;
  } {
    const invoice = String(result['invoice'] ?? '');
    const rawErr = result['error'];
    let codes: string[] = [];
    if (Array.isArray(rawErr)) {
      codes = rawErr.map((c) => String(c));
    } else if (typeof rawErr === 'string' && rawErr.trim()) {
      try {
        const parsed = JSON.parse(rawErr) as unknown;
        codes = Array.isArray(parsed)
          ? parsed.map((c) => String(c))
          : [rawErr];
      } catch {
        codes = [rawErr];
      }
    }
    if (codes.length > 0) {
      const rules = codes.map(
        (c) => STEADFAST_BULK_ERROR_RULES[c] ?? c,
      );
      // Keep the raw codes alongside the readable rules — staff search logs
      // by code, humans read the rule.
      const known = codes.some((c) => STEADFAST_BULK_ERROR_RULES[c]);
      return {
        message:
          `Steadfast [${invoice}]: ${rules.join('; ')}` +
          (known ? ` (${codes.join(', ')})` : ''),
        errors: { codes, invoice },
      };
    }
    const msg = String(result['message'] || 'Failed');
    return {
      message: `Steadfast [${invoice}]: ${msg}`,
      errors: { invoice },
    };
  }

  async getRedxParcelDetails(trackingId: string) {
    const creds = await this.getCreds('redx');
    const apiToken = creds.apiKey || creds.credentials?.['apiKey'];
    if (!apiToken)
      throw new BadRequestException('RedX API token not configured');

    const base = await this.getBaseUrl('redx');
    return this.jsonFetch(`${base}/parcel/info/${trackingId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'API-ACCESS-TOKEN': `Bearer ${apiToken}`,
      },
    });
  }

  async trackRedxParcel(trackingId: string) {
    const creds = await this.getCreds('redx');
    const apiToken = creds.apiKey || creds.credentials?.['apiKey'];
    if (!apiToken)
      throw new BadRequestException('RedX API token not configured');

    const base = await this.getBaseUrl('redx');
    return this.jsonFetch(`${base}/parcel/track/${trackingId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'API-ACCESS-TOKEN': `Bearer ${apiToken}`,
      },
    });
  }

  /**
   * Task 9(c): RedX charge calculator — GET /charge/charge_calculator
   * (doc "Calculate Parcel Charge": `?delivery_area_id=&pickup_area_id=&
   * cash_collection_amount=&weight=` → `{deliveryCharge, codCharge}`).
   * Dispatch-time PREVIEW only: callers render it as non-blocking info
   * (never gate dispatch on it). pickup_area_id is optional here (doc says
   * required, but no pickup-area config exists — omitted when unconfigured).
   */
  async getRedxCharge(params: {
    delivery_area_id: number | string;
    pickup_area_id?: number | string | null;
    cash_collection_amount: number | string;
    weight: number | string;
  }): Promise<{ deliveryCharge: number; codCharge: number }> {
    const deliveryAreaId = Number((params as any)?.delivery_area_id);
    const cash = Number((params as any)?.cash_collection_amount);
    const weight = Number((params as any)?.weight);
    if (!Number.isFinite(deliveryAreaId) || deliveryAreaId <= 0)
      throw new BadRequestException(
        "RedX charge preview: field 'delivery_area_id' is required",
      );
    if (!Number.isFinite(cash) || cash < 0)
      throw new BadRequestException(
        "RedX charge preview: field 'cash_collection_amount' must be a non-negative number",
      );
    if (!Number.isFinite(weight) || weight <= 0)
      throw new BadRequestException(
        "RedX charge preview: field 'weight' must be a positive number (grams)",
      );
    const creds = await this.getCreds('redx');
    const apiToken = creds.apiKey || (creds.credentials as any)?.['apiKey'];
    if (!apiToken)
      throw new BadRequestException('RedX API token not configured');
    const base = await this.getBaseUrl('redx');
    const qs = new URLSearchParams({
      delivery_area_id: String(Math.trunc(deliveryAreaId)),
      cash_collection_amount: String(cash),
      weight: String(Math.trunc(weight)),
    });
    const pickupRaw = (params as any)?.pickup_area_id;
    if (pickupRaw !== undefined && pickupRaw !== null && String(pickupRaw).trim() !== '') {
      const pickupId = Number(pickupRaw);
      if (Number.isFinite(pickupId) && pickupId > 0)
        qs.set('pickup_area_id', String(Math.trunc(pickupId)));
    }
    const data = await this.jsonFetch(
      `${base}/charge/charge_calculator?${qs.toString()}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'API-ACCESS-TOKEN': `Bearer ${apiToken}`,
        },
      },
    );
    return {
      deliveryCharge: Number((data as any)['deliveryCharge'] ?? 0),
      codCharge: Number((data as any)['codCharge'] ?? 0),
    };
  }

  /**
   * Task 6: RedX parcel update is PATCH /parcels (doc Update Parcel section) —
   * the old PUT path is deleted (controller route too). The cancel flow is
   * property_name=status / new_value=cancelled per the doc sample. The doc
   * response is {success, message}: success:false throws, otherwise the
   * parsed shape is returned.
   */
  async cancelRedxParcel(trackingId: string, reason: string) {
    const creds = await this.getCreds('redx');
    const apiToken = creds.apiKey || creds.credentials?.['apiKey'];
    if (!apiToken)
      throw new BadRequestException('RedX API token not configured');

    const base = await this.getBaseUrl('redx');
    const data = await this.jsonFetch(`${base}/parcels`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'API-ACCESS-TOKEN': `Bearer ${apiToken}`,
      },
      body: JSON.stringify({
        entity_type: 'parcel-tracking-id',
        entity_id: trackingId,
        update_details: {
          property_name: 'status',
          new_value: 'cancelled',
          reason: reason,
        },
      }),
    });
    if (data['success'] === false) {
      throw new BadRequestException(
        `RedX parcel update rejected: ${String(data['message'] || 'request not accepted')}`,
      );
    }
    return {
      success: data['success'] ?? true,
      message: data['message'],
    };
  }

  async getCities() {
    const pathao = await this.prisma.courierCredentials.findUnique({
      where: { courier: 'pathao' },
    });
    const carrybee = await this.prisma.courierCredentials.findUnique({
      where: { courier: 'carrybee' },
    });

    if (pathao?.enabled) {
      return this.getPathaoCities(pathao);
    } else if (carrybee?.enabled) {
      return this.getCarrybeeCities(carrybee);
    }
    throw new BadRequestException(
      'No supported courier (Pathao/Carrybee) is enabled',
    );
  }

  async getZones(cityId: string) {
    const pathao = await this.prisma.courierCredentials.findUnique({
      where: { courier: 'pathao' },
    });
    const carrybee = await this.prisma.courierCredentials.findUnique({
      where: { courier: 'carrybee' },
    });

    if (pathao?.enabled) {
      return this.getPathaoZones(pathao, cityId);
    } else if (carrybee?.enabled) {
      return this.getCarrybeeZones(carrybee, cityId);
    }
    throw new BadRequestException(
      'No supported courier (Pathao/Carrybee) is enabled',
    );
  }

  private async getPathaoCities(creds: any) {
    const base =
      BASE_URLS['pathao']?.[creds.mode] || BASE_URLS['pathao']?.['production'];
    const token = await this.getPathaoToken(
      base,
      creds.clientId,
      creds.clientSecret,
      creds.username,
      creds.password,
    );
    const parsed: Record<string, unknown> = await this.jsonFetch(
      `${base}/aladdin/api/v1/city-list`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    const innerData = parsed['data'] as Record<string, unknown> | undefined;
    const list = (innerData?.['data'] ||
      innerData ||
      parsed['data'] ||
      []) as unknown[];
    return list.map((item: any) => ({
      id: item.city_id || item.id,
      name: item.city_name || item.name,
    }));
  }

  private async getPathaoZones(creds: any, cityId: string) {
    const base =
      BASE_URLS['pathao']?.[creds.mode] || BASE_URLS['pathao']?.['production'];
    const token = await this.getPathaoToken(
      base,
      creds.clientId,
      creds.clientSecret,
      creds.username,
      creds.password,
    );
    const parsed: Record<string, unknown> = await this.jsonFetch(
      `${base}/aladdin/api/v1/cities/${cityId}/zone-list`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    const innerData = parsed['data'] as Record<string, unknown> | undefined;
    const list = (innerData?.['data'] ||
      innerData ||
      parsed['data'] ||
      []) as unknown[];
    return list.map((item: any) => ({
      id: item.zone_id || item.id,
      name: item.zone_name || item.name,
    }));
  }

  private async getCarrybeeCities(creds: any) {
    const base =
      BASE_URLS['carrybee']?.[creds.mode] ||
      BASE_URLS['carrybee']?.['production'];
    const clientContext =
      creds.clientContext || creds.credentials?.['clientContext'] || 'merchant';
    const parsed: Record<string, unknown> = await this.jsonFetch(
      `${base}/api/v2/cities`,
      {
        headers: {
          'Client-ID': creds.clientId,
          'Client-Secret': creds.clientSecret,
          'Client-Context': clientContext,
        },
      },
    );
    const innerData = parsed['data'] as Record<string, unknown> | undefined;
    const list = (innerData?.['cities'] ||
      parsed['cities'] ||
      parsed['data'] ||
      []) as unknown[];
    return list.map((item: any) => ({
      id: item.city_id || item.id,
      name: item.city_name || item.name,
    }));
  }

  private async getCarrybeeZones(creds: any, cityId: string) {
    const base =
      BASE_URLS['carrybee']?.[creds.mode] ||
      BASE_URLS['carrybee']?.['production'];
    const clientContext =
      creds.clientContext || creds.credentials?.['clientContext'] || 'merchant';
    const parsed: Record<string, unknown> = await this.jsonFetch(
      `${base}/api/v2/cities/${cityId}/zones`,
      {
        headers: {
          'Client-ID': creds.clientId,
          'Client-Secret': creds.clientSecret,
          'Client-Context': clientContext,
        },
      },
    );
    const innerData = parsed['data'] as Record<string, unknown> | undefined;
    const list = (innerData?.['zones'] ||
      parsed['zones'] ||
      parsed['data'] ||
      []) as unknown[];
    return list.map((item: any) => ({
      id: item.zone_id || item.id,
      name: item.zone_name || item.name,
    }));
  }
}
