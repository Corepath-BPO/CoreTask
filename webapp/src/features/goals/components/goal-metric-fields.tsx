import { GOAL_METRIC_UNIT_MAX } from '@coretask/contracts';
import type { Goal } from '@coretask/types';
import { useState } from 'react';

import { Input } from '@/components/ui/input';

/** A numeric goal's figures: where it started, where it is, where it is going. */
export function GoalMetricFields({
  goal,
  canEdit,
  onSave,
}: {
  goal: Goal;
  canEdit: boolean;
  onSave: (payload: {
    metricStart?: number | null;
    metricCurrent?: number | null;
    metricTarget?: number | null;
    metricUnit?: string | null;
  }) => void;
}) {
  const [start, setStart] = useState(goal.metric ? String(goal.metric.start) : '0');
  const [current, setCurrent] = useState(goal.metric ? String(goal.metric.current) : '');
  const [target, setTarget] = useState(goal.metric ? String(goal.metric.target) : '');
  const [unit, setUnit] = useState(goal.metric?.unit ?? '');

  /** A number from a box, or null when it is empty; undefined when it is not a number. */
  const read = (raw: string): number | null | undefined => {
    if (raw.trim() === '') return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : undefined;
  };
  // All three go together: the start box opens at 0, and that 0 has to be
  // saved too, or a goal given only a current value and a target measures nothing.
  const commit = () => {
    const figures = {
      metricStart: read(start),
      metricCurrent: read(current),
      metricTarget: read(target),
    };
    if (Object.values(figures).some((value) => value === undefined)) return;
    const saved = goal.metric;
    const unchanged =
      saved &&
      figures.metricStart === saved.start &&
      figures.metricCurrent === saved.current &&
      figures.metricTarget === saved.target;
    if (!unchanged) onSave(figures as Record<keyof typeof figures, number | null>);
  };

  const fields: {
    key: 'metricStart' | 'metricCurrent' | 'metricTarget';
    label: string;
    value: string;
    set: (value: string) => void;
  }[] = [
    { key: 'metricStart', label: 'Start', value: start, set: setStart },
    { key: 'metricCurrent', label: 'Current', value: current, set: setCurrent },
    { key: 'metricTarget', label: 'Target', value: target, set: setTarget },
  ];

  return (
    <div className="space-y-2 pt-1">
      <div className="grid grid-cols-4 gap-2">
        {fields.map((field) => (
          <label key={field.key} className="space-y-1 text-xs text-muted-foreground">
            {field.label}
            <Input
              type="number"
              inputMode="decimal"
              value={field.value}
              disabled={!canEdit}
              aria-label={`${field.label} value`}
              className="h-8"
              onChange={(event) => field.set(event.target.value)}
              onBlur={commit}
            />
          </label>
        ))}
        <label className="space-y-1 text-xs text-muted-foreground">
          Unit
          <Input
            value={unit}
            maxLength={GOAL_METRIC_UNIT_MAX}
            disabled={!canEdit}
            placeholder="leases"
            aria-label="Unit"
            className="h-8"
            onChange={(event) => setUnit(event.target.value)}
            onBlur={() =>
              unit.trim() !== (goal.metric?.unit ?? '') &&
              onSave({ metricUnit: unit.trim() || null })
            }
          />
        </label>
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {goal.metric
          ? `${goal.metric.current} of ${goal.metric.target}${goal.metric.unit ? ` ${goal.metric.unit}` : ''}, from ${goal.metric.start}`
          : 'Fill in the start, current and target values to measure progress.'}
      </p>
    </div>
  );
}
