import {
  AutomationTemplateReferenceKind,
  type AutomationTemplateReferenceKind as ReferenceKind,
} from '@coretask/contracts';
import type { AutomationMetadata } from '@coretask/types';

/**
 * What a rule names that belongs to its project.
 *
 * The client-side half of the question the server answers when a template is
 * saved: which sections, statuses and fields does this rule point at? Asked
 * here so the save dialog can show them — "Incoming Request, To do" — before
 * anybody decides whether the template should keep them or ask for them. The
 * keys walked are the ones the server's translation walks; the two must agree
 * or the dialog would promise to blank something the server keeps.
 *
 * People and priorities are left out on purpose. They are workspace-wide, so a
 * template carries them unchanged and there is nothing to decide about them.
 */
export interface RuleReference {
  kind: ReferenceKind;
  id: string;
  /** The project's name for it, or a plain noun when it cannot be resolved. */
  name: string;
}

interface ReferenceNode {
  type: string;
  configuration: Record<string, unknown>;
}

type NameSource = Pick<AutomationMetadata, 'sections' | 'statuses' | 'customFields'>;

/** Statuses written as the enum they were before definitions existed are not project rows. */
const LEGACY_ENUM = /^[A-Z][A-Z0-9_]*$/;

const readId = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

const readIds = (value: unknown): string[] => {
  const one = readId(value);
  if (one) return [one];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => readId(entry) !== null)
    : [];
};

const FALLBACK_NAME: Record<ReferenceKind, string> = {
  SECTION: 'a section',
  STATUS: 'a status',
  CUSTOM_FIELD: 'a field',
  OPTION: 'an option',
};

export function collectRuleReferences(
  nodes: readonly ReferenceNode[],
  triggerConfig: Record<string, unknown> | undefined,
  metadata: NameSource | undefined,
): RuleReference[] {
  const found = new Map<string, RuleReference>();

  const nameOf = (kind: ReferenceKind, id: string): string => {
    const list =
      kind === AutomationTemplateReferenceKind.SECTION
        ? metadata?.sections
        : kind === AutomationTemplateReferenceKind.STATUS
          ? metadata?.statuses
          : metadata?.customFields;

    return list?.find((entry) => entry.id === id)?.name ?? FALLBACK_NAME[kind];
  };

  const add = (kind: ReferenceKind, id: string) => {
    const key = `${kind}:${id}`;
    if (!found.has(key)) found.set(key, { kind, id, name: nameOf(kind, id) });
  };

  const configurations: { type: string; configuration: Record<string, unknown> }[] = [
    ...(triggerConfig ? [{ type: 'TRIGGER', configuration: triggerConfig }] : []),
    ...nodes,
  ];

  for (const { type, configuration: config } of configurations) {
    for (const id of readIds(config['sectionId'])) add(AutomationTemplateReferenceKind.SECTION, id);
    for (const id of readIds(config['sectionIds']))
      add(AutomationTemplateReferenceKind.SECTION, id);

    for (const key of ['status', 'statusDefinitionId']) {
      const id = readId(config[key]);
      if (id && !LEGACY_ENUM.test(id)) add(AutomationTemplateReferenceKind.STATUS, id);
    }

    for (const key of ['fieldId', 'customFieldId']) {
      const id = readId(config[key]);
      if (id) add(AutomationTemplateReferenceKind.CUSTOM_FIELD, id);
    }

    if (type === 'CONDITION') {
      const field = config['field'];
      if (typeof field === 'string' && field.startsWith('customField:')) {
        add(AutomationTemplateReferenceKind.CUSTOM_FIELD, field.slice('customField:'.length));
      } else if (field === 'sectionId') {
        for (const id of readIds(config['value'])) add(AutomationTemplateReferenceKind.SECTION, id);
      } else if (field === 'status') {
        for (const id of readIds(config['value'])) {
          if (!LEGACY_ENUM.test(id)) add(AutomationTemplateReferenceKind.STATUS, id);
        }
      }
    }
  }

  return [...found.values()];
}

/** "Incoming Request, To do and Risk" — the list as the dialog reads it out. */
export function describeReferences(references: readonly RuleReference[]): string {
  const names = references.map((reference) => reference.name);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}
