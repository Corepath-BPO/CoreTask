import { describe, expect, it } from 'vitest';

import {
  applyEdits,
  hasEdits,
  lastOnMainPath,
  makeNode,
  NO_EDITS,
  withPlaceholder,
  type CanvasNode,
} from './graph-edits';

const node = (over: Partial<CanvasNode>): CanvasNode =>
  ({
    id: 'n',
    type: 'ACTION',
    subtype: 'ASSIGN_USER',
    configuration: {},
    position: { x: 0, y: 0 },
    parentId: null,
    branchKey: null,
    order: 0,
    ...over,
  }) as CanvasNode;

/** trigger → condition → action, the ordinary shape. */
const chain = (): CanvasNode[] => [
  node({ id: 't', type: 'TRIGGER', subtype: 'TASK_CREATED', parentId: null, order: 0 }),
  node({ id: 'c', type: 'CONDITION', subtype: 'FIELD_COMPARISON', parentId: 't', order: 1 }),
  node({ id: 'a', type: 'ACTION', parentId: 'c', order: 2 }),
];

describe('unsaved edits over the server’s copy', () => {
  it('changes nothing when there are none', () => {
    expect(applyEdits(chain(), NO_EDITS).map((n) => n.id)).toEqual(['t', 'c', 'a']);
    expect(hasEdits(NO_EDITS)).toBe(false);
  });

  it('lays a move and a configuration over the stored node', () => {
    const result = applyEdits(chain(), {
      ...NO_EDITS,
      moved: { a: { x: 99, y: 11 } },
      configured: { a: { userId: 'u-1' } },
    });

    const action = result.find((n) => n.id === 'a');
    expect(action?.position).toEqual({ x: 99, y: 11 });
    expect(action?.configuration).toEqual({ userId: 'u-1' });
  });

  it('closes the gap when a step in the middle is removed', () => {
    /*
     * Filtering alone would leave the action pointing at a condition that is no
     * longer there — a step nothing reaches, which validation calls
     * disconnected and a person would call "my rule lost its action".
     */
    const result = applyEdits(chain(), { ...NO_EDITS, removed: ['c'] });

    expect(result.map((n) => n.id)).toEqual(['t', 'a']);
    expect(result.find((n) => n.id === 'a')?.parentId).toBe('t');
  });

  it('re-parents past a run of removed steps', () => {
    const result = applyEdits(chain(), { ...NO_EDITS, removed: ['c', 't'] });

    expect(result.find((n) => n.id === 'a')?.parentId).toBeNull();
  });

  it('includes added steps', () => {
    const added = node({ id: 'new-1', parentId: 'a', order: 3 });
    const result = applyEdits(chain(), { ...NO_EDITS, added: [added] });

    expect(result.map((n) => n.id)).toEqual(['t', 'c', 'a', 'new-1']);
  });
});

describe('the placeholder', () => {
  it('appears only while a rule has no action', () => {
    const withoutAction = chain().filter((n) => n.type !== 'ACTION');

    expect(withPlaceholder(withoutAction).some((n) => n.type === 'PLACEHOLDER')).toBe(true);
    expect(withPlaceholder(chain()).some((n) => n.type === 'PLACEHOLDER')).toBe(false);
  });

  it('hangs off the end of the rule', () => {
    const withoutAction = chain().filter((n) => n.type !== 'ACTION');
    const placeholder = withPlaceholder(withoutAction).find((n) => n.type === 'PLACEHOLDER');

    expect(placeholder?.parentId).toBe('c');
  });

  it('adds nothing to an empty canvas', () => {
    // Nothing to attach to, and a floating "+ Do this…" would be a step that
    // never becomes part of the rule.
    expect(withPlaceholder([])).toEqual([]);
  });
});

describe('adding a step', () => {
  it('attaches to the last step and sits beyond it', () => {
    const created = makeNode('ACTION', 'ADD_COMMENT', chain());

    expect(created.parentId).toBe('a');
    expect(created.position.x).toBeGreaterThan(0);
  });

  it('gives it an id that is obviously not from the database', () => {
    // The API maps client ids to real ones; one that looked like a uuid would
    // invite somebody to treat it as a key.
    expect(makeNode('ACTION', 'ADD_COMMENT', chain()).id).toMatch(/^new-/);
  });

  it('appends rather than forking when added twice', () => {
    const first = makeNode('ACTION', 'ADD_COMMENT', chain());
    const second = makeNode('ACTION', 'UPDATE_STATUS', [...chain(), first]);

    expect(second.parentId).toBe(first.id);
  });
});

describe('where the next step attaches', () => {
  it('is the step nothing follows', () => {
    expect(lastOnMainPath(chain())?.id).toBe('a');
  });

  it('is nothing at all on an empty canvas', () => {
    expect(lastOnMainPath([])).toBeNull();
  });
});
