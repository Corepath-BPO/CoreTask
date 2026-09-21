import { SystemField } from '@coretask/contracts';
import type { ProjectFieldMetadata, ViewSettings } from '@coretask/types';
import { Rows3 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

import { fieldLabel, groupableFields } from '../../lib/view-fields';
import { FieldTypeIcon } from '../field-picker/field-type-icon';

/**
 * Asana's Group menu: section, status, priority, assignee, then the project's
 * own single-select and people fields.
 *
 * Due date is listed and disabled rather than hidden, with the reason on
 * hover: an honest placeholder beats a missing item somebody goes looking for.
 */
export function GroupPopover({
  settings,
  metadata,
  onChange,
}: {
  settings: ViewSettings;
  metadata: ProjectFieldMetadata | undefined;
  onChange: (patch: Partial<ViewSettings>) => void;
}) {
  const current = settings.groupBy ?? SystemField.SECTION;
  const fields = groupableFields(metadata);
  const system = fields.filter(
    (field) => field.origin === 'system' && field.ref !== SystemField.SECTION,
  );
  const custom = fields.filter((field) => field.origin === 'custom');
  const active = current !== SystemField.SECTION;

  const choose = (ref: string) => onChange({ groupBy: ref === SystemField.SECTION ? null : ref });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={active ? 'secondary' : 'ghost'}
          size="sm"
          aria-label={active ? `Group, by ${fieldLabel(current, metadata)}` : 'Group'}
        >
          <Rows3 />
          Group
          {active && <span className="max-w-24 truncate">{fieldLabel(current, metadata)}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-1">
        <p className="px-2 pb-1 text-sm font-medium">Group by</p>
        <GroupChoice
          value={SystemField.SECTION}
          label="Section"
          current={current}
          onChoose={choose}
        />
        {system.map((field) => (
          <GroupChoice
            key={field.ref}
            value={field.ref}
            label={field.label}
            current={current}
            onChoose={choose}
            icon={<FieldTypeIcon type={field.dataType} className="size-3.5" />}
          />
        ))}
        <GroupChoice
          value="__dueDate__"
          label="Due date"
          current={current}
          onChoose={choose}
          disabled
          title="Grouping by date is not built yet"
        />
        {custom.length > 0 && (
          <>
            <p className="px-2 pt-2 text-xs font-medium text-muted-foreground">Custom fields</p>
            {custom.map((field) => (
              <GroupChoice
                key={field.ref}
                value={field.ref}
                label={field.label}
                current={current}
                onChoose={choose}
                icon={<FieldTypeIcon type={field.dataType} className="size-3.5" />}
              />
            ))}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

function GroupChoice({
  value,
  label,
  current,
  onChoose,
  disabled = false,
  title,
  icon,
}: {
  value: string;
  label: string;
  current: string;
  onChoose: (value: string) => void;
  disabled?: boolean;
  title?: string;
  icon?: React.ReactNode;
}) {
  return (
    <label
      title={title}
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted',
        disabled && 'cursor-not-allowed opacity-50 hover:bg-transparent',
      )}
    >
      <input
        type="radio"
        name="group-by"
        checked={current === value}
        disabled={disabled}
        onChange={() => onChoose(value)}
        className="size-4 accent-primary"
      />
      {icon}
      {label}
    </label>
  );
}
