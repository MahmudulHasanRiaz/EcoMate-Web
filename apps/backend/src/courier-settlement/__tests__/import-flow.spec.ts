// §13 ingestion flow (analyze → preview → confirm → import).
//
// The frozen contract under test: an upload click NEVER writes a financial
// document. `analyze()` only stores bytes + a header row in a draft state with
// zero rows/exceptions; `commit()` is the single write point and is reachable
// only from a draft state (409 otherwise); re-analyzing the same bytes resumes
// the same draft instead of forking a second invoice; an unrecognized courier
// format fails closed (ISSUE_FOUND + COURIER_FORMAT_MISMATCH) instead of
// being imported as if it were proven.

import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { CourierSettlementActivityService } from '../activity.service';
import {
  CourierSettlementImportService,
  DRAFT_STATES,
  PREVIEW_ROW_LIMIT,
} from '../courier-settlement-import.service';

const FIXTURE = join(__dirname, '../parsing/__fixtures__/pathao.csv');
const CSV = readFileSync(FIXTURE);

function makePrisma() {
  const invoices: any[] = [];
  const rows: any[] = [];
  const exceptions: any[] = [];
  const counters: Record<string, number> = {};
  let seq = 0;

  const tx: any = {
    orderCounter: {
      upsert: async ({ where }: any) => ({
        date: where.date,
        seq: (counters[where.date] = (counters[where.date] ?? 0) + 1),
      }),
    },
    courierSettlementRow: {
      count: async ({ where }: any) => rows.filter((r) => r.invoiceId === where.invoiceId).length,
      create: async ({ data }: any) => {
        const row = { id: `row-${++seq}`, ...data };
        rows.push(row);
        return row;
      },
      // persistRows batches: createMany in chunks, then one findMany for the
      // rowNumber → id map (§14 N+1 write fix).
      createMany: async ({ data }: any) => {
        for (const d of data) rows.push({ id: `row-${++seq}`, ...d });
        return { count: data.length };
      },
      findMany: async ({ where }: any) =>
        rows
          .filter((r) => r.invoiceId === where?.invoiceId)
          .map((r) => ({ id: r.id, rowNumber: r.rowNumber })),
    },
    courierSettlementException: {
      create: async ({ data }: any) => {
        const e = { id: `ex-${++seq}`, ...data };
        exceptions.push(e);
        return e;
      },
      createMany: async ({ data }: any) => {
        for (const d of data) exceptions.push({ id: `ex-${++seq}`, ...d });
        return { count: data.length };
      },
    },
    courierSettlementInvoice: {
      update: async ({ where, data }: any) => {
        const inv = invoices.find((i) => i.id === where.id);
        if (!inv) throw new Error('update: invoice not found');
        Object.assign(inv, data);
        return inv;
      },
    },
  };

  const prisma: any = {
    $transaction: async (fn: (t: any) => Promise<any>) => fn(tx),
    courierSettlementInvoice: {
      findFirst: async ({ where }: any) => {
        if (!where?.fileSha256) return null;
        const sha = where.fileSha256;
        if (where.state?.in) {
          return (
            invoices.find(
              (i) => i.fileSha256 === sha && !i.isRevision && where.state.in.includes(i.state),
            ) ?? null
          );
        }
        return (
          invoices.find(
            (i) =>
              i.fileSha256 === sha &&
              i.state !== 'DISCARDED' &&
              (!where.id?.not || i.id !== where.id.not),
          ) ?? null
        );
      },
      findUnique: async ({ where }: any) => {
        const inv = invoices.find((i) => i.id === where.id);
        // Prisma returns a fresh row — never the live array element (commitOrSchedule
        // reads state BEFORE updateMany mutates the stored invoice).
        return inv ? { ...inv } : null;
      },
      updateMany: async ({ where, data }: any) => {
        const matched = invoices.filter(
          (i) =>
            (!where?.id || i.id === where.id) &&
            (!where?.state?.in || where.state.in.includes(i.state)),
        );
        for (const inv of matched) Object.assign(inv, data);
        return { count: matched.length };
      },
      create: async ({ data }: any) => {
        const inv = { id: `inv-${++seq}`, createdAt: new Date(), isRevision: false, ...data };
        invoices.push(inv);
        return inv;
      },
      update: tx.courierSettlementInvoice.update,
    },
    courierSettlementRow: {
      ...tx.courierSettlementRow,
      findMany: async () => [],
    },
    courierSettlementException: tx.courierSettlementException,
    courierSettlementColumnAlias: { findMany: async () => [] },
    dispatch: { findMany: async () => [] },
    order: { findMany: async () => [] },
    orderCounter: tx.orderCounter,
  };

  return { prisma, invoices, rows, exceptions };
}

