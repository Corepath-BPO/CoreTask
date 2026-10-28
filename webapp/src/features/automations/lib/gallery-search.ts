/**
 * Words every rule shares, which would match every card and say nothing about
 * which one somebody wants.
 */
const STOP_WORDS = new Set([
  'the',
  'and',
  'but',
  'when',
  'whenever',
  'with',
  'that',
  'this',
  'for',
  'from',
  'into',
  'onto',
  'then',
  'its',
  'they',
  'them',
  'their',
  'are',
  'was',
  'will',
  'should',
  'want',
  'any',
  'all',
  'every',
  'each',
  'task',
  'tasks',
  'rule',
  'rules',
  'automate',
  'automatically',
]);

/**
 * The words that say what somebody wants, cut back to a stem so "assigned",
 * "assigns" and "assigning" all find "assign".
 */
export function queryWords(query: string): string[] {
  return [
    ...new Set(
      query
        .toLocaleLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((word) => word.length >= 3 && !STOP_WORDS.has(word))
        .map((word) => word.replace(/(ing|ed|es|s)$/, ''))
        .filter((stem) => stem.length >= 3),
    ),
  ];
}

/**
 * Ranks gallery cards against what somebody typed under "What do you want to
 * automate?".
 *
 * It is a sentence, not a keyword: "assign tasks when they move to Week 1"
 * should find "Assign whoever owns a section". So each word is matched on its
 * own, and the cards come back ranked by how many they share, best first, in
 * their own order on a tie. A card sharing none is left out. With nothing
 * typed, or only words every rule shares, everything stays, as it was.
 */
export function rankByWords<T>(
  items: readonly T[],
  query: string,
  textOf: (item: T) => string,
): T[] {
  const words = queryWords(query);
  if (words.length === 0) return [...items];

  return items
    .map((item, index) => {
      const text = textOf(item).toLocaleLowerCase();
      return { item, index, score: words.filter((word) => text.includes(word)).length };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item);
}
