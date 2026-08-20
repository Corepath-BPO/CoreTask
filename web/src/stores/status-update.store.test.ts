import { beforeEach, describe, expect, it } from 'vitest';

import { useStatusUpdateStore } from './status-update.store';

beforeEach(() => {
  useStatusUpdateStore.setState({ byProject: {} });
  localStorage.clear();
});

describe('status update store', () => {
  it('records the latest status per project', () => {
    useStatusUpdateStore.getState().setStatus('project-1', 'on_track');
    useStatusUpdateStore.getState().setStatus('project-2', 'at_risk');

    const { byProject } = useStatusUpdateStore.getState();
    expect(byProject['project-1']?.status).toBe('on_track');
    expect(byProject['project-2']?.status).toBe('at_risk');
  });

  it('overwrites a previous status rather than keeping history', () => {
    useStatusUpdateStore.getState().setStatus('project-1', 'on_track');
    useStatusUpdateStore.getState().setStatus('project-1', 'off_track');

    expect(useStatusUpdateStore.getState().byProject['project-1']?.status).toBe('off_track');
  });
});
