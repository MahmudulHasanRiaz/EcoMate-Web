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

const renderSections = (sections: any[]) =>
  render(
    <StorefrontConfigProvider initialConfig={CONFIG}>
      <AuthProvider>
        <LandingTemplateRenderer sections={sections} products={[]} />
      </AuthProvider>
    </StorefrontConfigProvider>,
  );

describe('LandingTemplateRenderer — video-embed poster', () => {
  beforeEach(() => {
    vi.mocked(window.fbq as any)?.mockClear?.();
  });

  it('passes section.poster to the native <video> element when set', () => {
    const { container } = renderSections([
      {
        type: 'video-embed',
        title: 'Watch',
        videoUrl: 'https://cdn.example.com/demo.mp4',
        poster: 'https://cdn.example.com/poster.jpg',
      },
    ]);
    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    expect(video?.getAttribute('src')).toBe('https://cdn.example.com/demo.mp4');
    expect(video?.getAttribute('poster')).toBe('https://cdn.example.com/poster.jpg');
  });

  it('renders no poster attribute on the native <video> element when poster is unset', () => {
    const { container } = renderSections([
      { type: 'video-embed', title: 'Watch', videoUrl: 'https://cdn.example.com/demo.mp4' },
    ]);
    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    expect(video?.hasAttribute('poster')).toBe(false);
  });

  it('renders no poster attribute when poster is an empty string', () => {
    const { container } = renderSections([
      {
        type: 'video-embed',
        title: 'Watch',
        videoUrl: 'https://cdn.example.com/demo.mp4',
        poster: '',
      },
    ]);
    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    expect(video?.hasAttribute('poster')).toBe(false);
  });

  it('ignores poster for YouTube embeds (iframes do not support poster)', () => {
    const { container } = renderSections([
      {
        type: 'video-embed',
        title: 'Watch',
        videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        poster: 'https://cdn.example.com/poster.jpg',
      },
    ]);
    expect(container.querySelector('video')).toBeNull();
    const iframe = container.querySelector('iframe');
    expect(iframe).not.toBeNull();
    expect(iframe?.hasAttribute('poster')).toBe(false);
    expect(screen.getByText('Watch')).toBeTruthy();
  });
});
