/**
 * Who a task may be given to: the project's assignees (its members and the
 * workspace's owner), and whoever holds it now, so an assignment made before
 * still reads as itself in the picker. With no project, everyone.
 */
export function onlyAssignable<T extends { user: { id: string } }>(
  members: readonly T[] | undefined,
  assignees: readonly { id: string }[] | undefined,
  currentId?: string | null,
): T[] {
  if (!members) return [];
  if (!assignees) return [...members];
  const allowed = new Set(assignees.map((person) => person.id));
  if (currentId) allowed.add(currentId);
  return members.filter((member) => allowed.has(member.user.id));
}

/** The same for a list of people as field metadata carries them. */
export function assignablePeople<T extends { id: string }>(
  assignees: readonly T[] | undefined,
  everyone: readonly T[] | undefined,
  current?: T | null,
): T[] {
  const people = [...(assignees ?? everyone ?? [])];
  if (current && !people.some((person) => person.id === current.id)) people.push(current);
  return people;
}
