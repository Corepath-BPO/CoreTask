import { CustomFieldType } from '@coretask/contracts';
import { z } from 'zod';

/**
 * Type-specific configuration for a custom field.
 *
 * `CustomField.settings` has existed as a JSON column since the field system
 * was built, but nothing read or wrote it — so a "text" field could not say
 * whether it was one line or many, and a number could not say how many decimal
 * places it kept. These schemas are what turn that column from a promise into
 * a contract.
 *
 * Parsed on write and on read. A document that predates a setting simply lacks
 * the key and picks up the default, which is why every field here is optional
 * with a default rather than required: the alternative is a migration every
 * time a type learns a new option.
 */

/** Short text is one line in a cell; long text needs somewhere to expand. */
export const textModeSchema = z.enum(['SHORT', 'LONG']);

/** Whether a date carries a time, which decides the editor and the format. */
export const dateModeSchema = z.enum(['DATE_ONLY', 'DATE_TIME']);

/** One person or several — the difference between a picker and a list. */
export const peopleModeSchema = z.enum(['SINGLE', 'MULTIPLE']);

/**
 * How a number is written down.
 *
 * `CURRENCY` is deliberately absent: it needs a currency code, a rounding rule
 * and a display position, and a format that renders "1.5" as "$1.50" without
 * storing which currency that is would be worse than not offering it.
 */
export const numberFormatSchema = z.enum(['PLAIN', 'PERCENTAGE']);

const textSettingsSchema = z.object({
  textMode: textModeSchema.default('SHORT'),
  placeholder: z.string().max(80).optional(),
  maxLength: z.number().int().min(1).max(10_000).optional(),
});

const numberSettingsSchema = z
  .object({
    numberFormat: numberFormatSchema.default('PLAIN'),
    decimalPlaces: z.number().int().min(0).max(6).default(0),
    minValue: z.number().optional(),
    maxValue: z.number().optional(),
  })
  .refine(
    (settings) =>
      settings.minValue === undefined ||
      settings.maxValue === undefined ||
      settings.minValue <= settings.maxValue,
    { message: 'The minimum must not be greater than the maximum.', path: ['minValue'] },
  );

const dateSettingsSchema = z.object({
  dateMode: dateModeSchema.default('DATE_ONLY'),
});

const peopleSettingsSchema = z.object({
  peopleMode: peopleModeSchema.default('SINGLE'),
});

const checkboxSettingsSchema = z.object({
  checkedLabel: z.string().max(40).optional(),
  uncheckedLabel: z.string().max(40).optional(),
  defaultValue: z.boolean().default(false),
});

const selectSettingsSchema = z.object({
  /** Multi-select only. Absent means no limit. */
  maxSelections: z.number().int().min(1).max(50).optional(),
});

const linkSettingsSchema = z.object({
  placeholder: z.string().max(80).optional(),
});

const emptySettingsSchema = z.object({});

/**
 * The schema that applies to one field type.
 *
 * A lookup rather than a discriminated union: the type is already known from
 * the field row, and a union would make every caller re-state it inside the
 * settings document where it could drift out of step with the column.
 */
const SETTINGS_BY_TYPE = {
  [CustomFieldType.TEXT]: textSettingsSchema,
  [CustomFieldType.NUMBER]: numberSettingsSchema,
  [CustomFieldType.DATE]: dateSettingsSchema,
  [CustomFieldType.PEOPLE]: peopleSettingsSchema,
  [CustomFieldType.CHECKBOX]: checkboxSettingsSchema,
  [CustomFieldType.SINGLE_SELECT]: emptySettingsSchema,
  [CustomFieldType.MULTI_SELECT]: selectSettingsSchema,
  [CustomFieldType.URL]: linkSettingsSchema,
  [CustomFieldType.EMAIL]: linkSettingsSchema,
} as const satisfies Record<CustomFieldType, z.ZodTypeAny>;

export type CustomFieldSettings = {
  [K in CustomFieldType]: z.infer<(typeof SETTINGS_BY_TYPE)[K]>;
};

/**
 * Validates a settings document against the type it belongs to.
 *
 * Unknown keys are dropped rather than rejected: a client one version ahead
 * should not have its whole field creation refused over a setting this server
 * does not understand yet.
 */
export function parseFieldSettings<T extends CustomFieldType>(
  type: T,
  settings: unknown,
): CustomFieldSettings[T] {
  const schema = SETTINGS_BY_TYPE[type] as z.ZodTypeAny;
  return schema.parse(settings ?? {}) as CustomFieldSettings[T];
}

/** Like `parseFieldSettings`, but reports why rather than throwing. */
export function safeParseFieldSettings<T extends CustomFieldType>(
  type: T,
  settings: unknown,
):
  | { success: true; data: CustomFieldSettings[T] }
  | { success: false; error: z.ZodError } {
  const schema = SETTINGS_BY_TYPE[type] as z.ZodTypeAny;
  const result = schema.safeParse(settings ?? {});

  return result.success
    ? { success: true, data: result.data as CustomFieldSettings[T] }
    : { success: false, error: result.error };
}

/** The defaults a newly created field of this type starts with. */
export function defaultFieldSettings<T extends CustomFieldType>(type: T): CustomFieldSettings[T] {
  return parseFieldSettings(type, {});
}
