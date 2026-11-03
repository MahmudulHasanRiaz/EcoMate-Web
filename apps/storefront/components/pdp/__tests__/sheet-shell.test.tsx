import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SheetShell } from '../SheetShell';

// P7: close is animated (300ms exit) — the parent's onClose (unmount)
// fires only after the exit transition, so close assertions wait for it.
describe('SheetShell', () => {
  it('renders children in a dialog with a close button', async () => {
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
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('closes on ESC but not on content click', async () => {
    const onClose = vi.fn();
    render(
      <SheetShell title="T" onClose={onClose}>
        <div>inner</div>
      </SheetShell>,
    );
    fireEvent.click(screen.getByText('inner'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('closes on backdrop click', async () => {
    const onClose = vi.fn();
    render(
      <SheetShell title="T" onClose={onClose}>
        <div>inner</div>
      </SheetShell>,
    );
    fireEvent.click(screen.getByTestId('sheet-backdrop'));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('keeps the sheet mounted during the exit animation', () => {
    const onClose = vi.fn();
    render(
      <SheetShell title="T" onClose={onClose}>
        <div>inner</div>
      </SheetShell>,
    );
    fireEvent.click(screen.getByLabelText('Close'));
    // Still mounted (animating out); the parent is not told to unmount yet.
    expect(screen.getByRole('dialog')).toBeDefined();
    expect(onClose).not.toHaveBeenCalled();
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

  it('still closes on Escape with the latest onClose', async () => {
    const onClose = vi.fn();
    render(
      <SheetShell title="Sheet" onClose={onClose}>
        <span>body</span>
      </SheetShell>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
