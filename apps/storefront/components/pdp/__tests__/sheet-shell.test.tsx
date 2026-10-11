import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SheetShell } from '../SheetShell';

describe('SheetShell', () => {
  it('renders children in a dialog with a close button', () => {
    const onClose = vi.fn();
    render(
      <SheetShell title="Size Guide" onClose={onClose}>
        <div>body text</div>
      </SheetShell>,
    );
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(screen.getByText('body text')).toBeDefined();
    expect(screen.getByText('Size Guide')).toBeDefined();
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on ESC but not on content click', () => {
    const onClose = vi.fn();
    render(
      <SheetShell title="T" onClose={onClose}>
        <div>inner</div>
      </SheetShell>,
    );
    fireEvent.click(screen.getByText('inner'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on backdrop click', () => {
    const onClose = vi.fn();
    const { container } = render(
      <SheetShell title="T" onClose={onClose}>
        <div>inner</div>
      </SheetShell>,
    );
    fireEvent.click(container.firstChild as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
