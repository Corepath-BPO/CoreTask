import {
  FORMULA_OPERAND_TYPES,
  expressionToLabels,
  labelsToExpression,
  type FormulaError,
} from '@coretask/contracts';
import type { CustomField } from '@coretask/types';

/** What the formula editor needs to know about a field it may name. */
export type FormulaCandidate = Pick<CustomField, 'id' | 'name' | 'type' | 'settings'>;

/**
 * The fields a formula on this project may read: numbers, ratings, dates and
 * other formulas — never the one being written, which would name itself.
 */
export function formulaCandidates(
  fields: readonly FormulaCandidate[],
  selfId?: string,
): FormulaCandidate[] {
  return fields.filter(
    (field) =>
      field.id !== selfId && (FORMULA_OPERAND_TYPES as readonly string[]).includes(field.type),
  );
}

/**
 * `{field:<uuid>}` → `{Effort}`, for the editor.
 *
 * A reference to a field that is no longer on the project stays as its raw
 * token rather than vanishing: the person editing needs to see that something
 * is wrong, and where.
 */
export function expressionToLabelText(
  expression: string,
  fields: readonly FormulaCandidate[],
): string {
  const names = new Map(fields.map((field) => [field.id.toLowerCase(), field.name]));
  return expressionToLabels(expression, (id) => names.get(id));
}

/**
 * `{Effort}` → `{field:<uuid>}`, for saving.
 *
 * Two fields with one name cannot be told apart by name, so the conversion
 * refuses rather than guesses; the message says which name to change.
 */
export function labelTextToExpression(
  text: string,
  fields: readonly FormulaCandidate[],
): { ok: true; expression: string } | { ok: false; error: FormulaError } {
  const byLabel = new Map<string, string | 'AMBIGUOUS'>();
  for (const field of fields) {
    const key = field.name.trim().toLowerCase();
    byLabel.set(key, byLabel.has(key) ? 'AMBIGUOUS' : field.id);
  }
  return labelsToExpression(text, (label) => byLabel.get(label.toLowerCase()));
}
