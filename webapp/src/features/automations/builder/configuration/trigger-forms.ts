import {
  TRIGGER_CONFIG_FORM,
  TRIGGER_CONFIG_FORMS_BY_TRIGGER,
  TRIGGER_CONFIG_FORMS_WITHOUT_VALUE,
  TRIGGER_CONFIG_FORM_LABEL,
  type AutomationTrigger,
  type TriggerConfigForm,
} from '@coretask/contracts';
import type { AutomationMetadata } from '@coretask/types';

/**
 * How a trigger's narrowing is offered, and how it is held.
 *
 * The chosen form is a key inside the trigger's configuration rather than a
 * trigger of its own, because the runner matches an event against `triggerType`
 * with an indexed query — see `TRIGGER_CONFIG_FORM`. So a rule watching section
 * moves stays `TASK_MOVED_TO_SECTION` whichever of the four somebody picked, and
 * only what is beside it changes.
 */

/** Which of the forms was chosen. Matches the wire key the validator tests. */
const FORM_KEY = 'form';

/**
 * One section, for the forms naming exactly one.
 *
 * Deliberately the key the trigger already used. A rule written before the
 * forms existed holds `{ sectionId }` and nothing else, and that is precisely
 * "Section is…" — so the old shape reads back as the new one rather than
 * needing a migration to be legible.
 */
const SECTION_KEY = 'sectionId';

/** Several, for "is one of". A list, never a comma-joined string. */
const SECTIONS_KEY = 'sectionIds';

/** One way of narrowing a trigger, as the panel needs it. */
export interface TriggerForm {
  form: TriggerConfigForm;
  label: string;
  /** Whether choosing it reveals the field below. */
  needsValue: boolean;
  /** Whether that field accepts more than one section. */
  multiple: boolean;
  /** Whether the engine can run it yet. */
  available: boolean;
  /** Why not, when not — the endpoint's words rather than a guess at them. */
  reason?: string | null;
}

/** The shape the metadata sends, which `AutomationCatalogEntry` does not declare. */
interface SuppliedForm {
  form: string;
  label: string;
  needsValue: boolean;
  multiple: boolean;
  available: boolean;
  reason?: string | null;
}

/**
 * The forms a trigger offers, as this project describes them.
 *
 * From the metadata rather than from the contract, because the endpoint is the
 * thing that knows which of them the engine can actually run — the constant
 * lists what exists, not what works. The contract stays the fallback so the
 * field is never briefly empty while the request is in flight.
 */
export function formsForTrigger(
  subtype: string,
  metadata: AutomationMetadata | undefined,
): TriggerForm[] {
  const entry = metadata?.triggers.find((trigger) => trigger.subtype === subtype);
  const supplied = (entry as { configForms?: SuppliedForm[] } | undefined)?.configForms;

  if (supplied && supplied.length > 0) {
    return supplied.map((form) => ({
      form: form.form as TriggerConfigForm,
      label: form.label,
      needsValue: form.needsValue,
      multiple: form.multiple,
      available: form.available,
      reason: form.reason ?? null,
    }));
  }

  return (TRIGGER_CONFIG_FORMS_BY_TRIGGER[subtype as AutomationTrigger] ?? []).map((form) => ({
    form,
    label: TRIGGER_CONFIG_FORM_LABEL[form],
    needsValue: !TRIGGER_CONFIG_FORMS_WITHOUT_VALUE.includes(form),
    multiple: form === TRIGGER_CONFIG_FORM.SECTION_CHANGED_TO_ANY_OF,
    available: true,
    reason: null,
  }));
}

/**
 * Which form a trigger is currently set to, inferred when nothing says.
 *
 * Never null while the trigger has forms at all: an empty select is a question
 * somebody has to answer before the panel says anything, and "any move" is both
 * the safe default and what a trigger with no section already does.
 */
export function readTriggerForm(
  configuration: Record<string, unknown>,
  forms: TriggerForm[],
): TriggerForm | null {
  if (forms.length === 0) return null;

  const stored = configuration[FORM_KEY];
  const named = forms.find((entry) => entry.form === stored);
  if (named) return named;

  // A section with no form beside it is the shape the trigger had before the
  // forms existed, and the runner reads it as "moved into this one".
  const legacy = configuration[SECTION_KEY];
  if (typeof legacy === 'string' && legacy !== '') {
    const equality = forms.find((entry) => entry.form === TRIGGER_CONFIG_FORM.SECTION_CHANGED_TO);
    if (equality) return equality;
  }

  return forms[0] ?? null;
}

/** The sections this trigger names, whichever key they were written under. */
export function readTriggerSections(configuration: Record<string, unknown>): string[] {
  const many = configuration[SECTIONS_KEY];
  if (Array.isArray(many)) {
    return many.filter((entry): entry is string => typeof entry === 'string' && entry !== '');
  }

  const one = configuration[SECTION_KEY];
  return typeof one === 'string' && one !== '' ? [one] : [];
}

/** Switching form, carrying whatever was already chosen across where it fits. */
export function applyTriggerForm(
  configuration: Record<string, unknown>,
  form: TriggerForm,
): Record<string, unknown> {
  return writeSections(configuration, form, readTriggerSections(configuration));
}

/** Choosing sections, under the key this form stores them in. */
export function applyTriggerSections(
  configuration: Record<string, unknown>,
  form: TriggerForm,
  sections: string[],
): Record<string, unknown> {
  return writeSections(configuration, form, sections);
}

/**
 * One write, with only the key this form actually uses.
 *
 * Both keys are cleared first: leaving `sectionIds` behind after a switch to
 * "Section is…" would hand the runner two answers to one question, and the one
 * on screen is not necessarily the one it would read.
 */
function writeSections(
  configuration: Record<string, unknown>,
  form: TriggerForm,
  sections: string[],
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...configuration, [FORM_KEY]: form.form };

  delete next[SECTION_KEY];
  delete next[SECTIONS_KEY];

  if (!form.needsValue) return next;

  if (form.multiple) {
    if (sections.length > 0) next[SECTIONS_KEY] = sections;
    return next;
  }

  // The first of whatever was chosen, so moving between "is…" and "is not…"
  // does not ask somebody to name the section a second time.
  if (sections.length > 0) next[SECTION_KEY] = sections[0];

  return next;
}
