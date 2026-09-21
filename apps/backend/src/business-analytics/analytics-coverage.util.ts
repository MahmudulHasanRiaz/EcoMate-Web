/**
 * Analytics coverage utility (P1).
 *
 * Cost-state computation aggregation + ladderState propagation (§2.3):
 * weakest wins (unavailable < estimated < actual); not_applicable never
 * downgrades the ladder. Pure functions only.
 */
import type { CostState } from './metric-contract';

export interface CoverageLine {
  name: string;
  state: CostState;
}

export interface CoverageSummary {
  /** Weakest state among contributing lines. */
  state: CostState;
  actual: string[];
  estimated: string[];
  unavailable: string[];
  notApplicable: string[];
}

/**
 * Weakest state wins; `not_applicable` lines never contribute.
 * Empty input means no missing inputs ⇒ `actual`.
 */
export function ladderState(states: CostState[]): CostState {
  const contributing = states.filter((s) => s !== 'not_applicable');
  if (contributing.length === 0) return 'actual';
  if (contributing.includes('unavailable')) return 'unavailable';
  if (contributing.includes('estimated')) return 'estimated';
  return 'actual';
}

/** Group line names by state for coverage badges + fix-list drill-down. */
export function summariseCoverage(lines: CoverageLine[]): CoverageSummary {
  const summary: CoverageSummary = {
    state: ladderState(lines.map((l) => l.state)),
    actual: [],
    estimated: [],
    unavailable: [],
    notApplicable: [],
  };
  for (const line of lines) {
    switch (line.state) {
      case 'actual':
        summary.actual.push(line.name);
        break;
      case 'estimated':
        summary.estimated.push(line.name);
        break;
      case 'unavailable':
        summary.unavailable.push(line.name);
        break;
      case 'not_applicable':
        summary.notApplicable.push(line.name);
        break;
      default: {
        const exhaustive: never = line.state;
        throw new Error(`Unknown coverage state: ${String(exhaustive)}`);
      }
    }
  }
  return summary;
}

/** Net Profit is presented as exact only when the ladder is all-actual. */
export function isProfitExact(state: CostState): boolean {
  return state === 'actual';
}

/** UI label for the ladder state (§2.5 guarantees). */
export function describeLadderState(state: CostState): string {
  switch (state) {
    case 'actual':
      return 'exact — all inputs actual';
    case 'estimated':
      return 'estimated — see coverage';
    case 'unavailable':
      return 'partial — inputs missing';
    case 'not_applicable':
      return 'not applicable';
  }
}
