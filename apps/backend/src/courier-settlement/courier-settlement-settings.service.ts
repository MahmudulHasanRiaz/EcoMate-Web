// ── Courier Settlement settings + lazy system accounts.
//
// Reads SystemSetting with the same raw findUnique pattern the rest of the
// codebase uses (no dedicated settings service exists). System accounts are
// created lazily on first use, mirroring marketing-*.service.ts.

import { Injectable, Logger } from '@nestjs/common';
import { AccountType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  COURIER_CLEARING_ACCOUNT_CODE,
  COURIER_CLEARING_ACCOUNT_NAME,
  COURIER_CASH_ACCOUNT_CODE,
  COURIER_CASH_ACCOUNT_NAME,
  COURIER_EXPENSE_ACCOUNT_CODE,
  COURIER_EXPENSE_ACCOUNT_NAME,
  COURIER_VARIANCE_ACCOUNT_CODE,
  COURIER_VARIANCE_ACCOUNT_NAME,
  DEFAULT_ARITHMETIC_TOLERANCE,
  DEFAULT_REQUIRE_WARNING_ACK,
  DEFAULT_RESIDUAL_THRESHOLD,
  SETTING_ACCOUNTING_ENABLED,
  SETTING_ARITHMETIC_TOLERANCE,
  SETTING_DEFAULT_CASH_ACCOUNT,
  SETTING_REQUIRE_WARNING_ACK,
  SETTING_RESIDUAL_THRESHOLD,
} from './courier-settlement.constants';

@Injectable()
export class CourierSettlementSettingsService {
  private readonly logger = new Logger(CourierSettlementSettingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async raw(key: string): Promise<string | null> {
    const s = await this.prisma.systemSetting.findUnique({ where: { key } });
    return s?.value ?? null;
  }

  async isAccountingEnabled(): Promise<boolean> {
    try {
      return (await this.raw(SETTING_ACCOUNTING_ENABLED)) === 'true';
    } catch {
      return false;
    }
  }

  async requireWarningAck(): Promise<boolean> {
    const v = await this.raw(SETTING_REQUIRE_WARNING_ACK);
    return v == null ? DEFAULT_REQUIRE_WARNING_ACK : v === 'true';
  }

  async residualThreshold(): Promise<number> {
    const v = Number(await this.raw(SETTING_RESIDUAL_THRESHOLD));
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_RESIDUAL_THRESHOLD;
  }

  async arithmeticTolerance(): Promise<number> {
    const v = Number(await this.raw(SETTING_ARITHMETIC_TOLERANCE));
    return Number.isFinite(v) && v >= 0 ? v : DEFAULT_ARITHMETIC_TOLERANCE;
  }

  /** Cash/bank account to use for the invoice's cash leg. Caller-supplied id wins. */
  async defaultCashAccountId(): Promise<string | null> {
    return this.raw(SETTING_DEFAULT_CASH_ACCOUNT);
  }

  async cashAccountId(): Promise<string> {
    const configured = await this.defaultCashAccountId();
    if (configured) {
      const account = await this.prisma.account.findUnique({ where: { id: configured } });
      if (account && !account.isGroup) return account.id;
    }
    return (await this.ensureAccount(
      COURIER_CASH_ACCOUNT_CODE,
      COURIER_CASH_ACCOUNT_NAME,
      AccountType.asset,
    )).id;
  }

  async expenseAccountId(): Promise<string> {
    return (await this.ensureAccount(
      COURIER_EXPENSE_ACCOUNT_CODE,
      COURIER_EXPENSE_ACCOUNT_NAME,
      AccountType.expense,
    )).id;
  }

  async clearingAccountId(): Promise<string> {
    return (await this.ensureAccount(
      COURIER_CLEARING_ACCOUNT_CODE,
      COURIER_CLEARING_ACCOUNT_NAME,
      AccountType.liability,
    )).id;
  }

  async varianceAccountId(): Promise<string> {
    return (await this.ensureAccount(
      COURIER_VARIANCE_ACCOUNT_CODE,
      COURIER_VARIANCE_ACCOUNT_NAME,
      AccountType.expense,
    )).id;
  }

  private async ensureAccount(code: string, name: string, type: AccountType) {
    const existing = await this.prisma.account.findFirst({ where: { code } });
    if (existing) return existing;
    const created = await this.prisma.account.create({
      data: { code, name, type, isGroup: false },
    });
    this.logger.log(`Created courier settlement account ${created.code} (${created.id})`);
    return created;
  }
}