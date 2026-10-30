import { WorkspaceRole } from '@coretask/contracts';
import { Logger } from '@nestjs/common';

import type { AiClient, AiRequest, AiToolCall } from '../../integrations/ai/ai-client';

import { AutomationDraftService } from './automation-draft.service';
import { AutomationGraphValidatorService } from './builder/automation-graph-validator.service';
import { AutomationMetadataService } from './builder/automation-metadata.service';

const WORKSPACE = '00000000-0000-4000-8000-000000000001';
const PROJECT = '00000000-0000-4000-8000-000000000002';
const BACKLOG = '10000000-0000-4000-8000-000000000001';
const WEEK_1 = '10000000-0000-4000-8000-000000000002';
const SAM = '20000000-0000-4000-8000-000000000001';
const ERNIE = '20000000-0000-4000-8000-000000000002';
const DOING = '30000000-0000-4000-8000-000000000001';
const HIGH = '40000000-0000-4000-8000-000000000001';
const RISK = '50000000-0000-4000-8000-000000000001';
const RISK_HIGH = '50000000-0000-4000-8000-000000000002';

/**
 * Prisma as far as the metadata and the validator read it: each table a list,
 * filtered by the ids a query asks for and returned whole otherwise. Nothing
 * here can write — a draft that tried would fail on the missing method.
 */
function table<T extends Record<string, unknown>>(rows: T[], key = 'id') {
  return {
    findMany: jest.fn(async (query?: { where?: Record<string, { in?: unknown[] }> }) => {
      const wanted = query?.where?.[key]?.in;
      return wanted ? rows.filter((row) => wanted.includes(row[key])) : rows;
    }),
  };
}

const sections = [
  { id: BACKLOG, name: 'Backlog', projectId: PROJECT },
  { id: WEEK_1, name: 'Week 1', projectId: PROJECT },
];
const people = [
  { id: SAM, name: 'Sam Rivera', email: 'sam@example.com', avatarUrl: null },
  { id: ERNIE, name: 'Ernie Cruz', email: 'ernie@example.com', avatarUrl: null },
];
const risk = {
  id: RISK,
  name: 'Risk',
  type: 'SINGLE_SELECT',
  options: [{ id: RISK_HIGH, label: 'High', colorToken: 'red' }],
};

const prisma = {
  section: table(sections),
  project: table([] as Record<string, unknown>[]),
  statusDefinition: table([{ id: DOING, name: 'Doing', colorToken: 'blue' }]),
  priorityDefinition: table([{ id: HIGH, name: 'High', colorToken: 'red' }]),
  workspaceMember: table(
    people.map((user) => ({ userId: user.id, user })),
    'userId',
  ),
  // Both on the project, so either may be given its work.
  projectMember: table(
    people.map((user) => ({ userId: user.id, projectId: PROJECT })),
    'userId',
  ),
  projectCustomField: table([{ customField: risk }]),
  customField: table([{ id: RISK, type: 'SINGLE_SELECT' }]),
  webhookEndpoint: table([] as Record<string, unknown>[]),
  team: table([] as Record<string, unknown>[]),
};

const config = { ai: { enabled: true }, webhooks: { allowPrivateUrls: false } };

