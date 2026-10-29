import { describe, expect, it } from 'vitest';

import { assignablePeople, onlyAssignable } from './assignable';

const member = (id: string) => ({ user: { id, name: id } });
const everyone = [member('owner'), member('earl'), member('hr'), member('it')];

describe('onlyAssignable', () => {
  it('keeps the project’s assignees, and whoever has the task now', () => {
    const picked = onlyAssignable(everyone, [{ id: 'owner' }, { id: 'earl' }], 'hr');
    expect(picked.map((m) => m.user.id)).toEqual(['owner', 'earl', 'hr']);
  });

  it('offers everyone for a task in no project', () => {
    expect(onlyAssignable(everyone, undefined, null)).toHaveLength(4);
  });

  it('has nobody before the members have loaded', () => {
    expect(onlyAssignable(undefined, [{ id: 'owner' }])).toEqual([]);
  });
});

describe('assignablePeople', () => {
  const ada = { id: 'ada', name: 'Ada' };
  const bob = { id: 'bob', name: 'Bob' };

  it('lists the assignees, and the current one when they are not among them', () => {
    expect(assignablePeople([ada], [ada, bob], bob)).toEqual([ada, bob]);
    expect(assignablePeople([ada], [ada, bob], ada)).toEqual([ada]);
  });

  it('falls back to everyone when the server sends no assignees', () => {
    expect(assignablePeople(undefined, [ada, bob], null)).toEqual([ada, bob]);
  });
});
