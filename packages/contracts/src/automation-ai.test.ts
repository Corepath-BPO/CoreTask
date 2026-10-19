import { describe, expect, it } from 'vitest';

import {
  aiActionProblem,
  aiCheckProblem,
  aiFieldPermission,
  aiPermissionFieldId,
  aiPermissionsOf,
  AI_INSTRUCTIONS_MAX,
} from './automation-ai.js';

describe('the AI steps', () => {
  it('reads what a "Use AI…" step may change, known kinds only, each once', () => {
    expect(
      aiPermissionsOf({
        allow: ['COMMENT', 'COMMENT', 'LAUNCH_ROCKETS', aiFieldPermission('f-1'), 'field:', 7],
      }),
    ).toEqual(['COMMENT', 'field:f-1']);
    expect(aiPermissionFieldId('field:f-1')).toBe('f-1');
    expect(aiPermissionFieldId('COMMENT')).toBeNull();
    expect(aiPermissionsOf({})).toEqual([]);
  });

  it('asks a "Use AI…" step for instructions and something to change', () => {
    expect(aiActionProblem({})).toMatch(/what to do/);
    expect(aiActionProblem({ instructions: '   ', allow: ['COMMENT'] })).toMatch(/what to do/);
    expect(aiActionProblem({ instructions: 'Triage', allow: [] })).toMatch(/at least one/);
    expect(
      aiActionProblem({ instructions: 'x'.repeat(AI_INSTRUCTIONS_MAX + 1), allow: ['COMMENT'] }),
    ).toMatch(/under/);
    expect(aiActionProblem({ instructions: 'Triage', allow: ['PRIORITY'] })).toBeNull();
  });

  it('asks an AI check for a question', () => {
    expect(aiCheckProblem({ field: 'ai.check' })).toMatch(/yes-or-no/);
    expect(aiCheckProblem({ question: 'Is it urgent?' })).toBeNull();
  });
});
