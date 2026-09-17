import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import CheckoutError from '../error';

describe('CheckoutError boundary', () => {
  const reloadMock = vi.fn();

  // Stub location once: re-spying window.location.reload across tests
  // recurses in jsdom (Maximum call stack). The component only uses .reload().
  Object.defineProperty(window, 'location', {
    value: { reload: reloadMock },
    writable: true,
    configurable: true,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it('auto-reloads once for a module-load TypeError (stale chunk signature)', () => {
    render(
      <CheckoutError
        error={new TypeError('(0, O.getGateways) is not a function') as Error}
        reset={() => {}}
      />,
    );
    expect(reloadMock).toHaveBeenCalledTimes(1);
    // Manual fallback UI still rendered underneath.
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });

  it('auto-reloads for a chunk-load failure message', () => {
    render(
      <CheckoutError
        error={Object.assign(new Error('Loading chunk 123 failed'), { name: 'ChunkLoadError' })}
        reset={() => {}}
      />,
    );
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT reload for an ordinary render error (shows manual UI only)', () => {
    render(
      <CheckoutError
        error={new Error('Cannot read properties of undefined (reading total)')}
        reset={() => {}}
      />,
    );
    expect(reloadMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });

  it('does NOT loop: a second module-load failure within the guard window shows UI only', () => {
    const err = () =>
      new TypeError('(0, O.getGateways) is not a function') as Error;
    const { unmount } = render(<CheckoutError error={err()} reset={() => {}} />);
    expect(reloadMock).toHaveBeenCalledTimes(1);
    unmount();
    render(<CheckoutError error={err()} reset={() => {}} />);
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });
});
