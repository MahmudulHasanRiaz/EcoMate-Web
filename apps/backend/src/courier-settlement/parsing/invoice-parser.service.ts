// ── Invoice parser service: detect → read → normalize → attach provenance.
// Pure function (no side effects, no DB). §9 ① raw is preserved verbatim on each row.

import { parseCsv, csvRowFirstCell } from './csv.reader';
import { parseXlsx } from './xlsx.reader';
import { detectProvider } from './file-detector';
import { normalize } from './normalizer';
import { getDescriptor } from './descriptors';
import { Provider, ParsedInvoice, RawRow } from './types';
import { parseMoney, parseDate } from './helpers';

export interface ParseInput {
  buffer: Buffer;
  filename: string;
  mimeType?: string;
  /**
   * Provider-scoped column mapping (§12). Aliases are applied ONLY after the
   * provider has been detected from the file's own headers, only for the
   * matching courier, and only when exactly one active alias claims a
   * canonical field — so a mapping can never change format detection or pick
   * silently between two competing columns.
   */
  aliases?: ParseAlias[];
}

export interface ParseAlias {
  courier: string;
  sourceHeader: string;
  field: string;
  active?: boolean;
}

export async function parseInvoiceFile(input: ParseInput): Promise<ParsedInvoice> {
  const { buffer, filename } = input;
  const isXlsx = /\.xlsx?$/i.test(filename) || (input.mimeType ?? '').includes('spreadsheet');

  const { fields, rows: rawRows, blankLineCount } = isXlsx
    ? await readXlsx(buffer, filename)
    : (() => {
        const csv = parseCsv(buffer.toString('utf8'));
        return { fields: csv.fields, rows: csv.rows, blankLineCount: csv.blankLineCount };
      })();

  const detected = detectProvider(fields, isXlsx, filename);
  if (!detected.provider) {
    throw new FileTypeUnsupportedError(
      `Unable to detect a known courier provider from headers of "${filename}". ` +
        'Headers: ' + JSON.stringify(fields),
    );
  }

  const provider = detected.provider;
  const desc = getDescriptor(provider);

  // §12 learned/manual mapping: replay confirmed column aliases onto the raw
  // rows before normalization so the proven descriptor rules apply unchanged.
  const overrides = resolveAliases(provider, input.aliases);
  if (Object.keys(overrides).length > 0) {
    applyOverrides(fields, rawRows, desc, overrides);
  }

  // Header may not be row 1 (RedX: blank row 1, header row 2). The CSV reader
  // already skipped blanks and captured the first non-empty row as the header,
  // so `fields` is correct. For xlsx we read row 1 as header.
  let footer: Record<string, string> | undefined;
  let rawTotals: Record<string, number> | undefined;

  if (desc.structureOnly) {
    footer = collectFooter(rawRows, desc);
    rawTotals = collectFooterTotals(footer);
  }

  const invoiceNo = deriveInvoiceNo(filename, provider, rawRows, desc);
  const invoiceDate = deriveInvoiceDate(filename, provider, rawRows, desc);

  const parsed = normalize(
    provider,
    fields,
    rawRows,
    footer,
    invoiceNo,
    { reason: detected.reason, blankLineCount, invoiceDate },
  );

  // RedX (structure-only) surfaces footer totals as informational rawTotals;
  // proven finance consumers ignore structure-only invoices entirely.
  if (detected.structureOnly) {
    parsed.meta.rawTotals = rawTotals;
  }

  return parsed;
}

async function readXlsx(buffer: Buffer, _filename: string) {
  const { fields, rows } = await parseXlsx(buffer, { headerRow: 1 });
  return { fields, rows, blankLineCount: 0 };
}

function collectFooter(rawRows: RawRow[], desc: { footerDetect: (v: string) => boolean }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rawRows) {
    const first = csvRowFirstCell(r);
    if (first && desc.footerDetect(first)) {
      out[String(first).trim().toLowerCase()] = JSON.stringify(r);
    }
  }
  return out;
}

