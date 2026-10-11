import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SizeGuideSheet } from '../SizeGuideSheet';

const chart = {
  id: 'c1',
  name: 'Panjabi Size Guide',
  description: null,
  image: null,
  tableData: [
    { Size: 'M', Chest: '40', Length: '42', Shoulder: '18', Sleeve: '24' },
    { Size: 'L', Chest: '42', Length: '43', Shoulder: '18.5', Sleeve: '24.5' },
  ],
} as any;

describe('SizeGuideSheet', () => {
  it('renders tabs, table and note', () => {
    render(<SizeGuideSheet chart={chart} onPickSize={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('Panjabi Size Guide')).toBeDefined();
    expect(screen.getByText('Size chart')).toBeDefined();
    expect(screen.getByText('How to measure')).toBeDefined();
    expect(screen.getByText('Tap a size to select it. Measurements are garment measurements.')).toBeDefined();
  });

  it('converts inch to cm client-side without mutating source', () => {
    render(<SizeGuideSheet chart={chart} onPickSize={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('40')).toBeDefined();
    fireEvent.click(screen.getByText('Cm'));
    expect(screen.getByText('101.6')).toBeDefined(); // 40 × 2.54
    expect(chart.tableData[0].Chest).toBe('40');
  });

  it('tap on a size applies it and closes', () => {
    const onPickSize = vi.fn();
    const onClose = vi.fn();
    render(<SizeGuideSheet chart={chart} onPickSize={onPickSize} onClose={onClose} />);
    fireEvent.click(screen.getByText('L'));
    expect(onPickSize).toHaveBeenCalledWith('L');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('how-to-measure tab shows definitions and image when present', () => {
    render(
      <SizeGuideSheet
        chart={{ ...chart, image: '/guide.jpg' }}
        onPickSize={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('How to measure'));
    expect(screen.getByText(/around the fullest part/)).toBeDefined();
    expect(screen.getByAltText('Panjabi Size Guide')).toBeDefined();
  });
});
