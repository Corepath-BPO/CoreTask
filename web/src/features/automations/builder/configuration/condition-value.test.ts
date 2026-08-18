import { CONDITION_VALUE_TYPE, isEvaluableOperator } from '@coretask/contracts';
import { describe, expect, it } from 'vitest';

import { conditionFromCatalogueEntry } from './condition-value';

/**
 * What a row from the condition catalogue becomes.
 *
 * The join between the two halves this feature connects: the endpoint decides
 * what may be checked, and this decides what picking one of those writes onto
 * the branch. Both ends of it can fail silently — a field key the runner does
 * not switch on, or a comparison it has no case for — so neither is asserted by
 * restating a table. The operators go through `isEvaluableOperator`, which is
 * the function the runner itself consults.
 */
describe('choosing a condition from the catalogue', () => {
  it('writes the row’s subtype as the field the runner reads', () => {
    expect(
      conditionFromCatalogueEntry({
        subtype: 'sectionId',
        valueType: CONDITION_VALUE_TYPE.SINGLE_SELECT,
      }),
    ).toEqual({ field: 'sectionId', operator: 'IS' });
  });

  /*
   * The custom-field key, carried rather than rebuilt.
   *
   * `customFieldKey` on the server produces `customField:<id>` and the entry
   * arrives with it already in `subtype`, so there is nothing to reassemble
   * here — which is the point. A second place that knows how the key is spelled
   * is a second place that can spell it differently.
   */
  it('keeps a custom field’s key exactly as the server generated it', () => {
    expect(
      conditionFromCatalogueEntry({
        subtype: 'customField:019fc8d5-aaaa-bbbb-cccc-000000000001',
        valueType: CONDITION_VALUE_TYPE.NUMBER,
      }),
    ).toEqual({
      field: 'customField:019fc8d5-aaaa-bbbb-cccc-000000000001',
      operator: 'EQUALS',
    });
  });

  /*
   * The comparison comes with the field, not after it.
   *
   * A condition holding a field and no operator is one the validator refuses
   * and the runner reads as an unknown comparison — so a picker writing only
   * half of it would hand back a step the card shows as answered and the rule
   * cannot publish.
   */
  it.each([
    [CONDITION_VALUE_TYPE.TEXT, 'IS'],
    [CONDITION_VALUE_TYPE.SINGLE_SELECT, 'IS'],
    [CONDITION_VALUE_TYPE.MULTI_SELECT, 'CONTAINS'],
    [CONDITION_VALUE_TYPE.PEOPLE, 'IS'],
    [CONDITION_VALUE_TYPE.DATE, 'IS'],
    [CONDITION_VALUE_TYPE.NUMBER, 'EQUALS'],
  ])('gives a %s field the comparison its type leads with', (valueType, operator) => {
    expect(conditionFromCatalogueEntry({ subtype: 'anything', valueType })).toEqual({
      field: 'anything',
      operator,
    });
  });

  /*
   * The failure f428e58 was about, guarded at the point the condition is made.
   *
   * The builder's vocabulary and the runner's are different words for the same
   * comparisons, and one that does not translate leaves a rule that publishes,
   * goes ACTIVE and is false on every event.
   */
  it('never opens with a comparison the engine cannot make', () => {
    const types = Object.values(CONDITION_VALUE_TYPE);

    const broken = types.filter((valueType) => {
      const written = conditionFromCatalogueEntry({ subtype: 'field', valueType });
      const operator = written['operator'];

      // No operator at all is the honest outcome for a type with no usable
      // comparison; a *wrong* one is the failure being guarded against.
      return operator !== undefined && !isEvaluableOperator(operator as string);
    });

    expect(broken).toEqual([]);
  });

  /*
   * A checkbox is the type that has none. Both its comparisons — "is checked"
   * and "is not checked" — are absent from the runner's table, which is why the
   * catalogue greys the one row that would use them. Should such a row ever be
   * reached anyway, writing the field alone leaves the step visibly unfinished
   * rather than quietly broken.
   */
  it('writes the field alone rather than a comparison nothing performs', () => {
    expect(
      conditionFromCatalogueEntry({
        subtype: 'completed',
        valueType: CONDITION_VALUE_TYPE.CHECKBOX,
      }),
    ).toEqual({ field: 'completed' });
  });

  /*
   * A metadata response older than this feature carries no `valueType`. The
   * field is still worth writing: the step stops being unanswered, the operator
   * select offers the field's own comparisons, and the card goes on reporting it
   * as incomplete until one is chosen.
   */
  it('writes the field alone when the row does not say what it holds', () => {
    expect(conditionFromCatalogueEntry({ subtype: 'status' })).toEqual({ field: 'status' });
  });
});
