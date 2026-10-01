/**
 * Order "Others Information" read model.
 *
 * A read-only projection over data the system already holds. It creates no
 * ledger of its own and writes nothing.
 *
 * FOUR SOURCES OF TRUTH, KEPT APART:
 *   1. Order snapshot      — order-owned historical truth.
 *   2. Customer profile    — current, customer-owned.
 *   3. Customer address book — reusable, customer-owned.
 *   4. Tracking/event ledger — delivery truth.
 * None of them overwrites another, and this service surfaces that separation
 * explicitly rather than blending the first two.
 *
 * SECURITY: this response carries IP, User-Agent, tracking identifiers,
 * customer PII and provider payloads. Credentials are never selected from the
 * database, provider responses are sanitized before they leave this service,
 * and the assembled `raw` view gets a final redaction sweep. Hiding a secret in
 * the frontend is not an acceptable control — redaction happens here.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { parseUserAgent } from './user-agent';
import {
  acceptanceFor,
  acceptanceColumnLabel,
  type AcceptanceState,
} from '../tracking/provider-acceptance';
import {
  sanitizeDispatchPayload,
  sanitizeStoredPayload,
  type SanitizeResult,
} from '../tracking/sanitize-dispatch-payload';
import {
  RETENTION_OUTBOX_DAYS,
  RETENTION_DISPATCH_DAYS,
} from '../tracking/retention-cleanup.service';

export type FieldState =
  | 'present'
  | 'missing'
  | 'not_collected'
  | 'not_applicable'
  | 'null';

export interface Field {
  key: string;
  label: string;
  value: unknown;
  state: FieldState;
  group?: string;
}

const f = (key: string, label: string, value: unknown, group?: string): Field => {
  let state: FieldState;
  if (value === undefined) state = 'not_collected';
  else if (value === null) state = 'null';
  else if (typeof value === 'string' && value.trim() === '') state = 'missing';
  else if (typeof value === 'object') {
    // An empty object/array is "missing" too, but must be tested structurally —
    // comparing by reference never works.
    state = Object.keys(value as object).length === 0 ? 'missing' : 'present';
  } else state = 'present';
  return { key, label, value, state, group };
};

const nf = (key: string, label: string, label2?: string): Field => ({
  key,
  label,
  value: null,
  state: 'not_collected',
  group: label2,
});

/** Fields the Purchase event cares about, for the coverage diagnostic. */
const COVERAGE_FIELDS = [
  'value', 'currency', 'content_ids', 'contents', 'num_items',
  'customer.email', 'customer.phone', 'customer.firstName', 'customer.lastName',
  'customer.city', 'customer.state', 'customer.zip',
  'trackingIdentity.fbp', 'trackingIdentity.fbc', 'trackingIdentity.gclid',
  'trackingIdentity.ttclid',
] as const;

