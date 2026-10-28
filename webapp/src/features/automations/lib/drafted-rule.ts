import type { AutomationDraft, SaveAutomationGraphNode } from '@coretask/types';

import { defaultTriggerConfiguration } from '../builder/configuration/timed-triggers';
import { makeTrigger, type CanvasNode } from '../builder/lib/graph-edits';

import { makeChainNodes, type ChainStep } from './starter-templates';

/*
 * A rule drafted from a sentence travels to the builder in the history entry's
 * state rather than the address: it is too big for a url, and a reload or
 * Back-then-Forward should reopen the same draft rather than ask the model
 * again for a different one.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNode = (value: unknown): value is SaveAutomationGraphNode =>
  isRecord(value) &&
  typeof value['type'] === 'string' &&
  typeof value['subtype'] === 'string' &&
  isRecord(value['configuration']) &&
  typeof value['order'] === 'number';

/**
 * The draft a history entry carries, or undefined.
 *
 * Checked rather than trusted: the state outlives the code that wrote it, so
 * an entry from an older build is a blank canvas rather than a broken page.
 */
export function readDraft(value: unknown): AutomationDraft | undefined {
  if (!isRecord(value) || typeof value['name'] !== 'string') return undefined;
  const nodes = value['nodes'];
  if (!Array.isArray(nodes) || !nodes.every(isNode)) return undefined;
  if (!nodes.some((node) => node.type === 'TRIGGER')) return undefined;

  return value as unknown as AutomationDraft;
}

/**
 * The canvas a drafted rule opens with: its trigger, then its steps in order,
 * each under the one before — a starter's shape, with the blanks answered.
 *
 * Keyed afresh, as a starter is: the ids the server drafted with are its own.
 * The trigger gets what one picked by hand starts with (the clock's triggers
 * take the browser's timezone), under whatever the draft set.
 */
export function makeDraftNodes(draft: AutomationDraft): CanvasNode[] {
  const ordered = [...draft.nodes].sort((a, b) => a.order - b.order);
  const trigger = ordered.find((node) => node.type === 'TRIGGER');
  const subtype = trigger?.subtype ?? '';

  const steps: ChainStep[] = ordered.flatMap((node) =>
    node.type === 'CONDITION' || node.type === 'ACTION'
      ? [{ type: node.type, subtype: node.subtype, configuration: node.configuration }]
      : [],
  );

  return makeChainNodes(
    makeTrigger(subtype, { ...defaultTriggerConfiguration(subtype), ...trigger?.configuration }),
    steps,
  );
}