async function makeService(queue?: { add: jest.Mock }) {
  const db = makePrisma();
  const activity = { record: jest.fn().mockResolvedValue(undefined) };
  const storage = {
    store: jest.fn(async (key: string) => `uploads/${key}`),
    readMediaOriginal: jest.fn(async () => CSV),
  };

  const mod = await Test.createTestingModule({
    providers: [
      CourierSettlementImportService,
      { provide: PrismaService, useValue: db.prisma },
      { provide: CourierSettlementActivityService, useValue: activity },
      { provide: StorageService, useValue: storage },
      ...(queue
        ? [{ provide: getQueueToken('courier-settlement-import'), useValue: queue }]
        : []),
    ],
  }).compile();

  return { svc: mod.get(CourierSettlementImportService), db, activity, storage };
}

const input = (courier?: string) => ({
  buffer: CSV,
  filename: 'pathao.csv',
  mimeType: 'text/csv',
  courier,
  actor: 'tester',
});

describe('courier-settlement import flow (§13)', () => {
  it('analyze stores a draft only — zero rows, zero exceptions', async () => {
    const { svc, db } = await makeService();
    const res = await svc.analyze(input());

    expect(res.resumed).toBe(false);
    expect(res.state).toBe('ANALYZED');
    expect(db.rows).toHaveLength(0);
    expect(db.exceptions).toHaveLength(0);
    expect(db.invoices).toHaveLength(1);
    expect(db.invoices[0].fileSha256).toBe(createHash('sha256').update(CSV).digest('hex'));

    // Preview exists so the operator can decide, but nothing is booked.
    expect(res.preview).toBeDefined();
    expect(res.preview!.classification.data).toBeGreaterThan(0);
    expect(res.preview!.rows.length).toBeLessThanOrEqual(PREVIEW_ROW_LIMIT);
    expect(res.preview!.identity.sha256).toBe(createHash('sha256').update(CSV).digest('hex'));
    expect(typeof res.preview!.money.net).toBe('number');
  });

  it('preview sheet mirrors the source file: full columns, source order, per-row findings + jump targets', async () => {
    const { svc } = await makeService();
    const res = await svc.analyze(input());
    const p = res.preview!;

    // The sheet header = classification.headers — full file width, source order
    // (the wizard previously read identity.headers, which is undefined).
    expect(p.classification.headers).toEqual([
      'Consignment_ID',
      'Created_Date',
      'Invoice type',
      'Collected_Amount',
      'Recipient_Name',
      'Recipient_Phone',
      'Collectable_Amount',
      'COD_fee',
      'Delivery_Fee',
      'Final_Fee',
      'Discount',
      'Additional_Charge',
      'Compensation_Cost',
      'Promo_Discount',
      'Payout',
      'Merchant_Order_ID',
      'Store_name',
    ]);

    // Every row keeps its source row number and its raw record 1:1.
    expect(p.rows.map((r) => r.rowNumber)).toEqual([1, 2, 3, 4]);
    for (const r of p.rows) {
      expect(Object.keys(r.raw)).toEqual(p.classification.headers);
      expect(Array.isArray(r.findings)).toBe(true);
    }

    // Classification counts and the rendered rows never disagree.
    expect(p.rows.filter((r) => r.rowClass === 'DATA')).toHaveLength(p.classification.data);

    // Per-row findings exist (fixture rows are all unmatched)…
    const flagged = p.rows.filter((r) => r.findings.length > 0);
    expect(flagged.length).toBeGreaterThan(0);

    // …and every one of them is reachable from the top-level findings list
    // through populated sampleRowNumbers — the finding → affected rows jump.
    expect(p.findings.every((f) => Array.isArray(f.sampleRowNumbers))).toBe(true);
    for (const r of flagged) {
      for (const rf of r.findings) {
        expect(rf.ruleId).toBeTruthy();
        expect(['red', 'yellow']).toContain(rf.severity);
        const grouped = p.findings.find(
          (f) => f.ruleId === rf.ruleId && f.severity === rf.severity,
        );
        expect(grouped).toBeDefined();
        expect(grouped!.sampleRowNumbers).toContain(r.rowNumber);
      }
    }
    expect(p.findings.some((f) => f.sampleRowNumbers.length > 0)).toBe(true);
  });

  it('re-analyzing the same bytes resumes the same draft (no second invoice)', async () => {
    const { svc, db } = await makeService();
    const first = await svc.analyze(input());
    const second = await svc.analyze(input());

    expect(second.resumed).toBe(true);
    expect(second.invoiceId).toBe(first.invoiceId);
    expect(db.invoices).toHaveLength(1);
    expect(db.rows).toHaveLength(0);
  });

  it('confirming the import is the single write point (rows + exceptions land)', async () => {
    const { svc, db, activity } = await makeService();
    const draft = await svc.analyze(input());
    const result = await svc.commit(draft.invoiceId, 'tester');

    expect(result.rowCount).toBeGreaterThan(0);
    expect(db.rows.length).toBe(result.rowCount);
    expect(db.exceptions.length).toBeGreaterThan(0);
    expect(['READY_FOR_REVIEW', 'REVIEW_REQUIRED', 'ISSUE_FOUND']).toContain(result.state);
    expect(activity.record).toHaveBeenCalledWith(
      expect.objectContaining({ invoiceId: draft.invoiceId, action: 'IMPORTED' }),
    );
  });

  it('commit freezes the original file column order (jsonb re-sorts rawJson)', async () => {
    const { svc, db } = await makeService();
    const draft = await svc.analyze(input());
    await svc.commit(draft.invoiceId, 'tester');
    const inv = db.invoices.find((i: any) => i.id === draft.invoiceId);
    expect(Array.isArray(inv.sourceHeaders)).toBe(true);
    expect(inv.sourceHeaders.length).toBeGreaterThan(0);
    // pathao fixture's first source column, in file order
    expect(inv.sourceHeaders[0]).toBe('Consignment_ID');
  });

  it('a committed invoice can never be imported twice (409)', async () => {
    const { svc } = await makeService();
    const draft = await svc.analyze(input());
    await svc.commit(draft.invoiceId, 'tester');
    await expect(svc.commit(draft.invoiceId, 'tester')).rejects.toBeInstanceOf(ConflictException);
    // and the preview of an imported invoice is refused, not silently re-shown
    await expect(svc.previewFor(draft.invoiceId)).rejects.toBeInstanceOf(ConflictException);
  });

  it('re-uploading an already imported file is flagged RED DUPLICATE_FILE (never silent)', async () => {
    const { svc, db } = await makeService();
    const draft = await svc.analyze(input());
    await svc.commit(draft.invoiceId, 'tester');
    const again = await svc.analyze(input());

    // The plan allows a second document (revision intent) but it must carry the
    // blocking duplicate finding so it can never silently double-count.
    expect(db.invoices).toHaveLength(2);
    const finding = again.preview?.findings.find((f) => f.ruleId === 'DUPLICATE_FILE');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('red');
    expect(finding!.blocking).toBe(true);
    expect(db.rows.filter((r) => r.invoiceId === again.invoiceId)).toHaveLength(0);
  });

  it('a courier without a proven rule fails closed (UNPROVEN → ISSUE_FOUND)', async () => {
    // RedX has no proven net rule — the parser marks the file structure-only,
    // the ruleset raises a blocking RED, and the committed state can never be
    // a claimable one without an approved finance rule.
    const { svc } = await makeService();
    const redx = readFileSync(join(__dirname, '../parsing/__fixtures__/redx.csv'));
    const res = await svc.analyze({
      buffer: redx,
      filename: 'redx.csv',
      mimeType: 'text/csv',
      actor: 'tester',
    });

    expect(DRAFT_STATES).toContain(res.state);
    expect(res.severity).toBe('red');
    expect(res.blocking).toBe(true);
    const finding = res.preview!.findings.find((f) => f.ruleId === 'UNPROVEN_FINANCE_RULE');
    expect(finding).toBeDefined();
    expect(finding!.blocking).toBe(true);

    const committed = await svc.commit(res.invoiceId, 'tester');
    expect(committed.state).toBe('ISSUE_FOUND');
  });

  it('a courier/format mismatch is surfaced, never silently accepted as green', async () => {
    const { svc } = await makeService();
    const res = await svc.analyze(input('redx'));

    const finding = res.preview!.findings.find((f) => f.ruleId === 'COURIER_FORMAT_MISMATCH');
    expect(finding).toBeDefined();
    expect(finding!.count).toBeGreaterThan(0);

    const committed = await svc.commit(res.invoiceId, 'tester');
    expect(committed.state).not.toBe('READY_FOR_REVIEW');
  });

  it('previewFor re-reads the stored bytes for a draft', async () => {
    const { svc, storage } = await makeService();
    const draft = await svc.analyze(input());
    storage.readMediaOriginal.mockClear();

    const preview = await svc.previewFor(draft.invoiceId);

    expect(storage.readMediaOriginal).toHaveBeenCalled();
    expect(preview.invoiceId).toBe(draft.invoiceId);
    expect(preview.state).toBe('ANALYZED');
    expect(preview.classification.data).toBeGreaterThan(0);
  });

  it('exposes the draft states the UI relies on for "Continue"', () => {
    expect(DRAFT_STATES).toEqual(['UPLOADED', 'ANALYZED', 'MAPPING_REQUIRED']);
  });
});

