import { SystemField } from '@coretask/contracts';
import type { ProjectFieldMetadata } from '@coretask/types';

import type { ChoiceOption } from '@/features/automations/builder/configuration/value-controls';

import type { QueryableField } from './view-fields';

/** The choices an enum or people field offers, from the project's own lists. */
export function choicesFor(
  field: QueryableField,
  metadata: ProjectFieldMetadata | undefined,
  meId: string | undefined,
): ChoiceOption[] {
  if (field.kind === 'PEOPLE') {
    const members = (metadata?.members ?? []).map((member) => ({
      value: member.id,
      label: member.id === meId ? `${member.name} (me)` : member.name,
      avatarUrl: member.avatarUrl ?? null,
    }));
    // Me first: the person filtering is the person most often filtered for.
    return [
      ...members.filter((member) => member.value === meId),
      ...members.filter((member) => member.value !== meId),
    ];
  }

  switch (field.ref) {
    case SystemField.STATUS:
      return (metadata?.statuses ?? []).map((status) => ({
        value: status.id,
        label: status.name,
        colorToken: status.colorToken,
      }));
    case SystemField.PRIORITY:
      return (metadata?.priorities ?? []).map((priority) => ({
        value: priority.id,
        label: priority.name,
        colorToken: priority.colorToken,
      }));
    case SystemField.SECTION:
      return (metadata?.sections ?? []).map((section) => ({
        value: section.id,
        label: section.name,
      }));
    default:
      return (field.custom?.options ?? [])
        .filter((option) => !option.isArchived)
        .map((option) => ({
          value: option.id,
          label: option.label,
          colorToken: option.colorToken,
        }));
  }
}
