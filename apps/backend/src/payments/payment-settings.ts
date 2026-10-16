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

/**
 * D (owner-locked): per-gateway tri-state overrides over the two global
 * defaults. Effective value for gateway G = explicit per-gateway override if
 * set (true/false), else the global SystemSetting value. `null` override =
 * "use global default" (the default state of every gateway).
 */
export interface GatewayPaymentOverrides {
  staffAutoVerified: boolean | null;
  editAllowed: boolean | null;
}

export interface EffectivePaymentSettings extends PaymentSettings {
  /** The gateway these values were resolved for (null = global only). */
  gatewayCode: string | null;
  /** The raw global defaults (before any override). */
  global: PaymentSettings;
  /** Raw per-gateway overrides (null when no gateway row / no overrides). */
  overrides: GatewayPaymentOverrides | null;
}

export async function resolveEffectivePaymentSettings(
  db: {
    systemSetting: {
      findMany: (args: unknown) => Promise<Array<{ key: string; value: string }>>;
    };
    paymentGateway?: {
      findUnique: (args: unknown) => Promise<{
        staffAutoVerifiedOverride?: boolean | null;
        editAllowedOverride?: boolean | null;
      } | null>;
    };
  },
  gatewayCode?: string | null,
): Promise<EffectivePaymentSettings> {
  const global = await readPaymentSettings(db);
  if (!gatewayCode) {
    return { ...global, gatewayCode: null, global, overrides: null };
  }
  let gw: {
    staffAutoVerifiedOverride?: boolean | null;
    editAllowedOverride?: boolean | null;
  } | null = null;
  try {
    gw =
      (await db.paymentGateway?.findUnique?.({
        where: { code: gatewayCode },
        select: {
          staffAutoVerifiedOverride: true,
          editAllowedOverride: true,
        },
      })) ?? null;
  } catch {
    gw = null;
  }
  const overrides: GatewayPaymentOverrides = {
    staffAutoVerified: gw?.staffAutoVerifiedOverride ?? null,
    editAllowed: gw?.editAllowedOverride ?? null,
  };
  return {
    staffAutoVerified:
      overrides.staffAutoVerified ?? global.staffAutoVerified,
    editAllowed: overrides.editAllowed ?? global.editAllowed,
    gatewayCode,
    global,
    overrides: gw ? overrides : null,
  };
}
