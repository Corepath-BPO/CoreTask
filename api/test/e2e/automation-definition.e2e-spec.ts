import { API_PREFIX, AutomationRuleStatus, WorkspaceRole } from '@coretask/contracts';
import request from 'supertest';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

/**
 * The structured rule over HTTP.
 *
 * Two things are being proved here that a unit test cannot reach. One is that
 * the reference checks really are scoped to the tenant — a section id from
 * another project has to be refused by the database's answer, not by a list
 * somebody remembered to keep current. The other is that publishing leaves the
 * running version alone, which is a claim about rows and can only be checked by
 * looking at them.
 */
describe('Automation definitions (e2e)', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestContext();
  });

  beforeEach(async () => {
    await context.prisma.truncateAllTables();
  });

  afterAll(async () => {
    await closeTestContext(context);
  });

  const server = () => context.app.getHttpServer();
  const url = (path: string) => `${API_PREFIX}${path}`;

  interface Actor {
    token: string;
    userId: string;
  }

  interface Scope {
    owner: Actor;
    member: Actor;
    /** In the workspace but not in the project's, for the cross-tenant checks. */
    outsider: Actor;
    workspaceId: string;
    projectId: string;
    sectionId: string;
    otherSectionId: string;
    /** A second project in the same workspace, and one of its sections. */
    siblingSectionId: string;
    /** Somebody else's workspace entirely. */
    foreignSectionId: string;
  }

  const registerUser = async (name = 'Test User'): Promise<Actor> => {
    const response = await request(server())
      .post(url('/auth/register'))
      .send({ name, email: uniqueEmail(), password: VALID_PASSWORD })
      .expect(201);

    return {
      token: response.body.data.accessToken as string,
      userId: response.body.data.user.id as string,
    };
  };

  const createProject = async (actor: Actor, workspaceId: string, name: string) => {
    const project = await request(server())
      .post(url(`/workspaces/${workspaceId}/projects`))
      .set('Authorization', `Bearer ${actor.token}`)
      .send({ name })
      .expect(201);

    return {
      id: project.body.data.id as string,
      sections: project.body.data.sections as { id: string }[],
    };
  };

  const createWorkspace = async (actor: Actor, name: string) => {
    const workspace = await request(server())
      .post(url('/workspaces'))
      .set('Authorization', `Bearer ${actor.token}`)
      .send({ name })
      .expect(201);

    return workspace.body.data.id as string;
  };

  const setupScope = async (): Promise<Scope> => {
    const owner = await registerUser('Owner');
    const member = await registerUser('Member');
    const outsider = await registerUser('Outsider');

    const workspaceId = await createWorkspace(owner, 'Acme Product');

    await context.prisma.workspaceMember.create({
      data: { workspaceId, userId: member.userId, role: WorkspaceRole.MEMBER },
    });

    const project = await createProject(owner, workspaceId, 'Platform Foundation');
    const sibling = await createProject(owner, workspaceId, 'Marketing Site');

    const foreignWorkspaceId = await createWorkspace(outsider, 'Someone Else');
    const foreign = await createProject(outsider, foreignWorkspaceId, 'Their Project');

    return {
      owner,
      member,
      outsider,
      workspaceId,
      projectId: project.id,
      sectionId: project.sections[0]?.id ?? '',
      otherSectionId: project.sections[1]?.id ?? project.sections[0]?.id ?? '',
      siblingSectionId: sibling.sections[0]?.id ?? '',
      foreignSectionId: foreign.sections[0]?.id ?? '',
    };
  };

  const rulesUrl = (scope: Scope) =>
    url(`/workspaces/${scope.workspaceId}/projects/${scope.projectId}/automations`);

  /* ------------------------------------------------------------------------ */
  /* Building blocks                                                           */
  /* ------------------------------------------------------------------------ */

  interface RuleNode {
    id?: string;
    nodeType: string;
    subtype: string;
    configuration?: Record<string, unknown>;
    parentId?: string;
    branchKey?: string;
    order?: number;
  }

  /** A rule created through the node-tree API, as every live rule was. */
  const legacyRule = async (scope: Scope, nodes: RuleNode[]): Promise<string> => {
    const created = await request(server())
      .post(rulesUrl(scope))
      .set('Authorization', `Bearer ${scope.owner.token}`)
      .send({
        name: 'Assign on arrival',
        triggerType: 'TASK_MOVED_TO_SECTION',
        triggerConfig: { sectionId: scope.sectionId },
        nodes,
      })
      .expect(201);

    return created.body.data.id as string;
  };

  /** A rule with no nodes at all, so its draft converts to a single empty branch. */
  const bareRule = (scope: Scope) => legacyRule(scope, []);

  const definitionUrl = (scope: Scope, ruleId: string) => `${rulesUrl(scope)}/${ruleId}/definition`;

  /* Deliberately not `async`: the supertest request is what is returned, so a
   * caller can keep chaining `.expect(...)` onto it the way every other spec
   * here does. */
  const readDefinition = (scope: Scope, ruleId: string, actor: Actor = scope.owner) =>
    request(server())
      .get(definitionUrl(scope, ruleId))
      .set('Authorization', `Bearer ${actor.token}`);

  const saveDefinition = (
    scope: Scope,
    ruleId: string,
    body: unknown,
    actor: Actor = scope.owner,
  ) =>
    request(server())
      .put(definitionUrl(scope, ruleId))
      .set('Authorization', `Bearer ${actor.token}`)
      .send(body as object);

  const publishDefinition = (scope: Scope, ruleId: string, actor: Actor = scope.owner) =>
    request(server())
      .post(`${definitionUrl(scope, ruleId)}/publish`)
      .set('Authorization', `Bearer ${actor.token}`);

  interface Branch {
    id: string;
    type: string;
    position: number;
    conditionGroup: {
      id: string;
      operator: string;
      conditions: {
        id: string;
        fieldKey: string;
        operator: string;
        value: unknown;
        position: number;
      }[];
    } | null;
    actions: {
      id: string;
      actionType: string;
      configuration: Record<string, unknown>;
      position: number;
    }[];
  }

  const condition = (scope: Scope, position = 0) => ({
    id: `condition-${position}`,
    fieldKey: 'sectionId',
    operator: 'IS',
    value: scope.sectionId,
    position,
  });

  const assignOwner = (scope: Scope, position = 0) => ({
    id: `action-${position}`,
    actionType: 'ASSIGN_USER',
    configuration: { userId: scope.owner.userId },
    position,
  });

  /** A rule that has everything publish asks for. */
  const completeDefinition = (scope: Scope, branches?: unknown[]) => ({
    name: 'Assign on arrival',
    trigger: { type: 'TASK_MOVED_TO_SECTION', configuration: { sectionId: scope.sectionId } },
    branches: branches ?? [
      {
        id: 'branch-primary',
        type: 'PRIMARY',
        position: 0,
        conditionGroup: { id: 'group-1', operator: 'ALL', conditions: [condition(scope)] },
        actions: [assignOwner(scope)],
      },
    ],
  });

  /** A rule saved, published, and left with a fresh draft. */
  const publishedRule = async (scope: Scope): Promise<string> => {
    const ruleId = await bareRule(scope);

    await saveDefinition(scope, ruleId, completeDefinition(scope)).expect(200);
    await publishDefinition(scope, ruleId).expect(200);

    return ruleId;
  };

  /* ------------------------------------------------------------------------ */
  /* Reading a rule that predates the model                                    */
  /* ------------------------------------------------------------------------ */

  describe('a legacy rule opened in the new builder', () => {
    it('converts a flat rule into one “Check if” branch', async () => {
      const scope = await setupScope();
      const ruleId = await legacyRule(scope, [
        { nodeType: 'TRIGGER', subtype: 'TASK_MOVED_TO_SECTION', configuration: {} },
        {
          nodeType: 'CONDITION',
          subtype: 'status',
          configuration: { field: 'status', operator: 'EQUALS', value: 'DONE' },
        },
        {
          nodeType: 'ACTION',
          subtype: 'ASSIGN_USER',
          configuration: { userId: scope.owner.userId },
        },
        { nodeType: 'ACTION', subtype: 'CLEAR_DUE_DATE', configuration: {} },
      ]);

      const response = await readDefinition(scope, ruleId).expect(200);
      const branches = response.body.data.definition.branches as Branch[];

      expect(branches).toHaveLength(1);
      expect(branches[0]?.type).toBe('PRIMARY');
      expect(branches[0]?.conditionGroup?.operator).toBe('ALL');
      expect(branches[0]?.conditionGroup?.conditions).toEqual([
        expect.objectContaining({ fieldKey: 'status', operator: 'IS', value: 'DONE' }),
      ]);
      expect(branches[0]?.actions.map((action) => action.actionType)).toEqual([
        'ASSIGN_USER',
        'CLEAR_DUE_DATE',
      ]);
    });

    it('converts a branch chain into PRIMARY, OTHERWISE_IF and OTHERWISE', async () => {
      const scope = await setupScope();
      const ruleId = await legacyRule(scope, [
        { id: 't', nodeType: 'TRIGGER', subtype: 'TASK_MOVED_TO_SECTION', order: 0 },
        {
          id: 'b1',
          nodeType: 'BRANCH',
          subtype: 'status',
          configuration: { field: 'status', operator: 'EQUALS', value: 'DONE' },
          parentId: 't',
          order: 1,
        },
        {
          id: 'a1',
          nodeType: 'ACTION',
          subtype: 'CLEAR_DUE_DATE',
          parentId: 'b1',
          branchKey: 'match',
          order: 0,
        },
        {
          id: 'b2',
          nodeType: 'BRANCH',
          subtype: 'priority',
          configuration: { field: 'priority', operator: 'EQUALS', value: 'HIGH' },
          parentId: 'b1',
          branchKey: 'else',
          order: 1,
        },
        {
          id: 'a2',
          nodeType: 'ACTION',
          subtype: 'UNASSIGN_USER',
          parentId: 'b2',
          branchKey: 'match',
          order: 0,
        },
        {
          id: 'a3',
          nodeType: 'ACTION',
          subtype: 'ADD_COMMENT',
          configuration: { body: 'Neither matched' },
          parentId: 'b2',
          branchKey: 'else',
          order: 1,
        },
      ]);

      const response = await readDefinition(scope, ruleId).expect(200);
      const branches = response.body.data.definition.branches as Branch[];

      expect(branches.map((branch) => [branch.type, branch.position])).toEqual([
        ['PRIMARY', 0],
        ['OTHERWISE_IF', 1],
        ['OTHERWISE', 2],
      ]);
      expect(branches.map((branch) => branch.actions.map((action) => action.actionType))).toEqual([
        ['CLEAR_DUE_DATE'],
        ['UNASSIGN_USER'],
        ['ADD_COMMENT'],
      ]);
      /* The model refuses a condition on OTHERWISE, and the tree never gave it
       * one — so the conversion must not invent one. */
      expect(branches[2]?.conditionGroup).toBeNull();
    });

    /* Converting on every read would give the builder a new set of ids each
     * time and quietly discard whatever had been saved into the draft. */
    it('converts once, and reads the same draft afterwards', async () => {
      const scope = await setupScope();
      const ruleId = await legacyRule(scope, [
        { nodeType: 'TRIGGER', subtype: 'TASK_MOVED_TO_SECTION', configuration: {} },
        { nodeType: 'ACTION', subtype: 'CLEAR_DUE_DATE', configuration: {} },
      ]);

      const first = await readDefinition(scope, ruleId).expect(200);
      const second = await readDefinition(scope, ruleId).expect(200);

      expect(second.body.data.definition.version).toBe(first.body.data.definition.version);
      expect(second.body.data.definition.branches[0].id).toBe(
        first.body.data.definition.branches[0].id,
      );
      expect(await context.prisma.automationRuleVersion.count({ where: { ruleId } })).toBe(1);
    });

    /* The node tree is what live rules still run from, and Phase 1 of the plan
     * is that nothing is dropped. */
    it('leaves the node tree exactly as it was', async () => {
      const scope = await setupScope();
      const ruleId = await legacyRule(scope, [
        { nodeType: 'TRIGGER', subtype: 'TASK_MOVED_TO_SECTION', configuration: {} },
        { nodeType: 'ACTION', subtype: 'CLEAR_DUE_DATE', configuration: {} },
      ]);

      const before = await context.prisma.automationNode.count({ where: { ruleId } });
      await readDefinition(scope, ruleId).expect(200);

      expect(await context.prisma.automationNode.count({ where: { ruleId } })).toBe(before);
    });

    it('does not find a rule from another workspace', async () => {
      const scope = await setupScope();
      const ruleId = await bareRule(scope);

      const foreign = await request(server())
        .get(
          url(
            `/workspaces/${scope.workspaceId}/projects/${scope.projectId}/automations/${ruleId}/definition`,
          ),
        )
        .set('Authorization', `Bearer ${scope.outsider.token}`);

      expect(foreign.status).toBe(403);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Saving                                                                    */
  /* ------------------------------------------------------------------------ */

  describe('saving a draft', () => {
    /* A builder that would not let you stop halfway is a builder nobody can
     * use, so an unfinished rule saves and blocks only the publish. */
    it('saves a rule that is not finished, and says why it cannot be published', async () => {
      const scope = await setupScope();
      const ruleId = await bareRule(scope);

      const response = await saveDefinition(
        scope,
        ruleId,
        completeDefinition(scope, [
          {
            id: 'branch-primary',
            type: 'PRIMARY',
            position: 0,
            conditionGroup: null,
            actions: [],
          },
        ]),
      ).expect(200);

      expect(response.body.data.publishable).toBe(false);
      expect(response.body.data.issues.length).toBeGreaterThan(0);
      expect(response.body.data.definition.branches).toHaveLength(1);
    });

    it('saves a complete rule and reports it as publishable', async () => {
      const scope = await setupScope();
      const ruleId = await bareRule(scope);

      const response = await saveDefinition(scope, ruleId, completeDefinition(scope)).expect(200);

      expect(response.body.data.issues).toEqual([]);
      expect(response.body.data.publishable).toBe(true);
    });

    it('reads back what was saved, on a fresh request', async () => {
      const scope = await setupScope();
      const ruleId = await bareRule(scope);

      await saveDefinition(scope, ruleId, completeDefinition(scope)).expect(200);
      const response = await readDefinition(scope, ruleId).expect(200);

      const branches = response.body.data.definition.branches as Branch[];
      expect(branches[0]?.conditionGroup?.conditions[0]?.value).toBe(scope.sectionId);
      expect(branches[0]?.actions[0]?.configuration['userId']).toBe(scope.owner.userId);
    });

    /*
     * The rule's trigger columns are what the matcher reads, so they describe
     * what is running. Moving them on a draft save would make a live rule start
     * firing on a different event the moment somebody typed.
     */
    it('does not move the running rule’s trigger', async () => {
      const scope = await setupScope();
      const ruleId = await bareRule(scope);

      await saveDefinition(scope, ruleId, {
        ...completeDefinition(scope),
        trigger: { type: 'TASK_COMPLETED', configuration: {} },
      }).expect(200);

      const rule = await context.prisma.automationRule.findUniqueOrThrow({ where: { id: ruleId } });
      expect(rule.triggerType).toBe('TASK_MOVED_TO_SECTION');
    });

    describe('refuses a rule that is wrong rather than unfinished', () => {
      const refusal = async (scope: Scope, branches: unknown[]) => {
        const ruleId = await bareRule(scope);
        const response = await saveDefinition(scope, ruleId, completeDefinition(scope, branches));

        expect(response.status).toBe(400);
        return response.body.error.details.issues as { message: string }[];
      };

      const primary = (scope: Scope, position = 0) => ({
        id: `branch-${position}`,
        type: 'PRIMARY',
        position,
        conditionGroup: {
          id: `group-${position}`,
          operator: 'ALL',
          conditions: [condition(scope)],
        },
        actions: [assignOwner(scope)],
      });

      it('two “Check if” branches', async () => {
        const scope = await setupScope();
        const issues = await refusal(scope, [primary(scope, 0), primary(scope, 1)]);

        expect(issues).toContainEqual(
          expect.objectContaining({ message: expect.stringContaining('exactly one') }),
        );
      });

      it('no “Check if” branch at all', async () => {
        const scope = await setupScope();
        const issues = await refusal(scope, [{ ...primary(scope, 0), type: 'OTHERWISE_IF' }]);

        expect(issues).toContainEqual(
          expect.objectContaining({ message: expect.stringContaining('exactly one') }),
        );
      });

      it('an “Otherwise” that is not last', async () => {
        const scope = await setupScope();
        const issues = await refusal(scope, [
          primary(scope, 0),
          {
            id: 'b-1',
            type: 'OTHERWISE',
            position: 1,
            conditionGroup: null,
            actions: [assignOwner(scope)],
          },
          { ...primary(scope, 2), type: 'OTHERWISE_IF' },
        ]);

        expect(issues).toContainEqual(
          expect.objectContaining({ message: expect.stringContaining('come last') }),
        );
      });

      it('two “Otherwise” branches', async () => {
        const scope = await setupScope();
        const issues = await refusal(scope, [
          primary(scope, 0),
          {
            id: 'b-1',
            type: 'OTHERWISE',
            position: 1,
            conditionGroup: null,
            actions: [assignOwner(scope)],
          },
          {
            id: 'b-2',
            type: 'OTHERWISE',
            position: 2,
            conditionGroup: null,
            actions: [assignOwner(scope)],
          },
        ]);

        expect(issues).toContainEqual(
          expect.objectContaining({ message: expect.stringContaining('only have one') }),
        );
      });

      it('an “Otherwise” carrying its own conditions', async () => {
        const scope = await setupScope();
        const issues = await refusal(scope, [
          primary(scope, 0),
          { ...primary(scope, 1), type: 'OTHERWISE' },
        ]);

        expect(issues).toContainEqual(
          expect.objectContaining({ message: expect.stringContaining('cannot have its own') }),
        );
      });

      it('branch positions with a gap in them', async () => {
        const scope = await setupScope();
        const issues = await refusal(scope, [
          primary(scope, 0),
          { ...primary(scope, 3), type: 'OTHERWISE_IF' },
        ]);

        expect(issues).toContainEqual(
          expect.objectContaining({ message: expect.stringContaining('valid order') }),
        );
      });

      it('action positions with a gap in them', async () => {
        const scope = await setupScope();
        const issues = await refusal(scope, [
          { ...primary(scope, 0), actions: [assignOwner(scope, 0), assignOwner(scope, 4)] },
        ]);

        expect(issues).toContainEqual(
          expect.objectContaining({ message: expect.stringContaining('actions in this branch') }),
        );
      });

      it('an action the engine has no code for', async () => {
        const scope = await setupScope();
        const issues = await refusal(scope, [
          {
            ...primary(scope, 0),
            actions: [{ id: 'a-0', actionType: 'LAUNCH_ROCKET', configuration: {}, position: 0 }],
          },
        ]);

        expect(issues).toContainEqual(
          expect.objectContaining({ message: expect.stringContaining('LAUNCH_ROCKET') }),
        );
      });

      /*
       * A rule that moves a task into another project's section is not broken —
       * it is a way of reaching across a tenant boundary, using an automation
       * as the thing that does the reaching.
       */
      it('a section from another project in the same workspace', async () => {
        const scope = await setupScope();
        const issues = await refusal(scope, [
          {
            ...primary(scope, 0),
            actions: [
              {
                id: 'a-0',
                actionType: 'MOVE_TO_SECTION',
                configuration: { sectionId: scope.siblingSectionId },
                position: 0,
              },
            ],
          },
        ]);

        expect(issues).toContainEqual(
          expect.objectContaining({ message: expect.stringContaining('not in this project') }),
        );
      });

      it('a section from another workspace entirely', async () => {
        const scope = await setupScope();
        const issues = await refusal(scope, [
          {
            ...primary(scope, 0),
            actions: [
              {
                id: 'a-0',
                actionType: 'MOVE_TO_SECTION',
                configuration: { sectionId: scope.foreignSectionId },
                position: 0,
              },
            ],
          },
        ]);

        expect(issues).toContainEqual(
          expect.objectContaining({ message: expect.stringContaining('not in this project') }),
        );
      });

      it('a person who is not a member of this workspace', async () => {
        const scope = await setupScope();
        const issues = await refusal(scope, [
          {
            ...primary(scope, 0),
            actions: [
              {
                id: 'a-0',
                actionType: 'ASSIGN_USER',
                configuration: { userId: scope.outsider.userId },
                position: 0,
              },
            ],
          },
        ]);

        expect(issues).toContainEqual(
          expect.objectContaining({ message: expect.stringContaining('not a member') }),
        );
      });

      /* The condition's value is scoped as tightly as an action's, since a
       * condition on another project's section is the same reach in reverse. */
      it('a condition comparing against another project’s section', async () => {
        const scope = await setupScope();
        const issues = await refusal(scope, [
          {
            ...primary(scope, 0),
            conditionGroup: {
              id: 'group-0',
              operator: 'ALL',
              conditions: [{ ...condition(scope), value: scope.foreignSectionId }],
            },
          },
        ]);

        expect(issues).toContainEqual(
          expect.objectContaining({ message: expect.stringContaining('not in this project') }),
        );
      });
    });

    it('reorders branches and actions, and keeps the new order', async () => {
      const scope = await setupScope();
      const ruleId = await bareRule(scope);

      const twoBranches = (flip: boolean) => [
        {
          id: 'branch-primary',
          type: 'PRIMARY',
          position: 0,
          conditionGroup: { id: 'group-1', operator: 'ALL', conditions: [condition(scope)] },
          actions: [
            {
              id: 'action-a',
              actionType: flip ? 'CLEAR_DUE_DATE' : 'UNASSIGN_USER',
              configuration: {},
              position: 0,
            },
            {
              id: 'action-b',
              actionType: flip ? 'UNASSIGN_USER' : 'CLEAR_DUE_DATE',
              configuration: {},
              position: 1,
            },
          ],
        },
        {
          id: 'branch-second',
          type: flip ? 'OTHERWISE' : 'OTHERWISE_IF',
          position: 1,
          conditionGroup: flip
            ? null
            : { id: 'group-2', operator: 'ANY', conditions: [condition(scope)] },
          actions: [assignOwner(scope)],
        },
      ];

      await saveDefinition(scope, ruleId, completeDefinition(scope, twoBranches(false))).expect(
        200,
      );
      await saveDefinition(scope, ruleId, completeDefinition(scope, twoBranches(true))).expect(200);

      const response = await readDefinition(scope, ruleId).expect(200);
      const branches = response.body.data.definition.branches as Branch[];

      expect(branches.map((branch) => branch.type)).toEqual(['PRIMARY', 'OTHERWISE']);
      expect(branches[0]?.actions.map((action) => [action.actionType, action.position])).toEqual([
        ['CLEAR_DUE_DATE', 0],
        ['UNASSIGN_USER', 1],
      ]);
      /* Replaced wholesale, so the old branch's rows are gone rather than
       * orphaned beside the new ones. */
      expect(await context.prisma.automationBranch.count()).toBe(2);
    });

    /* Order is asked of `position`, never of the array — a client that
     * serialises its branches some other way is still saving a rule that runs. */
    it('takes the order from position rather than from the array', async () => {
      const scope = await setupScope();
      const ruleId = await bareRule(scope);

      await saveDefinition(
        scope,
        ruleId,
        completeDefinition(scope, [
          {
            id: 'b-1',
            type: 'OTHERWISE',
            position: 1,
            conditionGroup: null,
            actions: [assignOwner(scope)],
          },
          {
            id: 'b-0',
            type: 'PRIMARY',
            position: 0,
            conditionGroup: { id: 'g-0', operator: 'ALL', conditions: [condition(scope)] },
            actions: [assignOwner(scope)],
          },
        ]),
      ).expect(200);

      const response = await readDefinition(scope, ruleId).expect(200);
      expect(
        (response.body.data.definition.branches as Branch[]).map((branch) => branch.type),
      ).toEqual(['PRIMARY', 'OTHERWISE']);
    });

    it('refuses a body that is not a rule definition', async () => {
      const scope = await setupScope();
      const ruleId = await bareRule(scope);

      await saveDefinition(scope, ruleId, { name: '', branches: [] }).expect(422);
    });

    it('refuses a save from somebody who cannot manage automations', async () => {
      const scope = await setupScope();
      const ruleId = await bareRule(scope);

      await saveDefinition(scope, ruleId, completeDefinition(scope), scope.member).expect(403);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Publishing                                                                */
  /* ------------------------------------------------------------------------ */

  describe('publishing', () => {
    const refuseToPublish = async (scope: Scope, branches: unknown[]) => {
      const ruleId = await bareRule(scope);

      await saveDefinition(scope, ruleId, completeDefinition(scope, branches)).expect(200);
      const response = await publishDefinition(scope, ruleId);

      expect(response.status).toBe(400);
      return response.body.error.details.issues as { message: string }[];
    };

    it('refuses a “Check if” branch with no conditions', async () => {
      const scope = await setupScope();
      const issues = await refuseToPublish(scope, [
        {
          id: 'b-0',
          type: 'PRIMARY',
          position: 0,
          conditionGroup: null,
          actions: [assignOwner(scope)],
        },
      ]);

      expect(issues).toContainEqual(
        expect.objectContaining({ message: expect.stringContaining('what this branch checks') }),
      );
    });

    it('refuses a branch with an empty condition group', async () => {
      const scope = await setupScope();
      const issues = await refuseToPublish(scope, [
        {
          id: 'b-0',
          type: 'PRIMARY',
          position: 0,
          conditionGroup: { id: 'g-0', operator: 'ALL', conditions: [] },
          actions: [assignOwner(scope)],
        },
      ]);

      expect(issues).toContainEqual(
        expect.objectContaining({ message: expect.stringContaining('at least one condition') }),
      );
    });

    /* A branch that matches and then does nothing is indistinguishable at run
     * time from one that never matched. */
    it('refuses a branch with no actions', async () => {
      const scope = await setupScope();
      const issues = await refuseToPublish(scope, [
        {
          id: 'b-0',
          type: 'PRIMARY',
          position: 0,
          conditionGroup: { id: 'g-0', operator: 'ALL', conditions: [condition(scope)] },
          actions: [],
        },
      ]);

      expect(issues).toContainEqual(
        expect.objectContaining({ message: expect.stringContaining('at least one action') }),
      );
    });

    it('refuses an action that has not been set up', async () => {
      const scope = await setupScope();
      const issues = await refuseToPublish(scope, [
        {
          id: 'b-0',
          type: 'PRIMARY',
          position: 0,
          conditionGroup: { id: 'g-0', operator: 'ALL', conditions: [condition(scope)] },
          actions: [{ id: 'a-0', actionType: 'MOVE_TO_SECTION', configuration: {}, position: 0 }],
        },
      ]);

      expect(issues).toContainEqual(
        expect.objectContaining({ message: expect.stringContaining('still needs to be set up') }),
      );
    });

    it('makes the rule live and records which version is running', async () => {
      const scope = await setupScope();
      const ruleId = await bareRule(scope);

      await saveDefinition(scope, ruleId, completeDefinition(scope)).expect(200);
      const response = await publishDefinition(scope, ruleId).expect(200);

      expect(response.body.data.definition.status).toBe(AutomationRuleStatus.ACTIVE);
      expect(response.body.data.definition.publishedVersion).toBe(1);
      expect(response.body.data.definition.publishedAt).not.toBeNull();

      const rule = await context.prisma.automationRule.findUniqueOrThrow({ where: { id: ruleId } });
      expect(rule.status).toBe(AutomationRuleStatus.ACTIVE);
      expect(rule.publishedVersionId).not.toBeNull();
    });

    /* The denormalised trigger is what the matcher's indexed query reads, so it
     * has to describe the version that is now running. */
    it('moves the rule’s trigger to match the version it published', async () => {
      const scope = await setupScope();
      const ruleId = await bareRule(scope);

      await saveDefinition(scope, ruleId, {
        ...completeDefinition(scope),
        trigger: { type: 'TASK_COMPLETED', configuration: {} },
      }).expect(200);
      await publishDefinition(scope, ruleId).expect(200);

      const rule = await context.prisma.automationRule.findUniqueOrThrow({ where: { id: ruleId } });
      expect(rule.triggerType).toBe('TASK_COMPLETED');
    });

    it('leaves a draft that is a different row from the one it published', async () => {
      const scope = await setupScope();
      const ruleId = await publishedRule(scope);

      const rule = await context.prisma.automationRule.findUniqueOrThrow({ where: { id: ruleId } });

      expect(rule.draftVersionId).not.toBeNull();
      expect(rule.draftVersionId).not.toBe(rule.publishedVersionId);
    });

    /*
     * The point of versions, stated as a test: after a publish, editing has to
     * be incapable of reaching what is running. If this ever fails, a person
     * typing into the builder is changing a rule that is acting on real tasks.
     */
    it('does not change the published version when the draft is edited afterwards', async () => {
      const scope = await setupScope();
      const ruleId = await publishedRule(scope);

      const before = await context.prisma.automationRule.findUniqueOrThrow({
        where: { id: ruleId },
      });
      const publishedId = before.publishedVersionId ?? '';

      const publishedBefore = await context.prisma.automationBranch.findMany({
        where: { ruleVersionId: publishedId },
        include: { actions: true, conditionGroup: { include: { conditions: true } } },
        orderBy: { position: 'asc' },
      });

      await saveDefinition(
        scope,
        ruleId,
        completeDefinition(scope, [
          {
            id: 'branch-primary',
            type: 'PRIMARY',
            position: 0,
            conditionGroup: { id: 'group-1', operator: 'ANY', conditions: [condition(scope)] },
            actions: [
              { id: 'action-0', actionType: 'CLEAR_DUE_DATE', configuration: {}, position: 0 },
              { id: 'action-1', actionType: 'UNASSIGN_USER', configuration: {}, position: 1 },
            ],
          },
        ]),
      ).expect(200);

      const after = await context.prisma.automationRule.findUniqueOrThrow({
        where: { id: ruleId },
      });
      const publishedAfter = await context.prisma.automationBranch.findMany({
        where: { ruleVersionId: publishedId },
        include: { actions: true, conditionGroup: { include: { conditions: true } } },
        orderBy: { position: 'asc' },
      });

      expect(after.publishedVersionId).toBe(publishedId);
      expect(publishedAfter).toEqual(publishedBefore);
      expect(publishedAfter[0]?.conditionGroup?.operator).toBe('ALL');
      expect(publishedAfter[0]?.actions.map((action) => action.actionType)).toEqual([
        'ASSIGN_USER',
      ]);
    });

    it('keeps every published version as history', async () => {
      const scope = await setupScope();
      const ruleId = await publishedRule(scope);

      const first = await context.prisma.automationRule.findUniqueOrThrow({
        where: { id: ruleId },
      });

      await saveDefinition(
        scope,
        ruleId,
        completeDefinition(scope, [
          {
            id: 'branch-primary',
            type: 'PRIMARY',
            position: 0,
            conditionGroup: { id: 'group-1', operator: 'ALL', conditions: [condition(scope)] },
            actions: [
              { id: 'action-0', actionType: 'CLEAR_DUE_DATE', configuration: {}, position: 0 },
            ],
          },
        ]),
      ).expect(200);
      await publishDefinition(scope, ruleId).expect(200);

      const second = await context.prisma.automationRule.findUniqueOrThrow({
        where: { id: ruleId },
      });

      expect(second.publishedVersionId).not.toBe(first.publishedVersionId);
      expect(
        await context.prisma.automationRuleVersion.count({
          where: { id: first.publishedVersionId ?? '' },
        }),
      ).toBe(1);
    });

    it('refuses a publish from somebody who cannot manage automations', async () => {
      const scope = await setupScope();
      const ruleId = await bareRule(scope);

      await saveDefinition(scope, ruleId, completeDefinition(scope)).expect(200);
      await publishDefinition(scope, ruleId, scope.member).expect(403);
    });

    /* Deleting the section a published rule names does not break the rule; it
     * stops it being republishable, which is what the builder has to show. */
    it('refuses to republish a rule whose section has since been deleted', async () => {
      const scope = await setupScope();
      const ruleId = await publishedRule(scope);

      await context.prisma.section.delete({ where: { id: scope.sectionId } });

      const response = await publishDefinition(scope, ruleId);
      expect(response.status).toBe(400);
    });
  });
});
