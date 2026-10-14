import { describe, expect, it } from 'vitest';

import { formAnswerProblem } from './forms.js';

const ask = (kind: string, options?: string[]) =>
  ({ label: 'Q', kind, ...(options ? { options } : {}) }) as Parameters<
    typeof formAnswerProblem
  >[0];

describe('formAnswerProblem', () => {
  it('judges each kind of answer, and leaves empty ones to "required"', () => {
    expect(formAnswerProblem(ask('EMAIL'), 'a@b.co')).toBeNull();
    expect(formAnswerProblem(ask('EMAIL'), 'nope')).toContain('email');
    expect(formAnswerProblem(ask('SINGLE_SELECT', ['Leak', 'Noise']), 'Leak')).toBeNull();
    expect(formAnswerProblem(ask('SINGLE_SELECT', ['Leak']), 'Fire')).toContain('Choose');
    expect(formAnswerProblem(ask('MULTI_SELECT', ['A', 'B']), 'A\nB')).toBeNull();
    expect(formAnswerProblem(ask('MULTI_SELECT', ['A', 'B']), 'A\nC')).toContain('Choose');
    expect(formAnswerProblem(ask('DATE'), '2026-10-14')).toBeNull();
    expect(formAnswerProblem(ask('DATE'), 'tomorrow')).toContain('date');
    expect(formAnswerProblem(ask('NUMBER'), '12.5')).toBeNull();
    expect(formAnswerProblem(ask('NUMBER'), 'twelve')).toContain('number');
    expect(formAnswerProblem(ask('NUMBER'), '   ')).toBeNull();
  });
});