/** RedX-style: sum the money columns across footer/summary rows verbatim. */
function collectFooterTotals(footer: Record<string, string>): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const [, json] of Object.entries(footer)) {
    try {
      const row = JSON.parse(json) as Record<string, string>;
      for (const [k, v] of Object.entries(row)) {
        const num = parseMoney(v);
        if (Number.isFinite(num) && num !== 0) {
          const key = k.toLowerCase();
          totals[key] = (totals[key] ?? 0) + num;
        }
      }
    } catch {
      /* ignore unparsable */
    }
  }
  return totals;
}

function deriveInvoiceNo(filename: string, provider: Provider, rawRows: RawRow[], desc: { columns: { header: string; field: string; kind: string }[] }): string {
  const invoiceHeader = desc.columns.find((c) => c.kind === 'invoice_no');
  if (invoiceHeader) {
    const values = new Set<string>();
    for (const r of rawRows) {
      const v = r[invoiceHeader.header];
      if (v != null && String(v).trim() !== '') values.add(String(v).trim());
    }
    if (values.size === 1) return values.values().next().value;
  }
  // Fallback: filename stem.
  const stem = filename.replace(/\.[^.]+$/, '');
  return stem;
}

function deriveInvoiceDate(
  filename: string,
  _provider: Provider,
  rawRows: RawRow[],
  desc: { columns: { header: string; field: string; kind: string }[] },
): Date | undefined {
  const fm = filename.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (fm) {
    const d = new Date(`${fm[1]}-${fm[2]}-${fm[3]}`);
    if (Number.isFinite(d.getTime())) return d;
  }
  const dateHeader = desc.columns.find((c) => c.kind === 'date' && c.field === 'invoicedDate')?.header
    ?? desc.columns.find((c) => c.kind === 'date')?.header;
  if (dateHeader && rawRows.length) {
    const v = rawRows[0][dateHeader];
    const d = parseDate(v);
    if (d) return d;
  }
  return undefined;
}

export class FileTypeUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileTypeUnsupportedError';
  }
}

/** §12 — provider-scoped, exactly one active alias per canonical field. */
function resolveAliases(provider: string, aliases?: ParseAlias[]): Record<string, string> {
  const out: Record<string, string> = {};
  const candidates = new Map<string, Set<string>>();
  for (const a of aliases ?? []) {
    if (a.courier !== provider || !a.active) continue;
    if (!candidates.has(a.field)) candidates.set(a.field, new Set());
    candidates.get(a.field)!.add(a.sourceHeader);
  }
  for (const [field, headers] of candidates) {
    // Two active columns claiming the same field ⇒ ambiguity ⇒ do not apply.
    if (headers.size === 1) out[field] = [...headers][0];
  }
  return out;
}

/**
 * Canonical field → the descriptor header that must receive the value.
 * Returns undefined when the provider has no such slot (e.g. RedX has no
 * consignment column), in which case the mapping is inert for this file.
 */
function targetHeaderFor(
  desc: ReturnType<typeof getDescriptor>,
  field: string,
): string | undefined {
  switch (field) {
    case 'consignmentId':
    case 'displayId':
    case 'trackingCode':
    case 'orderId':
      return desc.columns.find((c) => c.kind === identifierKind(field))?.header;
    case 'collected':
      return desc.collectedHeader;
    case 'net':
      return desc.netHeader;
    case 'charges':
      return desc.chargesHeader;
    case 'collectable':
      return desc.collectableHeader;
    default:
      return undefined;
  }
}

function identifierKind(field: string): string {
  switch (field) {
    case 'consignmentId':
      return 'consignment';
    case 'displayId':
      return 'order';
    case 'trackingCode':
      return 'tracking';
    default:
      return 'order';
  }
}

function applyOverrides(
  fields: string[],
  rawRows: RawRow[],
  desc: ReturnType<typeof getDescriptor>,
  overrides: Record<string, string>,
): void {
  for (const [field, sourceHeader] of Object.entries(overrides)) {
    const target = targetHeaderFor(desc, field);
    if (!target || !sourceHeader) continue;
    if (sourceHeader === target) continue;
    if (!fields.includes(sourceHeader)) continue;
    if (fields.includes(target)) continue; // file already carries the canonical column
    for (const row of rawRows) {
      const value = row[sourceHeader];
      if (value !== undefined) row[target] = value;
    }
    fields.push(target);
  }
}
