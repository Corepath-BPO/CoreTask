import { PROJECT_COLORS } from '@coretask/contracts';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';

import { Field } from '@/components/forms/field';
import { fieldAria } from '@/components/forms/field-aria';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { usePortfolioStore, type Portfolio } from '@/stores/portfolio.store';

import { portfolioFormSchema, type PortfolioFormInput } from '../lib/portfolio-schema';

interface PortfolioFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string | undefined;
  /** Omitted when creating. */
  portfolio?: Portfolio | null;
  /** Fired after a create, so the caller can jump straight into the new portfolio. */
  onCreated?: (portfolio: Portfolio) => void;
}

const EMPTY: PortfolioFormInput = {
  name: '',
  description: '',
  color: PROJECT_COLORS[0] as string,
};

export function PortfolioFormDialog({
  open,
  onOpenChange,
  workspaceId,
  portfolio = null,
  onCreated,
}: PortfolioFormDialogProps) {
  const isEdit = portfolio !== null;
  const createPortfolio = usePortfolioStore((state) => state.createPortfolio);
  const updatePortfolio = usePortfolioStore((state) => state.updatePortfolio);

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<PortfolioFormInput>({
    resolver: zodResolver(portfolioFormSchema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (!open) return;

    reset(
      portfolio
        ? {
            name: portfolio.name,
            description: portfolio.description ?? '',
            color: portfolio.color,
          }
        : EMPTY,
    );
  }, [open, portfolio, reset]);

  const onSubmit = handleSubmit((values) => {
    if (!workspaceId) return;

    const draft = {
      name: values.name,
      description: values.description || null,
      color: values.color,
    };

    if (isEdit) {
      updatePortfolio(workspaceId, portfolio.id, draft);
      toast.success(`Portfolio "${draft.name}" updated`);
    } else {
      const created = createPortfolio(workspaceId, draft);
      toast.success(`Portfolio "${created.name}" created`);
      onCreated?.(created);
    }

    onOpenChange(false);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit portfolio' : 'Create a portfolio'}</DialogTitle>
          <DialogDescription>
            A portfolio watches a group of projects together. It only references them — adding or
            removing a project never changes the project itself. Portfolios are stored in this
            browser for now.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} noValidate className="space-y-4">
          <Field
            label="Portfolio name"
            htmlFor="portfolio-name"
            error={errors.name?.message}
            required
          >
            <Input
              {...fieldAria('portfolio-name', errors.name?.message)}
              {...register('name')}
              placeholder="Q3 launches"
              autoFocus
            />
          </Field>

          <Field
            label="Description"
            htmlFor="portfolio-description"
            error={errors.description?.message}
          >
            <Textarea
              {...fieldAria('portfolio-description', errors.description?.message)}
              {...register('description')}
              placeholder="What this portfolio keeps an eye on (optional)"
              rows={2}
            />
          </Field>

          <Field label="Colour" htmlFor="portfolio-color" error={errors.color?.message}>
            <Controller
              control={control}
              name="color"
              render={({ field }) => (
                <div
                  id="portfolio-color"
                  role="radiogroup"
                  aria-label="Portfolio colour"
                  className="flex flex-wrap items-center gap-1.5 pt-1"
                >
                  {PROJECT_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      role="radio"
                      aria-checked={field.value === color}
                      aria-label={color}
                      onClick={() => field.onChange(color)}
                      style={{ backgroundColor: color }}
                      className={cn(
                        'size-6 rounded-md ring-offset-2 ring-offset-background transition-shadow focus-visible:ring-[3px] focus-visible:ring-ring/40 focus-visible:outline-none',
                        field.value === color && 'ring-2 ring-foreground',
                      )}
                    />
                  ))}
                </div>
              )}
            />
          </Field>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">{isEdit ? 'Save changes' : 'Create portfolio'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
