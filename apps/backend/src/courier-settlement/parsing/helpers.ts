// ── helpers for the courier-settlement parsing layer ──

import { Provider, RowClass, RowKind } from './types';

/** Parse a money cell: strips thousands separators. Returns NaN for non-numeric
 * text so callers can surface an anomaly rather than silently treating garbage as 0. */
export function parseMoney(value: string | undefined | null): number {
  if (value == null) return 0;
  const s = String(value).trim().replace(/,/g, '');
  if (s === '' || s === '-') return 0;
  const n = Number(s);
  return n;
}

export function isMoney(v: number): boolean {
  return Number.isFinite(v);
}

/** Absolute difference used for tolerance checks. */
export function withinTolerance(a: number, b: number, tolerance = 0.05): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= tolerance;
}

/** Parse a date cell loosely (Pathao "2026-09-26 15:00:02", Steadfast "2025-08-06 09:32:43 pm"). */
export function parseDate(value: string | undefined | null): Date | undefined {
  if (!value) return undefined;
  const raw = String(value).trim();
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d : undefined;
}

/** Mask a phone to its last 4 digits (PII anonymisation for fixtures/exports). */
export function maskPhone(phone: string | undefined): string | undefined {
  if (!phone) return phone;
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length <= 4) return digits;
  return `•••••••${digits.slice(-4)}`;
}

/** Generic name redaction for fixtures. */
export function redactName(name: string | undefined): string | undefined {
  if (!name) return name;
  return 'Customer';
}

/**
 * Reverse a double-encoded (mojibake) string produced by reading UTF-8 bytes as
 * Latin-1 and re-encoding to UTF-8. Only applied when the input contains high
 * bytes AND the Latin-1→UTF-8 decode yields clean (no replacement char) text that
 * differs from the input — so plain ASCII/UTF-8 strings are never altered.
 * Proven against the CarryBee fixture's double-encoded Bengali names.
 */
export function repairDoubleEncoding(value: string | undefined): string | undefined {
  if (!value) return value;
  // only attempt when the string actually contains bytes that look like mojibake
  if (!/[^\x00-\x7F]/.test(value)) return value;
  try {
    const decoded = Buffer.from(value, 'latin1').toString('utf8');
    if (decoded.includes('\uFFFD') || decoded === value || decoded.trim() === '') return value;
    return decoded;
  } catch {
    return value;
  }
}

export function normalizePhoneE164(phone: string | undefined): string | undefined {
  if (!phone) return phone;
  const digits = String(phone).replace(/\D/g, '');
  if (!digits) return phone;
  if (digits.startsWith('880')) return `+${digits}`;
  if (digits.startsWith('0')) return `+88${digits.slice(1)}`;
  return `+${digits}`;
}

/** Row-class inference from a parsed row. */
export function classifyRow(
  row: Record<string, string>,
  footerFirstCellValue: string | undefined,
  footerDetect: (value: string) => boolean,
  knownHeaders: Set<string>,
): RowClass {
  if (footerFirstCellValue && footerDetect(footerFirstCellValue)) return 'FOOTER';
  const hasAnyValue = Object.values(row).some((v) => v != null && String(v).trim() !== '');
  if (!hasAnyValue) return 'UNKNOWN';
  // A SUMMARY row has no identifier columns populated.
  return 'DATA';
}

export function resolveRowKind(
  raw: string | undefined,
  kindMap: Record<string, RowKind>,
): RowKind {
  if (raw == null) return 'UNKNOWN';
  const key = String(raw).trim().toLowerCase();
  return kindMap[key] ?? 'UNKNOWN';
}

/** True if the provider's declared structure implies a finance rule we can prove. */
export function providerProven(provider: Provider): boolean {
  return provider !== 'redx';
}

export const COURIER_LOGO: Record<Provider, string> = {
  pathao: 'Pathao',
  steadfast: 'Steadfast',
  redx: 'RedX',
  carrybee: 'CarryBee',
};
