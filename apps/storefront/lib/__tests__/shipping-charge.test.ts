import { describe, it, expect } from 'vitest';
import { resolveDeliveryCharge, maxConfiguredCharge } from '../shipping-charge';

const OPTIONS = [
  { id: 'inside', amount: 60 },
  { id: 'outside', amount: 120 },
];

const ZONES = [
  { districts: ['Dhaka'], type: 'custom_amount', amount: 60 },
  { districts: ['Nowhere'], type: 'no_delivery', amount: null },
];

const MAP = { Sylhet: 100 };

describe('resolveDeliveryCharge', () => {
  it('options mode: uses the selected option', () => {
    expect(
      resolveDeliveryCharge({
        shippingMode: 'options',
        shippingOptions: OPTIONS,
        selectedShippingOptionId: 'outside',
        defaultCharge: 60,
        subtotal: 500,
      }).charge,
    ).toBe(120);
  });

  it('options mode: falls back to the highest option when none selected', () => {
    expect(
      resolveDeliveryCharge({
        shippingMode: 'options',
        shippingOptions: OPTIONS,
        defaultCharge: 60,
        subtotal: 500,
      }).charge,
    ).toBe(120);
  });

  it('auto_district: no district shows the MAXIMUM configured charge', () => {
    expect(
      resolveDeliveryCharge({
        shippingMode: 'auto_district',
        shippingZones: [{ districts: ['Dhaka'], type: 'custom_amount', amount: 150 }],
        districtCharges: { Sylhet: 100 },
        defaultCharge: 60,
        freeDeliveryMin: 1000,
        subtotal: 500,
      }).charge,
    ).toBe(150);
  });

  it('auto_district: unmatched district shows the MAXIMUM configured charge', () => {
    expect(
      resolveDeliveryCharge({
        shippingMode: 'auto_district',
        district: 'Barisal',
        shippingZones: [{ districts: ['Dhaka'], type: 'custom_amount', amount: 150 }],
        districtCharges: { Sylhet: 100 },
        defaultCharge: 60,
        freeDeliveryMin: 1000,
        subtotal: 500,
      }).charge,
    ).toBe(150);
  });

  it('auto_district: district_charges map applies when no zone matches', () => {
    expect(
      resolveDeliveryCharge({
        shippingMode: 'auto_district',
        district: 'Sylhet',
        shippingZones: ZONES,
        districtCharges: MAP,
        defaultCharge: 60,
        freeDeliveryMin: 1000,
        subtotal: 500,
      }).charge,
    ).toBe(100);
  });

  it('auto_district: matched zone wins over the district_charges map', () => {
    expect(
      resolveDeliveryCharge({
        shippingMode: 'auto_district',
        district: 'Dhaka',
        shippingZones: [{ districts: ['Dhaka'], type: 'custom_amount', amount: 150 }],
        districtCharges: { Dhaka: 80 },
        defaultCharge: 60,
        freeDeliveryMin: 1000,
        subtotal: 500,
      }).charge,
    ).toBe(150);
  });

  it('auto_district: matching custom_amount zone overrides the default', () => {
    expect(
      resolveDeliveryCharge({
        shippingMode: 'auto_district',
        district: 'Dhaka',
        shippingZones: ZONES,
        defaultCharge: 150,
        freeDeliveryMin: 1000,
        subtotal: 500,
      }).charge,
    ).toBe(60);
  });

  it('auto_district: unmatched district with no map falls back to the max', () => {
    expect(
      resolveDeliveryCharge({
        shippingMode: 'auto_district',
        district: 'Sylhet',
        shippingZones: ZONES,
        defaultCharge: 60,
        freeDeliveryMin: 1000,
        subtotal: 500,
      }).charge,
    ).toBe(60);
  });

  it('auto_district: no_delivery zone blocks checkout with an error', () => {
    const res = resolveDeliveryCharge({
      shippingMode: 'auto_district',
      district: 'Nowhere',
      shippingZones: ZONES,
      defaultCharge: 60,
      subtotal: 500,
    });
    expect(res.charge).toBe(0);
    expect(res.noDeliveryError).not.toBe('');
  });

  it('free-delivery threshold applies only when configured (> 0)', () => {
    // Unset (0) minimum must NEVER zero the charge — subtotal >= 0 always.
    expect(
      resolveDeliveryCharge({
        shippingMode: 'auto_district',
        defaultCharge: 60,
        freeDeliveryMin: 0,
        subtotal: 5000,
      }).charge,
    ).toBe(60);
    expect(
      resolveDeliveryCharge({
        shippingMode: 'auto_district',
        defaultCharge: 60,
        subtotal: 5000,
      }).charge,
    ).toBe(60);
  });

describe('maxConfiguredCharge', () => {
  it('takes the max across default, zones and map', () => {
    expect(
      maxConfiguredCharge(60, [{ districts: ['Dhaka'], type: 'custom_amount', amount: 150 }], {
        Sylhet: 100,
      }),
    ).toBe(150);
  });

  it('ignores no_delivery zones and null amounts', () => {
    expect(
      maxConfiguredCharge(60, [{ districts: ['X'], type: 'no_delivery', amount: null }], null),
    ).toBe(60);
  });
});

describe('free-delivery threshold', () => {
  it('configured threshold zeroes the charge above the minimum', () => {
    expect(
      resolveDeliveryCharge({
        shippingMode: 'auto_district',
        defaultCharge: 60,
        freeDeliveryMin: 1000,
        subtotal: 1500,
      }).charge,
    ).toBe(0);
    expect(
      resolveDeliveryCharge({
        shippingMode: 'auto_district',
        defaultCharge: 60,
        freeDeliveryMin: 1000,
        subtotal: 500,
      }).charge,
    ).toBe(60);
  });
});
});
