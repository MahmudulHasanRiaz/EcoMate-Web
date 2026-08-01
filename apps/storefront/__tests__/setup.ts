import '@testing-library/jest-dom/vitest';
import { vi, beforeEach, afterEach } from 'vitest';

// Node >=22 exposes an experimental global `localStorage` that is unavailable
// unless `--localstorage-file` is provided. Because the key already exists on
// globalThis, vitest skips populating jsdom's Storage, so tests saw `undefined`.
// Restore jsdom's in-memory Storage for the test environment.
const jsdomWindow = (globalThis as { jsdom?: { window: { localStorage?: Storage } } }).jsdom?.window;
if (jsdomWindow?.localStorage) {
  Object.defineProperty(globalThis, 'localStorage', {
    value: jsdomWindow.localStorage,
    configurable: true,
    writable: true,
  });
}

class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  callback: IntersectionObserverCallback;
  options: IntersectionObserverInit | undefined;
  elements: Element[] = [];

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = callback;
    this.options = options;
    MockIntersectionObserver.instances.push(this);
  }
  observe(el: Element) { this.elements.push(el); }
  unobserve(el: Element) { this.elements = this.elements.filter(e => e !== el); }
  disconnect() { this.elements = []; }
  takeRecords(): IntersectionObserverEntry[] { return []; }
  trigger(isIntersecting: boolean) {
    this.callback(
      this.elements.map(el => ({ isIntersecting, target: el } as IntersectionObserverEntry)),
      this as unknown as IntersectionObserver,
    );
  }
}

beforeEach(() => {
  MockIntersectionObserver.instances = [];
  (globalThis as unknown as Record<string, unknown>).IntersectionObserver =
    MockIntersectionObserver as unknown as typeof IntersectionObserver;
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((q: string) => ({
      matches: false,
      media: q,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  (navigator as unknown as { connection?: { saveData?: boolean } }).connection = { saveData: false };
});

afterEach(() => {
  vi.restoreAllMocks();
});
