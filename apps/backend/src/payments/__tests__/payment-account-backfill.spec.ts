import { readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';

/**
 * Part 2 — real-SQL backfill test against an isolated schema.
 *
 * The migration is data-only; this test creates the three tables it touches
 * inside a temporary schema, runs the actual migration file twice and proves
 * rule order, asset-leaf eligibility and idempotency. Nothing in public is
 * touched (the whole schema is rolled back).
 */
const MIGRATION = readFileSync(
  join(
    process.cwd(),
    'prisma/migrations/20261022101000_payment_account_backfill/migration.sql',
  ),
  'utf8',
);

const connectionString =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/ecomate_web';

describe('Payment.accountId backfill (Part 2)', () => {
  let client: Client;
  let schema: string;

  const rows = async () => {
    const res = await client.query(
      'SELECT id, "accountId" FROM "Payment" ORDER BY id',
    );
    return Object.fromEntries(
      res.rows.map((r) => [r.id, r.accountId ?? null]),
    );
  };

  beforeAll(async () => {
    client = new Client({ connectionString });
    await client.connect();
    schema = `backfill_test_${Date.now()}`;
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);

    await client.query(`
      CREATE TABLE "Account" (
        id text PRIMARY KEY,
        code text NOT NULL,
        name text NOT NULL,
        type text NOT NULL,
        "isGroup" boolean NOT NULL DEFAULT false
      );
      CREATE TABLE "PaymentGateway" (
        code text PRIMARY KEY,
        "phoneNumber" text,
        "accountId" text
      );
      CREATE TABLE "Payment" (
        id text PRIMARY KEY,
        "gatewayCode" text NOT NULL,
        account text,
        "accountId" text
      );
    `);

    await client.query(`
      INSERT INTO "Account" (id, code, name, type, "isGroup") VALUES
        ('acc-cash',   '1001', 'Cash',           'asset',   false),
        ('acc-bank',   '1002', 'Bank',           'asset',   false),
        ('acc-phone',  '1003', '01700000000',    'asset',   false),
        ('acc-income', '4001', 'Sales Income',   'income',  false),
        ('acc-group',  '1100', 'Current Assets', 'asset',   true);

      INSERT INTO "PaymentGateway" (code, "phoneNumber", "accountId") VALUES
        ('bkash',  '01700000000', 'acc-cash'),
        ('rocket', '01900000000', 'acc-bank'),
        ('nagad',  '01800000000', NULL);

      INSERT INTO "Payment" (id, "gatewayCode", account, "accountId") VALUES
        ('p-rule1',        'bkash',  '01700000000',  NULL),
        ('p-rule1-prio',   'bkash',  '01700000000',  NULL),
        ('p-rule2-name',   'nagad',  '  bank  ',     NULL),
        ('p-rule2-code',   'nagad',  '1001',         NULL),
        ('p-income',       'nagad',  'Sales Income', NULL),
        ('p-group',        'nagad',  'Current Assets', NULL),
        ('p-unmapped',     'nagad',  '01800000000',  NULL),
        ('p-empty',        'nagad',  '',             NULL),
        ('p-null',         'nagad',  NULL,           NULL),
        ('p-already',      'nagad',  'Cash',         'acc-bank');
    `);
  });

  afterAll(async () => {
    if (client) {
      await client.query('ROLLBACK');
      await client.end();
    }
  });

  it('applies rule 1 before rule 2 and never assigns non-asset/group accounts', async () => {
    await client.query(MIGRATION);
    const after = await rows();

    // Rule 1 wins over the Account.name match ('01700000000' = acc-phone).
    expect(after['p-rule1']).toBe('acc-cash');
    expect(after['p-rule1-prio']).toBe('acc-cash');
    // Rule 2 is trimmed + case-insensitive for names and codes.
    expect(after['p-rule2-name']).toBe('acc-bank');
    expect(after['p-rule2-code']).toBe('acc-cash');
    // Ineligible accounts are never assigned.
    expect(after['p-income']).toBeNull();
    expect(after['p-group']).toBeNull();
    // Rule 1 only fires when the gateway itself is mapped and phone matches.
    expect(after['p-unmapped']).toBeNull();
    expect(after['p-empty']).toBeNull();
    expect(after['p-null']).toBeNull();
    // Existing ids are never rewritten.
    expect(after['p-already']).toBe('acc-bank');
  });

  it('is idempotent — a second run changes nothing', async () => {
    await client.query(MIGRATION);
    const first = await rows();
    await client.query(MIGRATION);
    const second = await rows();
    expect(second).toEqual(first);
  });
});
