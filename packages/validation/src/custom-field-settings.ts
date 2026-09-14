import {
  CustomFieldType,
  FORMULA_MAX_LENGTH,
  RATING_DEFAULT_STARS,
  RATING_MAX_STARS,
  RATING_MIN_STARS,
  UNIT_LABEL_MAX_LENGTH,
  parseFormula,
} from '@coretask/contracts';
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
 * `CURRENCY` carries an ISO code and is rendered by the client through
 * `Intl.NumberFormat`, so "1.5" reads as "€1.50" without the server knowing
 * a symbol; `CUSTOM_UNIT` is a label beside the number — "5 pts", "3 hrs".
 */
export const numberFormatSchema = z.enum(['PLAIN', 'PERCENTAGE', 'CURRENCY', 'CUSTOM_UNIT']);

export const unitPositionSchema = z.enum(['PREFIX', 'SUFFIX']);

/**
 * The display half, shared by NUMBER and FORMULA.
 *
 * The extra keys have no defaults on purpose: a document written before they
 * existed must read back byte-identical, and a PLAIN number has no currency.
 */
const numberDisplayShape = {
  numberFormat: numberFormatSchema.default('PLAIN'),
  decimalPlaces: z.number().int().min(0).max(6).default(0),
  currencyCode: z
    .string()
    .regex(/^[A-Z]{3}$/, 'Use a three-letter ISO currency code, such as USD.')
    .optional(),
  unitLabel: z.string().trim().min(1).max(UNIT_LABEL_MAX_LENGTH).optional(),
  unitPosition: unitPositionSchema.optional(),
};

interface NumberDisplay {
  numberFormat?: string;
  currencyCode?: string;
  unitLabel?: string;
}

function withDisplayRefinements<T extends z.ZodTypeAny>(schema: T) {
  return schema
    .refine(
      (settings: unknown) => {
        const display = settings as NumberDisplay;
        return display.numberFormat !== 'CURRENCY' || Boolean(display.currencyCode);
      },
      { message: 'A currency format needs a currency code.', path: ['currencyCode'] },
    )
    .refine(
      (settings: unknown) => {
        const display = settings as NumberDisplay;
        return display.numberFormat !== 'CUSTOM_UNIT' || Boolean(display.unitLabel);
      },
      { message: 'A custom unit needs a label.', path: ['unitLabel'] },
    );
}

const textSettingsSchema = z.object({
  textMode: textModeSchema.default('SHORT'),
  placeholder: z.string().max(80).optional(),
  maxLength: z.number().int().min(1).max(10_000).optional(),
});

const numberSettingsSchema = withDisplayRefinements(
  z
    .object({
      ...numberDisplayShape,
      minValue: z.number().optional(),
      maxValue: z.number().optional(),
    })
    .refine(
      (settings) =>
        settings.minValue === undefined ||
        settings.maxValue === undefined ||
        settings.minValue <= settings.maxValue,
      { message: 'The minimum must not be greater than the maximum.', path: ['minValue'] },
    ),
);

const dateSettingsSchema = z.object({
  dateMode: dateModeSchema.default('DATE_ONLY'),
});

const peopleSettingsSchema = z.object({
  peopleMode: peopleModeSchema.default('SINGLE'),
});

/*
 * No default value. Nothing ever applied one on create, Asana's fields have no
 * defaults either, and `parseFieldSettings` drops unknown keys — so a document
 * that still carries `defaultValue` reads back without it and nobody notices.
 */
const checkboxSettingsSchema = z.object({
  checkedLabel: z.string().max(40).optional(),
  uncheckedLabel: z.string().max(40).optional(),
});

const selectSettingsSchema = z.object({
  /** Multi-select only. Absent means no limit. */
  maxSelections: z.number().int().min(1).max(50).optional(),
});

const linkSettingsSchema = z.object({
  placeholder: z.string().max(80).optional(),
});

const ratingSettingsSchema = z.object({
  maxRating: z
    .number()
    .int()
    .min(RATING_MIN_STARS)
    .max(RATING_MAX_STARS)
    .default(RATING_DEFAULT_STARS),
});

/**
 * Syntax only, here. Whether the fields a formula names exist on the project
 * is the service's question, because only it holds the project.
 */
const formulaSettingsSchema = withDisplayRefinements(
  z.object({
    ...numberDisplayShape,
    expression: z
      .string()
      .trim()
      .min(1, 'Write a formula.')
      .max(FORMULA_MAX_LENGTH)
      .superRefine((expression, context) => {
        const parsed = parseFormula(expression);
        if (!parsed.ok) {
          context.addIssue({ code: z.ZodIssueCode.custom, message: parsed.error.message });
        }
      }),
  }),
);

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
  [CustomFieldType.RATING]: ratingSettingsSchema,
  [CustomFieldType.FORMULA]: formulaSettingsSchema,
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
): { success: true; data: CustomFieldSettings[T] } | { success: false; error: z.ZodError } {
  const schema = SETTINGS_BY_TYPE[type] as z.ZodTypeAny;
  const result = schema.safeParse(settings ?? {});

  return result.success
    ? { success: true, data: result.data as CustomFieldSettings[T] }
    : { success: false, error: result.error };
}

/** The defaults a newly created field of this type starts with. */
export function defaultFieldSettings<T extends CustomFieldType>(type: T): CustomFieldSettings[T] {
  // A formula has no default expression; its blank document is what the
  // editor starts from, and the API refuses to save it until one is written.
  return parseFieldSettings(type, type === CustomFieldType.FORMULA ? { expression: '0' } : {});
}
