import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import LandingTemplateRenderer from '@/components/landing/TemplateRenderer';
import { StorefrontConfigProvider } from '@/context/StorefrontConfigContext';
import { AuthProvider } from '@/context/AuthContext';
import type { StorefrontConfig } from '@/lib/api/storefront-config';

vi.mock('@/lib/api/auth', () => ({
  getMe: vi.fn().mockResolvedValue(null),
}));

const CONFIG = { currency: { code: 'BDT', symbol: '৳' } } as unknown as StorefrontConfig;

describe('LandingTemplateRenderer — hidden sections', () => {
  beforeEach(() => {
    vi.mocked(window.fbq as any)?.mockClear?.();
  });

  it('skips sections with hidden === true and renders the rest', () => {
    const sections = [
      { type: 'hero', title: 'Hidden Hero', hidden: true },
      { type: 'hero', title: 'Visible Hero' },
      { type: 'features', title: 'Visible Features', hidden: false },
    ];
    render(
      <StorefrontConfigProvider initialConfig={CONFIG}>
        <AuthProvider>
          <LandingTemplateRenderer sections={sections} products={[]} />
        </AuthProvider>
      </StorefrontConfigProvider>,
    );
    expect(screen.queryByText('Hidden Hero')).toBeNull();
    expect(screen.getByText('Visible Hero')).toBeTruthy();
    expect(screen.getByText('Visible Features')).toBeTruthy();
  });
});
