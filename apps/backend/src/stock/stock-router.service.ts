import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type StockAction = 'reserve' | 'release' | 'deduct' | 'add' | 'scrap' | 'fulfill' | 'allocate' | 'check' | 'skip';

export interface StockEngineDecision {
  ms: StockAction;
  pi: StockAction;
  /**
   * Retained for decision-shape compatibility. resolve() now evaluates the
   * product's syncManagedStock flag itself (callers pass it in), so this is
   * always false; callers that still gate on
   * `!decision.msConditionalOnSync || product.syncManagedStock` behave
   * exactly as before.
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
    // Physical inventory is the governing layer. When the product opts into
    // syncManagedStock (a merchant-settable flag on the product DTO), the
    // managed counters MIRROR the physical legs so surfaces that read the
    // managed quantity stay in step with physical stock:
    //   reserve → managed hold placed alongside the physical allocation
    //   allocate → no managed leg (the hold was already placed at reserve)
    //   release/deduct/add → same managed action as the physical leg
    //   scrap → managed-only (physical scrap is not routed for IC products)
    // Without the flag the managed side stays untouched, exactly as before.
    if (mode === 'INVENTORY_CONTROLLED') {
      const sync = syncManagedStock === true;
      if (opType === 'reserve') return { ms: sync ? 'reserve' : 'skip', pi: 'allocate', msConditionalOnSync: false };
      if (opType === 'release') return { ms: sync ? 'release' : 'skip', pi: 'release', msConditionalOnSync: false };
      if (opType === 'deduct') return { ms: sync ? 'deduct' : 'skip', pi: 'fulfill', msConditionalOnSync: false };
      if (opType === 'add') return { ms: sync ? 'add' : 'skip', pi: 'add', msConditionalOnSync: false };
      if (opType === 'allocate') return { ms: 'skip', pi: 'allocate', msConditionalOnSync: false };
      if (opType === 'check') return { ms: 'skip', pi: 'check', msConditionalOnSync: false };
      if (opType === 'scrap' && sync) return MS_ONLY;
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
