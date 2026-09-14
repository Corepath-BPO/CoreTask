import type { TaskCustomFieldValue } from '@coretask/types';
import type { Prisma } from '@prisma/client';

/**
 * A stored value row, as the API and the automation engine both present it.
 *
 * Pure, and in a file of its own, because two modules need the one answer: the
 * custom-fields service that serves a value over the wire, and the automation
 * runner that announces a value a rule wrote. The runner lives in the worker,
 * which must not import the service — that drags the request-side graph into a
 * process that deliberately does not register it — so the function both need
 * lives where neither has to reach for the other.
 */
export function toValueDto(value: {
  customFieldId: string;
  textValue: string | null;
  numberValue: Prisma.Decimal | null;
  dateValue: Date | null;
  booleanValue: boolean | null;
  optionIds: string[];
  userIds: string[];
}): TaskCustomFieldValue {
  return {
    customFieldId: value.customFieldId,
    text: value.textValue,
    // Decimal keeps precision in PostgreSQL but JSON has no such type, so it
    // crosses the wire as a number — the range is far inside what is safe.
    number: value.numberValue === null ? null : Number(value.numberValue),
    date: value.dateValue?.toISOString() ?? null,
    checkbox: value.booleanValue,
    optionIds: value.optionIds,
    userIds: value.userIds,
  };
}
