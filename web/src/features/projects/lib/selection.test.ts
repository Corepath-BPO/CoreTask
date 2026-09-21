import { describe, expect, it } from 'vitest';

import type { Group } from './group-by-section';
import {
  escapeBelongsElsewhere,
  isInteractiveTarget,
  rangeBetween,
  toggle,
  visibleOrder,
} from './selection';

const group = (id: string, ids: string[]): Group =>
  ({ id, name: id, tasks: ids.map((taskId) => ({ id: taskId })) }) as unknown as Group;

describe('visibleOrder', () => {
  it('walks the sections in order and skips collapsed ones', () => {
    const groups = [group('a', ['1', '2']), group('b', ['3']), group('c', ['4', '5'])];

    expect(visibleOrder(groups, new Set())).toEqual(['1', '2', '3', '4', '5']);
    expect(visibleOrder(groups, new Set(['b']))).toEqual(['1', '2', '4', '5']);
  });
});

describe('rangeBetween', () => {
  const order = ['1', '2', '3', '4', '5'];

  it('runs forward from the anchor to the target, inclusive', () => {
    expect(rangeBetween(order, '2', '4')).toEqual(['2', '3', '4']);
  });

  it('runs backward when the target is above the anchor', () => {
    expect(rangeBetween(order, '4', '2')).toEqual(['2', '3', '4']);
  });

  it('is just the target without an anchor, or with one that is gone', () => {
    expect(rangeBetween(order, null, '3')).toEqual(['3']);
    expect(rangeBetween(order, 'gone', '3')).toEqual(['3']);
  });
});

describe('toggle', () => {
  it('adds an absent id and removes a present one, without mutating', () => {
    const selected = new Set(['1']);

    expect([...toggle(selected, '2')]).toEqual(['1', '2']);
    expect([...toggle(selected, '1')]).toEqual([]);
    expect([...selected]).toEqual(['1']);
  });
});

describe('isInteractiveTarget', () => {
  it('treats controls and their contents as interactive, and the row padding as not', () => {
    const row = document.createElement('tr');
    row.innerHTML = '<td><button><span>Open</span></button></td><td class="pad"></td>';

    expect(isInteractiveTarget(row.querySelector('span'))).toBe(true);
    expect(isInteractiveTarget(row.querySelector('.pad'))).toBe(false);
    expect(isInteractiveTarget(null)).toBe(false);
  });
});

describe('escapeBelongsElsewhere', () => {
  it('yields to fields and open layers, but not to plain buttons or the checkbox', () => {
    const host = document.createElement('div');
    host.innerHTML =
      '<input class="text" /><input type="checkbox" class="box" /><button class="btn"></button>' +
      '<div role="listbox"><span class="option"></span></div>';

    expect(escapeBelongsElsewhere(host.querySelector('.text'))).toBe(true);
    expect(escapeBelongsElsewhere(host.querySelector('.option'))).toBe(true);
    expect(escapeBelongsElsewhere(host.querySelector('.box'))).toBe(false);
    expect(escapeBelongsElsewhere(host.querySelector('.btn'))).toBe(false);
  });
});
