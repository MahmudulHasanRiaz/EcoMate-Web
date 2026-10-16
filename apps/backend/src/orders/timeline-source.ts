/**
 * Read-time source attribution for the order timeline (admin "All / Staff /
 * Courier / System" filters).
 *
 * The JSONB timeline has ~25 write paths and 6+ entry shapes and carries no
 * source/actor field, so attribution is derived at read time instead of
 * touching every writer. Rules: courier entries win, a real staff actor
 * (anything that is not the literal System/Customer marker) is "staff",
 * everything else is "system".
 */
export type TimelineSource = 'staff' | 'courier' | 'system';

const NON_STAFF_ACTORS = new Set(['system', 'customer', 'auto', 'unknown']);

export function deriveTimelineSource(entry: unknown): TimelineSource {
  if (!entry || typeof entry !== 'object') return 'system';
  const e = entry as Record<string, unknown>;

  const type = typeof e.type === 'string' ? e.type.toLowerCase() : '';
  if (type === 'courier') return 'courier';
  if (typeof e.courier === 'string' && e.courier.trim() !== '')
    return 'courier';

  const actorRaw = e.performedBy ?? e.performer ?? e.by;
  const actor = typeof actorRaw === 'string' ? actorRaw.trim() : '';
  if (actor && !NON_STAFF_ACTORS.has(actor.toLowerCase())) return 'staff';

  return 'system';
}

export function withTimelineSources(
  timeline: unknown,
): Array<Record<string, unknown>> {
  if (!Array.isArray(timeline)) return [];
  return timeline.map((entry) =>
    entry && typeof entry === 'object'
      ? { ...(entry as Record<string, unknown>), source: deriveTimelineSource(entry) }
      : entry,
  ) as Array<Record<string, unknown>>;
}
