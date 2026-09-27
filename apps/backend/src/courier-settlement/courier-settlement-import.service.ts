// ── Ingestion pipeline (PRD §9, §13): analyze → preview → confirm → import.
//
// The financial document is NEVER committed by the upload click. `analyze()`
// parses in memory, stores the immutable original bytes and leaves the invoice
// in a draft state (ANALYZED / MAPPING_REQUIRED) with zero rows and zero
// exceptions — nothing it produces reaches KPIs, the exception queue or
// accounting. `commit()` is the single point where rows + exceptions are
// persisted, and it is only reachable from a draft state.

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { createHash } from 'crypto';
import {
  CourierSettlementInvoice,
  CourierSettlementInvoiceState,
  CourierSettlementRowClass,
  CourierSettlementRowKind,
} from '@prisma/client';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { parseInvoiceFile, type ParseAlias } from './parsing/invoice-parser.service';
import { getDescriptor } from './parsing/descriptors';
import type { ParsedInvoice, ParsedRow, Provider, RawRow } from './parsing/types';
import { matchRow, emptyIndexes, norm, type MatchIndexes } from './reconciliation/matcher';
import { evaluateRules, type RuleContext } from './reconciliation/rules';
import { expectedCod } from './economics';
import { FINALIZED_INVOICE_STATES } from './cost-projection';
import { CourierSettlementActivityService } from './activity.service';
import { dhakaDateParts } from '../common/utils/dhaka-time';
import {
  ASYNC_COMMIT_MIN_ROWS,
  INVOICE_DISPLAY_PREFIX,
  INSERT_BATCH_SIZE,
  MAX_COLUMNS,
  MAX_DATA_ROWS,
  MAX_UPLOAD_BYTES,
  PARSE_BUDGET_MS,
} from './courier-settlement.constants';

/** States in which an invoice is a resumable draft (no rows/exceptions yet). */
export const DRAFT_STATES: CourierSettlementInvoiceState[] = [
  'UPLOADED',
  'ANALYZED',
  'MAPPING_REQUIRED',
];

/** Preview never ships more than this many rows in one response (§20 P13). */
export const PREVIEW_ROW_LIMIT = 200;

export interface UploadInput {
  buffer: Buffer;
  filename: string;
  mimeType?: string;
  courier?: string;
  revisionOfId?: string;
  reason?: string;
  actor?: string | null;
  /** persist the original bytes; disabled in unit tests that have no storage. */
  storeFile?: boolean;
}

export interface UploadResult {
  invoiceId: string;
  displayId: string;
  provider: Provider;
  state: CourierSettlementInvoiceState;
  rowCount: number;
  /** Omitted on the async (background) import response — computed by the job. */
  matchedCount?: number;
  severity?: 'green' | 'yellow' | 'red';
  blocking?: boolean;
  duplicateFile?: boolean;
  /** true when the file matched an existing draft that was resumed */
  resumed?: boolean;
  preview?: InvoicePreview;
  importProgress?: number;
}

export interface PreviewFinding {
  severity: 'red' | 'yellow' | 'green';
  ruleId: string;
  message: string;
  count: number;
  blocking: boolean;
  sampleRowNumbers: number[];
}

export interface PreviewRowFinding {
  ruleId: string;
  severity: 'red' | 'yellow';
  blocking: boolean;
  message: string;
}

export interface PreviewRow {
  rowNumber: number;
  rowClass: string;
  rowKind: string;
  identifier: string | null;
  matchMethod: string;
  reviewState: 'green' | 'yellow' | 'red';
  declared: { collected: number; charges: number; net: number; residual: number };
  findings: PreviewRowFinding[];
  raw: Record<string, string>;
}

export interface PreviousSettlement {
  orderId: string;
  orderDisplayId: string | null;
  invoices: { invoiceId: string; displayId: string; finalizedAt: string | null }[];
  net: number;
  charges: number;
  collected: number;
  rowCount: number;
}

export interface InvoicePreview {
  invoiceId: string;
  displayId: string;
  state: CourierSettlementInvoiceState;
  resumed: boolean;
  duplicateFile: boolean;
  identity: {
    courier: string;
    provider: Provider;
    invoiceNo: string | null;
    invoiceDate: string;
    filename: string;
    fileSize: number | null;
    fileMime: string | null;
    sha256: string | null;
    format: string;
    detectReason?: string;
    proven: boolean;
    structureOnly: boolean;
  };
  classification: {
    total: number;
    data: number;
    summary: number;
    footer: number;
    unknown: number;
    blankLines: number;
    headers: string[];
  };
  matching: {
    matched: number;
    unmatched: number;
    duplicateIdentifiersInFile: number;
    previouslySettledOrders: number;
  };
  money: {
    grossCollected: number;
    charges: number;
    net: number;
    cashReceived: number;
    cashDisbursed: number;
    residual: number;
    expectedCod: number | null;
  };
  previousSettlements: PreviousSettlement[];
  findings: PreviewFinding[];
  rows: PreviewRow[];
  rowsTruncated: boolean;
}

interface PreparedRow {
  row: ParsedRow;
  match: ReturnType<typeof matchRow>;
  findings: ReturnType<typeof evaluateRules>;
  expected?: { value: number; divergence: boolean };
}

