import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type StockAction = 'reserve' | 'release' | 'deduct' | 'add' | 'scrap' | 'fulfill' | 'allocate' | 'check' | 'skip';

export interface StockEngineDecision {
  ms: StockAction;
  pi: StockAction;
  msConditionalOnSync: boolean;
}

@Injectable()
export class StockRouterService {
  constructor(private readonly prisma: PrismaService) {}

  async isInventoryManagementEnabled(): Promise<boolean> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: 'inventory_enabled' },
    });
    return setting?.value === 'true';
  }

  resolve(
    availabilityMode: string | null | undefined,
    opType: string,
    imEnabled: boolean,
  ): StockEngineDecision {
    const mode = availabilityMode as string | undefined;

    const SKIP: StockEngineDecision = { ms: 'skip', pi: 'skip', msConditionalOnSync: false };
    const MS_ONLY: StockEngineDecision = { ms: opType as StockAction, pi: 'skip', msConditionalOnSync: false };
    const PI_ONLY: StockEngineDecision = { ms: 'skip', pi: opType as StockAction, msConditionalOnSync: false };
    const MS_COND: StockEngineDecision = { ms: opType as StockAction, pi: opType as StockAction, msConditionalOnSync: true };

    if (!mode || mode === 'ALWAYS_IN_STOCK') return SKIP;
    if (mode === 'ALWAYS_OUT_OF_STOCK') return SKIP;

    if (!imEnabled) {
      if (mode === 'INVENTORY_CONTROLLED') {
        return { ...SKIP, ms: 'skip', pi: 'skip', msConditionalOnSync: false };
      }
      return MS_ONLY;
    }

    // IM ON
    if (mode === 'INVENTORY_CONTROLLED') {
      if (opType === 'reserve') return { ms: 'skip', pi: 'allocate', msConditionalOnSync: false };
      if (opType === 'release') return PI_ONLY;
      if (opType === 'deduct') return { ms: 'skip', pi: 'fulfill', msConditionalOnSync: false };
      if (opType === 'add') return PI_ONLY;
      if (opType === 'allocate') return { ms: 'skip', pi: 'allocate', msConditionalOnSync: false };
      if (opType === 'check') return { ms: 'skip', pi: 'check', msConditionalOnSync: false };
      return SKIP;
    }

    // IM ON + MANAGED_STOCK
    if (mode === 'MANAGED_STOCK') {
      if (opType === 'reserve') return MS_ONLY;
      if (opType === 'release') return { ms: 'release', pi: 'release', msConditionalOnSync: false };
      if (opType === 'deduct') return MS_COND;
      if (opType === 'add') return MS_COND;
      if (opType === 'scrap') return MS_ONLY;
      if (opType === 'allocate') return { ms: 'skip', pi: 'allocate', msConditionalOnSync: false };
      if (opType === 'check') return { ms: 'skip', pi: 'check', msConditionalOnSync: false };
      return MS_ONLY;
    }

    return MS_ONLY;
  }
}
