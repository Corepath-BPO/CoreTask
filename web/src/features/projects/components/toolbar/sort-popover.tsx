import { MAX_SORTS_PER_VIEW, SORT_DIRECTION_LABEL, type SortDirection } from '@coretask/contracts';
import type { ProjectFieldMetadata, ViewSettings, ViewSort } from '@coretask/types';
import { ArrowUpDown, Plus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { isManualOrder } from '../../lib/group-value';
import { sortableFields } from '../../lib/view-fields';

import { FieldPicker } from './filter-row';

/**
 * Asana's Sort menu: a field and a direction, up to five of them, or none.
 *
 * "Manual order" is what an empty list means, offered as a choice so the
 * way back to dragging rows is a click rather than five removals. The helper
 * line says why the drag handles went away while a sort holds.
 */
export function SortPopover({
  settings,
  metadata,
  onChange,
}: {
  settings: ViewSettings;
  metadata: ProjectFieldMetadata | undefined;
  onChange: (patch: Partial<ViewSettings>) => void;
}) {
  const fields = sortableFields(metadata);
  const sorts = settings.sorts;

  const setSorts = (next: ViewSort[]) => onChange({ sorts: next });

  const addSort = () => {
    const unused = fields.find((field) => !sorts.some((sort) => sort.field === field.ref));
    if (!unused) return;
    setSorts([...sorts, { field: unused.ref, direction: 'ASC' }]);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={sorts.length > 0 ? 'secondary' : 'ghost'}
          size="sm"
          aria-label={sorts.length > 0 ? `Sort, ${sorts.length} active` : 'Sort'}
        >
          <ArrowUpDown />
          Sort
          {sorts.length > 0 && <span className="tabular-nums">{sorts.length}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 space-y-3">
        <p className="text-sm font-medium">Sort</p>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="sort-mode"
            checked={sorts.length === 0}
            onChange={() => setSorts([])}
            className="size-4 cursor-pointer accent-primary"
          />
          Manual order
        </label>

        <div className="space-y-2">
          {sorts.map((sort, index) => (
            <div key={index} className="flex items-center gap-1.5" role="group" aria-label="Sort">
              <FieldPicker
                fields={fields}
                current={fields.find((field) => field.ref === sort.field)}
                onChoose={(field) =>
                  setSorts(
                    sorts.map((entry, at) =>
                      at === index ? { ...entry, field: field.ref } : entry,
                    ),
                  )
                }
              />
              <Select
                value={sort.direction}
                onValueChange={(direction) =>
                  setSorts(
                    sorts.map((entry, at) =>
                      at === index ? { ...entry, direction: direction as SortDirection } : entry,
                    ),
                  )
                }
              >
                <SelectTrigger aria-label="Direction" className="h-8 w-32 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ASC">{SORT_DIRECTION_LABEL.ASC}</SelectItem>
                  <SelectItem value="DESC">{SORT_DIRECTION_LABEL.DESC}</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Remove sort"
                onClick={() => setSorts(sorts.filter((_, at) => at !== index))}
              >
                <X />
              </Button>
            </div>
          ))}
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          disabled={sorts.length >= MAX_SORTS_PER_VIEW || fields.length === 0}
          onClick={addSort}
        >
          <Plus className="size-3.5" aria-hidden="true" />
          Add sort
        </Button>

        {!isManualOrder(settings) && (
          <p className="text-xs text-muted-foreground">
            Drag to reorder is off while a sort or grouping decides the order. Dragging into another
            group still sets its value.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
