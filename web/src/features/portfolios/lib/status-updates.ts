import type { ProjectStatusUpdateValue } from '@/stores/status-update.store';

export interface StatusUpdateOption {
  value: ProjectStatusUpdateValue;
  label: string;
  /** The small dot inside the chip. */
  dot: string;
  /** The tinted chip — Asana's colour language, theme-aware via alpha tints. */
  chip: string;
  /** Complete is the one filled chip, with a check instead of a dot. */
  filled?: boolean;
}

export const STATUS_UPDATE_OPTIONS: StatusUpdateOption[] = [
  {
    value: 'on_track',
    label: 'On track',
    dot: 'bg-emerald-500',
    chip: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  },
  {
    value: 'at_risk',
    label: 'At risk',
    dot: 'bg-amber-500',
    chip: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  },
  {
    value: 'off_track',
    label: 'Off track',
    dot: 'bg-rose-500',
    chip: 'bg-rose-500/15 text-rose-700 dark:text-rose-400',
  },
  {
    value: 'on_hold',
    label: 'On hold',
    dot: 'bg-blue-500',
    chip: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
  },
  {
    value: 'complete',
    label: 'Complete',
    dot: 'bg-white',
    chip: 'bg-emerald-500 text-white',
    filled: true,
  },
  {
    value: 'dropped',
    label: 'Dropped',
    dot: 'bg-muted-foreground',
    chip: 'bg-muted text-muted-foreground',
  },
];

export function statusUpdateOption(value: ProjectStatusUpdateValue): StatusUpdateOption {
  return (
    STATUS_UPDATE_OPTIONS.find((option) => option.value === value) ??
    (STATUS_UPDATE_OPTIONS[0] as StatusUpdateOption)
  );
}
