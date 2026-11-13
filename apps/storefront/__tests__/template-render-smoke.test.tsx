import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { preFormattedPages } from '@/lib/templates/registry';
import AboutTemplate from '@/lib/templates/pages/about';
import CompanyTemplate from '@/lib/templates/pages/company';
import ExchangePolicyTemplate from '@/lib/templates/pages/exchange-policy';
import PrivacyPolicyTemplate from '@/lib/templates/pages/privacy-policy';
import RefundPolicyTemplate from '@/lib/templates/pages/refund-policy';
import ShippingPolicyTemplate from '@/lib/templates/pages/shipping-policy';
import TermsConditionsTemplate from '@/lib/templates/pages/terms-conditions';

// The pre-formatted suite only creates template elements — it never renders
// them. These smoke tests prove the Part A templates render without throwing
// on neutral empty defaults (honest empty state, no fake copy) and with real
// configured content.

const META = { updatedAt: '2026-11-13T10:00:00.000Z', effectiveDate: null, version: 2 };

function defaults(key: string) {
  return preFormattedPages[key].defaultConfig;
}

describe('template render smoke', () => {
  it('about renders an honest empty state on neutral defaults, and real content when configured', () => {
    const empty = renderToString(<AboutTemplate config={defaults('about')} storeName="Acme" pageMeta={META} />);
    expect(empty).toContain('still writing our story');
    expect(empty).not.toContain('Store was born');
    expect(empty).not.toContain('Uncompromising Tech');

    const full = renderToString(
      <AboutTemplate
        config={{ story: 'We began in 2020.\n\nWe sell good things.', tagline: 'Real tagline', values: [{ title: 'Care', description: 'We care.' }], image: '' }}
        storeName="Acme"
        pageMeta={META}
      />,
    );
    expect(full).toContain('Acme');
    expect(full).toContain('Real tagline');
    expect(full).toContain('We began in 2020.');
    expect(full).toContain('Care');
  });

  it('company renders an honest empty state on neutral defaults, and real content when configured', () => {
    const empty = renderToString(<CompanyTemplate config={defaults('company')} storeName="Acme" pageMeta={META} />);
    expect(empty).toContain('Company details haven');
    expect(empty).not.toContain('Store Limited');
    expect(empty).not.toContain('Mahmud Riaz');
    expect(empty).not.toContain('STORE PLUS');

    const full = renderToString(
      <CompanyTemplate
        config={{ name: 'Acme Ltd', registration: 'R-1', certifications: 'ISO 9001', teamSize: '12 people', ceoName: 'Ayesha Khan', established: '2020', tagline: 'Our tagline', philosophy: 'Be honest.', vision: 'Grow.', impact: 'Help.', image: '' }}
        storeName="Acme"
        pageMeta={META}
      />,
    );
    expect(full).toContain('ACME');
    expect(full).toContain('Acme Ltd');
    expect(full).toContain('Ayesha Khan');
    expect(full).not.toContain('PLUS');
  });

  it('policy templates render empty states on neutral defaults', () => {
    for (const [key, Component, title] of [
      ['exchange-policy', ExchangePolicyTemplate, 'Exchange Policy'],
      ['privacy-policy', PrivacyPolicyTemplate, 'Privacy Policy'],
      ['refund-policy', RefundPolicyTemplate, 'Refund Policy'],
      ['shipping-policy', ShippingPolicyTemplate, 'Shipping Policy'],
      ['terms-conditions', TermsConditionsTemplate, 'Terms &amp; Conditions'],
    ] as const) {
      const html = renderToString(<Component config={defaults(key)} pageMeta={META} />);
      expect(html, `${key} empty state`).toContain('been set up yet');
      expect(html, `${key} title`).toContain(title);
    }
  });

  it('exchange renders steps and conditions by semantic kind, not position', () => {
    const html = renderToString(
      <ExchangePolicyTemplate
        config={{
          intro: 'How exchanges work.',
          quote: '',
          sections: [
            { heading: 'Damaged items', body: 'We replace them.', kind: 'condition' },
            { heading: 'Request', body: 'Call us.', kind: 'step' },
            { heading: 'Packaging', body: 'Keep the box.', kind: 'condition' },
          ],
        }}
        pageMeta={META}
      />,
    );
    expect(html).toContain('How exchanges work.');
    expect(html).toContain('Request');
    expect(html).toContain('Damaged items');
    expect(html).toContain('Exchange Conditions');
    // Last-updated comes from pageMeta (runtime-default locale, no hardcoded
    // en-GB/Asia/Dhaka) — assert the line and the year, not a locale string.
    expect(html).toContain('Last updated:');
    expect(html).toContain('2026');
    expect(html).toContain('Version');
  });

  it('terms sidebar links are real anchors derived from the sections', () => {
    const html = renderToString(
      <TermsConditionsTemplate
        config={{
          intro: '',
          sections: [
            { id: 'acceptance', heading: 'Acceptance', body: 'You accept.' },
            { id: 'payments', heading: 'Payments', body: 'You pay.' },
          ],
        }}
        pageMeta={META}
      />,
    );
    expect(html).toContain('href="#acceptance"');
    expect(html).toContain('href="#payments"');
    expect(html).toContain('Acceptance');
    expect(html).not.toContain('Operating Entities');
    expect(html).not.toContain('FIXED PLUS');
  });

  it('privacy uses last-updated from page meta, never a hardcoded date', () => {
    const html = renderToString(
      <PrivacyPolicyTemplate
        config={{ intro: '', sections: [{ id: 'data-collection', heading: 'Data Collection', body: 'We collect little.' }] }}
        pageMeta={META}
      />,
    );
    expect(html).toContain('Data Collection');
    expect(html).toContain('Last updated:');
    expect(html).toContain('2026');
    expect(html).not.toContain('January 2024');
  });

  it('refund shows the editable notice only when configured, with no hardcoded warning', () => {
    const empty = renderToString(
      <RefundPolicyTemplate config={defaults('refund-policy')} pageMeta={META} />,
    );
    expect(empty).not.toContain('24 hours');
    expect(empty).not.toContain('perishable');

    const withNotice = renderToString(
      <RefundPolicyTemplate
        config={{
          intro: '',
          sections: [{ heading: 'Timeline', body: '5-7 business days.' }],
          notice: { title: 'Please note', body: 'Contact us within 7 days.' },
          contactEmail: 'help@example.com',
        }}
        pageMeta={META}
      />,
    );
    expect(withNotice).toContain('Please note');
    expect(withNotice).toContain('Contact us within 7 days.');
    expect(withNotice).toContain('help@example.com');
  });

  it('shipping rewrites charge lines only from configured charges', () => {
    const html = renderToString(
      <ShippingPolicyTemplate
        config={{
          intro: '',
          sections: [{ heading: 'Charges', body: 'Free shipping on orders over ৳5,000\n\nInside Dhaka: ৳60 flat rate' }],
          deliveryCharge: 80,
          freeDeliveryMin: 3000,
        }}
        pageMeta={META}
      />,
    );
    expect(html).toContain('৳3,000');
    expect(html).toContain('৳80');
    expect(html).not.toContain('December 2024');
  });
});
