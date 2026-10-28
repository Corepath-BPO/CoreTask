import type { AI_FIELD_TYPES } from '@coretask/contracts';

import type { AiTool } from '../../integrations/ai/ai-client';

/*
 * The tools both AI halves of the builder offer a model: the steps that run
 * in a rule (`AutomationAiService`) and the drafting of a rule from a sentence
 * (`AutomationDraftService`). One spelling of "choose one of these ids", so the
 * model is asked the same way wherever it is asked.
 */

export interface Option {
  id: string;
  name: string;
}

export interface AiField {
  id: string;
  name: string;
  type: (typeof AI_FIELD_TYPES)[number];
  options: Option[];
}

const FIELD_TEXT_MAX = 1_000;

/** A tool whose one argument is an id from `options`, named in its description. */
export function choiceTool(
  name: string,
  description: string,
  argument: string,
  options: Option[],
): AiTool {
  return {
    name,
    description: `${description} The choices, as id: name —\n${options
      .map((option) => `${option.id}: ${option.name}`)
      .join('\n')}`,
    inputSchema: objectOf({
      [argument]: { type: 'string', enum: options.map((option) => option.id) },
    }),
  };
}

/** The tool for one custom field, and how to read its value back. */
export function fieldTool(
  field: AiField,
  index: number,
): {
  tool: AiTool;
  read: (input: Record<string, unknown>) => { stored: unknown; shown: string } | undefined;
} {
  const name = `set_field_${index}`;
  const about = `Set the “${field.name}” field.`;

  switch (field.type) {
    case 'SINGLE_SELECT':
      return {
        tool: choiceTool(name, about, 'option_id', field.options),
        read: (input) => {
          const option = pick(field.options, input['option_id']);
          return option ? { stored: option.id, shown: option.name } : undefined;
        },
      };
    case 'MULTI_SELECT':
      return {
        tool: {
          name,
          description: `${about} Choose one or more, as id: name —\n${field.options
            .map((option) => `${option.id}: ${option.name}`)
            .join('\n')}`,
          inputSchema: objectOf({
            option_ids: {
              type: 'array',
              minItems: 1,
              items: { type: 'string', enum: field.options.map((option) => option.id) },
            },
          }),
        },
        read: (input) => {
          const chosen = Array.isArray(input['option_ids'])
            ? field.options.filter((option) =>
                (input['option_ids'] as unknown[]).includes(option.id),
              )
            : [];
          return chosen.length > 0
            ? {
                stored: chosen.map((option) => option.id),
                shown: chosen.map((option) => option.name).join(', '),
              }
            : undefined;
        },
      };
    case 'NUMBER':
      return {
        tool: { name, description: about, inputSchema: objectOf({ number: { type: 'number' } }) },
        read: (input) => {
          const value = input['number'];
          return typeof value === 'number' && Number.isFinite(value)
            ? { stored: value, shown: String(value) }
            : undefined;
        },
      };
    case 'CHECKBOX':
      return {
        tool: {
          name,
          description: `${about} true ticks it, false clears it.`,
          inputSchema: objectOf({ checked: { type: 'boolean' } }),
        },
        read: (input) =>
          typeof input['checked'] === 'boolean'
            ? { stored: input['checked'], shown: input['checked'] ? 'ticked' : 'clear' }
            : undefined,
      };
    case 'TEXT':
      return {
        tool: {
          name,
          description: about,
          inputSchema: objectOf({ text: { type: 'string', maxLength: FIELD_TEXT_MAX } }),
        },
        read: (input) => {
          const value = text(input['text'], FIELD_TEXT_MAX);
          return value ? { stored: value, shown: `“${clip(value, 40)}”` } : undefined;
        },
      };
  }
}

export function objectOf(properties: Record<string, unknown>): Record<string, unknown> {
  return { type: 'object', properties, required: Object.keys(properties) };
}

export function pick<T extends { id: string }>(options: T[], id: unknown): T | undefined {
  return typeof id === 'string' ? options.find((option) => option.id === id) : undefined;
}

/** A trimmed, non-empty string no longer than `max`, or null. */
export function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed.slice(0, max);
}

export function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
