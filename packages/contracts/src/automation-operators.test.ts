import { describe, expect, it } from 'vitest';

import {
  CONDITION_OPERATOR,
  FilterOperator,
  isEvaluableOperator,
  operatorsForConditionField,
  toFilterOperator,
  CONDITION_VALUE_TYPE,
} from './index.js';

/*
 * The builder and the runner name the same comparison differently, and for a
 * while only the builder's half was written down. A condition built in the
 * panel stored `IS`, reached a switch that only knew `EQUALS`, and returned
 * false — so the rule published, showed no problem, and never fired.
 *
 * These lock the translation rather than the wording: what matters is that
 * every operator the panel can offer has a comparison behind it.
 */
describe('toFilterOperator', () => {
  it('translates the names the builder writes', () => {
    expect(toFilterOperator(CONDITION_OPERATOR.IS)).toBe(FilterOperator.EQUALS);
    expect(toFilterOperator(CONDITION_OPERATOR.IS_NOT)).toBe(FilterOperator.NOT_EQUALS);
    expect(toFilterOperator(CONDITION_OPERATOR.IS_ONE_OF)).toBe(FilterOperator.IN);
    expect(toFilterOperator(CONDITION_OPERATOR.IS_BEFORE)).toBe(FilterOperator.BEFORE);
  });

  it('leaves the names already in the database alone', () => {
    // Every condition written before the reading names existed holds these, and
    // a translation that dropped them would break rules that work today.
    expect(toFilterOperator('EQUALS')).toBe(FilterOperator.EQUALS);
    expect(toFilterOperator('IN')).toBe(FilterOperator.IN);
    expect(toFilterOperator('IS_EMPTY')).toBe(FilterOperator.IS_EMPTY);
  });

  it('refuses an operator no comparison can run', () => {
    // Null, not a guess. `IS_TODAY` guessed as `EQUALS` would turn "cannot
    // evaluate this" into "evaluated it and it was false" — silently.
    expect(toFilterOperator(CONDITION_OPERATOR.IS_TODAY)).toBeNull();
    expect(toFilterOperator(CONDITION_OPERATOR.BETWEEN)).toBeNull();
    expect(toFilterOperator('')).toBeNull();
    expect(toFilterOperator(undefined)).toBeNull();
  });

  it('has a comparison for every operator the section field offers', () => {
    // The guard that matters: the panel must not offer a choice that publishes
    // a rule which can never match.
    for (const operator of operatorsForConditionField(
      'sectionId',
      CONDITION_VALUE_TYPE.SINGLE_SELECT,
    )) {
      expect(isEvaluableOperator(operator)).toBe(true);
    }
  });
});

describe('operatorsForConditionField', () => {
  it('offers the section exactly is, is not and is one of', () => {
    expect(operatorsForConditionField('sectionId', CONDITION_VALUE_TYPE.SINGLE_SELECT)).toEqual([
      CONDITION_OPERATOR.IS,
      CONDITION_OPERATOR.IS_NOT,
      CONDITION_OPERATOR.IS_ONE_OF,
    ]);
  });

  it('leaves fields with no narrowing on their type’s full list', () => {
    // Status is the same type and does want the rest — a task can have no
    // priority, so its emptiness checks are real questions.
    const status = operatorsForConditionField('status', CONDITION_VALUE_TYPE.SINGLE_SELECT);

    expect(status).toContain(CONDITION_OPERATOR.IS_EMPTY);
    expect(status.length).toBeGreaterThan(3);
  });
});
