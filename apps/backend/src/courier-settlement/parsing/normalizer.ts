// ── Normalizer: raw rows → ParsedInvoice (§9 ①/② → declared values; effective==declared until adjusted).
// Per-provider net/charges resolution is proven against the real fixtures (§10).
// Unproven branches are marked `proven:false` (fail-closed, §11).

import { Provider, RowClass, RowKind, RawRow } from './types';
import type { ParsedInvoice, ParsedRow, ParsedRowAnomaly } from './types';
import type { ProviderDescriptor } from './descriptors';
import { getDescriptor } from './descriptors';
import {
  parseMoney,
  parseDate,
  resolveRowKind,
  classifyRow,
  repairDoubleEncoding,
} from './helpers';

const RESIDUAL_TOLERANCE = 0.05;
const ARITHMETIC_TOLERANCE = 1.0;

export function normalize(
  provider: Provider,
  fields: string[],
  rows: RawRow[],
  footer?: Record<string, string>,
  invoiceNo?: string,
  extraMeta: Partial<ParsedInvoice['meta']> = {},
): ParsedInvoice {
  const desc = getDescriptor(provider);

  const parsedRows: ParsedRow[] = rows.map((raw, idx) =>
    normalizeRow(provider, desc, raw, idx + 1, fields),
  );

  const dataRows = parsedRows.filter((r) => r.rowClass === 'DATA');
  const proven = provider !== 'redx' && dataRows.every((r) => r.anomaly.proven);

  return {
    meta: {
      provider,
      format: 'invoice',
      invoiceNo,
      invoiceDate: footer?.['Invoice Date'] ? parseDate(footer['Invoice Date']) : undefined,
      rowCount: parsedRows.length,
      rawTotals: footer ? undefined : undefined,
      footer,
      rawHeaders: fields,
      isStructureOnly: desc.structureOnly,
      proven,
      ...extraMeta,
    },
    rows: parsedRows,
  };
}

function headerFor(desc: ProviderDescriptor, kind: string): string | undefined {
  const col = desc.columns.find((c) => c.kind === kind);
  return col ? col.header : undefined;
}

function money(raw: RawRow, header: string | undefined): number {
  return parseMoney(header ? raw[header] : undefined);
}

function firstClass(desc: ProviderDescriptor, raw: RawRow): string | undefined {
  const firstKey = Object.keys(raw)[0];
  return firstKey ? raw[firstKey] : undefined;
}

