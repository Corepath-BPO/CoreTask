import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ColorTokenPicker } from '@/features/colors/components/color-token-picker';
import { SemanticBadge } from '@/features/colors/components/semantic-badge';

import { newOption, type DraftOption } from './field-type-registry';

/**
 * The list of choices behind a select field.
 *
 * Colour is part of an option, not decoration added later: the whole reason to
 * use a select rather than free text is that "Blocked" should be recognisable
 * at a glance in a dense grid. Each row therefore carries its own swatch.
 *
 * Reordering is done with buttons rather than drag-and-drop. Two reasons: the
 * list is short enough that two clicks is not a burden, and buttons work from
 * the keyboard without a parallel implementation — a drag handle that only a
 * mouse can use would make option order a mouse-only feature.
 */
export function CustomFieldOptionEditor({
  options,
  onChange,
}: {
  options: DraftOption[];
  onChange: (options: DraftOption[]) => void;
}) {
  const update = (key: string, patch: Partial<DraftOption>) =>
    onChange(options.map((option) => (option.key === key ? { ...option, ...patch } : option)));

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= options.length) return;

    const next = [...options];
    const [moved] = next.splice(index, 1);
    if (moved) next.splice(target, 0, moved);
    onChange(next);
  };

  return (
    <div className="space-y-2">
      <ul className="space-y-1.5">
        {options.map((option, index) => (
          <li key={option.key} className="flex items-center gap-1.5">
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={`Colour for ${option.label || `option ${index + 1}`}`}
                  className="shrink-0 cursor-pointer rounded focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
                >
                  <SemanticBadge color={{ colorToken: option.colorToken, customColor: null }}>
                    {option.label.trim() || '—'}
                  </SemanticBadge>
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-auto">
                <ColorTokenPicker
                  value={option.colorToken}
                  onChange={(colorToken) => update(option.key, { colorToken })}
                />
              </PopoverContent>
            </Popover>

            <Input
              value={option.label}
              onChange={(event) => update(option.key, { label: event.target.value })}
              aria-label={`Option ${index + 1}`}
              placeholder={`Option ${index + 1}`}
              className="h-8 flex-1"
            />

            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              aria-label={`Move ${option.label || `option ${index + 1}`} up`}
              disabled={index === 0}
              onClick={() => move(index, -1)}
            >
              <ArrowUp className="size-3.5" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              aria-label={`Move ${option.label || `option ${index + 1}`} down`}
              disabled={index === options.length - 1}
              onClick={() => move(index, 1)}
            >
              <ArrowDown className="size-3.5" aria-hidden="true" />
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              aria-label={`Remove ${option.label || `option ${index + 1}`}`}
              // The last row stays: removing it would leave a select with
              // nothing to select, which the API refuses anyway.
              disabled={options.length === 1}
              onClick={() => onChange(options.filter((entry) => entry.key !== option.key))}
            >
              <X className="size-3.5" aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ul>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...options, newOption(options.length)])}
      >
        <Plus className="size-3.5" aria-hidden="true" />
        Add option
      </Button>

      <p className="text-xs text-muted-foreground">
        Options can be renamed later. One that tasks already use is archived rather than deleted, so
        those tasks keep a value you can still read.
      </p>
    </div>
  );
}
