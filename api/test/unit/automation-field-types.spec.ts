import {
  CUSTOM_FIELD_TYPES,
  CustomFieldType,
  defaultOperatorForConditionField,
  isEvaluableOperator,
  operatorsForConditionField,
} from '@coretask/contracts';

import {
  ACTION_CATEGORY,
  CONDITION_CATEGORY,
  actionCatalogue,
  conditionCatalogue,
  triggerCatalogue,
  type CatalogueCustomField,
} from '../../src/modules/automations/builder/automation-catalogue';

/**
 * Every field type the field picker offers, through all three catalogues.
 *
 * The report that prompted this: a checkbox field showed up as a list column
 * and not as a trigger. The catalogue was never the cause — but nothing proved
 * that, because the fixtures beside this only ever held a select and a number.
 * Now each type a project can hold is walked, and a type that stops producing
 * a working row somewhere fails by name rather than by a screenshot.
 */
describe('every field type a project can hold', () => {
  const settable = CUSTOM_FIELD_TYPES.filter((type) => type !== CustomFieldType.FORMULA);
  const idOf = (type: string) => `field-${type.toLowerCase()}`;
  const fields: CatalogueCustomField[] = settable.map((type) => ({
    id: idOf(type),
    name: `${type} field`,
    type,
  }));

  const triggers = triggerCatalogue(fields);
  const conditions = conditionCatalogue(fields);
  const actions = actionCatalogue(fields);

  it.each(settable)('offers a %s field as a trigger, a condition and an action', (type) => {
    const trigger = triggers.find(
      (entry) => entry.fieldId === idOf(type) && entry.subtype === 'CUSTOM_FIELD_CHANGED',
    );
    const condition = conditions.find((entry) => entry.fieldId === idOf(type));
    const action = actions.find((entry) => entry.fieldId === idOf(type));

    expect(trigger).toMatchObject({
      available: true,
      reason: null,
      label: `${type} field is changed`,
    });
    expect(condition).toMatchObject({
      available: true,
      reason: null,
      category: CONDITION_CATEGORY.CUSTOM_FIELD,
    });
    expect(action).toMatchObject({
      available: true,
      reason: null,
      category: ACTION_CATEGORY.CHANGE_CUSTOM_FIELD,
    });
  });

  /*
   * Not just the first comparison — every one the operator list offers. A row
   * that opens on a working comparison and lists a broken one beside it is a
   * rule that stops firing the moment somebody picks the second.
   */
  it.each(settable)('can run every comparison it offers on a %s field', (type) => {
    const condition = conditions.find((entry) => entry.fieldId === idOf(type));
    expect(condition).toBeDefined();

    const first = defaultOperatorForConditionField(condition!.subtype, condition!.valueType);
    expect(first).not.toBeNull();

    for (const operator of operatorsForConditionField(condition!.subtype, condition!.valueType)) {
      expect({ operator, evaluable: isEvaluableOperator(operator) }).toEqual({
        operator,
        evaluable: true,
      });
    }
  });

  it('leaves a formula out of all three, since nothing can watch, compare or set it', () => {
    const formula: CatalogueCustomField = {
      id: 'field-total',
      name: 'Total',
      type: CustomFieldType.FORMULA,
    };

    expect(triggerCatalogue([formula]).some((entry) => entry.fieldId === 'field-total')).toBe(
      false,
    );
    expect(conditionCatalogue([formula]).some((entry) => entry.fieldId === 'field-total')).toBe(
      false,
    );
    expect(actionCatalogue([formula]).some((entry) => entry.fieldId === 'field-total')).toBe(false);
  });
});
