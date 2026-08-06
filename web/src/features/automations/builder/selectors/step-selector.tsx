import type { AutomationCatalogEntry } from '@coretask/types';

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

/**
 * Choosing what a step does.
 *
 * Searchable rather than a long menu: there are eleven actions today and there
 * will be more, and a list somebody has to read end to end stops being a list
 * once it passes about seven.
 *
 * Entries that cannot run are shown disabled rather than filtered out. Absence
 * reads as "never considered"; a greyed row with a reason reads as "not yet",
 * which is the truth and saves somebody searching for it twice.
 */
export function StepSelector({
  entries,
  trigger,
  open,
  onOpenChange,
  onChoose,
  placeholder,
}: {
  entries: AutomationCatalogEntry[];
  trigger: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChoose: (subtype: string) => void;
  placeholder: string;
}) {
  // Grouped by the category the API assigns, so the order is the server's
  // rather than whatever the array happened to be in.
  const groups = entries.reduce<Record<string, AutomationCatalogEntry[]>>((acc, entry) => {
    (acc[entry.category] ??= []).push(entry);
    return acc;
  }, {});

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>

      <PopoverContent align="start" className="w-80 p-0">
        <Command label={placeholder}>
          <CommandInput placeholder={placeholder} />

          <CommandList className="max-h-[320px]">
            <CommandEmpty>Nothing matches that.</CommandEmpty>

            {Object.entries(groups).map(([category, items]) => (
              <CommandGroup key={category} heading={category}>
                {items.map((entry) => (
                  <CommandItem
                    key={entry.subtype}
                    value={`${entry.label} ${entry.description} ${category}`}
                    disabled={!entry.available}
                    onSelect={() => {
                      if (!entry.available) return;

                      onChoose(entry.subtype);
                      onOpenChange(false);
                    }}
                    className="cursor-pointer"
                  >
                    <span className="flex-1 truncate">{entry.label}</span>
                    {!entry.available && (
                      <span className="text-xs text-muted-foreground">Coming soon</span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
