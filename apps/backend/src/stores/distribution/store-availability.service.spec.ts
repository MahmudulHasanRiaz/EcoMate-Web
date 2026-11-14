/**
 * StoreAvailabilityService.resolve() precedence-matrix spec — central-commerce §8.2 (P3).
 *
 * Contract under test:
 * ```
 * global   = product.status === 'active' && product.isActive === true
 * override = ProductStoreAssignment(source = MANUAL)
 * rule     = nearest Category with a StoreAvailabilityRule
 * default  = OFF for external stores · NATIVE = global only
 * final    = global AND (override ?? rule ?? default)
 * ```
 */
import { StoreAvailabilityService } from './store-availability.service';

describe('StoreAvailabilityService.resolve', () => {
  const svc = new StoreAvailabilityService();

  describe('global gate', () => {
    it('returns false when the product is globally inactive, regardless of override/rule', () => {
      expect(
        svc.resolve({ globalActive: false, storeKind: 'WOOCOMMERCE', overrideAvailable: true }),
      ).toBe(false);
    });

    it('returns false when the product is globally a draft, even with override ON', () => {
      expect(
        svc.resolve({
          globalActive: false,
          storeKind: 'SHOPIFY',
          overrideAvailable: true,
          ruleAvailable: true,
        }),
      ).toBe(false);
    });
  });

  describe('external precedence: override ?? rule ?? default(OFF)', () => {
    it('override ON beats rule OFF', () => {
      expect(
        svc.resolve({
          globalActive: true,
          storeKind: 'WOOCOMMERCE',
          overrideAvailable: true,
          ruleAvailable: false,
        }),
      ).toBe(true);
    });

    it('override OFF beats rule ON', () => {
      expect(
        svc.resolve({
          globalActive: true,
          storeKind: 'WOOCOMMERCE',
          overrideAvailable: false,
          ruleAvailable: true,
        }),
      ).toBe(false);
    });

    it('rule ON applies when no override exists', () => {
      expect(
        svc.resolve({ globalActive: true, storeKind: 'SHOPIFY', ruleAvailable: true }),
      ).toBe(true);
    });

    it('rule OFF applies when no override exists', () => {
      expect(
        svc.resolve({ globalActive: true, storeKind: 'CUSTOM', ruleAvailable: false }),
      ).toBe(false);
    });

    it('external default is OFF when neither override nor rule exists', () => {
      for (const kind of ['WOOCOMMERCE', 'SHOPIFY', 'CUSTOM'] as const) {
        expect(svc.resolve({ globalActive: true, storeKind: kind })).toBe(false);
      }
    });

    it('explicit defaultAvailable=true opts an external store in (transitional)', () => {
      expect(
        svc.resolve({ globalActive: true, storeKind: 'CUSTOM', defaultAvailable: true }),
      ).toBe(true);
    });
  });

  describe('NATIVE short-circuit (BR-20)', () => {
    it('NATIVE resolves to global only — override/rule/default are ignored', () => {
      expect(svc.resolve({ globalActive: true, storeKind: 'NATIVE' })).toBe(true);
      expect(svc.resolve({ globalActive: false, storeKind: 'NATIVE' })).toBe(false);
      // Even an explicit OFF override or rule must not unpublish native.
      expect(
        svc.resolve({
          globalActive: true,
          storeKind: 'NATIVE',
          overrideAvailable: false,
          ruleAvailable: false,
          defaultAvailable: false,
        }),
      ).toBe(true);
      // And an ON override must not publish a globally-off product.
      expect(
        svc.resolve({
          globalActive: false,
          storeKind: 'NATIVE',
          overrideAvailable: true,
          ruleAvailable: true,
          defaultAvailable: true,
        }),
      ).toBe(false);
    });
  });

  describe('global ON + override/rule matrix (external)', () => {
    it.each([
      [true, true, true],
      [true, false, true],
      [false, true, false],
      [false, false, false],
    ])(
      'override=%s rule=%s → %s',
      (overrideAvailable, ruleAvailable, expected) => {
        expect(
          svc.resolve({
            globalActive: true,
            storeKind: 'WOOCOMMERCE',
            overrideAvailable,
            ruleAvailable,
          }),
        ).toBe(expected);
      },
    );
  });
});
