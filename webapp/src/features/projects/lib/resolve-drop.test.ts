import type { Section } from '@coretask/types';
import { describe, expect, it } from 'vitest';

import { resolveDropPlan } from './resolve-drop';

const section = (id: string, position: number): Section => ({
  id,
  workspaceId: 'w',
  projectId: 'p',
  name: id,
  position,
  defaultStatusId: null,
  taskCount: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const sections = [
  section('backlog', 1000),
  section('doing', 2000),
  section('review', 3000),
  section('done', 4000),
];

const order = (plan: ReturnType<typeof resolveDropPlan>) =>
  plan?.reordered.map((entry) => entry.id);

describe('resolveDropPlan', () => {
  it('returns null when an item is dropped on itself', () => {
    expect(resolveDropPlan(sections, 'doing', 'doing')).toBeNull();
  });

  it('returns null for an unknown id', () => {
    expect(resolveDropPlan(sections, 'ghost', 'doing')).toBeNull();
    expect(resolveDropPlan(sections, 'doing', 'ghost')).toBeNull();
  });

  it('anchors to null when an item is dragged to the front', () => {
    const plan = resolveDropPlan(sections, 'done', 'backlog');

    expect(plan?.afterSectionId).toBeNull();
    expect(order(plan)).toEqual(['done', 'backlog', 'doing', 'review']);
  });

  it('anchors to the last item when dragged to the end', () => {
    const plan = resolveDropPlan(sections, 'backlog', 'done');

    // It lands *after* the item it was dropped onto, which is now its left
    // neighbour — so the anchor is `done`, not the one before it.
    expect(plan?.afterSectionId).toBe('done');
    expect(order(plan)).toEqual(['doing', 'review', 'done', 'backlog']);
  });

  /**
   * The direction that catches off-by-one errors: dragging left, the anchor is
   * the item that ends up *before* the dragged one, not the one it was dropped
   * onto.
   */
  it('anchors correctly when dragging leftwards', () => {
    const plan = resolveDropPlan(sections, 'review', 'doing');

    expect(plan?.afterSectionId).toBe('backlog');
    expect(order(plan)).toEqual(['backlog', 'review', 'doing', 'done']);
  });

  it('anchors correctly when dragging rightwards', () => {
    const plan = resolveDropPlan(sections, 'doing', 'review');

    expect(plan?.afterSectionId).toBe('review');
    expect(order(plan)).toEqual(['backlog', 'review', 'doing', 'done']);
  });

  it('keeps the anchor consistent with the reordered list', () => {
    for (const activeId of sections.map((entry) => entry.id)) {
      for (const overId of sections.map((entry) => entry.id)) {
        const plan = resolveDropPlan(sections, activeId, overId);
        if (!plan) continue;

        const index = plan.reordered.findIndex((entry) => entry.id === activeId);
        const expected = index === 0 ? null : (plan.reordered[index - 1]?.id ?? null);
        expect(plan.afterSectionId).toBe(expected);
      }
    }
  });

  it('never loses or duplicates a section', () => {
    const plan = resolveDropPlan(sections, 'backlog', 'review');
    expect(plan?.reordered).toHaveLength(sections.length);
    expect(new Set(order(plan)).size).toBe(sections.length);
  });
});
