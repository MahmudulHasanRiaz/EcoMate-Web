import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { EcoMateSDK } from '../CustomRenderer';

function sdkCode(): string {
  const { container } = render(<EcoMateSDK products={[]} currency="BDT" />);
  const script = container.querySelector('script');
  expect(script).not.toBeNull();
  return script!.innerHTML;
}

describe('EcoMateSDK checkout.submit', () => {
  it('passes the page-shown shipping charge through to /api/orders', () => {
    const code = sdkCode();
    // The bill the customer saw (page zone charge) must reach the backend —
    // otherwise the backend falls back to the global default and the admin
    // bill differs from what the customer paid.
    expect(code).toMatch(/shippingCharge/);
    expect(code).toMatch(/d\.shippingCharge/);
    expect(code).toMatch(/d\.deliveryCharge/);
  });

  it('still posts the order payload shape the backend expects', () => {
    const code = sdkCode();
    expect(code).toMatch(/\/api\/orders/);
    expect(code).toMatch(/guestName/);
    expect(code).toMatch(/guestPhone/);
    expect(code).toMatch(/shippingAddress/);
    expect(code).toMatch(/paymentOptionType/);
  });
});
