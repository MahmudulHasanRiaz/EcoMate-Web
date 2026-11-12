/**
 * Canonical sales-channel vocabulary for the admin UI.
 *
 * These mirror the backend registry. The Source list itself is NOT duplicated
 * here — it is fetched from `GET /sales-channel/sources`, so a platform added
 * as data appears in the UI without a client change. Only the static labels
 * and ordering live on the client.
 */

export type ChannelV2 = 'WEBSITE' | 'MESSAGING' | 'PHONE_CALL' | 'POS';
export type AcquisitionType = 'PAID' | 'ORGANIC' | 'UNKNOWN';

export interface SourcePlatformView {
  slug: string;
  displayName: string;
  enabled: boolean;
  capabilities: string[];
}

/**
 * Coerce a `GET /sales-channel/sources` body to the platform array the
 * order-create page renders with `sourceOptions.map(...)`.
 *
 * The endpoint returns a bare array today, but the old derivation
 * `(messagingSources ?? [])` passed a truthy envelope object straight
 * through — `(envelope || []).map` throws `(oe || []).map is not a function`
 * and white-screens the whole page. Accept a bare array, a
 * `{sources: [...]}` envelope, or a `{data: [...]}` envelope; anything else
 * is an empty list. Entries without a slug or displayName are dropped so the
 * `<option>` list can never render a blank/broken row.
 */
export function normalizeSourcePlatforms(body: unknown): SourcePlatformView[] {
  let list: unknown[] = [];
  if (Array.isArray(body)) list = body;
  else if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    if (Array.isArray(b.sources)) list = b.sources;
    else if (Array.isArray(b.data)) list = b.data;
  }
  return (list as SourcePlatformView[]).filter(
    (s) => s && typeof s.slug === 'string' && s.slug.trim() && typeof s.displayName === 'string' && s.displayName.trim(),
  );
}

/**
 * Manual-order creation ordering: Messaging and Phone Call first. All four are
 * retained — Website and POS remain available for exceptional operational use.
 */
export const CHANNEL_OPTIONS: { value: ChannelV2; label: string }[] = [
  { value: 'MESSAGING', label: 'Messaging' },
  { value: 'PHONE_CALL', label: 'Phone Call' },
  { value: 'WEBSITE', label: 'Website' },
  { value: 'POS', label: 'POS' },
];

export const CHANNEL_LABELS: Record<ChannelV2, string> = Object.fromEntries(
  CHANNEL_OPTIONS.map((c) => [c.value, c.label]),
) as Record<ChannelV2, string>;

export const ACQUISITION_OPTIONS: { value: AcquisitionType; label: string }[] = [
  { value: 'PAID', label: 'Paid' },
  { value: 'ORGANIC', label: 'Organic' },
  { value: 'UNKNOWN', label: 'Unknown' },
];

export const ACQUISITION_LABELS: Record<AcquisitionType, string> = Object.fromEntries(
  ACQUISITION_OPTIONS.map((a) => [a.value, a.label]),
) as Record<AcquisitionType, string>;

/**
 * Empty values render as an em dash. The DATABASE keeps a true NULL for "not
 * established" — a fake string such as 'Unknown' is never persisted, because
 * it would be indistinguishable from a real UNKNOWN classification.
 */
export function displayValue(v?: string | null): string {
  return v && v.trim() ? v : '—';
}
