// ── Courier Settlement & Invoice Management (PRD §5-§14) — parsing layer ──
// Pure-data parsing types. The parser never touches money it cannot prove:
// `proven: false` rows are fail-closed (§11 / plan §10).

export type Provider = 'pathao' | 'steadfast' | 'redx' | 'carrybee';

export type RowClass = 'DATA' | 'SUMMARY' | 'FOOTER' | 'UNKNOWN';
export type RowKind =
  | 'DELIVERY'
  | 'RETURN'
  | 'FEE_ONLY'
  | 'BILLING_ONLY'
  | 'ADJUSTMENT'
  | 'SUMMARY'
  | 'FOOTER'
  | 'UNKNOWN';

export type MatchMethod =
  | 'BY_CONSIGNMENT'
  | 'BY_TRACKING'
  | 'BY_ORDER_DISPLAYID'
  | 'BY_ORDER_EXTERNALID'
  | 'BY_ORDER_CUSTOMER'
  | 'MANUAL'
  | 'NONE';

export type ExceptionSeverity = 'red' | 'yellow';

export interface RawRow {
  [header: string]: string;
}

export interface ChargeComponent {
  key: string;
  /** signed multiplier: +1 adds to charges, -1 subtracts */
  sign: number;
  value: number;
}

export interface ParsedMeta {
  provider: Provider;
  format: 'invoice';
  /** provider invoice number when declared in-file, else filename stem */
  invoiceNo?: string;
  invoiceDate?: Date;
  rowCount: number;
  /** provider-declared totals read verbatim from the footer/structure (informational) */
  rawTotals?: Record<string, number>;
  /** keyed footer lines (e.g. RedX "total", "total cash paid") */
  footer?: Record<string, string>;
  rawHeaders: string[];
  /** true when the provider has no proven finance rule (fail-closed) */
  isStructureOnly: boolean;
  /** true when no finance rule can be applied to any row */
  proven: boolean;
  /** detection confidence signal, e.g. "pathao: header signature" */
  reason?: string;
  /** count of skipped blank lines before/within the file (§13 anomaly signal) */
  blankLineCount?: number;
}

export interface ParsedRowAnomaly {
  /** residual = collected − charges − net; ≠ 0 is an anomaly */
  residual: number;
  /** provider component sum vs provider-declaed charges */
  arithmeticOk: boolean;
  arithmeticDelta: number;
  /** when false the row's net/charges are not mathematically proven */
  proven: boolean;
}

export interface ParsedRow {
  rowNumber: number;
  rowClass: RowClass;
  rowKind: RowKind;
  consignmentId?: string;
  displayId?: string;
  trackingCode?: string;
  recipientName?: string;
  recipientPhone?: string;
  /** gross collection (what the courier collected on our behalf) — signed as declared */
  collected: number;
  collectable?: number;
  /** declared courier charges (positive = amount deducted by the courier) */
  charges: number;
  /** declared net settlement (signed: + = remitted to us, - = we pay the courier) */
  net: number;
  /** effective values == declared until a Class-B/C adjustment is applied (§8/§9) */
  effectiveCollected: number;
  effectiveCharges: number;
  effectiveNet: number;
  chargeComponents: ChargeComponent[];
  deliveryStatus?: string;
  payoutMethod?: string;
  paymentStatus?: string;
  invoiceDate?: Date;
  /** provider-specific declared fields kept verbatim (for the Sheet display contract) */
  declared: Record<string, string>;
  /** verbatim source row (§9 ①) */
  raw: RawRow;
  netRule: string;
  anomaly: ParsedRowAnomaly;
}

export interface ParsedInvoice {
  meta: ParsedMeta;
  rows: ParsedRow[];
}
