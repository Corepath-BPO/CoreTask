/**
 * Builds the aria wiring a control inside `<Field>` needs.
 *
 * Kept out of `field.tsx` so that file exports components only — mixing helpers
 * with components breaks Fast Refresh for the whole module.
 */
export function fieldAria(id: string, error?: string, hint?: string) {
  const describedBy = [error ? `${id}-error` : null, hint && !error ? `${id}-hint` : null]
    .filter(Boolean)
    .join(' ');

  return {
    id,
    'aria-invalid': Boolean(error) || undefined,
    'aria-describedby': describedBy || undefined,
  } as const;
}
