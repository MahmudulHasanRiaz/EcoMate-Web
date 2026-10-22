import { BadRequestException, NotFoundException } from '@nestjs/common';

/**
 * Strategy A (Phase 1) — shared account eligibility + gateway resolution.
 *
 * Eligible money-location accounts are exactly the expense idiom, tightened
 * to the directive: active, non-group, type = asset (a leaf Cash/Bank account).
 * Nothing here writes journals — this branch is identity only.
 */
export const ELIGIBLE_ACCOUNT_RULE =
  'an active, non-group Asset account (Cash/Bank)';

export interface EligibleAccount {
  id: string;
  code: string;
  name: string;
  type: string;
  isGroup: boolean;
  isActive: boolean;
}

/** Throws unless `accountId` is an eligible asset leaf. Returns the account. */
export async function assertEligibleAssetAccount(
  db: any,
  accountId: string,
  label = 'Account',
): Promise<EligibleAccount> {
  const account = await db.account.findUnique({
    where: { id: accountId },
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
      isGroup: true,
      isActive: true,
    },
  });
  if (!account) {
    throw new NotFoundException(`${label} ${accountId} not found`);
  }
  if (
    account.type !== 'asset' ||
    account.isGroup !== false ||
    account.isActive !== true
  ) {
    throw new BadRequestException(
      `${label} "${account.name}" is not ${ELIGIBLE_ACCOUNT_RULE}`,
    );
  }
  return account;
}

/**
 * Normalizes an optional FK value from a request body:
 *   undefined → undefined (caller leaves the stored value untouched)
 *   null / '' → null (explicit clear)
 *   string    → validated eligible account id
 */
export async function normalizeAccountId(
  db: any,
  value: unknown,
  label = 'Account',
): Promise<string | null | undefined> {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw new BadRequestException(`${label} must be an account id`);
  }
  await assertEligibleAssetAccount(db, value, label);
  return value;
}

export interface ConfiguredGateway {
  id: string;
  code: string;
  name: string;
  enabled: boolean;
  type: string;
  accountId: string | null;
}

/** Case-insensitive, separator-insensitive comparison key (mirrors the admin
 * gateway-normalize helper). */
function gatewayKey(value: string | null | undefined): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Every spelling of "cash on delivery" ever stored (checkout enum, older
 * storefront label, short staff code). */
const COD_ALIASES = new Set(['cashondelivery', 'cash', 'cod']);

/**
 * Resolves a stored/legacy gateway string to a CONFIGURED gateway code.
 * Stored lead rows predate the configured gateway set: values may be the
 * checkout enum ('CASH_ON_DELIVERY'), older shorthands ('cash'/'cod'),
 * upper/underscore variants, or real gateway codes. Returns null when
 * nothing matches — the caller decides how loud to be.
 *
 * Resolution order (first hit wins), mirroring the admin helper
 * (apps/admin/src/features/payments/lib/gateway-normalize.ts):
 *   1. no delegate → the raw value trimmed (the documented unit-test-double
 *      convention, same as requireConfiguredGateway).
 *   2. exact code;
 *   3. case-insensitive exact code;
 *   4. normalized comparison over all gateways (code AND name);
 *   5. cash-on-delivery alias → the configured COD gateway;
 *   6. otherwise null.
 */
export async function resolveConfiguredGatewayCode(
  db: any,
  raw: string,
): Promise<string | null> {
  // Unit-test transaction doubles have no `paymentGateway` delegate; mirror
  // requireConfiguredGateway's documented convention and pass the raw value
  // through untouched.
  if (!db?.paymentGateway?.findUnique) return String(raw).trim();

  const value = String(raw ?? '').trim();
  if (!value) return null;

  // 1. Exact code.
  const exact = await findConfiguredGateway(db, value);
  if (exact) return exact.code;

  // 2. Case-insensitive exact code.
  if (db?.paymentGateway?.findFirst) {
    const ci = await db.paymentGateway.findFirst({
      where: { code: { equals: value, mode: 'insensitive' } },
      select: { code: true },
    });
    if (ci?.code) return ci.code as string;
  }

  // 3. Normalized comparison over all gateways (code AND name).
  if (db?.paymentGateway?.findMany) {
    const all = await db.paymentGateway.findMany({
      select: { code: true, name: true, type: true, paymentOptionType: true },
    });
    const list: any[] = Array.isArray(all) ? all : [];
    const key = gatewayKey(value);
    if (key) {
      const normalized = list.find(
        (g) => gatewayKey(g?.code) === key || gatewayKey(g?.name) === key,
      );
      if (normalized?.code) return normalized.code as string;

      // 4. Cash-on-delivery alias → the configured COD gateway.
      if (COD_ALIASES.has(key)) {
        const cod =
          list.find((g) => g?.paymentOptionType === 'CASH_ON_DELIVERY') ??
          list.find((g) => g?.type === 'cash');
        if (cod?.code) return cod.code as string;
      }
    }
  }

  // 5. Nothing matched — the caller decides how loud to be.
  return null;
}

/** Exact-code lookup; returns null when the gateway is not configured. */
export async function findConfiguredGateway(
  db: any,
  gatewayCode: string,
): Promise<ConfiguredGateway | null> {
  if (!db?.paymentGateway?.findUnique) return null;
  return db.paymentGateway.findUnique({
    where: { code: gatewayCode },
    select: {
      id: true,
      code: true,
      name: true,
      enabled: true,
      type: true,
      accountId: true,
    },
  });
}

/**
 * Staff write-path guard: an unknown gatewayCode is a clear 400 — the old
 * "treat unknown as manual" behavior is gone from staff writes. Returns null
 * only when the Prisma delegate is absent (unit-test transaction doubles);
 * production always has the delegate.
 */
export async function requireConfiguredGateway(
  db: any,
  gatewayCode: string,
): Promise<ConfiguredGateway | null> {
  if (!gatewayCode || !String(gatewayCode).trim()) {
    throw new BadRequestException('Payment gateway is required');
  }
  if (!db?.paymentGateway?.findUnique) return null;
  const gateway = await findConfiguredGateway(db, gatewayCode);
  if (!gateway) {
    throw new BadRequestException(
      `Unknown payment gateway "${gatewayCode}". Configure it in Settings → Payment Gateways.`,
    );
  }
  return gateway;
}

/**
 * Stamps the gateway's mapped settlement account unless the client supplied
 * an eligible account of their own. A supplied-but-ineligible id is a 400
 * (never silently replaced).
 */
export async function resolvePaymentAccountId(
  db: any,
  opts: { accountId?: string | null; gatewayAccountId?: string | null },
): Promise<string | null> {
  if (opts.accountId) {
    await assertEligibleAssetAccount(db, opts.accountId);
    return opts.accountId;
  }
  return opts.gatewayAccountId ?? null;
}

/**
 * POS/till helper: exact code first, then a case-insensitive fallback for the
 * legacy 'CASH' label. The stored gatewayCode is never rewritten — only the
 * account lookup tolerates legacy casing.
 */
export async function resolveGatewayAccountId(
  db: any,
  gatewayCode: string,
): Promise<string | null> {
  if (!db?.paymentGateway?.findUnique) return null;
  const exact = await findConfiguredGateway(db, gatewayCode);
  if (exact) return exact.accountId;
  if (!gatewayCode) return null;
  if (!db?.paymentGateway?.findFirst) return null;
  const legacy = await db.paymentGateway.findFirst({
    where: { code: { equals: gatewayCode, mode: 'insensitive' } },
    select: { accountId: true },
  });
  return legacy?.accountId ?? null;
}
