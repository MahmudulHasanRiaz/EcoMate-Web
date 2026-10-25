import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import VideoEmbed from '../VideoEmbed';

describe('VideoEmbed facade (P2-3)', () => {
  it('renders a click-to-play thumbnail instead of the YouTube iframe', () => {
    const { container } = render(<VideoEmbed url="https://youtu.be/dQw4w9WgXcQ" />);
    expect(container.querySelector('iframe')).toBeNull();
    const thumb = container.querySelector('img');
    expect(thumb?.getAttribute('src')).toContain('dQw4w9WgXcQ');
    expect(thumb?.getAttribute('loading')).toBe('lazy');
    expect(screen.getByRole('button', { name: /play product video/i })).toBeDefined();
  });

  it('injects the lazy iframe only after click', () => {
    const { container } = render(<VideoEmbed url="https://youtu.be/dQw4w9WgXcQ" />);
    fireEvent.click(screen.getByRole('button', { name: /play product video/i }));
    const iframe = container.querySelector('iframe');
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute('src')).toContain('dQw4w9WgXcQ');
    expect(iframe?.getAttribute('loading')).toBe('lazy');
  });

  it('renders nothing for unparseable URLs', () => {
    const { container } = render(<VideoEmbed url="not a video" />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing for a whitespace-only URL', () => {
    const { container } = render(<VideoEmbed url="   " />);
    expect(container.innerHTML).toBe('');
  });
});

describe('VideoEmbed Facebook facade', () => {
  afterEach(() => {
    vi.useRealTimers();
    delete (window as any).FB;
    document.getElementById('fb-sdk')?.remove();
  });

  it('shows a tap-to-play facade and loads no SDK on mount', () => {
    const { container } = render(<VideoEmbed url="https://www.facebook.com/watch/?v=123456789" />);
    expect(screen.getByRole('button', { name: /play product video on facebook/i })).toBeDefined();
    expect(container.querySelector('iframe')).toBeNull();
    expect(document.getElementById('fb-sdk')).toBeNull();
  });

  it('collapses to a small link chip — never a blank box — when the plugin cannot render', () => {
    vi.useFakeTimers();
    // FB present but its plugin renders nothing (private/rejected URL).
    (window as any).FB = { XFBML: { parse: vi.fn() } };
    const url = 'https://www.facebook.com/watch/?v=123456789';
    const { container } = render(<VideoEmbed url={url} />);
    fireEvent.click(screen.getByRole('button', { name: /play product video on facebook/i }));
    expect((window as any).FB.XFBML.parse).toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    const chip = screen.getByRole('link', { name: /watch video on facebook/i });
    expect(chip.getAttribute('href')).toBe(url);
    // No aspect-ratio box survives the collapse.
    expect(container.querySelector('[style*="aspect-ratio"]')).toBeNull();
  });
});
