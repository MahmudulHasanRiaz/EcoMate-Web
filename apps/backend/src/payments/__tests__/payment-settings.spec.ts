import {
  parsePaymentSettings,
  readPaymentSettings,
  resolveEffectivePaymentSettings,
} from '../payment-settings';

/**
 * D (owner-locked): global payment defaults + per-gateway tri-state overrides.
 * Effective value for a gateway = explicit override (true/false) if set,
 * else the global SystemSetting value. `null` override = "use global default".
 */
describe('payment-settings — effective resolution (D)', () => {
  const settingsRows = (rows: Array<{ key: string; value: string }>) => ({
    systemSetting: { findMany: jest.fn().mockResolvedValue(rows) },
  });

  it('parsePaymentSettings: code defaults (S1 ON, S2 OFF)', () => {
    expect(parsePaymentSettings([])).toEqual({
      staffAutoVerified: true,
      editAllowed: false,
    });
  });

  it('readPaymentSettings reads exactly the two canonical keys', async () => {
    const db = settingsRows([
      { key: 'payments.staffAutoVerified', value: 'false' },
    ]);
    await readPaymentSettings(db);
    expect(db.systemSetting.findMany).toHaveBeenCalledWith({
      where: {
        key: {
          in: ['payments.staffAutoVerified', 'payments.editAllowed'],
        },
      },
    });
  });

  it('no gateway code → global values, no gateway lookup', async () => {
    const db = {
      ...settingsRows([
        { key: 'payments.staffAutoVerified', value: 'false' },
        { key: 'payments.editAllowed', value: 'true' },
      ]),
      paymentGateway: { findUnique: jest.fn() },
    };

    const eff = await resolveEffectivePaymentSettings(db, null);

    expect(eff).toMatchObject({
      staffAutoVerified: false,
      editAllowed: true,
      gatewayCode: null,
      overrides: null,
    });
    expect(eff.global).toEqual({ staffAutoVerified: false, editAllowed: true });
    expect(db.paymentGateway.findUnique).not.toHaveBeenCalled();
  });

  it('gateway with NULL overrides → use-global (behavior-neutral migration)', async () => {
    const db = {
      ...settingsRows([{ key: 'payments.staffAutoVerified', value: 'true' }]),
      paymentGateway: {
        findUnique: jest.fn().mockResolvedValue({
          staffAutoVerifiedOverride: null,
          editAllowedOverride: null,
        }),
      },
    };

    const eff = await resolveEffectivePaymentSettings(db, 'bkash');

    expect(eff.staffAutoVerified).toBe(true); // global default
    expect(eff.editAllowed).toBe(false); // global default
    expect(eff.overrides).toEqual({
      staffAutoVerified: null,
      editAllowed: null,
    });
  });

  it('explicit overrides win over the global values (mixed states)', async () => {
    const db = {
      ...settingsRows([
        { key: 'payments.staffAutoVerified', value: 'true' },
        { key: 'payments.editAllowed', value: 'false' },
      ]),
      paymentGateway: {
        findUnique: jest.fn().mockResolvedValue({
          staffAutoVerifiedOverride: false, // override OFF beats global ON
          editAllowedOverride: true, // override ON beats global OFF
        }),
      },
    };

    const eff = await resolveEffectivePaymentSettings(db, 'nagad');

    expect(eff.staffAutoVerified).toBe(false);
    expect(eff.editAllowed).toBe(true);
    expect(eff.global).toEqual({ staffAutoVerified: true, editAllowed: false });
  });

  it('partial override: only the set field wins, the other falls back to global', async () => {
    const db = {
      ...settingsRows([{ key: 'payments.staffAutoVerified', value: 'false' }]),
      paymentGateway: {
        findUnique: jest.fn().mockResolvedValue({
          staffAutoVerifiedOverride: true,
          editAllowedOverride: null,
        }),
      },
    };

    const eff = await resolveEffectivePaymentSettings(db, 'rocket');

    expect(eff.staffAutoVerified).toBe(true); // override ON
    expect(eff.editAllowed).toBe(false); // global default OFF
  });

  it('missing gateway row → global values, overrides null', async () => {
    const db = {
      ...settingsRows([]),
      paymentGateway: { findUnique: jest.fn().mockResolvedValue(null) },
    };

    const eff = await resolveEffectivePaymentSettings(db, 'ghost-gateway');

    expect(eff.staffAutoVerified).toBe(true);
    expect(eff.editAllowed).toBe(false);
    expect(eff.overrides).toBeNull();
    expect(eff.gatewayCode).toBe('ghost-gateway');
  });

  it('gateway lookup failure → degrades to global (never throws)', async () => {
    const db = {
      ...settingsRows([]),
      paymentGateway: {
        findUnique: jest.fn().mockRejectedValue(new Error('db down')),
      },
    };

    const eff = await resolveEffectivePaymentSettings(db, 'bkash');

    expect(eff.staffAutoVerified).toBe(true);
    expect(eff.editAllowed).toBe(false);
  });
});
