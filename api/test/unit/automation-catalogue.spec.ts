import {
  AUTOMATION_ACTIONS,
  AUTOMATION_TRIGGERS,
  AutomationTrigger,
  CONDITION_VALUE_TYPE,
  TRIGGER_CONFIG_FORM,
  WorkspaceRole,
  defaultOperatorForConditionField,
  isEvaluableOperator,
} from '@coretask/contracts';
import type { Task } from '@prisma/client';

import type { AutomationEvent } from '../../src/modules/automations/automation-event.publisher';
import { AutomationRunnerService } from '../../src/modules/automations/automation-runner.service';
import {
  ACTION_CATEGORY,
  CONDITION_CATEGORY,
  READABLE_TASK_FIELDS,
  actionCatalogue,
  capabilities,
  conditionCatalogue,
  customFieldKey,
  permissionsFor,
  triggerCatalogue,
  type CatalogueCustomField,
} from '../../src/modules/automations/builder/automation-catalogue';

/**
 * The catalogue, held to what the engine can really do.
 *
 * The point of these is not that the lists have the right number of rows. It is
 * that `available` is a derived fact rather than an optimistic one: the action
 * half is pinned to `AUTOMATION_ACTIONS`, and the condition half is pinned to
 * the runner's own `readField` by calling it. A field added to the catalogue and
 * not to the runner fails here rather than shipping as a rule that publishes
 * cleanly and silently never fires.
 */
