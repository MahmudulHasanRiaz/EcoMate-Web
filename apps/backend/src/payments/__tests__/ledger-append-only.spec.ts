/**
 * Task 2 — payment ledger schema gate (DB-less).
 *
 * Parses `apps/backend/prisma/schema.prisma` as text (Prisma datamodel
 * source, no database connection) and asserts the ledger additions:
 * Payment.account/recordedBy/submittedBy/recordedAt,
 * Dispatch.courierAmount, and the CodMismatchAlert + CustomerCreditEntry
 * models with their back-relations.
 *
 * RED before the Task 2 schema edit, GREEN after — `prisma generate`
 * is NOT required for this spec to pass.
 */
import * as fs from 'fs';
import * as path from 'path';

const SCHEMA_PATH = path.resolve(__dirname, '../../../prisma/schema.prisma');
const MIGRATION_PATH = path.resolve(
  __dirname,
  '../../../prisma/migrations/20261013125708_payment_ledger_cod_alert/migration.sql',
);

function readDatamodel(): string {
  return fs.readFileSync(SCHEMA_PATH, 'utf8');
}

function readMigration(): string {
  return fs.readFileSync(MIGRATION_PATH, 'utf8');
}

function getModelBlock(datamodel: string, model: string): string {
  const re = new RegExp(`^model\\s+${model}\\s*\\{([\\s\\S]*?)^\\}`, 'm');
  const m = datamodel.match(re);
  if (!m) throw new Error(`model ${model} not found in schema.prisma`);
  return m[1];
}

/** field name -> full declaration line (skips comments + @@ attributes). */
function parseFields(block: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const raw of block.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('//')) continue;
    if (line.startsWith('@@')) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    if (/^(model|enum|datasource|generator)\b/.test(parts[0])) continue;
    map.set(parts[0], line);
  }
  return map;
}

describe('payment ledger schema (Task 2, DB-less datamodel gate)', () => {
  it('schema.prisma is readable without a database', () => {
    expect(fs.existsSync(SCHEMA_PATH)).toBe(true);
    expect(readDatamodel()).toContain('model Payment');
  });

  it('Payment has account/recordedBy/submittedBy/recordedAt', () => {
    const fields = parseFields(getModelBlock(readDatamodel(), 'Payment'));
    expect(fields.get('account')).toMatch(/String\?/);
    expect(fields.get('recordedBy')).toMatch(/String\?/);
    // "staff:<userId>" | "customer:<customerId>"
    expect(fields.get('submittedBy')).toMatch(/String\?/);
    expect(fields.get('recordedAt')).toMatch(/DateTime/);
    expect(fields.get('recordedAt')).toMatch(/@default\(now\(\)\)/);
  });

  it('Dispatch has nullable courierAmount Decimal(10,2)', () => {
    const fields = parseFields(getModelBlock(readDatamodel(), 'Dispatch'));
    const decl = fields.get('courierAmount');
    expect(decl).toBeDefined();
    expect(decl).toMatch(/Decimal\?/);
    expect(decl).toMatch(/@db\.Decimal\(10,\s*2\)/);
  });

  it('CodMismatchAlert model exists with required fields + indexes', () => {
    const datamodel = readDatamodel();
    const block = getModelBlock(datamodel, 'CodMismatchAlert');
    const fields = parseFields(block);
    for (const f of [
      'id',
      'orderId',
      'courier',
      'consignmentId',
      'courierAmount',
      'systemDue',
      'status',
      'resolvedBy',
      'resolvedAt',
      'createdAt',
      'updatedAt',
      'order',
    ]) {
      expect(fields.get(f)).toBeDefined();
    }
    expect(fields.get('courierAmount')).toMatch(/@db\.Decimal\(10,\s*2\)/);
    expect(fields.get('systemDue')).toMatch(/@db\.Decimal\(10,\s*2\)/);
    expect(fields.get('status')).toMatch(/@default\("open"\)/);
    expect(block).toMatch(
      /order\s+Order\s+@relation\([^)]*onDelete:\s*Cascade[^)]*\)/,
    );
    expect(block).toMatch(/@@index\(\[orderId,\s*status\]\)/);
    expect(block).toMatch(/@@index\(\[consignmentId\]\)/);
  });

  it('CustomerCreditEntry model exists with required fields + index + relations', () => {
    const datamodel = readDatamodel();
    const block = getModelBlock(datamodel, 'CustomerCreditEntry');
    const fields = parseFields(block);
    for (const f of [
      'id',
      'customerId',
      'orderId',
      'paymentId',
      'amount',
      'reason',
      'createdBy',
      'createdAt',
    ]) {
      expect(fields.get(f)).toBeDefined();
    }
    expect(fields.get('amount')).toMatch(/@db\.Decimal\(10,\s*2\)/);
    expect(fields.get('orderId')).toMatch(/String\?/);
    expect(fields.get('paymentId')).toMatch(/String\?/);
    // customer FK + optional order/payment relations
    expect(block).toMatch(/CustomerProfile/);
    expect(block).toMatch(/@@index\(\[customerId\]\)/);
  });

  it('Order exposes codAlerts; CustomerProfile exposes creditEntries', () => {
    const datamodel = readDatamodel();
    const orderFields = parseFields(getModelBlock(datamodel, 'Order'));
    expect(orderFields.get('codAlerts')).toMatch(/CodMismatchAlert\[\]/);
    expect(orderFields.get('creditEntries')).toMatch(/CustomerCreditEntry\[\]/);
    const profileFields = parseFields(
      getModelBlock(datamodel, 'CustomerProfile'),
    );
    expect(profileFields.get('creditEntries')).toMatch(
      /CustomerCreditEntry\[\]/,
    );
    const paymentFields = parseFields(getModelBlock(datamodel, 'Payment'));
    expect(paymentFields.get('creditEntries')).toMatch(
      /CustomerCreditEntry\[\]/,
    );
  });

  it('migration is append-only: zero DROP INDEX/TABLE/COLUMN lines', () => {
    const sql = readMigration();
    expect(sql).not.toMatch(/DROP\s+(INDEX|TABLE|COLUMN)/i);
  });

  it('migration adds Payment ledger columns with correct nullability', () => {
    const sql = readMigration();
    expect(sql).toMatch(/"account"\s+TEXT\s*,/);
    expect(sql).toMatch(/"recordedBy"\s+TEXT\s*,?/);
    expect(sql).toMatch(/"submittedBy"\s+TEXT\s*;?/);
    expect(sql).toMatch(
      /"recordedAt"\s+TIMESTAMP\(3\)\s+NOT NULL\s+DEFAULT CURRENT_TIMESTAMP/,
    );
  });

  it('migration adds nullable Dispatch.courierAmount DECIMAL', () => {
    const sql = readMigration();
    const m = sql.match(
      /ALTER TABLE "Dispatch"[^;]*"courierAmount"\s+DECIMAL\(10,\s*2\)[^;]*;/,
    );
    expect(m).not.toBeNull();
    expect(m![0]).not.toMatch(/NOT NULL/);
  });

  it('migration creates CodMismatchAlert + CustomerCreditEntry with PRIMARY KEY', () => {
    const sql = readMigration();
    expect(sql).toMatch(/CREATE TABLE "CodMismatchAlert"/);
    expect(sql).toMatch(
      /CONSTRAINT "CodMismatchAlert_pkey" PRIMARY KEY \("id"\)/,
    );
    expect(sql).toMatch(/CREATE TABLE "CustomerCreditEntry"/);
    expect(sql).toMatch(
      /CONSTRAINT "CustomerCreditEntry_pkey" PRIMARY KEY \("id"\)/,
    );
  });
});
