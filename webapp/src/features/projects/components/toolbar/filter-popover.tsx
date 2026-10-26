import { MAX_FILTERS_PER_VIEW, OPERATORS_BY_KIND, type FilterOperator } from '@coretask/contracts';
import type { ProjectFieldMetadata, ViewFilterCondition, ViewSettings } from '@coretask/types';
import { ListFilter, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

import {
  QUICK_FILTERS,
  QUICK_FILTER_LABEL,
  isQuickFilterActive,
  toggleQuickFilter,
} from '../../lib/quick-filters';
import { filterableFields } from '../../lib/view-fields';

import { FilterRow } from './filter-row';

/**
 * Asana's Filter menu: the quick chips, then one row per condition.
 *
 * Every change goes straight to `onChange` and the rows refetch; there is no
 * Apply button, because a filter you have to confirm is a filter you cannot
 * try. The button shows how many conditions hold, so a narrowed list never
 * looks like a short project.
 */
export function FilterPopover({
  settings,
  metadata,
  meId,
  onChange,
}: {
  settings: ViewSettings;
  metadata: ProjectFieldMetadata | undefined;
  meId: string | undefined;
  onChange: (patch: Partial<ViewSettings>) => void;
}) {
  const conditions = settings.filters.conditions;
  const active = conditions.length + (settings.showCompleted === false ? 1 : 0);
  const fields = filterableFields(metadata);

  const setConditions = (next: ViewFilterCondition[]) =>
    onChange({ filters: { ...settings.filters, conditions: next } });

  const addRow = () => {
    const first = fields[0];
    if (!first) return;
    setConditions([
      ...conditions,
      { field: first.ref, operator: OPERATORS_BY_KIND[first.kind][0] as FilterOperator },
    ]);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={active > 0 ? 'secondary' : 'ghost'}
          size="sm"
          aria-label={active > 0 ? `Filter, ${active} active` : 'Filter'}
        >
          <ListFilter />
          Filter
          {active > 0 && <span className="tabular-nums">{active}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[32rem] max-w-[calc(100vw-2rem)] space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Filters</p>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            disabled={active === 0}
            onClick={() =>
              onChange({ filters: { ...settings.filters, conditions: [] }, showCompleted: true })
            }
          >
            Clear all
          </Button>
        </div>

        {/* Asana's one-click chips. Each is an ordinary condition underneath,
            so the row list below shows what a chip did. */}
        <div className="flex flex-wrap gap-1.5">
          {QUICK_FILTERS.map((quick) => {
            const on = isQuickFilterActive(settings, quick, meId ?? '');
            return (
              <button
                key={quick}
                type="button"
                aria-pressed={on}
                disabled={quick === 'MINE' && !meId}
                onClick={() => onChange(toggleQuickFilter(settings, quick, meId ?? ''))}
                className={cn(
                  'cursor-pointer rounded-full border px-2.5 py-1 text-xs transition-colors',
                  on
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:bg-muted',
                )}
              >
                {QUICK_FILTER_LABEL[quick]}
              </button>
            );
          })}
        </div>

        <div className="space-y-2">
          {conditions.map((condition, index) => (
            <FilterRow
              // Index-keyed on purpose: a row keeps its controls while its
              // field changes, and there is no stable id on a condition.
              key={index}
              condition={condition}
              metadata={metadata}
              meId={meId}
              onChange={(next) =>
                setConditions(conditions.map((entry, at) => (at === index ? next : entry)))
              }
              onRemove={() => setConditions(conditions.filter((_, at) => at !== index))}
            />
          ))}
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          disabled={conditions.length >= MAX_FILTERS_PER_VIEW || fields.length === 0}
          onClick={addRow}
        >
          <Plus className="size-3.5" aria-hidden="true" />
          Add filter
        </Button>
      </PopoverContent>
    </Popover>
  );
}
