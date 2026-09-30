import { Prisma } from '@prisma/client';

/**
 * Atomically append entries to `Order.timeline` (jsonb) inside the caller's
 * transaction.
 *
 * The timeline is an append-only audit trail but most writers do
 * read-modify-write: they read the array (often OUTSIDE the transaction that
 * writes it) and then replace the whole column. Two concurrent writers then
 * lose one side's entries permanently — e.g. a note added while a return is
 * being finalized. The SQL `||` operator appends to the LIVE row under the
 * row lock taken by this UPDATE, so no concurrent entry can ever be dropped.
 *
 * The append participates in the caller's transaction: a rollback removes the
 * appended entries together with the rest of the mutation.
 */
export async function appendOrderTimeline(
  tx: Prisma.TransactionClient,
  orderId: string,
  entries: unknown[],
): Promise<void> {
  if (entries.length === 0) return;
  const payload = JSON.stringify(entries);
  await tx.$executeRaw`
    UPDATE "Order"
    SET "timeline" = COALESCE("timeline", '[]'::jsonb) || ${payload}::jsonb,
        "updatedAt" = NOW()
    WHERE "id" = ${orderId}
  `;
}
