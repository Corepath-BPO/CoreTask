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

  const triggers = triggerCatalogue();
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
    const runner = new AutomationRunnerService({} as never);
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
     * The failure mode the catalogue is protecting against, demonstrated. A
     * field the runner has no case for falls through to the event payload,
     * which on almost every event carries nothing under that key — so the
     * comparison reads `undefined`, fails, and the rule never fires and never
     * complains.
     */
    it.each([customFieldKey('field-risk')])(
      'falls through to the event payload for %s, which is why it is not offered',
      (field) => {
        expect(readField(field, task, event)).toBe(FROM_THE_EVENT);
      },
    );

    it('marks a condition available only where the runner reads its field', () => {
      const readable = new Set<string>(READABLE_TASK_FIELDS);

      for (const condition of conditions) {
        if (!condition.available) continue;
        expect(readable.has(condition.subtype)).toBe(true);
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
     * The one row that gate takes away, named so the loss is deliberate.
     *
     * A checkbox offers "is checked" and "is not checked", and neither has a
     * comparison behind it — so this was an enabled row whose only product was
     * a rule that did nothing. Greyed with a reason it reads as "not yet",
     * which is the truth.
     */
    it('greys the completion check, which has no comparison behind it', () => {
      const completed = conditions.find((entry) => entry.subtype === 'completed');

      expect(completed).toMatchObject({ available: false });
      expect(completed?.reason).toBeTruthy();
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
     * The asymmetry, pinned deliberately. `SET_CUSTOM_FIELD` upserts into
     * `task_custom_field_values` and `readField` never reads that table, so the
     * same field is a working action and a check the engine cannot make. It
     * looks like a bug until something says which way round it is.
     */
    it('can write a custom field but not ask about one', () => {
      const condition = conditions.find((entry) => entry.fieldId === 'field-risk');
      const action = actions.find((entry) => entry.fieldId === 'field-risk');

      expect(condition?.available).toBe(false);
      expect(condition?.reason).toBeTruthy();
      expect(action?.available).toBe(true);
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
      expect(triggers.map((trigger) => trigger.subtype).sort()).toEqual(
        [...AUTOMATION_TRIGGERS].sort(),
      );
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
     * Nothing calls `automation.publish` with a comment event. The rule saves,
     * publishes and validates, then waits for something that is never sent —
     * which is why it is listed disabled rather than left looking usable.
     */
    it('disables a trigger nothing publishes', () => {
      const comment = triggers.find(
        (trigger) => trigger.subtype === AutomationTrigger.COMMENT_ADDED,
      );

      expect(comment?.available).toBe(false);
      expect(comment?.reason).toBeTruthy();
    });
  });

  // ---------------------------------------------------------------------------
  describe('capabilities and permissions', () => {
    it('claims nothing the action list does not support', () => {
      expect(capabilities()).toMatchObject({
        externalActions: false,
        ai: false,
        conditionsOnCustomFields: false,
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
