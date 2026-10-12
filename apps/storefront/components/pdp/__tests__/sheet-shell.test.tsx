import React, { useState } from 'react';
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

function FocusHarness() {
  const [n, setN] = useState(0);
  return (
    <>
      <button onClick={() => setN(n + 1)}>bump {n}</button>
      {/* inline arrow: new onClose identity on every render, like all call sites */}
      <SheetShell title="Sheet" onClose={() => {}}>
        <button>inner action</button>
      </SheetShell>
    </>
  );
}

describe('SheetShell focus (P1-6)', () => {
  it('focuses close on mount but never steals it back on re-render', () => {
    render(<FocusHarness />);

    // mount: initial focus lands on ✕
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Close');

    // user moves into the sheet content…
    screen.getByText('inner action').focus();
    expect(document.activeElement?.textContent).toBe('inner action');

    // …a parent re-render (new onClose identity) must not yank focus back
    fireEvent.click(screen.getByText(/bump/));
    expect(document.activeElement?.textContent).toBe('inner action');
  });

  it('still closes on Escape with the latest onClose', () => {
    const onClose = vi.fn();
    render(
      <SheetShell title="Sheet" onClose={onClose}>
        <span>body</span>
      </SheetShell>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
