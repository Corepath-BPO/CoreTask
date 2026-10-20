import type { Goal } from '@coretask/types';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { setupUser } from '@/test/test-utils';

import { GoalMetricFields } from './goal-metric-fields';

const goal = (metric: Goal['metric']) => ({ id: 'g-1', metric }) as Goal;

describe('GoalMetricFields', () => {
  it('saves the start it opens with alongside the current value and target', async () => {
    const user = setupUser();
    const onSave = vi.fn();
    render(<GoalMetricFields goal={goal(null)} canEdit onSave={onSave} />);

    await user.type(screen.getByLabelText('Current value'), '10');
    await user.type(screen.getByLabelText('Target value'), '40');
    await user.tab();

    expect(onSave).toHaveBeenLastCalledWith({
      metricStart: 0,
      metricCurrent: 10,
      metricTarget: 40,
    });
  });

  it('reads the figures back and leaves them alone when nothing changed', async () => {
    const user = setupUser();
    const onSave = vi.fn();
    render(
      <GoalMetricFields
        goal={goal({ start: 0, current: 10, target: 40, unit: 'leases' })}
        canEdit
        onSave={onSave}
      />,
    );

    expect(screen.getByText('10 of 40 leases, from 0')).toBeInTheDocument();
    await user.click(screen.getByLabelText('Current value'));
    await user.tab();
    expect(onSave).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText('Unit'));
    await user.type(screen.getByLabelText('Unit'), '$');
    await user.tab();
    expect(onSave).toHaveBeenCalledWith({ metricUnit: '$' });
  });
});
