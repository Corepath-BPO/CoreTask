import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// jsdom implements neither of these, and both are touched during a normal render
// (theme resolution and Radix's collision handling).
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

/*
 * jsdom ships no Pointer Events at all, and Radix's Select reaches for pointer
 * capture the moment its trigger is pressed. Without these, opening a dropdown
 * throws `hasPointerCapture is not a function` and the listbox simply never
 * appears — which reads in a test like the options being missing rather than
 * the environment being incomplete.
 */
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}

// Radix scrolls the highlighted option into view when a list opens.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

afterEach(() => cleanup());
