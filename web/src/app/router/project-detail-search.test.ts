import { describe, expect, it } from 'vitest';

import { validateProjectDetailSearch } from './router';

const TASK_ID = '0198c9a1-2b3c-7d4e-89ab-0123456789ab';

describe('validateProjectDetailSearch', () => {
  it('passes a valid task id through', () => {
    expect(validateProjectDetailSearch({ task: TASK_ID })).toEqual({ task: TASK_ID });
  });

  it('drops a task that is not a uuid', () => {
    expect(validateProjectDetailSearch({ task: 'not-a-uuid' })).toEqual({});
  });

  it('accepts customize as a boolean or as the string the URL carries', () => {
    expect(validateProjectDetailSearch({ customize: true })).toEqual({ customize: true });
    expect(validateProjectDetailSearch({ customize: 'true' })).toEqual({ customize: true });
  });

  it('rejects anything else pretending to be customize', () => {
    expect(validateProjectDetailSearch({ customize: '1' })).toEqual({});
    expect(validateProjectDetailSearch({ customize: 'yes' })).toEqual({});
    expect(validateProjectDetailSearch({ customize: false })).toEqual({});
  });

  it('lets the task win when a hand-built URL names both panels', () => {
    expect(validateProjectDetailSearch({ task: TASK_ID, customize: 'true' })).toEqual({
      task: TASK_ID,
    });
  });

  it('returns an empty schema for an empty search', () => {
    expect(validateProjectDetailSearch({})).toEqual({});
  });
});
