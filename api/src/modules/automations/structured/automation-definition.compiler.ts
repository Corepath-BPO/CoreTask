import { AutomationNodeType, FALLBACK_CONFIG_KEY } from '@coretask/contracts';
import type { AutomationBranchDefinition } from '@coretask/types';
import type { Prisma } from '@prisma/client';

import type { SnapshotNode } from '../versions/rule-snapshot';

/**
 * A structured definition, as the steps the runner executes.
 *
 * The runner reads one shape — the node tree a published version keeps — and
 * the structured definition is the other way of writing a rule, so publishing
 * one compiles it into that shape rather than teaching the runner a second.
 * The mapping is the inverse of `convertLegacyRule`, and it is direct because
 * both models mean the same thing by a branch:
 *
 * - each branch is a row: a condition hanging off the trigger, tried in
 *   position order, the first that holds winning — which is exactly how the
 *   runner reads the trigger's conditions;
 * - `OTHERWISE` is the fallback row, the condition marked as always holding;
 * - a group of conditions is one condition step holding the group, `ALL` or
 *   `ANY` as written — see `automation-condition-groups`;
 * - a branch's actions follow its condition, each under the one before.
 *
 * Returns the problems instead of compiling what it cannot say faithfully. A
 * published rule that runs something other than what was published is the
 * failure versions exist to prevent.
 */
export function compileDefinition(
  definition: {
    trigger: { type: string; configuration: Record<string, unknown> };
    branches: readonly AutomationBranchDefinition[];
  },
  newId: () => string,
): { nodes: SnapshotNode[]; problems: string[] } {
  const nodes: SnapshotNode[] = [];
  const problems: string[] = [];
  let position = 0;

  const add = (
    nodeType: SnapshotNode['nodeType'],
    subtype: string,
    configuration: Record<string, unknown>,
    parentNodeId: string | null,
  ): string => {
    const id = newId();
    nodes.push({
      id,
      nodeType,
      subtype,
      configuration: configuration as Prisma.JsonValue,
      parentNodeId,
      branchKey: null,
      position: position++,
    });
    return id;
  };

  const trigger = add(
    AutomationNodeType.TRIGGER,
    definition.trigger.type,
    definition.trigger.configuration,
    null,
  );

  for (const branch of [...definition.branches].sort((a, b) => a.position - b.position)) {
    let tail: string;

    if (!branch.conditionGroup) {
      tail = add(
        AutomationNodeType.CONDITION,
        'FIELD_COMPARISON',
        { [FALLBACK_CONFIG_KEY]: true },
        trigger,
      );
    } else {
      const comparisons = [...branch.conditionGroup.conditions]
        .sort((a, b) => a.position - b.position)
        .map((condition) => ({
          field: condition.fieldKey,
          operator: condition.operator,
          value: condition.value,
        }));

      // One comparison is a step of its own; more are one grouped step, which
      // is what a condition group is in the node shape too.
      tail = add(
        AutomationNodeType.CONDITION,
        'FIELD_COMPARISON',
        comparisons.length === 1
          ? (comparisons[0] as Record<string, unknown>)
          : { match: branch.conditionGroup.operator, conditions: comparisons },
        trigger,
      );
    }

    for (const action of [...branch.actions].sort((a, b) => a.position - b.position)) {
      tail = add(AutomationNodeType.ACTION, action.actionType, action.configuration, tail);
    }
  }

  return { nodes, problems };
}
