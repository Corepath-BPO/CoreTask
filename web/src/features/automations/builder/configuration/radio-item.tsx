import * as SelectPrimitive from '@radix-ui/react-select';

import { cn } from '@/lib/utils';

/**
 * A row in a single-choice list, marked with a radio rather than a tick.
 *
 * The two lists in these forms mean different things and should not look the
 * same. Choosing a section replaces whatever was chosen before; choosing
 * sections for "is one of" adds to a set. A tick says "this one is on" and says
 * nothing about the others, which is true of a checkbox and false here — a
 * radio says the choices are exclusive before anybody clicks one and finds out.
 *
 * Local to these panels rather than folded into the shared `SelectItem`,
 * because every other select in the application is a tick and changing all of
 * them from here would be a redesign nobody asked for.
 *
 * The circle is always drawn and only the dot is an indicator, so the control
 * reads as a radio in both states — an empty row with no circle at all would
 * leave the group looking like plain text until something was selected.
 */
export function RadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "group relative flex w-full cursor-pointer select-none items-center gap-2.5 rounded-sm py-1.5 pl-2 pr-2 text-sm outline-hidden [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        'focus:bg-accent focus:text-accent-foreground',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors',
          // Read from the row, because that is where Radix puts the state —
          // the circle itself has none and would never colour.
          'border-muted-foreground/50 group-data-[state=checked]:border-primary',
        )}
      >
        <SelectPrimitive.ItemIndicator>
          <span className="size-2 rounded-full bg-primary" />
        </SelectPrimitive.ItemIndicator>
      </span>

      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}
