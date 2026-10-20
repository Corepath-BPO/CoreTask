import { AI_CHECK_FIELD } from './automation-ai.js';
import { ConditionMatch, isFallbackBranch } from './automation-graph.js';

/**
 * A "Check if" that asks more than one thing: a group.
 *
 * A condition step's configuration is either one comparison —
 * `{ field, operator, value }` — or a group of them:
 *
 * ```
 * { match: 'ALL' | 'ANY', conditions: [comparison | group, …] }
 * ```
 *
 * `ALL` holds when every entry holds and `ANY` when at least one does; an entry
 * may itself be a group, which is how `A and (B or C)` is written. The mode
 * belongs to the group rather than sitting between its entries: "A and B or C"
 * read left to right means something different to every reader, and dragging
 * an entry would quietly change the expression. A group of one mode is one
 * answer, whatever order its entries are in. See
 * `docs/architecture/automation-condition-groups.md`.
 *
 * One step holds the whole group, so the canvas still draws one card per
 * branch and the runner still takes the first branch whose card holds.
 *
 * Defined here because four places read the same shape — the runner judging
 * it, the validator refusing a malformed one, the builder drawing and editing
 * it, and the template library translating the ids inside it — and a group
 * read four slightly different ways is how a rule publishes clean and then
 * checks something else.
 */

/** How deep groups may nest: a group, a group inside it, and one inside that. */
export const MAX_CONDITION_GROUP_DEPTH = 3;

/** How many comparisons one step may make, across all of its groups. */
export const MAX_GROUP_CONDITIONS = 20;

export interface ConditionGroupConfig {
  match: ConditionMatch;
  conditions: Record<string, unknown>[];
}

/** One comparison inside a step, with the path the validator names it by. */
export interface ConditionLeaf {
  configuration: Record<string, unknown>;
  /** `''` for a step that is one comparison; `conditions.1.conditions.0` inside groups. */
  path: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Whether a configuration is a group rather than one comparison. */
export function isConditionGroup(configuration: unknown): configuration is ConditionGroupConfig {
  return Array.isArray(asRecord(configuration)['conditions']);
}

/** A group's mode, `ALL` unless it says `ANY` — the meaning a rule had before groups. */
export function groupMatch(configuration: unknown): ConditionMatch {
  return asRecord(configuration)['match'] === ConditionMatch.ANY
    ? ConditionMatch.ANY
    : ConditionMatch.ALL;
}

/** A path inside a configuration, joined the way validation issues name one. */
export function joinConditionPath(base: string, key: string): string {
  return base === '' ? key : `${base}.${key}`;
}

/**
 * Every comparison a condition step makes, however deeply grouped.
 *
 * The fallback row makes none. A step that is a single comparison is a list of
 * one, so a reader that loops over this needs no second branch for the
 * ungrouped shape every rule from before groups has.
 */
export function conditionLeaves(configuration: unknown, path = '', depth = 0): ConditionLeaf[] {
  const config = asRecord(configuration);
  if (isFallbackBranch(config)) return [];
  if (!isConditionGroup(config)) return [{ configuration: config, path }];
  // Past any depth the validator allows: a stored shape that deep is not
  // walked further, so it cannot hang whatever is reading it.
  if (depth > MAX_CONDITION_GROUP_DEPTH) return [];

  return config.conditions.flatMap((entry, index) =>
    conditionLeaves(entry, joinConditionPath(path, `conditions.${index}`), depth + 1),
  );
}

/**
 * The same group with every comparison replaced — how a template moves a
 * group's section and field ids into another project.
 */
export function mapConditionLeaves(
  configuration: Record<string, unknown>,
  map: (leaf: Record<string, unknown>) => Record<string, unknown>,
  depth = 0,
): Record<string, unknown> {
  if (isFallbackBranch(configuration)) return configuration;
  if (!isConditionGroup(configuration)) return map(configuration);
  if (depth > MAX_CONDITION_GROUP_DEPTH) return configuration;

  return {
    ...configuration,
    conditions: configuration.conditions.map((entry) =>
      mapConditionLeaves(asRecord(entry), map, depth + 1),
    ),
  };
}

/** How many levels of group a configuration has — 0 for one comparison. */
export function conditionGroupDepth(configuration: unknown, depth = 0): number {
  if (!isConditionGroup(configuration) || depth > MAX_CONDITION_GROUP_DEPTH + 1) return 0;

  return (
    1 +
    Math.max(0, ...configuration.conditions.map((entry) => conditionGroupDepth(entry, depth + 1)))
  );
}

/**
 * Whether a condition step holds, given how to judge one comparison.
 *
 * `ALL` is every entry and `ANY` is at least one, each entry judged the same
 * way — a nested group by recursion. An empty group holds nothing: a question
 * with no parts has no answer, and a condition nobody can evaluate blocks the
 * rule rather than waving it through, as an unknown operator does. The
 * validator refuses one before it is ever published.
 */
export function evaluateCondition(
  configuration: unknown,
  holds: (comparison: Record<string, unknown>) => boolean,
  depth = 0,
): boolean {
  const config = asRecord(configuration);
  if (isFallbackBranch(config)) return true;
  if (!isConditionGroup(config)) return holds(config);
  if (depth > MAX_CONDITION_GROUP_DEPTH || config.conditions.length === 0) return false;

  const judge = (entry: unknown) => evaluateCondition(entry, holds, depth + 1);
  return groupMatch(config) === ConditionMatch.ANY
    ? config.conditions.some(judge)
    : config.conditions.every(judge);
}

/**
 * What is wrong with a group's shape, as opposed to with one comparison in it.
 *
 * An empty group, groups nested past the limit, too many comparisons in one
 * step, and an AI check inside a group — which asks a model rather than
 * comparing a value, and is a step of its own so that its answer and reason
 * are logged as the step's.
 */
export function conditionGroupProblems(
  configuration: unknown,
): { path: string; message: string }[] {
  if (!isConditionGroup(configuration)) return [];

  const problems: { path: string; message: string }[] = [];

  const walk = (group: unknown, path: string, depth: number) => {
    if (!isConditionGroup(group)) return;

    if (depth > MAX_CONDITION_GROUP_DEPTH) {
      problems.push({
        path,
        message: `Groups go ${MAX_CONDITION_GROUP_DEPTH} deep at most. Move this one up a level.`,
      });
      return;
    }

    if (group.conditions.length === 0) {
      problems.push({ path, message: 'Add a condition to this group, or remove it.' });
    }

    group.conditions.forEach((entry, index) => {
      const at = joinConditionPath(path, `conditions.${index}`);
      if (isConditionGroup(entry)) {
        walk(entry, at, depth + 1);
        return;
      }
      if (asRecord(entry)['field'] === AI_CHECK_FIELD) {
        problems.push({
          path: at,
          message: 'A check with AI cannot be part of a group. Give it a branch of its own.',
        });
      }
    });
  };

  walk(configuration, '', 1);

  if (conditionLeaves(configuration).length > MAX_GROUP_CONDITIONS) {
    problems.push({
      path: '',
      message: `One step checks ${MAX_GROUP_CONDITIONS} things at most. Split it into branches.`,
    });
  }

  return problems;
}
