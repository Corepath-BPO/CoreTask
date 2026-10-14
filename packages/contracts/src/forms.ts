/**
 * Intake forms — Asana's Forms.
 *
 * A form always asks for the request's title and, optionally, details; its
 * own questions come after. Each submission is a task in the project, with the
 * answers written into its description, so nothing a submitter said is lost.
 */

export const FormQuestionKind = {
  SHORT_TEXT: 'SHORT_TEXT',
  LONG_TEXT: 'LONG_TEXT',
  EMAIL: 'EMAIL',
  SINGLE_SELECT: 'SINGLE_SELECT',
  MULTI_SELECT: 'MULTI_SELECT',
  DATE: 'DATE',
  NUMBER: 'NUMBER',
} as const;
export type FormQuestionKind = (typeof FormQuestionKind)[keyof typeof FormQuestionKind];
export const FORM_QUESTION_KINDS = Object.values(FormQuestionKind);

export const FORM_QUESTION_KIND_LABEL: Record<FormQuestionKind, string> = {
  SHORT_TEXT: 'Short answer',
  LONG_TEXT: 'Paragraph',
  EMAIL: 'Email address',
  SINGLE_SELECT: 'Single choice',
  MULTI_SELECT: 'Multiple choice',
  DATE: 'Date',
  NUMBER: 'Number',
};

/** The kinds answered by choosing from the question's own options. */
export const FORM_CHOICE_KINDS: readonly FormQuestionKind[] = [
  FormQuestionKind.SINGLE_SELECT,
  FormQuestionKind.MULTI_SELECT,
];

export const MAX_FORM_OPTIONS = 20;
export const FORM_OPTION_MAX = 100;
/** A multiple-choice answer travels as one string, one chosen option per line. */
export const FORM_MULTI_SEPARATOR = '\n';

export const FORM_NAME_MAX = 120;
export const FORM_DESCRIPTION_MAX = 2_000;
export const FORM_QUESTION_LABEL_MAX = 200;
export const MAX_FORM_QUESTIONS = 20;
export const FORM_ANSWER_MAX = 5_000;
export const MAX_FORMS_PER_PROJECT = 20;

/** A loose email check: something@something.something, nothing more is promised. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

/**
 * What is wrong with an answer to a question, or null when nothing is. An
 * empty answer is not judged here; whether one is allowed is `required`'s job.
 */
export function formAnswerProblem(
  question: { label: string; kind: FormQuestionKind; options?: readonly string[] },
  answer: string,
): string | null {
  const value = answer.trim();
  if (!value) return null;
  const options = question.options ?? [];
  switch (question.kind) {
    case FormQuestionKind.EMAIL:
      return looksLikeEmail(value) ? null : `“${question.label}” needs an email address.`;
    case FormQuestionKind.SINGLE_SELECT:
      return options.includes(value) ? null : `Choose one of the options for “${question.label}”.`;
    case FormQuestionKind.MULTI_SELECT:
      return value.split(FORM_MULTI_SEPARATOR).every((part) => options.includes(part.trim()))
        ? null
        : `Choose from the options for “${question.label}”.`;
    case FormQuestionKind.DATE: {
      const valid =
        /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
      return valid ? null : `“${question.label}” needs a date.`;
    }
    case FormQuestionKind.NUMBER:
      return value !== '' && Number.isFinite(Number(value))
        ? null
        : `“${question.label}” needs a number.`;
    default:
      return null;
  }
}
