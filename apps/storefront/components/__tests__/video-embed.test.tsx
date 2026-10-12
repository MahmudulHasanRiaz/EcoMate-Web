import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
});
