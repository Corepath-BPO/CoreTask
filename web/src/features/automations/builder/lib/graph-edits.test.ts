import { describe, expect, it } from 'vitest';

import {
  applyEdits,
  branchRows,
  copyBranchRow,
  fallbackRow,
  FALLBACK_CONFIGURATION,
  hasEdits,
  lastOnMainPath,
  makeBranchRow,
  makeNode,
  makeNodeUnder,
  NO_EDITS,
  readPlaceholderId,
  withDescendants,
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
});

describe('branch rows', () => {
  /** A rule with one row, and an action answering it. */
  const oneRow = (): CanvasNode[] => [
    node({ id: 't', type: 'TRIGGER', subtype: 'TASK_CREATED', parentId: null, order: 0 }),
    node({
      id: 'r1',
      type: 'CONDITION',
      subtype: 'FIELD_COMPARISON',
      parentId: 't',
      order: 1,
      configuration: { field: 'priority', operator: 'EQUALS', value: 'HIGH' },
    }),
    node({ id: 'a1', parentId: 'r1', order: 2 }),
  ];

  it('is a condition hanging straight off the trigger, not an arm of a split', () => {
    const rows = branchRows(oneRow());

    expect(rows.map((row) => row.id)).toEqual(['r1']);
  });

  it('adds another row as a sibling of the first', () => {
    // Nested inside the first row's "otherwise", this used to become a split
    // with two arms — a card nobody asked for and two placeholder paths.
    const created = makeBranchRow(oneRow(), 't');

    expect(created.type).toBe('CONDITION');
    expect(created.parentId).toBe('t');
    expect(created.branchKey).toBeNull();
    expect(created.configuration).toEqual({});
  });

  it('marks the fallback rather than giving it a comparison', () => {
    const created = makeBranchRow(oneRow(), 't', FALLBACK_CONFIGURATION);

    expect(created.type).toBe('CONDITION');
    expect(fallbackRow([...oneRow(), created])?.id).toBe(created.id);
  });

  it('keeps a new question in front of the fallback', () => {
    /*
     * "Otherwise" runs when nothing else did, so anything ordered after it
     * could never run — and appending is what a counter of nodes does by
     * default.
     */
    const fallback = makeBranchRow(oneRow(), 't', FALLBACK_CONFIGURATION);
    const withFallback = [...oneRow(), fallback];

    const created = makeBranchRow(withFallback, 't');
    const rows = branchRows([...withFallback, created]);

    expect(rows.map((row) => row.id)).toEqual(['r1', created.id, fallback.id]);
  });

  it('keeps a second question in front of it too', () => {
    // Two of them have to fit in the same gap, so the order cannot simply be
    // "one less than the fallback".
    const fallback = makeBranchRow(oneRow(), 't', FALLBACK_CONFIGURATION);
    let nodes = [...oneRow(), fallback];

    const first = makeBranchRow(nodes, 't');
    nodes = [...nodes, first];
    const second = makeBranchRow(nodes, 't');

    const rows = branchRows([...nodes, second]);

    expect(rows.map((row) => row.id)).toEqual(['r1', first.id, second.id, fallback.id]);
  });

  it('offers a new row somewhere to put its actions', () => {
    // A question with no "+ Do this…" beside it is half a row, and the plus
    // that would otherwise reveal it only appears on hover.
    const created = makeBranchRow(oneRow(), 't');
    const drawn = withPlaceholder([...oneRow(), created]);

    expect(drawn.filter((n) => n.type === 'PLACEHOLDER').map((n) => n.parentId)).toEqual([
      created.id,
    ]);
  });

  it('takes a row’s actions with it', () => {
    /*
     * Removing a step ordinarily closes the gap. A row is the other case: its
     * actions only make sense under its question, and re-parenting them onto
     * the trigger turns "assign when the priority is high" into "assign".
     */
    expect(withDescendants(oneRow(), 'r1').sort()).toEqual(['a1', 'r1']);
  });

  it('answers with nothing for a rule that has no fallback', () => {
    expect(fallbackRow(oneRow())).toBeNull();
  });

  describe('duplicating one', () => {
    it('copies the question and the actions under it', () => {
      const copies = copyBranchRow(oneRow(), 'r1');

      expect(copies).toHaveLength(2);
      expect(copies[0]!.type).toBe('CONDITION');
      expect(copies[0]!.configuration).toEqual({
        field: 'priority',
        operator: 'EQUALS',
        value: 'HIGH',
      });
      expect(copies[1]!.type).toBe('ACTION');
    });

    it('leaves the original with its actions', () => {
      /*
       * Duplicating an ordinary step lets the copy adopt what followed the
       * original, because "do that again" means carrying on afterwards. Doing
       * that to a branch takes its actions away and leaves two questions with
       * one answer between them.
       */
      const nodes = [...oneRow(), ...copyBranchRow(oneRow(), 'r1')];
      const original = nodes.filter((n) => n.parentId === 'r1');

      expect(original.map((n) => n.id)).toEqual(['a1']);
    });

    it('gives every copied node an id of its own', () => {
      const copies = copyBranchRow(oneRow(), 'r1');
      const ids = copies.map((copy) => copy.id);

      expect(new Set(ids).size).toBe(2);
      for (const id of ids) expect(id).toMatch(/^new-/);
    });

    it('is a branch of its own, not a step inside the one it came from', () => {
      /*
       * A copy parented to the source condition would draw one column to the
       * right on the same line — a second check on that path rather than an
       * alternative to it. The runner would read it that way too, so both the
       * drawing and the behaviour would be wrong in the same direction.
       */
      const [copy, action] = copyBranchRow(oneRow(), 'r1');

      expect(copy!.parentId).toBe('t');
      expect(copy!.branchKey).toBeNull();
      expect(action!.parentId).toBe(copy!.id);
    });

    it('sits directly below the branch it came from', () => {
      const withFallback = [...oneRow(), makeBranchRow(oneRow(), 't', FALLBACK_CONFIGURATION)];
      const copies = copyBranchRow(withFallback, 'r1');
      const rows = branchRows([...withFallback, ...copies]);

      // And in front of the fallback, which has to stay last or nothing after
      // it could ever run.
      expect(rows.map((row) => row.id)).toEqual(['r1', copies[0]!.id, rows[2]!.id]);
      expect(rows[2]!.configuration).toEqual(FALLBACK_CONFIGURATION);
    });
  });
});