function normalizeRow(
  provider: Provider,
  desc: ProviderDescriptor,
  raw: RawRow,
  rowNumber: number,
  fields: string[],
): ParsedRow {
  const firstCell = firstClass(desc, raw);
  const rowClass: RowClass = desc.structureOnly
    ? 'FOOTER'
    : classifyRow(raw, firstCell, (v) => desc.footerDetect(v), new Set(fields));

  // kind from the kind header
  const kindHeader = desc.kindHeader;
  let kind: RowKind = rowClass === 'FOOTER' ? 'FOOTER' : resolveRowKind(raw[kindHeader], desc.kindMap);

  // identifiers
  const consignmentId = desc.identifierOrder.includes('consignmentId')
    ? moneyOrText(raw, headerFor(desc, 'consignment'))
    : undefined;
  const displayId = desc.identifierOrder.includes('displayId')
    ? moneyOrText(raw, headerFor(desc, 'order'))
    : undefined;
  const trackingCode = desc.identifierOrder.includes('trackingCode')
    ? moneyOrText(raw, headerFor(desc, 'tracking'))
    : undefined;

  // non-DATA rows (FOOTER/SUMMARY/UNKNOWN) carry no financial values; their money
  // lives in invoice-level rawTotals (§10), never in per-row finance.
  const isData = rowClass === 'DATA';
  const collected = isData ? money(raw, desc.collectedHeader) : 0;
  const collectable = isData && desc.collectableHeader ? money(raw, desc.collectableHeader) : undefined;
  const declaredCharges = isData ? resolveCharges(desc, raw, collected) : 0;
  const declaredNet = isData ? resolveNet(desc, raw, collected, declaredCharges) : 0;

  // CarryBee prepaid rows are economically BILLING_ONLY (no collection on our behalf).
  if (provider === 'carrybee' && collected === 0) {
    kind = 'BILLING_ONLY';
  }

  // component sum vs provider-declared charges (arithmetic invariant)
  const componentSum = desc.chargeComponents.reduce((acc, c) => acc + (c.sign * money(raw, c.header)), 0);
  const arithmeticDelta = desc.chargesHeader && isData
    ? componentSum - declaredCharges
    : 0; // when charges are derived from components, invariant holds by construction
  const arithmeticOk = Number.isFinite(arithmeticDelta)
    ? Math.abs(arithmeticDelta) <= ARITHMETIC_TOLERANCE
    : isData === false;

  const residual = Number.isFinite(declaredNet) ? collected - declaredCharges - declaredNet : 0;
  // non-DATA rows are never financial facts; data rows are proven per the netRule
  const proven = isData ? numberProven(provider, desc, collected, declaredNet, declaredCharges) : true;

  const anomaly: ParsedRowAnomaly = {
    residual,
    arithmeticOk,
    arithmeticDelta,
    proven,
  };

  // declared = verbatim source values (§9 ② is recomputable from raw, so raw alone suffices)
  const declared: Record<string, string> = {};
  for (const h of fields) {
    declared[h] = raw[h] ?? '';
  }

  const effectiveCollected = collected;
  const effectiveCharges = declaredCharges;
  const effectiveNet = Number.isFinite(declaredNet) ? declaredNet : 0;

  return {
    rowNumber,
    rowClass,
    rowKind: rowClass === 'FOOTER' ? 'FOOTER' : kind,
    consignmentId,
    displayId,
    trackingCode,
    recipientName: repairDoubleEncoding(textOnly(raw, headerFor(desc, 'recipient_name'))),
    recipientPhone: textOnly(raw, headerFor(desc, 'recipient_phone')),
    collected,
    collectable,
    charges: declaredCharges,
    net: Number.isFinite(declaredNet) ? declaredNet : 0,
    effectiveCollected,
    effectiveCharges,
    effectiveNet,
    chargeComponents: desc.chargeComponents.map((c) => ({
      key: c.field,
      sign: c.sign,
      value: money(raw, c.header),
    })),
    deliveryStatus: textOnly(raw, headerFor(desc, 'delivery_status')),
    payoutMethod: textOnly(raw, headerFor(desc, 'payout_method')),
    paymentStatus: textOnly(raw, headerFor(desc, 'payment_status')),
    invoiceDate: parseDate(textOnly(raw, headerFor(desc, 'date'))),
    declared,
    raw,
    netRule: desc.netRule,
    anomaly,
  };
}

/** charges = provider-declared total when present, else sum of signed components. */
function resolveCharges(desc: ProviderDescriptor, raw: RawRow, _collected: number): number {
  if (desc.chargesHeader) return money(raw, desc.chargesHeader);
  return desc.chargeComponents.reduce((acc, c) => acc + c.sign * money(raw, c.header), 0);
}

/** net per proven netRule. NaN = unproven branch (fail-closed). */
function resolveNet(
  desc: ProviderDescriptor,
  raw: RawRow,
  collected: number,
  charges: number,
): number {
  switch (desc.netRule) {
    case 'declared_payout':
      return desc.netHeader ? money(raw, desc.netHeader) : NaN;
    case 'collected_minus_charges':
      return collected - charges;
    case 'billing_when_no_collection': {
      const billing = desc.billingHeader ? money(raw, desc.billingHeader) : 0;
      // collected>0 branch is unproven for CarryBee → NaN (fail-closed)
      if (collected > 0) return NaN;
      return collected === 0 ? -billing : NaN;
    }
    case 'none':
    default:
      return NaN;
  }
}

function numberProven(
  provider: Provider,
  desc: ProviderDescriptor,
  collected: number,
  net: number,
  charges: number,
): boolean {
  if (provider === 'redx') return false;
  if (desc.netRule === 'none') return false;
  if (desc.netRule === 'billing_when_no_collection' && collected > 0) return false;
  // residual must reconcile within tolerance
  if (!Number.isFinite(net) || !Number.isFinite(charges)) return false;
  const residual = collected - charges - net;
  return Math.abs(residual) <= RESIDUAL_TOLERANCE;
}

function textOnly(raw: RawRow, header: string | undefined): string | undefined {
  if (!header) return undefined;
  const v = raw[header];
  if (v == null || v === '') return undefined;
  return String(v);
}

function moneyOrText(raw: RawRow, header: string | undefined): string | undefined {
  if (!header) return undefined;
  const v = raw[header];
  return v == null || v === '' ? undefined : String(v);
}
