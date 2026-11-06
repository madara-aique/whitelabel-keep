import '@testing-library/jest-dom/vitest';

/**
 * Global test setup.
 *
 * Loaded for every test file, including the `node` environment where
 * there is no `window`, so every DOM touch is guarded.
 */

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  });
}
