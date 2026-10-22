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