describe('AutomationDraftService', () => {
  let answer: AiToolCall[];
  let ai: { available: boolean; call: jest.Mock<Promise<AiToolCall[]>, [AiRequest]> };
  let service: AutomationDraftService;

  const draft = (prompt: string, role: WorkspaceRole = WorkspaceRole.MANAGER) =>
    service.draft(WORKSPACE, PROJECT, role, prompt, new Date('2026-10-28T09:00:00Z'));

  beforeEach(() => {
    answer = [];
    ai = { available: true, call: jest.fn(async (_request: AiRequest) => answer) };
    const metadata = new AutomationMetadataService(
      prisma as never,
      { requireProject: jest.fn() } as never,
      config as never,
    );
    const validator = new AutomationGraphValidatorService(prisma as never, config as never);
    service = new AutomationDraftService(metadata, validator, ai as unknown as AiClient);
  });

  it('drafts “move to Week 1, assign Sam, due Friday” as a publishable rule, unsaved', async () => {
    answer = [
      { name: 'trigger', input: { subtype: 'TASK_MOVED_TO_SECTION', section_id: WEEK_1 } },
      { name: 'assign_person', input: { person_id: SAM } },
      { name: 'set_due_date', input: { weekday_next_week: 5 } },
      {
        name: 'name_rule',
        input: {
          name: 'Week 1 to Sam, due Friday',
          description: 'When a task moves to Week 1, assign it to Sam and make it due Friday.',
        },
      },
    ];

    const result = await draft(
      'when a task moves to Week 1, assign it to Sam and set the due date to Friday',
    );

    expect(result.name).toBe('Week 1 to Sam, due Friday');
    expect(result.description).toBe(
      'When a task moves to Week 1, assign it to Sam and make it due Friday.',
    );
    expect(
      result.nodes.map(({ id, type, subtype, configuration, parentId, order }) => ({
        id,
        type,
        subtype,
        configuration,
        parentId,
        order,
      })),
    ).toEqual([
      {
        id: 'new-draft-0',
        type: 'TRIGGER',
        subtype: 'TASK_MOVED_TO_SECTION',
        configuration: { form: 'SECTION_CHANGED_TO', sectionId: WEEK_1 },
        parentId: null,
        order: 0,
      },
      {
        id: 'new-draft-1',
        type: 'ACTION',
        subtype: 'ASSIGN_USER',
        configuration: { userId: SAM },
        parentId: 'new-draft-0',
        order: 1,
      },
      {
        id: 'new-draft-2',
        type: 'ACTION',
        subtype: 'SET_DUE_DATE',
        configuration: { weekdayNextWeek: 5 },
        parentId: 'new-draft-1',
        order: 2,
      },
    ]);
    // Publishable as it stands; the one remark is the validator's usual
    // reminder that a rule without a check runs on every move.
    expect(result.validation).toEqual({
      publishable: true,
      issues: [expect.objectContaining({ level: 'WARNING', nodeId: null })],
    });
    expect(result.notes).toEqual([]);
  });

  it('tells the model the project’s own names and offers only their ids', async () => {
    answer = [{ name: 'trigger', input: { subtype: 'TASK_COMPLETED' } }];
    await draft('when a task is completed');

    const request = ai.call.mock.calls[0]?.[0] as AiRequest;
    expect(request.prompt).toContain(`${WEEK_1}: Week 1`);
    expect(request.prompt).toContain(`${SAM}: Sam Rivera`);
    expect(request.prompt).toContain('<request>\nwhen a task is completed\n</request>');
    expect(request.prompt).toContain('Today is 2026-10-28, a Wednesday.');

    const tool = (name: string) => request.tools.find((entry) => entry.name === name);
    const properties = (name: string) =>
      (tool(name)?.inputSchema as { properties: Record<string, { enum?: unknown[] }> }).properties;

    expect(properties('trigger')['section_id']?.enum).toEqual([BACKLOG, WEEK_1]);
    expect(properties('assign_person')['person_id']?.enum).toEqual([SAM, ERNIE]);
    // The vocabulary is the engine's, less what a project page does not mean.
    expect(properties('trigger')['subtype']?.enum).toContain('TASK_MOVED_TO_SECTION');
    expect(properties('trigger')['subtype']?.enum).not.toContain('TICKET_CREATED');
    expect(tool('set_ticket_status')).toBeUndefined();
    expect(tool('set_field_1')?.description).toContain('Risk');
  });

  it('puts the checks in one “Check if”, a group when there are several', async () => {
    answer = [
      { name: 'trigger', input: { subtype: 'TASK_CREATED' } },
      { name: 'check_if', input: { field: 'priority', operator: 'IS', value: HIGH } },
      {
        name: 'check_if',
        input: { field: `customField:${RISK}`, operator: 'IS', value: RISK_HIGH },
      },
      { name: 'move_to_section', input: { section_id: WEEK_1 } },
      { name: 'name_rule', input: { name: 'Urgent to Week 1', description: 'Moves it.' } },
    ];

    const result = await draft(
      'when a high priority, high risk task is created, move it to Week 1',
    );

    expect(result.nodes.map((node) => node.type)).toEqual(['TRIGGER', 'CONDITION', 'ACTION']);
    expect(result.nodes[1]).toMatchObject({
      subtype: 'FIELD_COMPARISON',
      parentId: 'new-draft-0',
      configuration: {
        match: 'ALL',
        conditions: [
          { field: 'priority', operator: 'IS', value: HIGH },
          { field: `customField:${RISK}`, operator: 'IS', value: RISK_HIGH },
        ],
      },
    });
    expect(result.validation.publishable).toBe(true);
  });

  it('refuses ids that are not on offer and says what was left out', async () => {
    answer = [
      { name: 'trigger', input: { subtype: 'TASK_MOVED_TO_SECTION', section_id: WEEK_1 } },
      { name: 'assign_person', input: { person_id: 'someone-else' } },
      { name: 'check_if', input: { field: 'priority', operator: 'IS', value: 'not-a-priority' } },
      { name: 'set_status', input: { status_id: DOING } },
      {
        name: 'name_rule',
        input: {
          name: 'Week 1',
          description: 'Sets Doing.',
          left_out: 'Nobody here is called Pat.',
        },
      },
    ];

    const result = await draft('when a task moves to Week 1, assign it to Pat and set Doing');

    expect(result.nodes.map((node) => node.subtype)).toEqual([
      'TASK_MOVED_TO_SECTION',
      'UPDATE_STATUS',
    ]);
    expect(result.notes).toEqual([
      'The person to assign is not a member of this project.',
      'A condition on Priority is… compared it with something it cannot hold.',
      'Nobody here is called Pat.',
    ]);
  });

  it('returns what the validator finds wrong, rather than hiding it', async () => {
    answer = [
      { name: 'trigger', input: { subtype: 'TASK_CREATED' } },
      { name: 'name_rule', input: { name: 'Nothing yet', description: 'Does nothing.' } },
    ];

    const result = await draft('when a task is created');

    expect(result.nodes).toHaveLength(1);
    expect(result.validation.publishable).toBe(false);
    expect(result.validation.issues.length).toBeGreaterThan(0);
  });

  it('answers with the model’s reason when no rule fits the sentence', async () => {
    answer = [{ name: 'cannot_draft', input: { reason: 'That is a question, not a rule.' } }];

    await expect(draft('what is the weather?')).rejects.toMatchObject({
      status: 422,
      message: 'That is a question, not a rule.',
    });
  });

  it('asks nothing of a model that is not set up, or for somebody who cannot add rules', async () => {
    await expect(draft('anything', WorkspaceRole.MEMBER)).rejects.toMatchObject({ status: 403 });

    ai.available = false;
    await expect(draft('anything')).rejects.toMatchObject({ status: 503 });
    expect(ai.call).not.toHaveBeenCalled();
  });

  it('says the AI did not answer when the call fails', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    ai.call.mockRejectedValue(new Error('The AI service refused the request (529): overloaded'));

    await expect(draft('when a task is created, assign Sam')).rejects.toMatchObject({
      status: 503,
      message: 'The AI could not draft a rule just now. Try again in a moment.',
    });
  });
});
