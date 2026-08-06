import { describe, expect, it } from 'vitest';

import {
  applyEdits,
  hasEdits,
  lastOnMainPath,
  makeBranch,
  makeNode,
  makeNodeUnder,
  NO_EDITS,
  readPlaceholderId,
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

  it('lays a configuration over the stored node', () => {
    // Position used to be laid over here too. It is worked out from the rule's
    // shape now, so there is nothing to overlay — see `layoutGraph`.
    const result = applyEdits(chain(), {
      ...NO_EDITS,
      configured: { a: { userId: 'u-1' } },
    });

    expect(result.find((n) => n.id === 'a')?.configuration).toEqual({ userId: 'u-1' });
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

describe('branches', () => {
  const withBranch = (): CanvasNode[] => [
    node({ id: 't', type: 'TRIGGER', subtype: 'TASK_CREATED', parentId: null, order: 0 }),
    node({ id: 'b', type: 'BRANCH', subtype: 'FIELD_COMPARISON', parentId: 't', order: 1 }),
  ];

  it('offers a placeholder on each arm, filled or not', () => {
    // A split showing only the path somebody built looks like it goes one way.
    const drawn = withPlaceholder(withBranch());
    const arms = drawn.filter((n) => n.type === 'PLACEHOLDER').map((n) => n.branchKey);

    expect(arms).toEqual(['match', 'else']);
  });

  it('stops offering an arm once something is on it', () => {
    const filled = [
      ...withBranch(),
      node({ id: 'a', parentId: 'b', branchKey: 'match', order: 2 }),
    ];
    const arms = withPlaceholder(filled)
      .filter((n) => n.type === 'PLACEHOLDER')
      .map((n) => n.branchKey);

    expect(arms).toEqual(['else']);
  });

  it('does not put a trailing placeholder after a split', () => {
    // The arms are where steps go. One hanging off the branch itself would be a
    // third path the runner has no arm for.
    const trailing = withPlaceholder(withBranch()).filter(
      (n) => n.type === 'PLACEHOLDER' && n.branchKey === null,
    );

    expect(trailing).toEqual([]);
  });

  it('carries where it goes in its id', () => {
    const placeholder = withPlaceholder(withBranch()).find((n) => n.branchKey === 'else');
    const target = readPlaceholderId(placeholder?.id ?? '');

    expect(target).toEqual({ parentId: 'b', arm: 'else' });
  });

  it('reads a main-path placeholder as having no arm', () => {
    expect(readPlaceholderId('placeholder:t:main')).toEqual({ parentId: 't', arm: null });
    expect(readPlaceholderId('not-a-placeholder')).toBeNull();
  });

  it('puts an action on the arm it was chosen from', () => {
    const created = makeNodeUnder('ACTION', 'ASSIGN_USER', 'b', 'else', withBranch());

    expect(created.parentId).toBe('b');
    expect(created.branchKey).toBe('else');
  });

  it('separates the arms vertically so they do not overlap', () => {
    const match = makeNodeUnder('ACTION', 'ASSIGN_USER', 'b', 'match', withBranch());
    const other = makeNodeUnder('ACTION', 'ASSIGN_USER', 'b', 'else', withBranch());

    expect(other.position.y).toBeGreaterThan(match.position.y);
  });

  it('creates a split carrying its own comparison', () => {
    // The runner evaluates the branch node itself; a separate condition beside
    // it would be two nodes describing one decision.
    const branch = makeBranch(withBranch().slice(0, 1));

    expect(branch.type).toBe('BRANCH');
    expect(branch.subtype).toBe('FIELD_COMPARISON');
  });
});
