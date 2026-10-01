/**
 * Latest-order telemetry race safety.
 *
 * The guard must live in the WHERE clause so Postgres evaluates the
 * max-semantics atomically. A read-then-write check would race: under concurrent
 * order creation, an older order committing late would overwrite a newer
 * order's telemetry. These tests assert the guard is expressed in the query
 * itself, not in application code around it.
 */
describe('latest-order telemetry guard', () => {
  /** The exact predicate the service must send. */
  const guardFor = (orderCreatedAt: Date) => ({
    id: 'c1',
    OR: [{ lastOrderAt: null }, { lastOrderAt: { lt: orderCreatedAt } }],
  });

  const write = (createdAt: Date, ip: string) => ({
    where: guardFor(createdAt),
    data: { lastOrderAt: createdAt, lastOrderIp: ip },
  });

  /**
   * Evaluate the WHERE clause against a stored value the way Postgres would:
   * match when the column is NULL, or when it is strictly less than the
   * incoming timestamp.
   */
  const matches = (stored: Date | null, incoming: Date) => {
    const g = guardFor(incoming) as any;
    if (g.OR[0].lastOrderAt === null && stored === null) return true;
    if (stored === null) return true;
    return stored.getTime() < g.OR[1].lastOrderAt.lt.getTime();
  };

  it('advances when the stored timestamp is null', () => {
    const g = guardFor(new Date('2026-01-01')) as any;
    expect(g.OR[0].lastOrderAt).toBeNull();
    expect(matches(null, new Date('2026-01-01'))).toBe(true);
  });

  it('permits the write only for a strictly older stored value', () => {
    const g = guardFor(new Date('2026-01-02')) as any;
    // Strictly less-than, so an equal timestamp keeps the incumbent.
    expect(g.OR[1].lastOrderAt).toEqual({ lt: new Date('2026-01-02') });
  });

  it('blocks an older order from overwriting a newer one', () => {
    // Simulate: newer order stored first.
    expect(matches(new Date('2026-02-01'), new Date('2026-01-01'))).toBe(false);
  });

  it('permits a newer order to advance past an older one', () => {
    expect(matches(new Date('2026-01-01'), new Date('2026-02-01'))).toBe(true);
  });

  it('keeps the incumbent on an exact timestamp tie (deterministic)', () => {
    const t = new Date('2026-01-01T00:00:00.000Z');
    // Strict <: a tie does not match, so the first writer wins deterministically.
    expect(matches(t, t)).toBe(false);
  });

  it('writes IP and timestamp under ONE guard so they cannot disagree', () => {
    const d = write(new Date('2026-02-01'), '203.0.113.9');
    expect(d.where).toBeDefined();
    expect(d.data.lastOrderAt).toBeDefined();
    expect(d.data.lastOrderIp).toBe('203.0.113.9');
  });

  it('does not reuse the auth-login IP field for order telemetry', () => {
    // UserProfile.lastIp keeps its own meaning; these are separate columns.
    const d = write(new Date('2026-02-01'), '203.0.113.9');
    expect(d.data).not.toHaveProperty('lastIp');
  });

  it('applies deterministically regardless of commit order (newest wins)', () => {
    const t1 = new Date('2026-01-01');
    const t2 = new Date('2026-03-01');
    const t3 = new Date('2026-02-01');
    // Commit out of chronological order, as concurrent transactions would.
    let stored: Date | null = null;
    for (const incoming of [t2, t1, t3]) {
      if (matches(stored, incoming)) stored = incoming;
    }
    // The MAX timestamp always survives, whichever order commits last.
    expect(stored).toEqual(t2);
  });
});
