import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PdpSections } from '../PdpSections';

const base = {
  id: 'p1',
  name: 'Panjabi',
  description: 'Line one.\nLine two.',
  tags: ['Wedding', 'Formal'],
} as any;

describe('PdpSections', () => {
  it('renders description heading without collapse toggle', () => {
    render(<PdpSections product={base} sizeValues={[]} />);
    expect(screen.getByText('Description')).toBeDefined();
  });

  it('renders benefits as a check grid, hidden when absent', () => {
    const { rerender } = render(<PdpSections product={base} sizeValues={[]} />);
    expect(screen.queryByText('Key Features')).toBeNull();
    rerender(
      <PdpSections
        product={{ ...base, descriptionSections: { benefits: ['Soft & breathable', 'Fine stitching'] } }}
        sizeValues={[]}
      />,
    );
    expect(screen.getByText('Key Features')).toBeDefined();
    expect(screen.getByText('Soft & breathable')).toBeDefined();
  });

  it('renders admin detailRows with size row', () => {
    render(
      <PdpSections
        product={{ ...base, detailRows: [{ label: 'Fabric', value: 'Popcorn' }] }}
        sizeValues={['M', 'L']}
      />,
    );
    expect(screen.getByText('Product Details')).toBeDefined();
    expect(screen.getByText('Fabric')).toBeDefined();
    expect(screen.getByText('Popcorn')).toBeDefined();
    expect(screen.getByText('Size Available')).toBeDefined();
  });

  it('falls back to legacy specifications when rows are empty', () => {
    render(
      <PdpSections
        product={{ ...base, descriptionSections: { specifications: '<p>100% cotton</p>' } }}
        sizeValues={[]}
      />,
    );
    expect(screen.getByText('Product Details')).toBeDefined();
    expect(screen.getByText('100% cotton')).toBeDefined();
  });

  it('hides details entirely when neither source exists', () => {
    render(<PdpSections product={base} sizeValues={[]} />);
    expect(screen.queryByText('Product Details')).toBeNull();
  });

  it('renders tag chips, hidden when empty', () => {
    const { rerender } = render(<PdpSections product={base} sizeValues={[]} />);
    expect(screen.getByText('Perfect For')).toBeDefined();
    expect(screen.getByText('Wedding')).toBeDefined();
    rerender(<PdpSections product={{ ...base, tags: [] }} sizeValues={[]} />);
    expect(screen.queryByText('Perfect For')).toBeNull();
  });

  it('renders video only when a URL exists', () => {
    const { rerender } = render(<PdpSections product={base} sizeValues={[]} />);
    expect(screen.queryByText(/product video/i)).toBeNull();
    rerender(
      <PdpSections product={{ ...base, videoUrl: 'https://youtu.be/dQw4w9WgXcQ' }} sizeValues={[]} />,
    );
    expect(screen.getByText(/product video/i)).toBeDefined();
  });
});
