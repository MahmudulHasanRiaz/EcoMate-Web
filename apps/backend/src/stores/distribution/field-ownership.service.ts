/**
 * Field-ownership decision engine — central-commerce §8.3 (P3).
 *
 * Pure function over per-field hashes. The comparison decides which fields
 * enter the push payload, so "detect → compare → change only what is
 * required" is literally payload construction.
 *
 * Invariants (BR-02/BR-03/BR-26):
 * - No case pushes over a drifted external value.
 * - PRESERVE cases are resolvable only through the audited override
 *   workflow (Force EcoMate Value / Keep External Value — P4).
 * - First contact (BR-05) adopts pre-existing external values as the
 *   baseline instead of overwriting them.
 */
import { Injectable } from '@nestjs/common';

export type OwnershipDecision = 'SKIP' | 'PUSH' | 'PRESERVE_EXTERNAL' | 'PRESERVE_CONFLICT';
export type FieldOwnership = 'ECOMATE' | 'EXTERNAL' | 'CONFLICT';

export interface OwnershipEvaluateInput {
  /** hash EcoMate last pushed (or adopted at first contact) */
  baselineHash: string;
  /** hash of EcoMate's current value */
  ecoMateHash: string;
  /** hash read back from the store */
  externalHash: string;
  /**
   * EcoMate hash at the last adopt/rebase. After an adopt (BR-05) or a Keep
   * External rebase (BR-04) the baseline is a *store* value EcoMate never
   * pushed, so eco-change must be measured against this anchor — otherwise
   * the first sync after adoption would PUSH over the adopted value.
   * Defaults to baselineHash (the classic pushed-baseline flow).
   */
  ecoMateHashAtRebase?: string | null;
  /** stored ownership; a quiet SKIP preserves it instead of resetting it */
  currentOwnership?: FieldOwnership;
}

export interface OwnershipEvaluateResult {
  action: OwnershipDecision;
  ownership: FieldOwnership;
  /** set only for PUSH — the baseline the pusher must persist */
  nextBaselineHash?: string;
}

export interface AdoptExistingInput {
  ecoMateHash: string;
  externalHash: string;
}

@Injectable()
export class FieldOwnershipService {
  evaluate(input: OwnershipEvaluateInput): OwnershipEvaluateResult {
    const ecoReference = input.ecoMateHashAtRebase ?? input.baselineHash;
    const extChanged = input.externalHash !== input.baselineHash;
    const ecoChanged = input.ecoMateHash !== ecoReference;
    if (!extChanged && !ecoChanged) {
      return { action: 'SKIP', ownership: input.currentOwnership ?? 'ECOMATE' };
    }
    if (!extChanged && ecoChanged) {
      return { action: 'PUSH', ownership: 'ECOMATE', nextBaselineHash: input.ecoMateHash };
    }
    if (extChanged && !ecoChanged) return { action: 'PRESERVE_EXTERNAL', ownership: 'EXTERNAL' };
    return { action: 'PRESERVE_CONFLICT', ownership: 'CONFLICT' };
  }

  /**
   * First contact (BR-05): the external value becomes the baseline.
   * A differing store value is recorded EXTERNAL — never overwritten.
   */
  adoptExisting(input: AdoptExistingInput): {
    ownership: FieldOwnership;
    baselineHash: string;
    externalHash: string;
    ecoMateHashAtRebase: string;
  } {
    if (input.externalHash === input.ecoMateHash) {
      return {
        ownership: 'ECOMATE',
        baselineHash: input.externalHash,
        externalHash: input.externalHash,
        ecoMateHashAtRebase: input.ecoMateHash,
      };
    }
    return {
      ownership: 'EXTERNAL',
      baselineHash: input.externalHash,
      externalHash: input.externalHash,
      ecoMateHashAtRebase: input.ecoMateHash,
    };
  }
}
