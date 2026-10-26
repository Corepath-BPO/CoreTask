import { describe, expect, it } from 'vitest';

import { router } from '../router/router';

import { NAV_SECTIONS } from './navigation';

/**
 * The sidebar's "Soon" chips are hand-maintained, and drifted once already:
 * Teams and Inbox both shipped while the sidebar went on advertising them as
 * unbuilt, so the only way to find either page was to know the URL.
 *
 * The router is the source of truth. A `comingSoon` item must resolve to the
 * placeholder component, and an item without the flag must resolve to a real
 * page — so shipping one and forgetting the chip fails here.
 */
describe('sidebar navigation', () => {
  const items = NAV_SECTIONS.flatMap((section) => section.items);

  const routeFor = (path: string) =>
    Object.values(router.routesById).find((route) => route.fullPath === path);

  it.each(items.map((item) => [item.label, item.to, Boolean(item.comingSoon)] as const))(
    '%s points at a route that exists',
    (_label, to) => {
      expect(routeFor(to)).toBeDefined();
    },
  );

  it('every link in the sidebar is reachable', () => {
    const missing = items.filter((item) => !routeFor(item.to));
    expect(missing.map((item) => item.to)).toEqual([]);
  });

  /*
   * Compared against the placeholder component by name rather than by identity,
   * because the router wraps each placeholder in its own arrow function.
   */
  const isPlaceholder = (path: string): boolean => {
    const route = routeFor(path);
    const component = route?.options.component;
    if (!component) return false;
    return /PlaceholderPage/.test(String(component));
  };

  it('items marked Soon really are placeholders', () => {
    const lying = items
      .filter((item) => item.comingSoon)
      .filter((item) => !isPlaceholder(item.to))
      .map((item) => item.label);

    expect(lying).toEqual([]);
  });

  it('items not marked Soon really are built', () => {
    const stale = items
      .filter((item) => !item.comingSoon)
      .filter((item) => isPlaceholder(item.to))
      .map((item) => item.label);

    expect(stale).toEqual([]);
  });
});
