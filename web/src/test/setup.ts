import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/*
 * jsdom implements neither of these, and both are touched during a normal
 * render (theme resolution and Radix's collision handling).
 *
 * A plain function rather than `vi.fn()`: `restoreMocks: true` strips the
 * implementation off a spy after the first test, so from the second test in a
 * file onwards `matchMedia()` returned undefined and any component that reads
 * the theme threw "Cannot read properties of undefined". Nothing here needs to
 * be asserted on, so there is no reason for it to be a spy at all.
 */
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }),
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
