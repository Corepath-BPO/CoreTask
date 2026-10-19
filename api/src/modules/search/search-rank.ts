/**
 * How well a piece of text answers a search, higher being better.
 *
 * PostgreSQL finds the candidates (`ILIKE`, case-insensitive substring); this
 * orders them the way a person expects: the exact name, then names that start
 * with what was typed, then names with a word that does, then anything that
 * merely contains it. Without it "api" lists "Rapid prototyping" above "API
 * gateway" whenever the former was touched more recently.
 */
export function searchRank(text: string, query: string): number {
  const haystack = text.toLowerCase();
  const needle = query.trim().toLowerCase();
  if (!needle) return 0;

  if (haystack === needle) return 4;
  if (haystack.startsWith(needle)) return 3;
  if (haystack.split(/[\s\-_/.:,()[\]]+/).some((word) => word.startsWith(needle))) return 2;
  if (haystack.includes(needle)) return 1;
  return 0;
}

/**
 * Best-first, keeping the database's order (most recently updated) for ties,
 * then trimmed to the limit.
 */
export function rankHits<T>(
  hits: readonly T[],
  query: string,
  textOf: (hit: T) => string[],
  limit: number,
): T[] {
  return hits
    .map((hit, index) => ({
      hit,
      index,
      rank: Math.max(0, ...textOf(hit).map((text) => searchRank(text, query))),
    }))
    .sort((a, b) => b.rank - a.rank || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.hit);
}
