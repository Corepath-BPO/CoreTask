import { HOME_WIDGETS, HOME_WIDGET_LABEL, type HomeWidget } from '@coretask/contracts';
import { ArrowDown, ArrowUp, EyeOff, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';

/**
 * Customize Home: which widgets show, and in what order.
 *
 * Shown widgets move up and down or come off the page; hidden ones are listed
 * below to add back, at the end. Every change saves at once — there is no
 * "Done" to forget — and Reset puts the defaults back without touching the
 * notepad's text.
 */
export function HomeCustomizeSheet({
  open,
  onOpenChange,
  widgets,
  onChange,
  onReset,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  widgets: readonly HomeWidget[];
  onChange: (widgets: HomeWidget[]) => void;
  onReset: () => void;
}) {
  const hidden = HOME_WIDGETS.filter((widget) => !widgets.includes(widget));

  const move = (index: number, by: -1 | 1) => {
    const next = [...widgets];
    const [moved] = next.splice(index, 1);
    if (!moved) return;
    next.splice(index + by, 0, moved);
    onChange(next);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-sm">
        <SheetHeader>
          <SheetTitle>Customize Home</SheetTitle>
          <SheetDescription>Choose the widgets on your Home, and their order.</SheetDescription>
        </SheetHeader>

        <section aria-label="Shown on Home" className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground">On your Home</h3>
          {widgets.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing yet — add a widget below.</p>
          ) : (
            <ul className="space-y-1.5">
              {widgets.map((widget, index) => (
                <li
                  key={widget}
                  className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate">{HOME_WIDGET_LABEL[widget]}</span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Move ${HOME_WIDGET_LABEL[widget]} up`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Move ${HOME_WIDGET_LABEL[widget]} down`}
                    disabled={index === widgets.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Hide ${HOME_WIDGET_LABEL[widget]}`}
                    onClick={() => onChange(widgets.filter((entry) => entry !== widget))}
                  >
                    <EyeOff />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {hidden.length > 0 && (
          <section aria-label="Hidden widgets" className="space-y-2">
            <h3 className="text-xs font-medium text-muted-foreground">Add a widget</h3>
            <ul className="space-y-1.5">
              {hidden.map((widget) => (
                <li
                  key={widget}
                  className="flex items-center gap-1 rounded-md border border-dashed px-3 py-1.5 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {HOME_WIDGET_LABEL[widget]}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Add ${HOME_WIDGET_LABEL[widget]}`}
                    onClick={() => onChange([...widgets, widget])}
                  >
                    <Plus />
                    Add
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <SheetFooter className="mt-auto">
          <Button variant="outline" size="sm" onClick={onReset}>
            Reset to default
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
