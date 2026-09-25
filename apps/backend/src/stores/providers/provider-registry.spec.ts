/**
 * Provider registry tests — central-commerce §7 / BR-20 (P1).
 *
 * - All three slugs registered in P1 (WooCommerce, Shopify, Custom/Bridge
 *   are first-class from P1; WooCommerce is the first implementation).
 * - `providerFor` THROWS for NATIVE (native-isolation invariant).
 * - Capability spot-checks that lock §7.1: WooCommerce faithful stock,
 *   Shopify unsupported stock (BR-08), combos false everywhere (BR-22),
 *   costPrice never customer-facing (BR-23: WC has no native field).
 */
import { ProviderRegistryService } from './provider-registry.service';
import { WooCommerceProvider } from './woocommerce.provider';
import { ShopifyProvider } from './shopify.provider';
import { CustomBridgeProvider } from './custom-bridge.provider';

function makeRegistry(): ProviderRegistryService {
  return new ProviderRegistryService(
    new WooCommerceProvider(),
    new ShopifyProvider(),
    new CustomBridgeProvider(),
  );
}

describe('ProviderRegistryService (P1)', () => {
  it('registers all three provider slugs', () => {
    const registry = makeRegistry();
    expect(registry.slugs().sort()).toEqual(['custom', 'shopify', 'woocommerce']);
  });

  it('resolves each store kind to its adapter', () => {
    const registry = makeRegistry();
    expect(registry.providerFor({ kind: 'WOOCOMMERCE' }).slug).toBe('woocommerce');
    expect(registry.providerFor({ kind: 'SHOPIFY' }).slug).toBe('shopify');
    expect(registry.providerFor({ kind: 'CUSTOM' }).slug).toBe('custom');
  });

  it('throws for NATIVE kind (BR-20 native-isolation guard)', () => {
    const registry = makeRegistry();
    expect(() => registry.providerFor({ kind: 'NATIVE' })).toThrow(/BR-20/);
  });

  it('throws for an unknown store kind', () => {
    const registry = makeRegistry();
    expect(() => providerForUnknown(registry)).toThrow(/Unknown store kind/);
  });

  it('locks the §7.1 stock-fidelity matrix (BR-06/BR-08)', () => {
    const registry = makeRegistry();
    expect(
      registry.providerBySlug('woocommerce').declaredCapabilities.stockStatusFidelity,
    ).toBe('faithful');
    expect(
      registry.providerBySlug('shopify').declaredCapabilities.stockStatusFidelity,
    ).toBe('unsupported');
  });

  it('declares combos=false for every provider (BR-22)', () => {
    const registry = makeRegistry();
    for (const slug of registry.slugs()) {
      expect(registry.providerBySlug(slug).declaredCapabilities.combos).toBe(false);
    }
  });

  it('declares costPrice=false for WooCommerce (BR-23, no native field)', () => {
    const registry = makeRegistry();
    expect(registry.providerBySlug('woocommerce').declaredCapabilities.costPrice).toBe(
      false,
    );
  });

  function providerForUnknown(registry: ProviderRegistryService) {
    return registry.providerFor({ kind: 'MAGENTO' });
  }
});
