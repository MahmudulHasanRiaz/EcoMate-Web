/**
 * P1 pure-rule tests — analytics coverage utility (§2.3, §2.5 guarantees).
 *
 * Covers: cost-state computation helpers, ladderState propagation
 * (weakest wins: unavailable < estimated < actual; not_applicable never
 * downgrades), Other Costs not_applicable, profit-exactness labelling.
 */
import {
  ladderState,
  summariseCoverage,
  isProfitExact,
  describeLadderState,
} from '../analytics-coverage.util';
import { OTHER_COSTS_STATE } from '../metric-contract';

describe('ladderState propagation (§2.3)', () => {
  it('all-actual stays actual', () => {
    expect(ladderState(['actual', 'actual', 'actual'])).toBe('actual');
  });

  it('any estimated downgrades actual to estimated', () => {
    expect(ladderState(['actual', 'estimated', 'actual'])).toBe('estimated');
  });

  it('any unavailable beats estimated (weakest wins)', () => {
    expect(ladderState(['actual', 'estimated', 'unavailable'])).toBe(
      'unavailable',
    );
    expect(ladderState(['estimated', 'unavailable'])).toBe('unavailable');
  });

  it('not_applicable never downgrades the ladder', () => {
    expect(ladderState(['actual', 'not_applicable'])).toBe('actual');
    expect(
      ladderState(['estimated', 'not_applicable', 'not_applicable']),
    ).toBe('estimated');
  });

  it('empty ladder is actual (no missing inputs)', () => {
    expect(ladderState([])).toBe('actual');
  });

  it('Other Costs is not_applicable and leaves the ladder untouched', () => {
    expect(OTHER_COSTS_STATE).toBe('not_applicable');
    expect(ladderState(['actual', OTHER_COSTS_STATE])).toBe('actual');
  });
});

describe('coverage summary', () => {
  it('groups contributing lines by state for fix-list drill-down', () => {
    const s = summariseCoverage([
      { name: 'COGS', state: 'estimated' },
      { name: 'Marketing Cost', state: 'unavailable' },
      { name: 'Other Costs', state: 'not_applicable' },
      { name: 'Fulfillment Cost', state: 'actual' },
    ]);
    expect(s.state).toBe('unavailable');
    expect(s.estimated).toEqual(['COGS']);
    expect(s.unavailable).toEqual(['Marketing Cost']);
    expect(s.notApplicable).toEqual(['Other Costs']);
    expect(s.actual).toEqual(['Fulfillment Cost']);
  });
});

describe('profit labelling (§2.5 guarantees)', () => {
  it('Net Profit is exact only when the ladder is all-actual', () => {
    expect(isProfitExact('actual')).toBe(true);
    expect(isProfitExact('estimated')).toBe(false);
    expect(isProfitExact('unavailable')).toBe(false);
    expect(isProfitExact('not_applicable')).toBe(false);
  });

  it('labels distinguish estimated from partial', () => {
    expect(describeLadderState('actual')).toContain('exact');
    expect(describeLadderState('estimated')).toContain('estimated');
    expect(describeLadderState('unavailable')).toContain('partial');
  });
});
