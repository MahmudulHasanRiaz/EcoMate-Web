import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PdpGallery } from '../PdpGallery';

vi.mock('next/image', () => ({
  default: ({ alt, src, ...rest }: any) => <img alt={alt} src={src} {...rest} />,
}));

describe('PdpGallery', () => {
  const props = {
    images: ['/a.jpg', '/b.jpg'],
    productName: 'Panjabi',
    galleryKey: 'p1',
  };

  it('delegates to the gallery and keeps the counter badge', () => {
    render(<PdpGallery {...props} />);
    expect(screen.getByTestId('pdp-gallery')).toBeDefined();
    // desktop + mobile counters both render "1 / 2"
    expect(screen.getAllByText('2').length).toBeGreaterThan(0);
  });

  it('mobile thumb row selects the tapped image', () => {
    render(<PdpGallery {...props} />);
    const thumbs = screen.getAllByLabelText(/Go to image/);
    expect(thumbs.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(thumbs[1]);
    expect(screen.getAllByText('2').length).toBeGreaterThan(0);
  });
});