describe('the automation catalogue', () => {
  const fields: CatalogueCustomField[] = [
    { id: 'field-risk', name: 'Risk', type: 'SINGLE_SELECT' },
    { id: 'field-effort', name: 'Effort', type: 'NUMBER' },
  ];

  const triggers = triggerCatalogue(fields);
  const conditions = conditionCatalogue(fields);
  const actions = actionCatalogue(fields);

  // ---------------------------------------------------------------------------
  describe('nothing is refused without an explanation', () => {
    /*
     * The whole convention in one property. A greyed row saying nothing tells
     * somebody "not for you" without saying why or whether it will change, and
     * sends them looking for the feature somewhere else — which is worse than
     * the row being absent.
     */
    it.each([
      ['triggers', triggers],
      ['conditions', conditions],
      ['actions', actions],
    ])('gives every unavailable %s entry a reason', (_name, entries) => {
      const unexplained = entries
        .filter((entry) => !entry.available)
        .filter((entry) => typeof entry.reason !== 'string' || entry.reason.trim() === '');

      expect(unexplained.map((entry) => entry.subtype)).toEqual([]);
    });

    it('gives every unavailable trigger configuration form a reason', () => {
      const forms = triggers.flatMap((trigger) => trigger.configForms);
      const unexplained = forms.filter((form) => !form.available && !form.reason);

      expect(unexplained.map((form) => form.form)).toEqual([]);
      expect(forms.length).toBeGreaterThan(0);
    });

    it('leaves no stale reason on something that works', () => {
      const entries = [...triggers, ...conditions, ...actions];
      const contradictory = entries.filter((entry) => entry.available && entry.reason);

      expect(contradictory.map((entry) => entry.subtype)).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  describe('actions match what the runner implements', () => {
    it('marks an action available exactly when the engine can perform it', () => {
      const executable = new Set<string>(AUTOMATION_ACTIONS);

      for (const action of actions) {
        expect({ subtype: action.subtype, available: action.available }).toEqual({
          subtype: action.subtype,
          available: executable.has(action.subtype),
        });
      }
    });

    /*
     * The regression this exists to catch. Rebuilding the catalogue against a
     * specified list of rows is exactly how a working action that the list did
     * not happen to name gets dropped — and dropped silently, because nothing
     * else in the system reads this file.
     */
    it('offers every executable action somewhere', () => {
      const offered = new Set(actions.filter((action) => action.available).map((a) => a.subtype));

      expect([...AUTOMATION_ACTIONS].filter((action) => !offered.has(action))).toEqual([]);
    });

    it('files every entry under one of the catalogue’s groups', () => {
      const groups = new Set<string>(Object.values(ACTION_CATEGORY));

      for (const action of actions) {
        expect(groups.has(action.category)).toBe(true);
      }
    });

    it('shows the groups in the order the catalogue reads in', () => {
      const seen = actions.map((action) => action.category).filter(unique);

      expect(seen).toEqual(Object.values(ACTION_CATEGORY));
    });
  });

  // ---------------------------------------------------------------------------
  describe('conditions match what the runner can read', () => {
    /**
     * `readField` is private, and reaching it is the point.
     *
     * The alternative is restating the runner's `switch` in the assertion, which
     * would pass just as happily when both copies are wrong. This calls the code
     * that decides the answer at run time.
     */
    const runner = new AutomationRunnerService({} as never, {} as never);
    const readField = (field: string, task: Task, event: AutomationEvent): unknown =>
      (
        runner as unknown as {
          readField(field: string, task: Task, event: AutomationEvent): unknown;
        }
      ).readField(field, task, event);

    /** Distinctive, so "read from the task" and "fell through" cannot be confused. */
    const FROM_THE_EVENT = '__from-the-event-payload__';

    const task = {
      id: 'task-1',
      status: 'IN_PROGRESS',
      priority: 'HIGH',
      sectionId: 'section-1',
      assigneeId: 'user-1',
      createdById: 'user-2',
      title: 'A real title',
      description: 'A real description',
      completedAt: new Date('2026-01-02T03:04:05.000Z'),
      dueDate: new Date('2026-02-03T00:00:00.000Z'),
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      estimatedMinutes: 45,
      createdAt: new Date('2025-12-31T10:00:00.000Z'),
    } as unknown as Task;

    const probed = [...READABLE_TASK_FIELDS, customFieldKey('field-risk')];

    const event = {
      workspaceId: 'workspace-1',
      projectId: 'project-1',
      trigger: AutomationTrigger.TASK_UPDATED,
      entityType: 'TASK',
      entityId: 'task-1',
      after: Object.fromEntries(probed.map((field) => [field, FROM_THE_EVENT])),
      correlationId: 'correlation-1',
      depth: 0,
    } as unknown as AutomationEvent;

    it.each(READABLE_TASK_FIELDS)('resolves %s from the task itself', (field) => {
      const value = readField(field, task, event);

      expect(value).not.toBe(FROM_THE_EVENT);
      expect(value).toBeDefined();
    });

    /*
     * A custom field's key resolves against the value rows loaded with the
     * task, never the event payload — the event is the thing that happened,
     * not the state a condition asks about.
     */
    it('reads a custom field from the task’s own value rows', () => {
      const blank = {
        textValue: null,
        numberValue: null,
        dateValue: null,
        booleanValue: null,
        optionIds: [] as string[],
        userIds: [] as string[],
      };

      const holding = {
        ...task,
        customFieldValues: [
          { ...blank, customFieldId: 'field-risk', optionIds: ['option-high'] },
          { ...blank, customFieldId: 'field-effort', numberValue: 8 },
          { ...blank, customFieldId: 'field-started', dateValue: new Date('2026-03-01T00:00:00Z') },
          { ...blank, customFieldId: 'field-notes', textValue: 'call first' },
        ],
      } as unknown as Task;

      expect(readField(customFieldKey('field-risk'), holding, event)).toBe('option-high');
      expect(readField(customFieldKey('field-effort'), holding, event)).toBe(8);
      expect(readField(customFieldKey('field-started'), holding, event)).toBe(
        '2026-03-01T00:00:00.000Z',
      );
      expect(readField(customFieldKey('field-notes'), holding, event)).toBe('call first');
    });

    it('reads an unset custom field as empty, so "is empty" can hold', () => {
      expect(readField(customFieldKey('field-risk'), task, event)).toBeNull();
    });

    /*
     * A set compares by membership — the promise behind offering multi-select
     * and people fields as conditions at all. "Tags is set to Urgent" against
     * ['urgent', 'q3'] holds; read as equality it could never hold once a
     * second value was ticked.
     */
    describe('a many-valued field compares by membership', () => {
      const conditionHolds = (configuration: Record<string, unknown>, holding: Task): boolean =>
        (
          runner as unknown as {
            conditionHolds(
              node: { subtype: string; configuration: Record<string, unknown> },
              task: Task,
              event: AutomationEvent,
            ): boolean;
          }
        ).conditionHolds({ subtype: customFieldKey('field-tags'), configuration }, holding, event);

      const blank = {
        textValue: null,
        numberValue: null,
        dateValue: null,
        booleanValue: null,
        optionIds: [] as string[],
        userIds: [] as string[],
      };

      const tagged = (...optionIds: string[]): Task =>
        ({
          ...task,
          customFieldValues: [{ ...blank, customFieldId: 'field-tags', optionIds }],
        }) as unknown as Task;

      const field = customFieldKey('field-tags');

      it('holds when the chosen option is among those held', () => {
        expect(
          conditionHolds({ field, operator: 'IS', value: 'urgent' }, tagged('urgent', 'q3')),
        ).toBe(true);
        expect(
          conditionHolds({ field, operator: 'IS', value: 'urgent' }, tagged('q3', 'later')),
        ).toBe(false);
      });

      it('reads "is not" as the same membership, denied', () => {
        expect(
          conditionHolds({ field, operator: 'IS_NOT', value: 'urgent' }, tagged('urgent', 'q3')),
        ).toBe(false);
        expect(conditionHolds({ field, operator: 'IS_NOT', value: 'urgent' }, tagged('q3'))).toBe(
          true,
        );
      });

      it('reads "is one of" as any overlap between the two sets', () => {
        expect(
          conditionHolds(
            { field, operator: 'IS_ONE_OF', value: ['urgent', 'blocked'] },
            tagged('q3', 'blocked'),
          ),
        ).toBe(true);
        expect(
          conditionHolds(
            { field, operator: 'IS_ONE_OF', value: ['urgent', 'blocked'] },
            tagged('q3'),
          ),
        ).toBe(false);
      });

      it('still unwraps a one-entry set, so a single tick compares as itself', () => {
        expect(conditionHolds({ field, operator: 'IS', value: 'urgent' }, tagged('urgent'))).toBe(
          true,
        );
      });

      it('reads an empty field as empty, not as holding nothing in particular', () => {
        expect(conditionHolds({ field, operator: 'IS_EMPTY' }, tagged())).toBe(true);
        expect(conditionHolds({ field, operator: 'IS_NOT_EMPTY' }, tagged('urgent', 'q3'))).toBe(
          true,
        );
      });
    });

    it('marks a condition available only where the runner reads its field', () => {
      const readable = new Set<string>(READABLE_TASK_FIELDS);

      for (const condition of conditions) {
        if (!condition.available) continue;
        expect(
          readable.has(condition.subtype) || condition.subtype.startsWith('customField:'),
        ).toBe(true);
      }
    });

    /*
     * The other half of a condition, and the half f428e58 was about.
     *
     * Reading the field is not enough: the builder writes a comparison the
     * moment a row is picked, and one the runner's switch has no case for makes
     * the condition false on every event — a rule that publishes, goes ACTIVE
     * and never fires. `isEvaluableOperator` is what the runner really consults,
     * so this asks it rather than restating the table.
     */
    it('offers no condition whose first comparison the engine cannot make', () => {
      const broken = conditions
        .filter((entry) => entry.available)
        .filter(
          (entry) =>
            !isEvaluableOperator(defaultOperatorForConditionField(entry.subtype, entry.valueType)),
        );

      expect(broken.map((entry) => entry.subtype)).toEqual([]);
    });

    /*
     * The row that gate used to take away, now let through. "Is checked" is a
     * comparison the runner makes itself, so the completion check — and every
     * checkbox custom field with it — is a working row rather than a greyed
     * one. `automation-runner-conditions.spec` holds the runner to that.
     */
    it('offers the completion check, now that "is checked" is a comparison', () => {
      const completed = conditions.find((entry) => entry.subtype === 'completed');

      expect(completed).toMatchObject({ available: true, reason: null });
    });

    /*
     * `readField` grew a case for the description and this list was not told,
     * so a working comparison was withheld with the generic "the engine cannot
     * read this" — the same invisible failure as offering one that does not
     * work, pointed the other way.
     */
    it('offers the description check the engine can now satisfy', () => {
      const description = conditions.find((entry) => entry.subtype === 'description');

      expect(description).toMatchObject({ available: true, reason: null });
      expect(readField('description', task, event)).toBe('A real description');
    });

    it('shows the groups in the order the catalogue reads in', () => {
      const seen = conditions.map((condition) => condition.category).filter(unique);

      expect(seen).toEqual(Object.values(CONDITION_CATEGORY));
    });
  });

  // ---------------------------------------------------------------------------
  describe('custom fields are generated from the project’s own', () => {
    it('produces one condition per field, carrying the field it came from', () => {
      const generated = conditions.filter(
        (entry) => entry.category === CONDITION_CATEGORY.CUSTOM_FIELD,
      );

      expect(generated).toHaveLength(fields.length);
      expect(generated.map((entry) => entry.label)).toEqual(['Risk is…', 'Effort is…']);
      expect(generated.map((entry) => entry.fieldId)).toEqual(['field-risk', 'field-effort']);
      expect(generated.map((entry) => entry.fieldName)).toEqual(['Risk', 'Effort']);
    });

    it('maps the field’s type onto the value type that picks its operators', () => {
      const generated = conditions.filter(
        (entry) => entry.category === CONDITION_CATEGORY.CUSTOM_FIELD,
      );

      expect(generated.map((entry) => entry.valueType)).toEqual([
        CONDITION_VALUE_TYPE.SINGLE_SELECT,
        CONDITION_VALUE_TYPE.NUMBER,
      ]);
    });

    it('produces one action per field, all of which run', () => {
      const generated = actions.filter(
        (entry) => entry.category === ACTION_CATEGORY.CHANGE_CUSTOM_FIELD,
      );

      expect(generated).toHaveLength(fields.length);
      expect(generated.map((entry) => entry.label)).toEqual([
        'Change Risk to…',
        'Change Effort to…',
      ]);
      expect(generated.every((entry) => entry.subtype === 'SET_CUSTOM_FIELD')).toBe(true);
      expect(generated.every((entry) => entry.available)).toBe(true);
      expect(generated.map((entry) => entry.fieldId)).toEqual(['field-risk', 'field-effort']);
    });

    /*
     * The old asymmetry, closed: the runner now loads the value rows with the
     * task, so a single-valued field is a working condition as well as a
     * working action.
     */
    it('can ask about a single-valued custom field as well as write it', () => {
      const condition = conditions.find((entry) => entry.fieldId === 'field-risk');
      const action = actions.find((entry) => entry.fieldId === 'field-risk');

      expect(condition).toMatchObject({ available: true, reason: null });
      expect(action?.available).toBe(true);
    });

    /*
     * The many-valued types used to stay greyed — "the engine compares one at
     * a time" — until `conditionHolds` learned to read "is set to X" against a
     * set as membership. Now their rows derive available like everything else.
     */
    it('offers the many-valued types too, now that membership is a comparison', () => {
      const manyValued = conditionCatalogue([
        { id: 'field-tags', name: 'Tags', type: 'MULTI_SELECT' },
        { id: 'field-watchers', name: 'Watchers', type: 'PEOPLE' },
      ]);

      const generated = manyValued.filter((entry) => entry.fieldId !== undefined);
      expect(generated).toHaveLength(2);
      expect(generated.every((entry) => entry.available && entry.reason === null)).toBe(true);
    });

    it('treats a rating as a number, and leaves a formula out entirely', () => {
      const mixed: CatalogueCustomField[] = [
        { id: 'field-stars', name: 'Stars', type: 'RATING' },
        { id: 'field-total', name: 'Total', type: 'FORMULA' },
      ];

      const generatedConditions = conditionCatalogue(mixed).filter(
        (entry) => entry.category === CONDITION_CATEGORY.CUSTOM_FIELD,
      );
      expect(generatedConditions.map((entry) => entry.fieldId)).toEqual(['field-stars']);
      expect(generatedConditions[0]?.valueType).toBe(CONDITION_VALUE_TYPE.NUMBER);

      const generatedActions = actionCatalogue(mixed).filter(
        (entry) => entry.category === ACTION_CATEGORY.CHANGE_CUSTOM_FIELD,
      );
      expect(generatedActions.map((entry) => entry.fieldId)).toEqual(['field-stars']);

      const generatedTriggers = triggerCatalogue(mixed).filter(
        (entry) => entry.fieldId !== undefined,
      );
      expect(generatedTriggers.map((entry) => entry.fieldId)).toEqual(['field-stars']);
    });

    it('generates nothing when the project uses no fields', () => {
      expect(
        conditionCatalogue([]).filter((e) => e.category === CONDITION_CATEGORY.CUSTOM_FIELD),
      ).toEqual([]);
      expect(
        actionCatalogue([]).filter((e) => e.category === ACTION_CATEGORY.CHANGE_CUSTOM_FIELD),
      ).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  describe('trigger configuration forms', () => {
    const moved = triggers.find(
      (trigger) => trigger.subtype === AutomationTrigger.TASK_MOVED_TO_SECTION,
    );

    it('offers the four forms, worded as the inspector words them', () => {
      expect(moved?.configForms.map((form) => form.label)).toEqual([
        'Section is changed',
        'Section is…',
        'Section is not…',
        'Section is one of…',
      ]);
    });

    it('says which forms ask for a section and which take several', () => {
      const shape = Object.fromEntries(
        (moved?.configForms ?? []).map((form) => [
          form.form,
          { needsValue: form.needsValue, multiple: form.multiple },
        ]),
      );

      expect(shape).toEqual({
        SECTION_CHANGED: { needsValue: false, multiple: false },
        SECTION_CHANGED_TO: { needsValue: true, multiple: false },
        SECTION_CHANGED_TO_NOT: { needsValue: true, multiple: false },
        SECTION_CHANGED_TO_ANY_OF: { needsValue: true, multiple: true },
      });
    });

    /*
     * `triggerMatches` reads one `sectionId` and compares it for equality. A
     * rule saved as "section is not Done" would be matched by that same branch
     * and fire on exactly the events it was written to exclude — so these two
     * are offered disabled rather than offered wrong.
     */
    it('disables the forms the runner would match backwards', () => {
      const available = Object.fromEntries(
        (moved?.configForms ?? []).map((form) => [form.form, form.available]),
      );

      expect(available).toEqual({
        [TRIGGER_CONFIG_FORM.SECTION_CHANGED]: true,
        [TRIGGER_CONFIG_FORM.SECTION_CHANGED_TO]: true,
        [TRIGGER_CONFIG_FORM.SECTION_CHANGED_TO_NOT]: false,
        [TRIGGER_CONFIG_FORM.SECTION_CHANGED_TO_ANY_OF]: false,
      });
    });

    /*
     * The regrouping filters by a list of categories, so a category missing
     * from that list would drop every trigger under it — quietly, and only
     * from the picker. This is the assertion that makes that impossible.
     */
    it('lists every declared trigger exactly once', () => {
      // The generated "[Field] is changed" rows share the real subtype by
      // design — they are the same trigger with the field pre-filled — so the
      // once-each guarantee is about the hand-written rows.
      const declared = triggers
        .filter((trigger) => trigger.fieldId === undefined)
        .map((trigger) => trigger.subtype)
        .filter((subtype) => (AUTOMATION_TRIGGERS as readonly string[]).includes(subtype));

      expect(declared.sort()).toEqual([...AUTOMATION_TRIGGERS].sort());
    });

    /*
     * The planned rows borrow the picker without joining the engine: their
     * subtypes must stay outside the enum, or one could collide with a real
     * trigger and validate as something the runner never fires.
     */
    it('keeps every planned trigger row outside the enum, disabled, and explained', () => {
      const planned = triggers.filter(
        (trigger) => !(AUTOMATION_TRIGGERS as readonly string[]).includes(trigger.subtype),
      );

      expect(planned.length).toBeGreaterThan(0);
      expect(planned.every((trigger) => !trigger.available)).toBe(true);
      expect(planned.every((trigger) => typeof trigger.reason === 'string')).toBe(true);
      expect(planned.every((trigger) => trigger.configForms.length === 0)).toBe(true);
    });

    /*
     * The per-field rows exist so "can I watch this field?" is answered in
     * place. Only a date can approach or pass, so only a DATE field gets the
     * two time-based rows beside its "is changed".
     */
    it('generates three rows for a date field and one for any other', () => {
      const dated = triggerCatalogue([{ id: 'field-started', name: 'Started', type: 'DATE' }]);
      const datedLabels = dated
        .filter((trigger) => trigger.fieldId === 'field-started')
        .map((trigger) => trigger.label);

      expect(datedLabels).toEqual([
        'Started is changed',
        'Started is approaching',
        'Started is overdue',
      ]);

      const plain = triggers.filter((trigger) => trigger.fieldId !== undefined);
      expect(plain.map((trigger) => trigger.label)).toEqual([
        'Risk is changed',
        'Effort is changed',
      ]);
      expect(plain.map((trigger) => trigger.fieldName)).toEqual(['Risk', 'Effort']);
    });

    /*
     * "[Field] is changed" is the real trigger with the field pre-filled — the
     * runner narrows on the `fieldId` the row carries — while the date rows
     * still wait on something watching the clock.
     */
    it('offers the per-field change rows and greys only the date ones', () => {
      const rows = triggerCatalogue([{ id: 'field-started', name: 'Started', type: 'DATE' }]);
      const generated = rows.filter((trigger) => trigger.fieldId === 'field-started');

      const changed = generated.find((trigger) => trigger.label === 'Started is changed');
      expect(changed).toMatchObject({
        subtype: AutomationTrigger.CUSTOM_FIELD_CHANGED,
        available: true,
        reason: null,
        fieldId: 'field-started',
      });

      const dated = generated.filter((trigger) => trigger.label !== 'Started is changed');
      expect(dated).toHaveLength(2);
      expect(dated.every((trigger) => !trigger.available && trigger.reason)).toBe(true);
    });

    it('gathers each group rather than interleaving them', () => {
      const categories = triggers.map((trigger) => trigger.category);

      // Every run of one category, in order. Enum order splits "Status and
      // workflow" in two, so this list would be longer than the set of
      // categories and a client grouping as it reads would draw that heading
      // twice.
      const runs = categories.filter((value, index) => categories[index - 1] !== value);

      expect(runs).toEqual(categories.filter(unique));
    });

    it('gives every other trigger the single form it has always had', () => {
      const others = triggers.filter(
        (trigger) => trigger.subtype !== AutomationTrigger.TASK_MOVED_TO_SECTION,
      );

      expect(others.every((trigger) => trigger.configForms.length === 0)).toBe(true);
    });

    /*
     * `CommentsService` publishes a comment event for items in a project, so
     * the trigger is offered for real. A trigger nothing publishes would be
     * the quietest failure the builder can sell — see the ticket triggers.
     */
    it('offers the comment trigger now that comments are published', () => {
      const comment = triggers.find(
        (trigger) => trigger.subtype === AutomationTrigger.COMMENT_ADDED,
      );

      expect(comment?.available).toBe(true);
      expect(comment?.reason).toBeNull();
    });

    it('disables ticket triggers while actions only operate on tasks', () => {
      const ticketTriggerTypes = new Set<string>([
        AutomationTrigger.TICKET_CREATED,
        AutomationTrigger.TICKET_STATUS_CHANGED,
      ]);
      const ticketTriggers = triggers.filter((trigger) => ticketTriggerTypes.has(trigger.subtype));

      expect(ticketTriggers).toHaveLength(2);
      expect(ticketTriggers.every((trigger) => !trigger.available && trigger.reason)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  describe('trigger scoping', () => {
    /*
     * `triggerMatches` is private for the same reason `readField` is: restating
     * its comparisons in the assertion would pass just as happily when both
     * copies are wrong. This calls the code that decides at run time.
     */
    const runner = new AutomationRunnerService({} as never, {} as never);
    const matches = (config: unknown, event: unknown): boolean =>
      (
        runner as unknown as { triggerMatches(config: unknown, event: unknown): boolean }
      ).triggerMatches(config, event);

    const fieldEvent = {
      trigger: AutomationTrigger.CUSTOM_FIELD_CHANGED,
      after: { fieldId: 'field-risk', fieldName: 'Risk' },
    };

    it('fires a narrowed rule only for its own field', () => {
      expect(matches({ fieldId: 'field-risk' }, fieldEvent)).toBe(true);
      expect(matches({ fieldId: 'field-effort' }, fieldEvent)).toBe(false);
    });

    /* What every rule saved before the narrowing existed stores. */
    it('fires an unnarrowed rule for any field', () => {
      expect(matches({}, fieldEvent)).toBe(true);
      expect(matches(null, fieldEvent)).toBe(true);
    });

    it('leaves section narrowing exactly as it was', () => {
      const moved = {
        trigger: AutomationTrigger.TASK_MOVED_TO_SECTION,
        after: { sectionId: 'section-1' },
      };

      expect(matches({ sectionId: 'section-1' }, moved)).toBe(true);
      expect(matches({ sectionId: 'section-2' }, moved)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  describe('capabilities and permissions', () => {
    it('claims nothing the action list does not support', () => {
      expect(capabilities()).toMatchObject({
        // SEND_WEBHOOK is executable, so the engine may say it talks to other tools.
        externalActions: true,
        ai: false,
        conditionsOnCustomFields: true,
        actionsOnCustomFields: true,
        delays: false,
      });
    });

    it('lets a manager write rules and a member only read them', () => {
      expect(permissionsFor(WorkspaceRole.MANAGER, true)).toMatchObject({
        canView: true,
        canCreate: true,
        canPublish: true,
      });

      expect(permissionsFor(WorkspaceRole.MEMBER, false)).toMatchObject({
        canView: true,
        canCreate: false,
        canEdit: false,
        canPublish: false,
        canDelete: false,
      });
    });
  });
});

/** First occurrence only, so a list of categories becomes their order. */
function unique<T>(value: T, index: number, all: T[]): boolean {
  return all.indexOf(value) === index;
}
