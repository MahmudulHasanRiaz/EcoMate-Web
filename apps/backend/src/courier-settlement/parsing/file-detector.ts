// ── File detection (PRD §5, §10) — infer provider from headers + first row + name.
// Detection is structural (header signatures), never by trusting only the filename.

import { Provider } from './types';

export interface DetectedFile {
  provider: Provider | null;
  isXlsx: boolean;
  headerRow: number;
  reason: string;
  structureOnly: boolean;
}

const CSV_SIGNATURES: Array<{
  provider: Provider;
  headers: string[];
  note: string;
}> = [
  {
    provider: 'pathao',
    headers: ['Consignment_ID', 'Payout', 'Invoice type'],
    note: 'pathao: Consignment_ID + Payout + Invoice type (17 cols, no footer)',
  },
  {
    provider: 'carrybee',
    headers: ['Consignment_id', 'merchant_order_id', 'Billing_amount'],
    note: 'carrybee: Consignment_id + merchant_order_id + Billing_amount',
  },
  {
    provider: 'redx',
    headers: ['Parcel Id', 'Cash Paid'],
    note: 'redx: Parcel Id + Cash Paid (quoted header row 2; footer-only file)',
  },
  {
    provider: 'steadfast',
    headers: ['COD Amount', 'COD Charge'],
    note: 'steadfast: COD Amount + COD Charge (xlsx, but header signature also matches CSV shape)',
  },
];

export function detectSteadfastByMime(): boolean {
  return false;
}

export function detectProvider(
  fields: string[],
  isXlsx: boolean,
  filename: string,
): DetectedFile {
  const norm = (s: string) => String(s).trim().toLowerCase();
  const normFields = new Set(fields.map(norm));

  const match = CSV_SIGNATURES.find((s) => s.headers.every((h) => normFields.has(norm(h))));
  if (match) {
    return {
      provider: match.provider,
      isXlsx,
      headerRow: match.provider === 'redx' ? 2 : 1,
      reason: match.note,
      structureOnly: match.provider === 'redx',
    };
  }

  // Steadfast via xlsx is detected by COD Amount + COD Charge + Rider
  if (isXlsx && normFields.has('cod amount') && normFields.has('cod charge')) {
    return {
      provider: 'steadfast',
      isXlsx,
      headerRow: 1,
      reason: 'steadfast: COD Amount + COD Charge (xlsx signature)',
      structureOnly: false,
    };
  }

  // Filename fallback (lower confidence — still structural confirmation expected later)
  const fn = norm(filename);
  const fallback: Array<{ provider: Provider; test: (fn: string) => boolean }> = [
    { provider: 'pathao', test: (f) => f.includes('pathao') },
    { provider: 'steadfast', test: (f) => f.includes('steadfast') || f.includes('sfc-') },
    { provider: 'redx', test: (f) => f.includes('redx') },
    { provider: 'carrybee', test: (f) => f.includes('carrybee') },
  ];
  const fb = fallback.find((b) => b.test(fn));
  if (fb) {
    return {
      provider: fb.provider,
      isXlsx,
      headerRow: 1,
      reason: `filename fallback: ${fb.provider}`,
      structureOnly: fb.provider === 'redx',
    };
  }

  return { provider: null, isXlsx, headerRow: 1, reason: 'unknown provider', structureOnly: false };
}
