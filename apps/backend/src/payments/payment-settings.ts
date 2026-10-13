/**
 * Task 5 — payment ledger settings (S1/S2).
 *
 * Canonical reader + parser for the `payments.*` SystemSetting keys.
 * Task 7 seeds UI + values later; until then these code defaults apply:
 *   payments.staffAutoVerified = true  (S1 ON)
 *   payments.editAllowed        = false (S2 OFF)
 *
 * Pure functions (no DI) so both PaymentsService and OrdersService can use
 * them without creating a circular provider dependency — each service
 * performs its own `systemSetting.findMany` (inside its tx where relevant)
 * and parses via `parsePaymentSettings`.
 */
export const PAYMENT_SETTING_KEYS = [
  'payments.staffAutoVerified',
  'payments.editAllowed',
] as const;

export interface PaymentSettings {
  /** S1: staff manual entries skip the verification queue (PAID directly). */
  staffAutoVerified: boolean;
  /** S2: staff may directly edit recorded payment rows (with audit). */
  editAllowed: boolean;
}

export function parsePaymentSettings(
  rows: Array<{ key: string; value: string }>,
): PaymentSettings {
  const map = new Map((rows ?? []).map((r) => [r.key, r.value]));
  const staffRaw = map.get('payments.staffAutoVerified');
  const editRaw = map.get('payments.editAllowed');
  return {
    staffAutoVerified: staffRaw === undefined ? true : staffRaw === 'true',
    editAllowed: editRaw === undefined ? false : editRaw === 'true',
  };
}

export async function readPaymentSettings(db: {
  systemSetting: {
    findMany: (args: unknown) => Promise<Array<{ key: string; value: string }>>;
  };
}): Promise<PaymentSettings> {
  const rows = await db.systemSetting.findMany({
    where: { key: { in: [...PAYMENT_SETTING_KEYS] } },
  });
  return parsePaymentSettings(rows ?? []);
}
