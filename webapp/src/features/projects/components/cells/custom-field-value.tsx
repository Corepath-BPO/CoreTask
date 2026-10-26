import { CustomFieldType } from '@coretask/contracts';
import type { CustomField, ProjectFieldMetadata, TaskCustomFieldValue } from '@coretask/types';

import { SemanticBadge } from '@/features/colors/components/semantic-badge';
import { cn, formatDate } from '@/lib/utils';

import { checkboxLabel, formatNumber, maxRating, numberFormat, wantsTime } from './field-settings';
import { RatingCell } from './rating-cell';

/**
 * One option as a chip, greyed once it is hidden.
 *
 * An archived option still renders its label. That is the whole reason
 * options archive rather than delete — a cell showing a bare uuid tells the
 * reader nothing about what they chose — and the greying says why the picker
 * no longer offers it.
 */
export function OptionBadge({ field, optionId }: { field: CustomField; optionId: string }) {
  const option = field.options.find((entry) => entry.id === optionId);

  if (!option) return <span className="text-xs text-muted-foreground">Unknown</span>;

  return (
    <span
      className={cn('inline-flex', option.isArchived && 'opacity-50 grayscale')}
      title={option.isArchived ? `${option.label} is a hidden option` : undefined}
    >
      <SemanticBadge color={{ colorToken: option.colorToken, customColor: option.customColor }}>
        {option.label}
      </SemanticBadge>
    </span>
  );
}

/**
 * A field's value, read-only, the way the cell would draw it.
 *
 * Used wherever a value is shown without being edited: board cards, the
 * formula cell, a story in the feed. It shares the formatters with the editing
 * cell so the two can never disagree about "1.5" versus "€1.50".
 */
export function CustomFieldValue({
  field,
  value,
  metadata,
  compact = false,
}: {
  field: CustomField;
  value: TaskCustomFieldValue | undefined;
  metadata: ProjectFieldMetadata | undefined;
  /** Tighter rendering for a card chip. */
  compact?: boolean;
}) {
  const empty = <span className="text-muted-foreground">—</span>;

  switch (field.type) {
    case CustomFieldType.NUMBER:
    case CustomFieldType.FORMULA:
      return value?.number == null ? (
        empty
      ) : (
        <span className="tabular-nums">{formatNumber(value.number, numberFormat(field))}</span>
      );

    case CustomFieldType.RATING:
      return (
        <RatingCell
          value={value?.number ?? null}
          max={maxRating(field)}
          canEdit={false}
          label={field.name}
          onCommit={() => undefined}
        />
      );

    case CustomFieldType.DATE: {
      if (!value?.date) return empty;
      const withTime = wantsTime(field);
      return (
        <span>
          {formatDate(value.date)}
          {withTime && (
            <span className="ml-1 text-muted-foreground">
              {new Date(value.date).toLocaleTimeString(undefined, {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          )}
        </span>
      );
    }

    case CustomFieldType.CHECKBOX: {
      const checked = value?.checkbox ?? false;
      return <span>{checkboxLabel(field, checked) ?? (checked ? 'Yes' : 'No')}</span>;
    }

    case CustomFieldType.SINGLE_SELECT:
    case CustomFieldType.MULTI_SELECT: {
      const ids = value?.optionIds ?? [];
      if (ids.length === 0) return empty;
      return (
        <span className={cn('flex flex-wrap gap-1', compact && 'gap-0.5')}>
          {ids.map((id) => (
            <OptionBadge key={id} field={field} optionId={id} />
          ))}
        </span>
      );
    }

    case CustomFieldType.PEOPLE: {
      const ids = value?.userIds ?? [];
      const names = ids
        .map((id) => metadata?.members.find((member) => member.id === id)?.name)
        .filter(Boolean);
      return names.length > 0 ? <span>{names.join(', ')}</span> : empty;
    }

    case CustomFieldType.URL:
      return value?.text ? (
        <a
          href={value.text}
          target="_blank"
          rel="noreferrer noopener"
          onClick={(event) => event.stopPropagation()}
          className="truncate text-primary underline-offset-2 hover:underline"
        >
          {value.text}
        </a>
      ) : (
        empty
      );

    default:
      return value?.text ? <span className="truncate">{value.text}</span> : empty;
  }
}