interface Prepared {
  parsed: ParsedInvoice;
  provider: Provider;
  courier: string;
  sha256: string;
  duplicateFile: boolean;
  courierFormatMismatch: boolean;
  rowRecords: PreparedRow[];
  invoiceFindings: ReturnType<typeof evaluateRules>;
  allFindings: ReturnType<typeof evaluateRules>;
  matchedCount: number;
  dataRowCount: number;
  state: CourierSettlementInvoiceState;
}

@Injectable()
export class CourierSettlementImportService {
  private readonly logger = new Logger(CourierSettlementImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: CourierSettlementActivityService,
    @Optional() @Inject(StorageService) private readonly storage?: StorageService,
    // §17 async threshold: registered by the module; optional so unit tests and
    // queue-less environments fall back to the synchronous import path.
    @Optional() @InjectQueue('courier-settlement-import') private readonly importQueue?: Queue,
  ) {}

  validateUpload(buffer: Buffer, _filename: string): void {
    if (buffer.length === 0) throw new BadRequestException('Uploaded file is empty');
    if (buffer.length > MAX_UPLOAD_BYTES) {
      throw new BadRequestException(
        `File exceeds the ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB limit`,
      );
    }
  }

  // ── Step 1: analyze (draft). Stores bytes + header only, never rows. ──
  async analyze(input: UploadInput): Promise<UploadResult> {
    this.validateUpload(input.buffer, input.filename);
    const sha256 = createHash('sha256').update(input.buffer).digest('hex');

    // Same file, still a draft ⇒ resume it. Re-analysing never forks a second
    // invoice for the same bytes (§13 duplicate safety / Q8).
    const draft = await this.prisma.courierSettlementInvoice.findFirst({
      where: { fileSha256: sha256, isRevision: false, state: { in: DRAFT_STATES } },
      select: { id: true, displayId: true, state: true },
    });
    if (draft && !input.revisionOfId) {
      const full = (await this.prisma.courierSettlementInvoice.findUnique({
        where: { id: draft.id },
      })) as CourierSettlementInvoice;
      const preview = await this.previewFrom(input, draft.id, full);
      return {
        invoiceId: draft.id,
        displayId: draft.displayId,
        provider: preview.identity.provider,
        state: draft.state,
        rowCount: preview.classification.total,
        matchedCount: preview.matching.matched,
        severity: severityOfFindings(preview.findings),
        blocking: preview.findings.some((f) => f.blocking),
        duplicateFile: preview.duplicateFile,
        resumed: true,
        preview,
      };
    }

    const prepared = await this.prepare(input, draft?.id ?? undefined);
    const displayId = await this.nextDisplayId();
    const fileRef = input.storeFile === false ? null : await this.storeFile(input, sha256);
    const state: CourierSettlementInvoiceState = prepared.state === 'MAPPING_REQUIRED'
      ? 'MAPPING_REQUIRED'
      : 'ANALYZED';

    const created = await this.prisma.courierSettlementInvoice.create({
      data: {
        displayId,
        courier: prepared.courier,
        provider: prepared.provider,
        invoiceNo: prepared.parsed.meta.invoiceNo ?? null,
        invoiceDate: prepared.parsed.meta.invoiceDate ?? new Date(),
        rowCount: prepared.parsed.rows.length,
        fileStorageId: fileRef?.storageKey ?? null,
        fileOriginalName: input.filename,
        fileSha256: sha256,
        fileMime: input.mimeType ?? null,
        fileSize: input.buffer.length,
        rawTotals: (prepared.parsed.meta.rawTotals ?? prepared.parsed.meta.footer ?? null) as never,
        isRevision: !!input.revisionOfId,
        revisionOfId: input.revisionOfId ?? null,
        state,
      },
    });

    const preview = await this.buildPreview(prepared, created, { resumed: false });
    return {
      invoiceId: created.id,
      displayId,
      provider: prepared.provider,
      state,
      rowCount: preview.classification.total,
      matchedCount: preview.matching.matched,
      severity: severityOfFindings(preview.findings),
      blocking: preview.findings.some((f) => f.blocking),
      duplicateFile: prepared.duplicateFile,
      resumed: false,
      preview,
    };
  }

  // ── Step 2: preview for a stored draft (reopen / resume). ──
  async previewFor(invoiceId: string): Promise<InvoicePreview> {
    const invoice = await this.prisma.courierSettlementInvoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new BadRequestException('Invoice not found');
    if (!DRAFT_STATES.includes(invoice.state)) {
      throw new ConflictException(
        'This invoice has already been imported — open it to review the imported rows.',
      );
    }
    const buffer = await this.readStoredFile(invoice);
    return this.previewFrom(
      {
        buffer,
        filename: invoice.fileOriginalName ?? 'invoice.csv',
        mimeType: invoice.fileMime ?? undefined,
        courier: invoice.courier,
        storeFile: false,
      },
      invoice.id,
      invoice,
    );
  }

