import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type StockAction = 'reserve' | 'release' | 'deduct' | 'add' | 'scrap' | 'fulfill' | 'allocate' | 'check' | 'skip';

export interface StockEngineDecision {
  ms: StockAction;
  pi: StockAction;
  /**
   * Retained for decision-shape compatibility; always false. Since the
   * 2026-11-11 mirror removal, no decision is conditional on the
   * product's syncManagedStock flag — callers that still gate on
   * `!decision.msConditionalOnSync || product.syncManagedStock` simply
   * apply whatever non-skip leg the router returned.
   */
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
    syncManagedStock?: boolean,
  ): StockEngineDecision {
    const mode = availabilityMode as string | undefined;

    const SKIP: StockEngineDecision = { ms: 'skip', pi: 'skip', msConditionalOnSync: false };
    const MS_ONLY: StockEngineDecision = { ms: opType as StockAction, pi: 'skip', msConditionalOnSync: false };
    const PI_ONLY: StockEngineDecision = { ms: 'skip', pi: opType as StockAction, msConditionalOnSync: false };

    if (!mode || mode === 'ALWAYS_IN_STOCK') return SKIP;
    if (mode === 'ALWAYS_OUT_OF_STOCK') return SKIP;

    if (!imEnabled) {
      if (mode === 'INVENTORY_CONTROLLED') {
        return SKIP;
      }
      return MS_ONLY;
    }

    // IM ON + INVENTORY_CONTROLLED
    // Physical inventory is the ONLY governing layer (owner decision
    // 2026-11-11: auto-mirroring removed entirely). The managed counters
    // are NEVER moved for an IC product — regardless of the product's
    // syncManagedStock flag, which is now ignored by this router. The
    // flag parameter is retained only so existing callers keep compiling.
    if (mode === 'INVENTORY_CONTROLLED') {
      if (opType === 'reserve') return { ms: 'skip', pi: 'allocate', msConditionalOnSync: false };
      if (opType === 'release') return { ms: 'skip', pi: 'release', msConditionalOnSync: false };
      if (opType === 'deduct') return { ms: 'skip', pi: 'fulfill', msConditionalOnSync: false };
      if (opType === 'add') return { ms: 'skip', pi: 'add', msConditionalOnSync: false };
      if (opType === 'allocate') return { ms: 'skip', pi: 'allocate', msConditionalOnSync: false };
      if (opType === 'check') return { ms: 'skip', pi: 'check', msConditionalOnSync: false };
      return SKIP;
    }

    // IM ON + MANAGED_STOCK
    // Architecture:
    //   - Order Create  → reserve managed stock only (MS_ONLY)
    //   - Order Confirm → allocate physical inventory (pi:'allocate')
    //   - Handed Over   → deduct BOTH managed stock AND physical inventory
    //   - Cancel/Return → restore BOTH managed stock AND physical inventory
    if (mode === 'MANAGED_STOCK') {
      if (opType === 'reserve') return MS_ONLY;                                                     // managed reserved at order creation
      if (opType === 'release') return { ms: 'release', pi: 'release', msConditionalOnSync: false }; // both released at cancel/edit
      if (opType === 'deduct') return { ms: 'deduct', pi: 'fulfill', msConditionalOnSync: false };   // both deducted at dispatch (HANDED_OVER)
      if (opType === 'add') return { ms: 'add', pi: 'add', msConditionalOnSync: false };             // both restored at return
      if (opType === 'scrap') return MS_ONLY;
      if (opType === 'allocate') return { ms: 'skip', pi: 'allocate', msConditionalOnSync: false };  // physical allocated at confirm
      if (opType === 'check') return { ms: 'skip', pi: 'check', msConditionalOnSync: false };
      return MS_ONLY;
    }

    return MS_ONLY;
  }
}