describe('async import threshold (§17)', () => {
  it('small invoices still import synchronously — no queue involvement', async () => {
    const queue = { add: jest.fn() };
    const { svc, db } = await makeService(queue);
    const draft = await svc.analyze(input());
    expect(db.invoices[0].rowCount).toBeLessThan(5000);

    const res = await svc.commitOrSchedule(draft.invoiceId, 'tester');

    expect(queue.add).not.toHaveBeenCalled();
    expect(res.state).not.toBe('IMPORTING');
    expect(db.rows.length).toBe(res.rowCount);
  });

  it('above the threshold: claims IMPORTING, enqueues once, returns progress to poll', async () => {
    const queue = { add: jest.fn().mockResolvedValue(undefined) };
    const { svc, db } = await makeService(queue);
    const draft = await svc.analyze(input());
    db.invoices[0].rowCount = 5000; // simulate a huge file at the gate

    const res = await svc.commitOrSchedule(draft.invoiceId, 'tester');

    expect(res.state).toBe('IMPORTING');
    expect(res.importProgress).toBe(5);
    expect(db.invoices[0].state).toBe('IMPORTING');
    expect(db.invoices[0].importStage).toBe('queued');
    expect(db.rows).toHaveLength(0); // nothing financial yet
    expect(queue.add).toHaveBeenCalledWith(
      'commit',
      expect.objectContaining({ invoiceId: draft.invoiceId, previousState: 'ANALYZED' }),
      expect.objectContaining({ jobId: `cs-commit-${draft.invoiceId}` }),
    );

    // The worker re-enters commit() while the invoice is IMPORTING.
    const committed = await svc.commit(draft.invoiceId, 'tester');
    expect(['READY_FOR_REVIEW', 'REVIEW_REQUIRED', 'ISSUE_FOUND']).toContain(committed.state);
    expect(db.rows.length).toBeGreaterThan(0);
  });

  it('an imported invoice can never be scheduled again (409 before any enqueue)', async () => {
    const queue = { add: jest.fn() };
    const { svc } = await makeService(queue);
    const draft = await svc.analyze(input());
    await svc.commit(draft.invoiceId, 'tester');

    await expect(svc.commitOrSchedule(draft.invoiceId, 'tester')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('falls back to a synchronous import when the queue is unavailable', async () => {
    const queue = { add: jest.fn().mockRejectedValue(new Error('redis down')) };
    const { svc, db } = await makeService(queue);
    const draft = await svc.analyze(input());
    db.invoices[0].rowCount = 5000;

    const res = await svc.commitOrSchedule(draft.invoiceId, 'tester');

    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(res.state).not.toBe('IMPORTING');
    expect(db.invoices[0].state).not.toBe('IMPORTING');
    expect(db.rows.length).toBe(res.rowCount);
  });
});