  private async previewFrom(input: UploadInput, selfId: string, known?: CourierSettlementInvoice): Promise<InvoicePreview> {
    const prepared = await this.prepare(input, selfId);
    const header =
      known ??
      (({
        id: selfId,
        displayId: '',
        courier: prepared.courier,
        fileOriginalName: input.filename,
        fileMime: input.mimeType ?? null,
        fileSize: input.buffer.length,
        fileSha256: prepared.sha256,
        state: 'ANALYZED' as CourierSettlementInvoiceState,
        invoiceNo: prepared.parsed.meta.invoiceNo ?? null,
        invoiceDate: prepared.parsed.meta.invoiceDate ?? new Date(),
        createdAt: new Date(),
      } as unknown) as CourierSettlementInvoice);
    return this.buildPreview(prepared, header, { resumed: true });
  }

  // ── Step 3: confirm the import (draft → rows persisted). ──
  /**
   * Threshold gate (§17): small invoices import synchronously (unchanged UX);
   * at/above ASYNC_COMMIT_MIN_ROWS the draft is claimed into IMPORTING, a
   * background job does the heavy write, and the caller gets an honest
   * `{ state: 'IMPORTING', importProgress }` to poll. jobId makes enqueue
   * idempotent; a Redis failure falls back to the synchronous path.
   */
  async commitOrSchedule(
    invoiceId: string,
    actor?: string | null,
  ): Promise<UploadResult & { importProgress?: number }> {
    const invoice = await this.prisma.courierSettlementInvoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, displayId: true, provider: true, state: true, rowCount: true },
    });
    if (!invoice) throw new BadRequestException('Invoice not found');
    if (!DRAFT_STATES.includes(invoice.state)) {
      throw new ConflictException('This invoice has already been imported.');
    }
    if (invoice.rowCount < ASYNC_COMMIT_MIN_ROWS || !this.importQueue) {
      return this.commit(invoiceId, actor);
    }

    const claim = await this.prisma.courierSettlementInvoice.updateMany({
      where: { id: invoiceId, state: { in: DRAFT_STATES } },
      data: { state: 'IMPORTING', importProgress: 5, importStage: 'queued' },
    });
    if (claim.count !== 1) {
      throw new ConflictException('This invoice has already been imported.');
    }
    try {
      await this.importQueue.add(
        'commit',
        { invoiceId, actor: actor ?? null, previousState: invoice.state },
        {
          jobId: `cs-commit-${invoiceId}`,
          removeOnComplete: { age: 60 * 60 },
          removeOnFail: true,
        },
      );
    } catch (e) {
      this.logger.warn(`Async enqueue failed, importing synchronously: ${(e as Error).message}`);
      await this.prisma.courierSettlementInvoice.update({
        where: { id: invoiceId },
        data: { state: invoice.state, importProgress: 0, importStage: null },
      });
      return this.commit(invoiceId, actor);
    }
    return {
      invoiceId,
      displayId: invoice.displayId,
      provider: invoice.provider as Provider,
      state: 'IMPORTING',
      rowCount: invoice.rowCount,
      importProgress: 5,
    };
  }

  async commit(
    invoiceId: string,
    actor?: string | null,
    /** supplied by the one-shot path so tests need no file storage */
    knownBuffer?: Buffer,
  ): Promise<UploadResult> {
    const invoice = await this.prisma.courierSettlementInvoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new BadRequestException('Invoice not found');
    // IMPORTING is accepted: the background job re-enters commit() there; every
    // other non-draft state is a replay and must 409.
    if (!DRAFT_STATES.includes(invoice.state) && invoice.state !== 'IMPORTING') {
      throw new ConflictException('This invoice has already been imported.');
    }
    const buffer = knownBuffer ?? (await this.readStoredFile(invoice));

    const prepared = await this.prepare(
      {
        buffer,
        filename: invoice.fileOriginalName ?? 'invoice.csv',
        mimeType: invoice.fileMime ?? undefined,
        courier: invoice.courier,
        storeFile: false,
        actor,
      },
      invoice.id,
    );

    const state = prepared.state;
    const created = await this.prisma.$transaction(async (tx) => {
      const existingRows = await tx.courierSettlementRow.count({ where: { invoiceId } });
      if (existingRows > 0) {
        throw new ConflictException('This invoice has already been imported.');
      }
      await this.persistRows(tx, invoiceId, prepared);
      return tx.courierSettlementInvoice.update({
        where: { id: invoiceId },
        data: {
          state,
          rowCount: prepared.parsed.rows.length,
          provider: prepared.provider,
          courier: prepared.courier,
          invoiceNo: prepared.parsed.meta.invoiceNo ?? invoice.invoiceNo ?? null,
          invoiceDate: prepared.parsed.meta.invoiceDate ?? invoice.invoiceDate,
          // §3/§18: freeze the source column order — jsonb key order in
          // rawJson does not match the file (it re-sorts keys by length).
          sourceHeaders: prepared.parsed.meta.rawHeaders,
        },
      });
    });

    await this.recordImportActivity(created, prepared, invoice.fileSha256 ?? prepared.sha256, actor);

    return {
      invoiceId: created.id,
      displayId: created.displayId,
      provider: prepared.provider,
      state,
      rowCount: prepared.parsed.rows.length,
      matchedCount: prepared.matchedCount,
      severity: severityOfFindings(prepared.allFindings),
      blocking: prepared.allFindings.some((f) => f.blocking || f.severity === 'red'),
      duplicateFile: prepared.duplicateFile,
    };
  }

  // ── One-shot path (revisions + programmatic callers): analyze + commit. ──
  async ingest(input: UploadInput): Promise<UploadResult> {
    const analyzed = await this.analyze(input);
    const committed = await this.commit(analyzed.invoiceId, input.actor ?? null, input.buffer);
    return { ...committed, resumed: analyzed.resumed };
  }

  // ── Pure preparation: parse + match + rules, no DB writes. ──
  private async prepare(input: UploadInput, selfId?: string): Promise<Prepared> {
    this.validateUpload(input.buffer, input.filename);
    const budgetStartedAt = Date.now();
    const sha256 = createHash('sha256').update(input.buffer).digest('hex');

    const existing = await this.prisma.courierSettlementInvoice.findFirst({
      where: {
        fileSha256: sha256,
        isRevision: false,
        state: { not: 'DISCARDED' },
        ...(selfId ? { id: { not: selfId } } : {}),
      },
      select: { id: true },
    });
    const duplicateFile = !!existing && !input.revisionOfId;

    const aliases = await this.loadAliases();
    const parsed = await parseInvoiceFile({
      buffer: input.buffer,
      filename: input.filename,
      mimeType: input.mimeType,
      aliases,
    });

    if (parsed.meta.rowCount > MAX_DATA_ROWS) {
      throw new BadRequestException(`File has more than ${MAX_DATA_ROWS} rows`);
    }
    if (parsed.meta.rawHeaders.length > MAX_COLUMNS) {
      throw new BadRequestException(`File has more than ${MAX_COLUMNS} columns`);
    }

    const provider = parsed.meta.provider;
    const courier = input.courier ?? provider;
    const courierFormatMismatch = !!input.courier && input.courier !== provider;

    const indexes = await this.buildMatchIndexes(parsed);
    const dataRows = parsed.rows.filter((r) => r.rowClass === 'DATA');

    let matchedCount = 0;
    const rowRecords: PreparedRow[] = [];

    const matchContexts = dataRows.map((row) =>
      matchRow(
        {
          rowNumber: row.rowNumber,
          consignmentId: row.consignmentId,
          displayId: row.displayId,
          trackingCode: row.trackingCode,
        },
        getDescriptor(provider).identifierOrder,
        indexes,
      ),
    );
    const expectedById = await this.expectedForOrders(
      matchContexts.map((m) => m.orderId).filter((v): v is string => !!v),
    );

    let dataCursor = 0;
    for (const row of parsed.rows) {
      const isData = row.rowClass === 'DATA';
      const match = isData
        ? matchContexts[dataCursor++] ?? { matchMethod: 'NONE' as const, matchContext: {} as Record<string, unknown> }
        : { matchMethod: 'NONE' as const, matchContext: {} as Record<string, unknown> };
      if (isData && match.matchMethod !== 'NONE') matchedCount++;

      const expected = match.orderId ? expectedById.get(match.orderId) : undefined;
      const findings = this.evaluateRow({
        provider,
        row,
        matched: match.matchMethod !== 'NONE',
        courierFormatMismatch,
        provenFinanceRule: parsed.meta.proven,
        structureOnly: parsed.meta.isStructureOnly,
        expectedCod: expected?.value,
        expectedCodDivergence: expected?.divergence,
      });
      rowRecords.push({ row, match, findings, expected });
    }

    const rowFindings = rowRecords.flatMap((r) => r.findings);
    const invoiceFindings: ReturnType<typeof evaluateRules> = [];
    if (duplicateFile) {
      invoiceFindings.push(...evaluateRules({ scope: 'invoice', checksumDuplicate: true }));
    }
    if (!parsed.meta.proven) {
      invoiceFindings.push(
        ...evaluateRules({
          scope: 'invoice',
          provenFinanceRule: false,
          structureOnly: parsed.meta.isStructureOnly,
        }),
      );
    }
    if (courierFormatMismatch) {
      invoiceFindings.push(...evaluateRules({ scope: 'invoice', courierFormatMismatch: true }));
    }
    const allFindings = [...rowFindings, ...invoiceFindings];

    // §17: bounded work. Parsing is capped by MAX_DATA_ROWS/MAX_COLUMNS, but the
    // matching pass can still blow up on pathological inputs — refuse honestly
    // instead of holding the request open forever.
    if (Date.now() - budgetStartedAt > PARSE_BUDGET_MS) {
      throw new BadRequestException(
        `File analysis exceeded the ${Math.round(PARSE_BUDGET_MS / 1000)}s budget; split it into smaller batches`,
      );
    }

    const state = this.resolveState(allFindings, parsed, dataRows);

    return {
      parsed,
      provider,
      courier,
      sha256,
      duplicateFile,
      courierFormatMismatch,
      rowRecords,
      invoiceFindings,
      allFindings,
      matchedCount,
      dataRowCount: dataRows.length,
      state,
    };
  }

  private async persistRows(
    tx: Prisma.TransactionClient,
    invoiceId: string,
    prepared: Prepared,
  ): Promise<void> {
    // §14/§17: batched inserts. One INSERT per row (and one per finding) is an
    // N+1 write storm — a 5 000-row invoice took 3.3 s of pure round-trips.
    // Rows go in INSERT_BATCH_SIZE chunks; rowNumber → id is resolved with ONE
    // query (unique [invoiceId, rowNumber]); findings follow in one more pass.
    const rowInputs: Prisma.CourierSettlementRowCreateManyInput[] = prepared.rowRecords.map(
      ({ row, match, findings }) => {
        const severity = worstOf(findings);
        return {
          invoiceId,
          rowNumber: row.rowNumber,
          rowClass: row.rowClass as CourierSettlementRowClass,
          rowKind: row.rowKind as CourierSettlementRowKind,
          consignmentId: row.consignmentId ?? null,
          orderId: match.orderId ?? null,
          dispatchId: match.dispatchId ?? null,
          identifier: row.consignmentId ?? row.displayId ?? row.trackingCode ?? null,
          declaredCollected: row.collected,
          declaredCharges: row.charges,
          declaredNet: row.net,
          declaredResidual: row.anomaly.residual,
          effectiveCollected: row.effectiveCollected,
          effectiveCharges: row.effectiveCharges,
          effectiveNet: row.effectiveNet,
          effectiveResidual: row.anomaly.residual,
          matchMethod: match.matchMethod,
          matchedAt: match.matchMethod !== 'NONE' ? new Date() : null,
          matchContext: match.matchContext as never,
          rawJson: row.raw as never,
          normalized: row.declared as never,
          reviewState: severity,
        };
      },
    );
    for (let i = 0; i < rowInputs.length; i += INSERT_BATCH_SIZE) {
      await tx.courierSettlementRow.createMany({
        data: rowInputs.slice(i, i + INSERT_BATCH_SIZE),
      });
    }

    const rowIdByNumber = new Map<number, string>();
    if (rowInputs.length > 0) {
      const ids = await tx.courierSettlementRow.findMany({
        where: { invoiceId },
        select: { id: true, rowNumber: true },
      });
      for (const r of ids) rowIdByNumber.set(r.rowNumber, r.id);
    }

    const exceptionInputs: Prisma.CourierSettlementExceptionCreateManyInput[] = [];
    for (const f of prepared.invoiceFindings) {
      exceptionInputs.push({
        invoiceId,
        ruleId: f.id,
        severity: f.severity,
        blocked: f.blocking || f.severity === 'red',
        status: 'open',
        message: f.message,
      });
    }
    for (const rec of prepared.rowRecords) {
      const { row, match, findings } = rec;
      const rowId = rowIdByNumber.get(row.rowNumber) ?? null;
      for (const f of findings) {
        exceptionInputs.push({
          invoiceId,
          rowId,
          orderId: match.orderId ?? null,
          dispatchId: match.dispatchId ?? null,
          ruleId: f.id,
          severity: f.severity,
          blocked: f.blocking || f.severity === 'red',
          status: 'open',
          message: f.message,
          context: { rowNumber: row.rowNumber } as never,
        });
      }
    }
    for (let i = 0; i < exceptionInputs.length; i += INSERT_BATCH_SIZE) {
      await tx.courierSettlementException.createMany({
        data: exceptionInputs.slice(i, i + INSERT_BATCH_SIZE),
      });
    }
  }

  private async recordImportActivity(
    invoice: CourierSettlementInvoice,
    prepared: Prepared,
    sha256: string,
    actor?: string | null,
  ): Promise<void> {
    await this.activity.record({
      invoiceId: invoice.id,
      action: 'IMPORTED',
      actor: actor ?? null,
      detail: {
        provider: prepared.provider,
        rows: prepared.parsed.rows.length,
        dataRows: prepared.dataRowCount,
        matched: prepared.matchedCount,
        duplicateFile: prepared.duplicateFile,
      },
      dedupeKey: `import:${sha256}`,
    });
    await this.activity.record({
      invoiceId: invoice.id,
      action: 'MATCHED',
      actor: actor ?? null,
      detail: {
        matched: prepared.matchedCount,
        unmatched: prepared.dataRowCount - prepared.matchedCount,
      },
      dedupeKey: `matched:${prepared.matchedCount}`,
    });
  }

  // ── Preview payload (Q5/Q6/Q11): identity, classification, money,
  //    previous settlements, findings and a spreadsheet-like row window. ──
  private async buildPreview(
    prepared: Prepared,
    invoice: {
      id: string;
      displayId: string;
      courier: string;
      fileOriginalName: string | null;
      fileMime: string | null;
      fileSize: number | null;
      fileSha256: string | null;
      state: CourierSettlementInvoiceState;
      createdAt: Date;
    },
    opts: { resumed: boolean },
  ): Promise<InvoicePreview> {
    const rows = prepared.rowRecords;
    const data = rows.filter((r) => r.row.rowClass === 'DATA');

    const money = data.reduce(
      (acc, r) => {
        acc.collected += r.row.effectiveCollected;
        acc.charges += r.row.effectiveCharges;
        acc.net += r.row.effectiveNet;
        acc.residual += r.row.anomaly?.residual ?? 0;
        return acc;
      },
      { collected: 0, charges: 0, net: 0, residual: 0 },
    );

    const matchedOrderIds = [...new Set(data.map((r) => r.match.orderId).filter((v): v is string => !!v))];
    const previousSettlements = await this.previousSettlements(matchedOrderIds, invoice.id);

    const seenIdentifiers = new Set<string>();
    let duplicateIdentifiersInFile = 0;
    for (const r of data) {
      const id = r.match.matchContext && (r.match.matchContext as { identifier?: string }).identifier;
      const key = (r.row.consignmentId ?? r.row.displayId ?? r.row.trackingCode ?? id ?? '').trim();
      if (!key) continue;
      if (seenIdentifiers.has(key)) duplicateIdentifiersInFile++;
      else seenIdentifiers.add(key);
    }

    const classes = { data: 0, summary: 0, footer: 0, unknown: 0 };
    for (const r of rows) {
      const c = String(r.row.rowClass).toLowerCase() as keyof typeof classes;
      if (c in classes) classes[c]++;
    }

    const expectedSum = data.reduce((sum, r) => sum + (r.expected?.value ?? 0), 0);
    const expectedAny = data.some((r) => r.expected != null);

    // The sheet shows the SOURCE file as the operator sees it: every row class
    // (DATA + SUMMARY/FOOTER/UNKNOWN) in source order, capped per class so a
    // 5 000-row file still previews instantly. Money stays DATA-only above.
    const previewRows: PreviewRow[] = [];
    let dataIncluded = 0;
    let otherIncluded = 0;
    for (const r of rows) {
      const isData = r.row.rowClass === 'DATA';
      if (isData) {
        if (dataIncluded >= PREVIEW_ROW_LIMIT) continue;
        dataIncluded++;
      } else {
        if (otherIncluded >= PREVIEW_ROW_LIMIT) continue;
        otherIncluded++;
      }
      previewRows.push({
        rowNumber: r.row.rowNumber,
        rowClass: r.row.rowClass,
        rowKind: r.row.rowKind,
        identifier: r.row.consignmentId ?? r.row.displayId ?? r.row.trackingCode ?? null,
        matchMethod: r.match.matchMethod,
        reviewState: worstOf(r.findings),
        declared: {
          collected: r.row.collected,
          charges: r.row.charges,
          net: r.row.net,
          residual: r.row.anomaly.residual,
        },
        findings: r.findings.map((f) => ({
          ruleId: f.id,
          severity: f.severity,
          blocking: f.blocking || f.severity === 'red',
          message: f.message,
        })),
        raw: r.row.raw as Record<string, string>,
      });
    }

    // Findings carry the rows they fired on so the UI can jump straight from a
    // finding to the affected cells (finding → data → decide).
    const findings = groupFindings(prepared.allFindings);
    const rowsByFinding = new Map<string, number[]>();
    for (const r of rows) {
      for (const f of r.findings) {
        const key = `${f.severity}:${f.id}:${f.message}`;
        const list = rowsByFinding.get(key);
        if (list) list.push(r.row.rowNumber);
        else rowsByFinding.set(key, [r.row.rowNumber]);
      }
    }
    for (const f of findings) {
      const list = rowsByFinding.get(`${f.severity}:${f.ruleId}:${f.message}`);
      f.sampleRowNumbers = list ? list.slice(0, 50) : [];
    }

    return {
      invoiceId: invoice.id,
      displayId: invoice.displayId,
      state: invoice.state,
      resumed: opts.resumed,
      duplicateFile: prepared.duplicateFile,
      identity: {
        courier: prepared.courier,
        provider: prepared.provider,
        invoiceNo: prepared.parsed.meta.invoiceNo ?? null,
        invoiceDate: (prepared.parsed.meta.invoiceDate ?? new Date()).toISOString(),
        filename: invoice.fileOriginalName ?? 'invoice',
        fileSize: invoice.fileSize ?? 0,
        fileMime: invoice.fileMime,
        sha256: invoice.fileSha256 ?? '',
        format: `${prepared.provider}:${prepared.parsed.meta.isStructureOnly ? 'structure-only' : 'invoice'}`,
        detectReason: prepared.parsed.meta.reason,
        proven: prepared.parsed.meta.proven,
        structureOnly: prepared.parsed.meta.isStructureOnly,
      },
      classification: {
        total: rows.length,
        data: classes.data,
        summary: classes.summary,
        footer: classes.footer,
        unknown: classes.unknown,
        blankLines: prepared.parsed.meta.blankLineCount ?? 0,
        headers: prepared.parsed.meta.rawHeaders,
      },
      matching: {
        matched: prepared.matchedCount,
        unmatched: data.length - prepared.matchedCount,
        duplicateIdentifiersInFile,
        previouslySettledOrders: previousSettlements.length,
      },
      money: {
        grossCollected: round(money.collected),
        charges: round(money.charges),
        net: round(money.net),
        cashReceived: round(data.reduce((s, r) => s + Math.max(r.row.effectiveNet, 0), 0)),
        cashDisbursed: round(data.reduce((s, r) => s + Math.max(-r.row.effectiveNet, 0), 0)),
        residual: round(money.residual),
        expectedCod: expectedAny ? round(expectedSum) : null,
      },
      previousSettlements,
      findings,
      rows: previewRows,
      rowsTruncated: data.length > PREVIEW_ROW_LIMIT,
    };
  }

  /** Finalized, non-superseded settlements already booked for these orders. */
  private async previousSettlements(orderIds: string[], selfId: string): Promise<PreviousSettlement[]> {
    if (orderIds.length === 0) return [];
    // A settlement only counts as "previous" once it is financially finalized —
    // a reviewed-but-unfinalized invoice has moved no money.
    const finalizedStates = FINALIZED_INVOICE_STATES as unknown as CourierSettlementInvoiceState[];
    const [rows, orders] = await Promise.all([
      this.prisma.courierSettlementRow.findMany({
        where: {
          orderId: { in: orderIds },
          invoiceId: { not: selfId },
          invoice: { state: { in: finalizedStates }, isRevision: false },
          supersededAt: null,
        },
        select: {
          invoiceId: true,
          orderId: true,
          effectiveCollected: true,
          effectiveCharges: true,
          effectiveNet: true,
          invoice: { select: { displayId: true, finalizedAt: true } },
        },
        take: 2000,
      }),
      this.prisma.order.findMany({
        where: { id: { in: orderIds } },
        select: { id: true, displayId: true },
      }),
    ]);
    if (rows.length === 0) return [];

    const byOrder = new Map<
      string,
      { invoices: Map<string, { invoiceId: string; displayId: string; finalizedAt: string | null }>; net: number; charges: number; collected: number; rowCount: number }
    >();
    for (const r of rows) {
      if (!r.orderId) continue;
      let entry = byOrder.get(r.orderId);
      if (!entry) {
        entry = { invoices: new Map(), net: 0, charges: 0, collected: 0, rowCount: 0 };
        byOrder.set(r.orderId, entry);
      }
      entry.net += Number(r.effectiveNet ?? 0);
      entry.charges += Number(r.effectiveCharges ?? 0);
      entry.collected += Number(r.effectiveCollected ?? 0);
      entry.rowCount++;
      entry.invoices.set(r.invoiceId, {
        invoiceId: r.invoiceId,
        displayId: r.invoice.displayId,
        finalizedAt: r.invoice.finalizedAt ? r.invoice.finalizedAt.toISOString() : null,
      });
    }

    const displayById = new Map(orders.map((o) => [o.id, o.displayId]));
    return [...byOrder.entries()].map(([orderId, v]) => ({
      orderId,
      orderDisplayId: displayById.get(orderId) ?? null,
      invoices: [...v.invoices.values()],
      net: round(v.net),
      charges: round(v.charges),
      collected: round(v.collected),
      rowCount: v.rowCount,
    }));
  }

  private resolveState(
    findings: ReturnType<typeof evaluateRules>,
    parsed: ParsedInvoice,
    dataRows: ParsedRow[],
  ): CourierSettlementInvoiceState {
    if (findings.some((f) => f.severity === 'red' && f.blocking)) {
      // Missing/again mapping means the operator must map columns first.
      if (dataRows.length > 0 && parsed.meta.proven) {
        const allMissing = dataRows.every((r) => !r.consignmentId && !r.displayId && !r.trackingCode);
        if (allMissing) return 'MAPPING_REQUIRED';
      }
      return 'ISSUE_FOUND';
    }
    if (findings.some((f) => f.severity === 'yellow')) return 'REVIEW_REQUIRED';
    return 'READY_FOR_REVIEW';
  }

  private evaluateRow(args: {
    provider: Provider;
    row: ParsedRow;
    matched: boolean;
    courierFormatMismatch: boolean;
    provenFinanceRule: boolean;
    structureOnly: boolean;
    expectedCod?: number;
    expectedCodDivergence?: boolean;
  }) {
    const { provider, row, matched } = args;
    const ctx: RuleContext = {
      scope: 'row',
      provider,
      rowClass: row.rowClass,
      rowKind: row.rowKind,
      hasIdentifier: !!(row.consignmentId || row.displayId || row.trackingCode),
      matched,
      residual: row.anomaly.residual,
      arithmeticDelta: row.anomaly.arithmeticDelta,
      declaredCharges: row.charges,
      effectiveCollected: row.effectiveCollected,
      effectiveNet: row.effectiveNet,
      grossCodCollected: row.collected,
      expectedCod: args.expectedCod,
      expectedCodDivergence: args.expectedCodDivergence,
    };
    return evaluateRules(ctx);
  }

  /** Batched (no N+1): one query for every matched order's COD expectation. */
  private async expectedForOrders(orderIds: string[]) {
    const map = new Map<string, { value: number; divergence: boolean }>();
    if (orderIds.length === 0) return map;
    const orders = await this.prisma.order.findMany({
      where: { id: { in: [...new Set(orderIds)] } },
      select: {
        id: true,
        paymentOptionType: true,
        trashedAt: true,
        total: true,
        status: { select: { name: true } },
        payments: { select: { amount: true, gatewayCode: true, status: true } },
      },
    });
    for (const order of orders) {
      const res = expectedCod({
        paymentOptionType: order.paymentOptionType,
        trashedAt: order.trashedAt,
        statusName: order.status?.name ?? null,
        total: num(order.total),
        payments: order.payments.map((p) => ({
          amount: num(p.amount),
          gatewayCode: p.gatewayCode,
          status: String(p.status),
        })),
      });
      map.set(order.id, { value: res.value, divergence: res.divergence });
    }
    return map;
  }

  async buildMatchIndexes(parsed: ParsedInvoice): Promise<MatchIndexes> {
    const indexes = emptyIndexes();
    const consignments = uniq(parsed.rows.map((r) => r.consignmentId));
    const displayIds = uniq(parsed.rows.map((r) => r.displayId));
    const trackings = uniq(parsed.rows.map((r) => r.trackingCode));

    const dispatches = await this.prisma.dispatch.findMany({
      where: {
        OR: [
          consignments.length ? { consignmentId: { in: consignments } } : undefined,
          trackings.length ? { trackingCode: { in: trackings } } : undefined,
        ].filter(Boolean) as never,
      },
      select: { id: true, orderId: true, consignmentId: true, trackingCode: true },
    });
    for (const d of dispatches) {
      if (d.consignmentId) indexes.dispatchByConsignment.set(norm(d.consignmentId), { id: d.id, orderId: d.orderId });
      if (d.trackingCode) indexes.dispatchByTracking.set(norm(d.trackingCode), { id: d.id, orderId: d.orderId });
    }

    const orders = await this.prisma.order.findMany({
      where: {
        OR: [
          displayIds.length ? { displayId: { in: displayIds } } : undefined,
          displayIds.length ? { externalOrderId: { in: displayIds } } : undefined,
          consignments.length ? { courierConsignmentId: { in: consignments } } : undefined,
          trackings.length ? { courierTrackingCode: { in: trackings } } : undefined,
        ].filter(Boolean) as never,
      },
      select: {
        id: true,
        displayId: true,
        externalOrderId: true,
        courierConsignmentId: true,
        courierTrackingCode: true,
      },
    });
    for (const o of orders) {
      if (o.displayId) indexes.orderByDisplayId.set(norm(o.displayId), { id: o.id });
      if (o.externalOrderId) indexes.orderByExternalId.set(norm(o.externalOrderId), { id: o.id });
      if (o.courierConsignmentId) indexes.orderByConsignment.set(norm(o.courierConsignmentId), { id: o.id });
      if (o.courierTrackingCode) indexes.orderByTracking.set(norm(o.courierTrackingCode), { id: o.id });
    }
    return indexes;
  }

  private async nextDisplayId(): Promise<string> {
    const { year, month, day } = dhakaDateParts();
    const dateStr = `${String(year).slice(2)}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;
    return this.prisma.$transaction(async (tx) => {
      const counter = await tx.orderCounter.upsert({
        where: { date: `CS${dateStr}` },
        create: { date: `CS${dateStr}`, seq: 1 },
        update: { seq: { increment: 1 } },
      });
      return `${INVOICE_DISPLAY_PREFIX}-${dateStr}-${String(counter.seq).padStart(4, '0')}`;
    });
  }

  private async storeFile(input: UploadInput, sha256: string): Promise<{ storageKey: string } | null> {
    if (!this.storage) return null;
    try {
      const key = `courier-settlement/${sha256}-${input.filename}`;
      const url = await this.storage.store(key, input.buffer, input.mimeType ?? 'application/octet-stream');
      return { storageKey: url };
    } catch (e) {
      this.logger.warn(`Failed to persist courier invoice file: ${(e as Error).message}`);
      return null;
    }
  }

  private async readStoredFile(invoice: {
    fileStorageId: string | null;
    fileOriginalName: string | null;
  }): Promise<Buffer> {
    if (!invoice.fileStorageId || !this.storage) {
      throw new BadRequestException(
        'The original file for this draft was not stored — re-upload it to continue.',
      );
    }
    try {
      return await this.storage.readMediaOriginal(
        invoice.fileOriginalName ?? 'invoice',
        invoice.fileStorageId,
      );
    } catch (e) {
      throw new BadRequestException(
        `Unable to read the stored invoice file: ${(e as Error).message}`,
      );
    }
  }

  private async loadAliases(): Promise<ParseAlias[]> {
    return this.prisma.courierSettlementColumnAlias.findMany({
      where: { active: true },
      select: { courier: true, sourceHeader: true, field: true, active: true },
      take: 500,
    });
  }
}

function groupFindings(findings: ReturnType<typeof evaluateRules>): PreviewFinding[] {
  const map = new Map<string, PreviewFinding>();
  for (const f of findings) {
    const key = `${f.severity}:${f.id}:${f.message}`;
    const existing = map.get(key);
    if (existing) {
      existing.count++;
      continue;
    }
    map.set(key, {
      severity: f.severity,
      ruleId: f.id,
      message: f.message,
      count: 1,
      blocking: f.blocking || f.severity === 'red',
      sampleRowNumbers: [],
    });
  }
  return [...map.values()].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'red' ? -1 : 1));
}

function severityOfFindings(findings: { severity: string }[]): 'green' | 'yellow' | 'red' {
  if (findings.some((f) => f.severity === 'red')) return 'red';
  if (findings.some((f) => f.severity === 'yellow')) return 'yellow';
  return 'green';
}

function worstOf(findings: { severity: 'red' | 'yellow' }[]): 'green' | 'yellow' | 'red' {
  if (findings.some((f) => f.severity === 'red')) return 'red';
  if (findings.some((f) => f.severity === 'yellow')) return 'yellow';
  return 'green';
}

function uniq(values: (string | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v))];
}

function num(v: unknown): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