function dig(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

@Injectable()
export class OrderOthersService {
  constructor(private readonly prisma: PrismaService) {}

  async getForOrder(orderId: string): Promise<Record<string, unknown>> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true, displayId: true, createdAt: true, customerId: true,
        guestName: true, guestPhone: true,
        customerEmail: true, customerPhone: true,
        customerFirstName: true, customerLastName: true,
        customerCity: true, customerState: true, customerZip: true,
        customerCountry: true,
        shippingAddress: true, billingAddress: true,
        ipAddress: true, userAgent: true, trackingSessionId: true,
        source: true, salesChannel: true,
        sourcePlatform: true, sourceType: true, sourceEntity: true,
        attribution: true,
      },
    });
    if (!order) throw new NotFoundException('Order not found');

    // Tracking rows key on the business displayId, not the internal UUID.
    const snapshots = await this.prisma.trackingSnapshot.findMany({
      where: { orderId: order.displayId },
      orderBy: { createdAt: 'asc' },
    });

    const transitionLogAvailable =
      Date.now() - new Date(order.createdAt).getTime() <= RETENTION_OUTBOX_DAYS * 86_400_000;

    const events = await Promise.all(
      snapshots.map((s) => this.buildEvent(s.id, transitionLogAvailable)),
    );

    const customerProfile = order.customerId
      ? await this.buildCustomerProfile(order.customerId)
      : null;
    const fieldDiffs = customerProfile
      ? this.diffSnapshotVsProfile(order, customerProfile)
      : [];

    const attribution = (order.attribution ?? null) as Record<string, any> | null;
    const resolvedAttribution = order.customerId
      ? await this.buildResolvedAttribution(order.displayId, attribution)
      : null;

    const snapshotFields = this.snapshotFields(order);
    const raw = sanitizeDispatchPayload({
      order: {
        id: order.id,
        displayId: order.displayId,
        createdAt: order.createdAt,
        customerId: order.customerId,
        guestName: order.guestName,
        guestPhone: order.guestPhone,
        customerEmail: order.customerEmail,
        customerPhone: order.customerPhone,
        customerFirstName: order.customerFirstName,
        customerLastName: order.customerLastName,
        customerCity: order.customerCity,
        customerState: order.customerState,
        customerZip: order.customerZip,
        customerCountry: order.customerCountry,
        shippingAddress: order.shippingAddress,
        billingAddress: order.billingAddress,
        ipAddress: order.ipAddress,
        userAgent: order.userAgent,
        trackingSessionId: order.trackingSessionId,
        source: order.source,
        salesChannel: order.salesChannel,
        sourcePlatform: order.sourcePlatform,
        sourceType: order.sourceType,
        sourceEntity: order.sourceEntity,
        attribution: order.attribution,
      },
      customerProfile,
      purchaseEvents: events,
    });

    return {
      orderId: order.id,
      displayId: order.displayId,
      createdAt: order.createdAt,
      retention: {
        transitionLogAvailable,
        transitionLogPurgeDays: RETENTION_OUTBOX_DAYS,
        dispatchRetentionDays: RETENTION_DISPATCH_DAYS,
      },
      sections: {
        snapshot: snapshotFields,
        customerProfile: customerProfile ? this.profileFields(customerProfile) : [],
        device: this.deviceFields(order, attribution),
        attributionRaw: this.attributionRawFields(attribution),
        attributionResolved: resolvedAttribution,
        trackingIdentifiers: this.trackingIdentifierFields(attribution, events),
      },
      customerProfile: customerProfile
        ? { ...customerProfile, fieldDiffs }
        : null,
      purchase: { events },
      raw: raw.value,
      rawMeta: { truncated: raw.truncated, redactedPaths: raw.redactedPaths },
    };
  }

  // ── 1. Order snapshot (order-owned historical truth) ──────────────────────
  private snapshotFields(o: any): Field[] {
    const ship = (o.shippingAddress ?? {}) as Record<string, any>;
    const bill = (o.billingAddress ?? {}) as Record<string, any>;
    return [
      f('customerName', 'Customer name', [o.customerFirstName, o.customerLastName].filter(Boolean).join(' ') || o.guestName || null, 'Identity'),
      f('customerPhone', 'Phone', o.customerPhone ?? o.guestPhone ?? null, 'Identity'),
      f('customerEmail', 'Email', o.customerEmail ?? null, 'Identity'),
      f('customerCity', 'City', o.customerCity ?? null, 'Identity'),
      f('customerState', 'State / Division', o.customerState ?? null, 'Identity'),
      f('customerZip', 'Postal code', o.customerZip ?? null, 'Identity'),
      f('customerCountry', 'Country', o.customerCountry ?? null, 'Identity'),
      f('shippingAddress', 'Shipping address (at order time)', Object.keys(ship).length ? ship : null, 'Addresses'),
      f('billingAddress', 'Billing address (at order time)', Object.keys(bill).length ? bill : null, 'Addresses'),
      f('ipAddress', 'IP address', o.ipAddress ?? null, 'Technical'),
      f('userAgent', 'User-Agent', o.userAgent ?? null, 'Technical'),
      f('trackingSessionId', 'Tracking session', o.trackingSessionId ?? null, 'Technical'),
      f('source', 'Source', o.source ?? null, 'Technical'),
      f('salesChannel', 'Sales channel', o.salesChannel ?? null, 'Technical'),
    ];
  }

  // ── 2. Current customer profile (customer-owned) ──────────────────────────
  private async buildCustomerProfile(customerProfileId: string) {
    const profile = await this.prisma.customerProfile.findUnique({
      where: { id: customerProfileId },
      select: {
        id: true, name: true, phone: true, email: true,
        createdAt: true, lastOrderAt: true, lastOrderIp: true,
        customerAddresses: {
          orderBy: [{ type: 'asc' }, { isDefault: 'desc' }, { createdAt: 'asc' }],
        },
      },
    });
    if (!profile) return null;

    const lastOrder = await this.prisma.order.findFirst({
      where: { customerId: profile.id },
      orderBy: { createdAt: 'desc' },
      select: { displayId: true, createdAt: true, total: true },
    });

    return {
      ...profile,
      lastOrder,
      addresses: profile.customerAddresses,
    };
  }

  private profileFields(p: any): Field[] {
    return [
      f('id', 'Customer ID', p.id, 'Identity'),
      f('name', 'Name', p.name, 'Identity'),
      f('phone', 'Phone', p.phone, 'Identity'),
      f('email', 'Email', p.email, 'Identity'),
      f('createdAt', 'Profile created', p.createdAt, 'Activity'),
      f('lastOrderAt', 'Last order', p.lastOrder?.createdAt ?? p.lastOrderAt, 'Activity'),
      f('lastOrderIp', 'Last order IP', p.lastOrderIp, 'Activity'),
      f('addressCount', 'Saved addresses', Array.isArray(p.addresses) ? p.addresses.length : 0, 'Addresses'),
    ];
  }

  /**
   * Field-level divergence between the order-time snapshot and the current
   * profile. This is what makes "snapshot ≠ profile" legible instead of
   * something the admin has to spot by comparing two panels.
   */
  private diffSnapshotVsProfile(order: any, profile: any): DiffRow[] {
    if (!profile) return [];
    const rows: DiffRow[] = [];
    const snapshotName = [order.customerFirstName, order.customerLastName]
      .filter(Boolean)
      .join(' ') || order.guestName || null;
    const pairs: { key: string; label: string; snapshot: unknown; current: unknown }[] = [
      { key: 'name', label: 'Name', snapshot: snapshotName, current: profile.name },
      { key: 'phone', label: 'Phone', snapshot: order.customerPhone ?? order.guestPhone, current: profile.phone },
      { key: 'email', label: 'Email', snapshot: order.customerEmail, current: profile.email },
    ];
    for (const p of pairs) {
      if (p.snapshot !== p.current) {
        rows.push({
          key: p.key,
          label: p.label,
          snapshotValue: p.snapshot ?? null,
          currentValue: p.current ?? null,
        });
      }
    }
    return rows;
  }

  // ── 3. Device & request (derived where possible, never invented) ──────────
  private deviceFields(order: any, attribution: Record<string, any> | null): Field[] {
    const ua = parseUserAgent(order.userAgent);
    const device = (attribution?.device ?? null) as Record<string, any> | null;

    if (!order.userAgent && !order.ipAddress && !device) {
      return [nf('device', 'Device & request information', 'No technical context was captured with this order.')];
    }

    return [
      f('ipAddress', 'IP address', order.ipAddress ?? null, 'Request'),
      f('userAgent', 'User-Agent (raw)', order.userAgent ?? null, 'Request'),
      ua
        ? f('browser', 'Browser', ua.browser, 'Derived from User-Agent')
        : nf('browser', 'Browser', 'Derived from User-Agent'),
      ua
        ? f('browserVersion', 'Browser version', ua.browserVersion, 'Derived from User-Agent')
        : nf('browserVersion', 'Browser version', 'Derived from User-Agent'),
      ua ? f('os', 'Operating system', ua.os, 'Derived from User-Agent') : nf('os', 'Operating system', 'Derived from User-Agent'),
      ua ? f('osVersion', 'OS version', ua.osVersion, 'Derived from User-Agent') : nf('osVersion', 'OS version', 'Derived from User-Agent'),
      ua ? f('deviceType', 'Device type', ua.deviceType, 'Derived from User-Agent') : nf('deviceType', 'Device type', 'Derived from User-Agent'),
      ua ? f('platform', 'Platform', ua.platform, 'Derived from User-Agent') : nf('platform', 'Platform', 'Derived from User-Agent'),
      f('timezone', 'Timezone', device?.timezone ?? null, 'Collected by storefront'),
      f('language', 'Language', device?.language ?? null, 'Collected by storefront'),
      // Screen data is only present when the storefront explicitly sent it.
      f('screen', 'Screen', device?.screen ?? null, 'Collected by storefront'),
      f('viewport', 'Viewport', device?.viewport ?? null, 'Collected by storefront'),
      f('referrer', 'Referrer', attribution?.referrer ?? null, 'Request'),
      f('landingUrl', 'Landing URL', attribution?.landingUrl ?? null, 'Request'),
      f('sessionToken', 'Session token', attribution?.sessionToken ?? null, 'Request'),
    ];
  }

  // ── 4. Raw attribution (what actually arrived) ───────────────────────────
  private attributionRawFields(a: Record<string, any> | null): Field[] {
    if (!a) {
      return [nf('attribution', 'No attribution signal was captured with this order.')];
    }
    const utm = a.utm ?? {};
    return [
      f('utmSource', 'utm_source', utm.source, 'UTM'),
      f('utmMedium', 'utm_medium', utm.medium, 'UTM'),
      f('utmCampaign', 'utm_campaign', utm.campaign, 'UTM'),
      f('utmContent', 'utm_content', utm.content, 'UTM'),
      f('utmTerm', 'utm_term', utm.term, 'UTM'),
      f('referrer', 'Referrer', a.referrer, 'Context'),
      f('landingUrl', 'Landing URL', a.landingUrl, 'Context'),
      f('ip', 'IP (at capture)', a.ip, 'Context'),
      f('userAgent', 'User-Agent (at capture)', a.userAgent, 'Context'),
      f('device', 'Device block', a.device, 'Context'),
      f('capturedAt', 'Captured at', a.capturedAt, 'Context'),
    ];
  }

  // ── 5. Resolved attribution (what the system concluded) ──────────────────
  private async buildResolvedAttribution(
    displayId: string,
    raw: Record<string, any> | null,
  ): Promise<Field[]> {
    const resolved = (raw?.resolved ?? null) as Record<string, any> | null;
    const touch = (raw?.touch ?? null) as Record<string, any> | null;

    const orderAttribution = await this.prisma.orderAttribution.findUnique({
      where: { orderId: displayId },
      select: {
        method: true, confidence: true, explanation: true,
        attributionVersion: true, attributedAt: true,
        sessionId: true, campaignId: true, adSetId: true, adId: true,
        campaign: { select: { name: true } },
        adSet: { select: { name: true } },
        ad: { select: { name: true } },
      },
    });

    const fields: Field[] = [
      f('platform', 'Platform', resolved?.platform ?? null, 'Resolved at order time'),
      f('type', 'Type', resolved?.type ?? null, 'Resolved at order time'),
      f('method', 'Attribution method', orderAttribution?.method ?? null, 'Campaign credit'),
      f('confidence', 'Confidence', orderAttribution?.confidence ?? null, 'Campaign credit'),
      f('campaignId', 'Campaign ID', orderAttribution?.campaignId ?? null, 'Campaign credit'),
      f('campaign', 'Campaign', orderAttribution?.campaign?.name ?? null, 'Campaign credit'),
      f('adSetId', 'Ad Set ID', orderAttribution?.adSetId ?? null, 'Campaign credit'),
      f('adSet', 'Ad Set', orderAttribution?.adSet?.name ?? null, 'Campaign credit'),
      f('adId', 'Ad ID', orderAttribution?.adId ?? null, 'Campaign credit'),
      f('ad', 'Ad', orderAttribution?.ad?.name ?? null, 'Campaign credit'),
      f('explanation', 'Explanation', orderAttribution?.explanation ?? null, 'Campaign credit'),
      f('attributionVersion', 'Attribution version', orderAttribution?.attributionVersion ?? null, 'Campaign credit'),
      f('firstSeenAt', 'First touch', touch?.firstSeenAt ?? null, 'Touch model (recorded, not applied)'),
      f('ageDays', 'Touch age (days)', touch?.ageDays ?? null, 'Touch model (recorded, not applied)'),
      f('windowDays', 'Attribution window (days)', touch?.windowDays ?? null, 'Touch model (recorded, not applied)'),
      f('withinWindow', 'Within window', touch?.withinWindow ?? null, 'Touch model (recorded, not applied)'),
    ];
    return fields;
  }

  // ── 6. Tracking identifiers ──────────────────────────────────────────────
  private trackingIdentifierFields(
    a: Record<string, any> | null,
    events: any[],
  ): Field[] {
    const clickIds = (a?.clickIds ?? {}) as Record<string, string>;
    const identity = (events[0]?.payloadIdentity ?? {}) as Record<string, any>;
    const keys = [
      'clickId', 'click_id', 'fbclid', 'fb_click_id', 'gclid',
      'wbraid', 'gbraid', 'msclkid', 'ttclid', 'twclid', 'igshid',
    ];
    const fields: Field[] = keys.map((key) => {
      const value = clickIds[key] ?? identity[key] ?? null;
      return {
        key: `clickId.${key}`,
        label: key,
        value,
        state: (value ? 'present' : 'missing') as FieldState,
        group: 'Click identifiers',
      };
    });
    fields.push(
      { key: 'fbp', label: 'fbp (Meta browser)', value: identity.fbp ?? null, state: identity.fbp ? 'present' : 'missing', group: 'Platform identifiers' },
      { key: 'fbc', label: 'fbc (Meta click)', value: identity.fbc ?? null, state: identity.fbc ? 'present' : 'missing', group: 'Platform identifiers' },
      { key: 'externalId', label: 'externalId', value: identity.externalId ?? null, state: identity.externalId ? 'present' : 'missing', group: 'Platform identifiers' },
    );
    return fields;
  }

  // ── 7. Purchase events + delivery metrics ────────────────────────────────
  private async buildEvent(snapshotId: string, transitionLogAvailable: boolean) {
    const snapshot = await this.prisma.trackingSnapshot.findUnique({
      where: { id: snapshotId },
      select: {
        id: true, eventId: true, eventType: true, eventTime: true,
        actionSource: true, payload: true, createdAt: true, ctxId: true,
      },
    });
    if (!snapshot) return null;

    const dispatches = await this.prisma.trackingDispatch.findMany({
      where: { snapshotId },
      select: {
        id: true, provider: true, destinationId: true, pixelId: true, status: true,
        attemptCount: true, httpStatus: true, responseBody: true, errorMsg: true,
        providerEventId: true, payloadSnapshot: true, updatedAt: true, createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const transitions = transitionLogAvailable
      ? await this.prisma.trackingDispatchEvent.findMany({
          where: { snapshotId },
          select: {
            id: true, provider: true, fromStatus: true, toStatus: true,
            attempt: true, message: true, createdAt: true,
          },
          orderBy: { createdAt: 'asc' },
        })
      : [];

    const outboxDead = await this.prisma.trackingOutbox.count({
      where: { snapshotId, status: 'DEAD' },
    });

    const states: AcceptanceState[] = [];
    const dispatchRows = dispatches.map((d) => {
      const state = acceptanceFor(d.provider, {
        status: d.status,
        httpStatus: d.httpStatus,
        responseBody: d.responseBody,
        errorMsg: d.errorMsg,
        attemptCount: d.attemptCount,
      });
      states.push(state);

      // Attempt-level failure count lives on the transition log, which is
      // purged at 30 days. Beyond that it is `null` (NOT 0) so the UI can say
      // "not available" instead of falsely implying no attempt ever failed.
      const failedAttempts = transitionLogAvailable
        ? transitions.filter((t) => t.provider === d.provider && isFailureStatus(t.toStatus)).length
        : null;

      const sanitized = d.payloadSnapshot as unknown as SanitizeResult | null;

      return {
        provider: d.provider,
        destinationId: d.destinationId,
        pixelId: d.pixelId,
        status: d.status,
        // Row-level: a dispatch row is one delivery target, so 0 or 1.
        dispatched: d.attemptCount > 0 ? 1 : 0,
        // Attempt-level: increments on every retry, independent of the row count.
        attempts: d.attemptCount,
        accepted: state === 'accepted' ? 1 : 0,
        rejected: state === 'rejected' ? 1 : 0,
        unknown: state === 'http_accepted' || state === 'unknown' ? 1 : 0,
        acceptanceBasis: state,
        failed: d.status === 'FAILED' || d.status === 'DEAD' ? 1 : 0,
        skipped: d.status === 'SKIPPED' ? 1 : 0,
        failedAttempts,
        failedAttemptsAvailable: transitionLogAvailable,
        httpStatus: d.httpStatus,
        providerEventId: d.providerEventId,
        errorMsg: d.errorMsg,
        lastAttemptAt: d.updatedAt,
      };
    });

    const payload = (snapshot.payload ?? {}) as Record<string, any>;
    const coverage = COVERAGE_FIELDS.map((field) => {
      const value = dig(payload, field);
      return {
        field,
        value: typeof value === 'object' && value !== null ? JSON.stringify(value) : (value ?? null),
        state: (value === undefined || value === null || value === ''
          ? 'missing'
          : 'present') as FieldState,
      };
    });

    return {
      eventId: snapshot.eventId,
      eventType: snapshot.eventType,
      eventTime: new Date(Number(snapshot.eventTime) * 1000).toISOString(),
      actionSource: snapshot.actionSource,
      triggerMode: payload.triggerMode ?? null,
      acceptanceColumnLabel: acceptanceColumnLabel(states),
      dispatches: dispatchRows,
      outbox: { dead: outboxDead },
      timeline: transitions.map((t) => ({
        at: t.createdAt,
        provider: t.provider,
        fromStatus: t.fromStatus,
        toStatus: t.toStatus,
        attempt: t.attempt,
        message: t.message,
      })),
      transitionLogAvailable,
      payloadCaptured: snapshot.payload,
      // Sanitized + bounded per provider. Deliberately NOT labelled "exact
      // payload": the sanitizer redacts secrets and may truncate, which the
      // wrapper reports so the UI can disclose it.
      payloadSent: dispatches.map((d) => ({
        provider: d.provider,
        destinationId: d.destinationId,
        ...(sanitizeStoredPayload(d.payloadSnapshot) ?? { value: null, truncated: false, redactedPaths: [] }),
      })),
      coverage,
      payloadIdentity: (payload.trackingIdentity ?? {}) as Record<string, any>,
    };
  }
}

function isFailureStatus(status: string): boolean {
  return ['FAILED', 'RETRY', 'DEAD'].includes(status);
}

export interface DiffRow {
  key: string;
  label: string;
  snapshotValue: unknown;
  currentValue: unknown;
}
