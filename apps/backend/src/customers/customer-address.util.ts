/**
 * Address normalisation and identity fingerprinting.
 *
 * The fingerprint answers one question: "is this the same physical address we
 * already hold for this customer in this role?" It is deliberately strict — the
 * safe failure mode is a NEW row, never a merge of two different addresses.
 * thana/district alone can never identify an address, because many homes share
 * a locality; the house/road line is always part of the identity.
 *
 * Pure module: no DB, no clock, no side effects. Fully unit-testable.
 */
import { createHash } from 'crypto';

export interface AddressInput {
  fullName?: string | null;
  phone?: string | null;
  addressLine?: string | null;
  area?: string | null;
  thana?: string | null;
  district?: string | null;
  division?: string | null;
  postalCode?: string | null;
  country?: string | null;
}

export interface NormalizedAddress extends AddressInput {
  fullName: string;
  phone: string;
  addressLine: string;
  area: string;
  thana: string;
  district: string;
  postalCode: string;
  country: string;
}

/** Bengali digits → ASCII, so ১২৩৪ and 1234 compare equal. */
function foldBengaliDigits(v: string): string {
  return v.replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d)));
}

/** Words that carry no address identity — dropped entirely. */
const NOISE_WORDS = new Set(['the', 'of', 'at']);

/**
 * Token-level aliases. Applied per token so "Road 7" and "Rd 7" match, while
 * longer phrases ("post code" / "postal code") collapse through the same table.
 */
const TOKEN_ALIASES: Record<string, string> = {
  rd: 'road',
  road: 'road',
  str: 'street',
  street: 'street',
  ave: 'avenue',
  avenue: 'avenue',
  blvd: 'boulevard',
  upazila: 'thana',
  upazila_new: 'thana',
  thana: 'thana',
  ps: 'postcode',
  postcode: 'postcode',
  post: 'postcode',
  postal: 'postcode',
  zip: 'postcode',
  zipcode: 'postcode',
  house: 'house',
  flat: 'house',
  apartment: 'house',
  apt: 'house',
  bhawan: 'house',
};

/**
 * Multi-word aliases collapsed BEFORE tokenisation, because a per-token table
 * cannot reduce a two-word phrase ("post code" → "postcode").
 */
const PHRASE_ALIASES: [RegExp, string][] = [
  [/\bpost\s*code\b/g, 'postcode'],
  [/\bpostal\s*code\b/g, 'postcode'],
  [/\bzip\s*code\b/g, 'postcode'],
  [/\bhouse\s*hold\b/g, 'house'],
  [/\bflat\s*no\b/g, 'house'],
  [/\bapartment\s*no\b/g, 'house'],
];

/**
 * Normalise one address component to a comparable token string.
 * Lowercases, folds Bengali digits, unifies &/and, strips punctuation, maps
 * aliases, and collapses whitespace. Returns '' for absent values.
 */
export function normalizeAddressPart(value?: string | null): string {
  if (value === null || value === undefined) return '';
  let v = foldBengaliDigits(String(value)).toLowerCase().trim();
  if (!v) return '';
  v = v.replace(/&/g, ' and ');
  for (const [pattern, replacement] of PHRASE_ALIASES) v = v.replace(pattern, replacement);
  // Strip everything that is not a letter, digit, or space.
  v = v.replace(/[^\p{L}\p{N}\s]+/gu, ' ');
  const tokens = v
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => TOKEN_ALIASES[t] ?? t)
    .filter((t) => !NOISE_WORDS.has(t));
  return tokens.join(' ');
}

/** Normalise every component of an address. */
export function normalizeFullAddress(input: AddressInput): NormalizedAddress {
  return {
    fullName: normalizeAddressPart(input.fullName),
    phone: normalizeAddressPart(input.phone),
    addressLine: normalizeAddressPart(input.addressLine),
    area: normalizeAddressPart(input.area),
    thana: normalizeAddressPart(input.thana),
    district: normalizeAddressPart(input.district),
    division: normalizeAddressPart(input.division),
    postalCode: normalizeAddressPart(input.postalCode),
    country: normalizeAddressPart(input.country) || 'bangladesh',
  };
}

/**
 * sha256 over the identity-bearing components. `division` is deliberately
 * EXCLUDED: it is derived from district, so including it would let a correct
 * address hash differently purely because a resolver disagreed about division.
 */
export function addressFingerprint(input: AddressInput): string {
  const n = normalizeFullAddress(input);
  const canonical = [
    n.fullName,
    n.phone,
    n.addressLine,
    n.area,
    n.thana,
    n.district,
    n.postalCode,
    n.country,
  ].join('|');
  return createHash('sha256').update(canonical).digest('hex');
}

/** Aliases found in order JSON blobs across the codebase and storefront. */
const LINE_KEYS = ['addressLine', 'address', 'address_line', 'street', 'line', 'house'];
const NAME_KEYS = ['fullName', 'full_name', 'name', 'customerName'];
const PHONE_KEYS = ['phone', 'phoneNumber', 'phone_number', 'contact'];
const AREA_KEYS = ['area', 'areaName'];
const THANA_KEYS = ['thana', 'upazila', 'zone'];
const DISTRICT_KEYS = ['district', 'city'];
const DIVISION_KEYS = ['division', 'state', 'province'];
const POSTAL_KEYS = ['postalCode', 'postCode', 'post_code', 'zip', 'zipCode', 'postal'];

function pick(obj: Record<string, any>, keys: string[]): string {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

/**
 * Read a `shippingAddress`/`billingAddress` JSON blob into AddressInput.
 * Returns null when the blob has no usable address line — an address with no
 * house/road is not an address we can safely store or deduplicate.
 */
export function readAddressBlob(blob: unknown): AddressInput | null {
  if (!blob || typeof blob !== 'object' || Array.isArray(blob)) return null;
  const o = blob as Record<string, any>;
  const addressLine = pick(o, LINE_KEYS);
  if (!addressLine) return null;
  return {
    fullName: pick(o, NAME_KEYS),
    phone: pick(o, PHONE_KEYS),
    addressLine,
    area: pick(o, AREA_KEYS),
    thana: pick(o, THANA_KEYS),
    district: pick(o, DISTRICT_KEYS),
    division: pick(o, DIVISION_KEYS),
    postalCode: pick(o, POSTAL_KEYS),
    country: typeof o.country === 'string' && o.country.trim() ? o.country.trim() : 'Bangladesh',
  };
}

/** True when a blob carries no address content (null, {}, or non-object). */
export function isEmptyAddressBlob(blob: unknown): boolean {
  return readAddressBlob(blob) === null;
}
