/**
 * [C2] + [C9] Backfill boundary and race semantics.
 *
 * These encode the guarantees verified against the live database, so a later
 * change cannot quietly reintroduce the bug the marker column exists to
 * prevent: `channel IS NULL` must never be used as the "not yet migrated"
 * guard, because a NULL channel is the CORRECT answer for most historical
 * orders.
 */
import { isInBackfillWorkSet } from '../sales-channel.mapper';

const BOUNDARY = new Date('2026-06-01T00:00:00.000Z');

const row = (over: Partial<{ channelMappedAt: Date | null; createdAt: Date }> = {}) => ({
  // Default: never mapped, created before the boundary.
  channelMappedAt: null,
  createdAt: new Date('2026-01-15T00:00:00.000Z'),
  ...over,
});

describe('backfill work set', () => {
  it('includes an unmapped row created before the boundary', () => {
    expect(isInBackfillWorkSet(row(), BOUNDARY)).toBe(true);
  });

  it('includes a row created exactly at the boundary (inclusive)', () => {
    expect(isInBackfillWorkSet(row({ createdAt: BOUNDARY }), BOUNDARY)).toBe(true);
  });

  it('EXCLUDES a row created after the boundary (new runtime)', () => {
    // [C9] T3: the new container wrote this row itself; the historical
    // backfill must never touch it.
    expect(
      isInBackfillWorkSet(row({ createdAt: new Date('2026-06-01T00:00:00.001Z') }), BOUNDARY),
    ).toBe(false);
  });

  it('EXCLUDES an already-mapped row even when it predates the boundary', () => {
    // [C2] Re-running must be a no-op.
    expect(
      isInBackfillWorkSet(row({ channelMappedAt: new Date('2026-05-01') }), BOUNDARY),
    ).toBe(false);
  });

  it('INCLUDES a mapped-but-NULL-channel row is NOT the test — the marker decides', () => {
    // The critical semantic: a row whose canonical channel is NULL is still
    // "unmapped" until channelMappedAt is set. The predicate deliberately
    // ignores any channel value, so this cannot be expressed through it.
    const channelless = row();
    expect(channelless).not.toHaveProperty('channel');
    expect(isInBackfillWorkSet(channelless, BOUNDARY)).toBe(true);
  });

  it('requires BOTH conditions, not either one', () => {
    // Mapped but recent → excluded (marker).
    expect(
      isInBackfillWorkSet(
        row({ channelMappedAt: new Date(), createdAt: new Date() }),
        BOUNDARY,
      ),
    ).toBe(false);
    // Unmapped but future → excluded (boundary).
    expect(
      isInBackfillWorkSet(row({ createdAt: new Date('2030-01-01') }), BOUNDARY),
    ).toBe(false);
    // Neither condition satisfied → included.
    expect(isInBackfillWorkSet(row(), BOUNDARY)).toBe(true);
  });

  it('is deterministic: same inputs always give the same answer', () => {
    const r = row();
    const first = isInBackfillWorkSet(r, BOUNDARY);
    for (let i = 0; i < 5; i++) {
      expect(isInBackfillWorkSet(r, BOUNDARY)).toBe(first);
    }
  });
});
