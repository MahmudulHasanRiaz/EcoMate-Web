/**
 * Store identity helpers — central-commerce §8.10 (P1).
 *
 * Pure functions (unit-tested, no DB): domain normalisation and the
 * `identityFingerprint = hash(provider + providerStoreId + normalised
 * domain)` that lets reconnect reuse the same `Store` row. Duplicate
 * protection is structural (`@@unique([kind, domainNormalised])`); a
 * connect that resolves to an existing fingerprint returns 409 with a
 * "reconnect to existing store" payload instead of creating a row.
 */
import * as crypto from 'crypto';

export function normaliseDomain(domain: string | null | undefined): string | null {
  if (!domain) return null;
  let d = domain.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '').replace(/^www\./, '');
  d = d.split('/')[0].split('?')[0].split(':')[0].trim();
  return d || null;
}

export interface StoreIdentityInput {
  kind: string;
  providerStoreId?: string | null;
  domain?: string | null;
}

export function identityFingerprint(input: StoreIdentityInput): string {
  const parts = [
    input.kind,
    (input.providerStoreId ?? '').trim(),
    normaliseDomain(input.domain) ?? '',
  ];
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
}
