/** Filters people by name or e-mail, case-insensitively — the `@` pickers share it. */
export function matchesQuery(member: { name: string; email: string }, query: string): boolean {
  if (query === '') return true;

  const needle = query.toLowerCase();
  return member.name.toLowerCase().includes(needle) || member.email.toLowerCase().includes(needle);
}
