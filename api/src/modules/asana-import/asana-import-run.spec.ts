import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';

import type { PrismaService } from '../../database/prisma.service';
import {
  AsanaApiError,
  type AsanaApiClient,
  type AsanaParams,
} from '../../integrations/asana/asana-api.client';
import type { StorageService } from '../../integrations/storage/storage.service';

import { AsanaImportRun, pool, readableError, changeLine, historyId } from './asana-import-run';
import { AsanaLiveSyncService } from './asana-live-sync.service';

// ---------------------------------------------------------------------------
// An in-memory stand-in for the Prisma calls the importer makes
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

/** Composite keys `createMany({ skipDuplicates })` and `upsert` match on. */
const UNIQUE: Record<string, string[][]> = {
  user: [['email']],
  workspaceMember: [['workspaceId', 'userId']],
  teamMember: [['teamId', 'userId']],
  projectMember: [['projectId', 'userId']],
  projectCustomField: [['projectId', 'customFieldId']],
  taskCustomFieldValue: [['taskId', 'customFieldId']],
  taskProject: [['taskId', 'projectId']],
  taskTag: [['taskId', 'tagId']],
  tag: [['workspaceId', 'nameKey']],
  follower: [['taskId', 'userId']],
  taskLike: [['taskId', 'userId']],
  commentMention: [['commentId', 'userId']],
  commentLike: [['commentId', 'userId']],
  portfolioProject: [['portfolioId', 'projectId']],
  taskDependency: [['blockedTaskId', 'blockingTaskId']],
  externalRef: [['workspaceId', 'source', 'entityType', 'externalId']],
  activityLog: [['id']],
};

function notFound(): Error {
  return new Prisma.PrismaClientKnownRequestError('Record not found', {
    code: 'P2025',
    clientVersion: 'test',
  });
}

/** `{ a_b: { a, b } }` and `{ a: 1 }` alike become a flat set of conditions. */
function flatten(where: Row = {}): Row {
  const flat: Row = {};
  for (const [key, value] of Object.entries(where)) {
    const isCompound =
      key.includes('_') && value !== null && typeof value === 'object' && !Array.isArray(value);
    if (isCompound) Object.assign(flat, value as Row);
    else flat[key] = value;
  }
  return flat;
}

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(flatten(where)).every(([key, condition]) => {
    const value = row[key];
    // A column never written reads as null, as it does in the database.
    if (condition === null) return value === null || value === undefined;
    if (condition !== null && typeof condition === 'object' && !(condition instanceof Date)) {
      const operator = condition as { in?: unknown[]; not?: unknown; gt?: Date; lt?: Date };
      if ('in' in operator) return (operator.in ?? []).includes(value);
      if ('not' in operator) {
        return operator.not === null
          ? value !== null && value !== undefined
          : value !== operator.not;
      }
      if ('gt' in operator) return value instanceof Date && value > (operator.gt as Date);
      if ('lt' in operator) return value instanceof Date && value < (operator.lt as Date);
      return false;
    }
    return value === condition;
  });
}

class FakeTable {
  rows: Row[] = [];

  constructor(private readonly name: string) {}

  private sameKey(a: Row, b: Row): boolean {
    return (UNIQUE[this.name] ?? []).some((fields) =>
      fields.every((field) => a[field] === b[field]),
    );
  }

  private insert(data: Row): Row {
    const row: Row = Object.fromEntries(
      Object.entries(data).filter(([, value]) => value !== undefined),
    );
    row['id'] ??= randomUUID();
    row['createdAt'] ??= new Date();
    if (this.rows.some((existing) => this.sameKey(existing, row))) {
      throw new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: 'test',
      });
    }
    this.rows.push(row);
    return row;
  }

  findUnique = async ({ where }: { where: Row }) =>
    this.rows.find((row) => matches(row, where)) ?? null;
  findUniqueOrThrow = async ({ where }: { where: Row }) => {
    const row = this.rows.find((candidate) => matches(candidate, where));
    if (!row) throw notFound();
    return row;
  };
  findFirst = async ({ where }: { where?: Row } = {}) =>
    this.rows.find((row) => matches(row, where)) ?? null;
  findMany = async ({ where, distinct }: { where?: Row; distinct?: string[] } = {}) => {
    const found = this.rows.filter((row) => matches(row, where));
    if (!distinct) return found;
    const seen = new Set<string>();
    return found.filter((row) => {
      const key = distinct.map((field) => String(row[field])).join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  count = async ({ where }: { where?: Row } = {}) =>
    this.rows.filter((row) => matches(row, where)).length;
  create = async ({ data }: { data: Row }) => this.insert(data);
  createMany = async ({ data }: { data: Row[] }) => {
    let count = 0;
    for (const row of data) {
      if (this.rows.some((existing) => this.sameKey(existing, row))) continue;
      this.insert(row);
      count += 1;
    }
    return { count };
  };
  update = async ({ where, data }: { where: Row; data: Row }) => {
    const row = this.rows.find((candidate) => matches(candidate, where));
    if (!row) throw notFound();
    Object.assign(row, data);
    return row;
  };
  updateMany = async ({ where, data }: { where: Row; data: Row }) => {
    const found = this.rows.filter((row) => matches(row, where));
    for (const row of found) Object.assign(row, data);
    return { count: found.length };
  };
  upsert = async ({ where, create, update }: { where: Row; create: Row; update: Row }) => {
    const row = this.rows.find((candidate) => matches(candidate, where));
    if (row) return Object.assign(row, update);
    return this.insert(create);
  };
  aggregate = async ({ where, _max }: { where?: Row; _max: Record<string, boolean> }) => {
    const found = this.rows.filter((row) => matches(row, where));
    const max = Object.fromEntries(
      Object.keys(_max).map((field) => {
        const values = found
          .map((row) => row[field])
          .filter((v): v is number => typeof v === 'number');
        return [field, values.length ? Math.max(...values) : null];
      }),
    );
    return { _max: max };
  };
  deleteMany = async ({ where }: { where: Row }) => {
    const before = this.rows.length;
    this.rows = this.rows.filter((row) => !matches(row, where));
    return { count: before - this.rows.length };
  };
}

function fakePrisma() {
  const tables = new Map<string, FakeTable>();
  const table = (name: string) => {
    if (!tables.has(name)) tables.set(name, new FakeTable(name));
    return tables.get(name) as FakeTable;
  };
  const prisma = new Proxy({}, { get: (_target, name: string) => table(name) });
  return { prisma: prisma as unknown as PrismaService, table };
}

// ---------------------------------------------------------------------------
// A small Asana organisation
// ---------------------------------------------------------------------------

const WS = '100';

function organisation() {
  const task1 = {
    gid: 'T1',
    name: 'Fix the boiler',
    resource_subtype: 'default_task',
    html_notes:
      '<body>Call <a data-asana-gid="U2" data-asana-type="user">@Bob</a> first\nThen order parts</body>',
    completed: false,
    assignee: { gid: 'U2' },
    due_on: '2026-11-01',
    created_at: '2026-10-01T10:00:00.000Z',
    created_by: { gid: 'U1' },
    num_subtasks: 1,
    memberships: [
      { project: { gid: 'P1' }, section: { gid: 'S1' } },
      { project: { gid: 'P2' }, section: null },
    ],
    tags: [],
    followers: [{ gid: 'U1' }, { gid: 'U2' }],
    likes: [{ user: { gid: 'U1' } }],
    dependencies: [{ gid: 'T2' }],
    custom_type: { gid: 'CT', name: 'Ticket' },
    custom_fields: [
      { gid: 'F1', resource_subtype: 'enum', enum_value: { gid: 'O2' } },
      { gid: 'F2', resource_subtype: 'text', text_value: 'Unit 4B' },
      { gid: 'F3', resource_subtype: 'reference', display_value: 'Acme Holdings' },
    ],
  };
  const task2 = {
    gid: 'T2',
    name: 'Order parts',
    completed: true,
    completed_at: '2026-10-02T12:00:00.000Z',
    num_subtasks: 0,
    memberships: [{ project: { gid: 'P1' }, section: { gid: 'S2' } }],
    custom_fields: [{ gid: 'F2', resource_subtype: 'text', text_value: null }],
  };

  return {
    tasks: { T1: task1, T2: task2 } as Record<string, Row>,
    routes: (path: string, params: AsanaParams): unknown[] => {
      switch (path) {
        case `/workspaces/${WS}/workspace_memberships`:
          return [
            {
              gid: 'M1',
              user: { gid: 'U1', name: 'Ada Lovelace', email: 'Ada@Example.com' },
              is_admin: true,
            },
            { gid: 'M2', user: { gid: 'U2', name: 'Bob Builder', email: 'bob@example.com' } },
          ];
        case `/workspaces/${WS}/teams`:
          return [{ gid: 'TEAM1', name: 'Leasing' }];
        case '/teams/TEAM1/users':
          return [{ gid: 'U1' }, { gid: 'U2' }];
        case `/workspaces/${WS}/custom_fields`:
          return [
            {
              gid: 'F1',
              name: 'Priority',
              resource_subtype: 'enum',
              enum_options: [
                { gid: 'O1', name: 'Low', color: 'green', enabled: true },
                { gid: 'O2', name: 'High', color: 'red', enabled: true },
              ],
            },
            { gid: 'F2', name: 'Unit', resource_subtype: 'text' },
            { gid: 'F3', name: 'Client record', resource_subtype: 'reference' },
          ];
        case `/workspaces/${WS}/tags`:
          return [];
        case '/projects':
          return params['archived'] === true
            ? [
                {
                  gid: 'P2',
                  name: 'Old leases',
                  archived: true,
                  privacy_setting: 'public_to_workspace',
                },
              ]
            : [
                {
                  gid: 'P1',
                  name: 'Maintenance',
                  color: 'dark-green',
                  privacy_setting: 'private',
                  owner: { gid: 'U1' },
                  team: { gid: 'TEAM1' },
                  html_notes: '<body>Repairs</body>',
                },
              ];
        case '/memberships':
          return params['parent'] === 'P1'
            ? [
                { gid: 'PM1', member: { gid: 'U1', resource_type: 'user' }, access_level: 'admin' },
                {
                  gid: 'PM2',
                  member: { gid: 'TEAM1', resource_type: 'team' },
                  access_level: 'editor',
                },
              ]
            : [];
        case '/projects/P1/sections':
          return [
            { gid: 'S1', name: 'To do' },
            { gid: 'S2', name: 'Done' },
          ];
        case '/projects/P2/sections':
          return [{ gid: 'S3', name: 'Untitled section' }];
        case '/projects/P1/custom_field_settings':
          return [
            { gid: 'CFS1', custom_field: { gid: 'F1' } },
            { gid: 'CFS2', custom_field: { gid: 'F2' } },
            { gid: 'CFS3', custom_field: { gid: 'F3' } },
          ];
        case '/projects/P2/custom_field_settings':
        case '/status_updates':
        case '/portfolios':
          return [];
        case '/task_templates':
          return params['project'] === 'P1'
            ? [
                {
                  gid: 'TT1',
                  name: 'New hire',
                  created_by: { gid: 'U2' },
                  template: {
                    name: 'Onboard a new hire',
                    html_description: '<body>Welcome aboard</body>',
                    relative_due_on: 5,
                    task_resource_subtype: 'default_task',
                    subtasks: [{ name: 'Laptop' }, { name: 'Badge' }],
                  },
                },
              ]
            : [];
        case '/tasks':
          return params['project'] === 'P1' ? [task1, task2] : [task1];
        case '/tasks/T1/subtasks':
          return [{ gid: 'ST1', name: 'Check pressure', num_subtasks: 1, assignee: { gid: 'U2' } }];
        case '/tasks/ST1/subtasks':
          return [{ gid: 'SST1', name: 'Write down the reading', num_subtasks: 0 }];
        case '/tasks/T1/stories':
          return [
            { gid: 'ST-sys', resource_subtype: 'assigned', text: 'assigned to Bob' },
            {
              gid: 'C1',
              resource_subtype: 'comment_added',
              html_text:
                '<body>Thanks <a data-asana-gid="U2" data-asana-type="user">@Bob</a></body>',
              created_at: '2026-10-03T08:00:00.000Z',
              created_by: { gid: 'U1', name: 'Ada Lovelace' },
              likes: [{ user: { gid: 'U2' } }],
            },
            {
              gid: 'C2',
              resource_subtype: 'comment_added',
              text: 'From a contractor',
              created_by: { gid: 'X9', name: 'Outside Contractor' },
            },
            { gid: 'ST-att', resource_subtype: 'attachment_added' },
          ];
        case '/attachments':
          return [
            {
              gid: 'A1',
              name: 'boiler.png',
              host: 'asana',
              size: 9,
              download_url: 'https://files.asana.test/a1',
            },
            { gid: 'A2', name: 'Lease.pdf', host: 'gdrive', view_url: 'https://drive.test/lease' },
          ];
        default:
          if (path.endsWith('/subtasks') || path.endsWith('/stories')) return [];
          throw new Error(`Unexpected Asana call: ${path}`);
      }
    },
  };
}

type Search = (params: AsanaParams) => Row[];

function fakeAsana(routes: (path: string, params: AsanaParams) => unknown[], search?: Search) {
  const client = {
    requestCount: 0,
    list: jest.fn(async (path: string, params: AsanaParams = {}) => {
      client.requestCount += 1;
      return routes(path, params);
    }),
    get: jest.fn(async (path: string, params: AsanaParams = {}) => {
      client.requestCount += 1;
      if (path.endsWith('/tasks/search')) {
        if (search) return search(params);
        // Without `search`, this organisation has no search: a free Asana plan, refused.
        throw new AsanaApiError(path, 402, 'Search is only available to premium users.');
      }
      // One task or field, asked for by gid: the organisation answers, or refuses.
      if (/^\/(tasks|custom_fields|tags|projects)\/[^/]+$/.test(path)) return routes(path, params);
      // The contractor is not in the workspace, and Asana will not say who they are.
      throw new Error(`Not found: ${path}`);
    }),
    download: jest.fn(async () => ({ body: Buffer.from('png-bytes'), contentType: 'image/png' })),
  };
  return client;
}

function fakeStorage() {
  return {
    maxFileSizeBytes: 25 * 1024 * 1024,
    assertUploadAllowed: jest.fn(),
    buildObjectKey: jest.fn(
      (workspaceId: string) => `workspaces/${workspaceId}/${randomUUID()}.png`,
    ),
    putObject: jest.fn(async () => undefined),
  };
}

const logger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };

async function setUp() {
  const db = fakePrisma();
  const workspaceId = randomUUID();
  const starter = await db
    .table('user')
    .create({ data: { email: 'ada@example.com', name: 'Ada L.' } });
  await db.table('workspaceMember').create({
    data: { workspaceId, userId: starter['id'], role: 'OWNER' },
  });
  const run = await db.table('importRun').create({ data: { workspaceId, status: 'RUNNING' } });
  return { db, workspaceId, starterId: starter['id'] as string, runId: run['id'] as string };
}

async function runImport(
  context: Awaited<ReturnType<typeof setUp>>,
  org = organisation(),
  storage = fakeStorage(),
  search?: Search,
) {
  const asana = fakeAsana(org.routes, search);
  const job = new AsanaImportRun(
    {
      prisma: context.db.prisma,
      asana: asana as unknown as AsanaApiClient,
      storage: storage as unknown as StorageService,
      logger: logger as never,
      concurrency: 3,
    },
    context.runId,
    context.workspaceId,
    WS,
    context.starterId,
  );
  const status = await job.execute();
  return { status, job, asana, storage };
}

const rows = (context: Awaited<ReturnType<typeof setUp>>, name: string) =>
  context.db.table(name).rows;

// ---------------------------------------------------------------------------

describe('AsanaImportRun', () => {
  it('brings people across by e-mail, with a placeholder for anyone without an account', async () => {
    const context = await setUp();
    const { status, job } = await runImport(context);

    expect(job.snapshot().errors).toEqual([]);
    expect(status).toBe('SUCCEEDED');

    const users = rows(context, 'user');
    expect(users).toHaveLength(2);
    const bob = users.find((user) => user['email'] === 'bob@example.com') as Row;
    expect(bob['passwordHash']).toBeNull();
    expect(bob['name']).toBe('Bob Builder');

    const roles = rows(context, 'workspaceMember')
      .map((member) => member['role'])
      .sort();
    // Ada keeps OWNER: an import never lowers the person who ran it.
    expect(roles).toEqual(['MEMBER', 'OWNER']);
    expect(rows(context, 'teamMember')).toHaveLength(2);
    expect(job.snapshot().counts['placeholders']).toEqual({ done: 1 });
  });

  it('maps projects, sections, fields and tasks the way CoreTask holds them', async () => {
    const context = await setUp();
    await runImport(context);

    const [maintenance, old] = ['Maintenance', 'Old leases'].map(
      (name) => rows(context, 'project').find((project) => project['name'] === name) as Row,
    ) as [Row, Row];
    expect(maintenance['visibility']).toBe('PRIVATE');
    expect(maintenance['color']).toBe('#22C55E');
    expect(maintenance['description']).toBe('<p>Repairs</p>');
    expect(maintenance['teamId']).toBe(rows(context, 'team')[0]?.['id']);
    expect(old['status']).toBe('ARCHIVED');
    expect(old['archivedAt']).toBeInstanceOf(Date);
    expect(rows(context, 'section').map((section) => section['name'])).toEqual([
      'To do',
      'Done',
      'Untitled section',
    ]);

    const task = rows(context, 'task').find((row) => row['title'] === 'Fix the boiler') as Row;
    const bob = rows(context, 'user').find((user) => user['email'] === 'bob@example.com') as Row;
    expect(task['projectId']).toBe(maintenance['id']);
    expect(task['sectionId']).toBe(rows(context, 'section')[0]?.['id']);
    expect(task['assigneeId']).toBe(bob['id']);
    expect(task['dueDate']).toEqual(new Date('2026-11-01T00:00:00.000Z'));
    expect(task['description']).toBe(
      `<p>Call <span data-mention="${String(bob['id'])}">@Bob Builder</span> first</p><p>Then order parts</p>` +
        '<p><strong>Linked files</strong></p><ul><li><a href="https://drive.test/lease" target="_blank" rel="noopener noreferrer">Lease.pdf</a></li></ul>',
    );
    // Also in the archived project, where Asana multi-homed it.
    expect(rows(context, 'taskProject')).toEqual([
      expect.objectContaining({ taskId: task['id'], projectId: old['id'] }),
    ]);

    const done = rows(context, 'task').find((row) => row['title'] === 'Order parts') as Row;
    expect(done['status']).toBe('DONE');
    expect(done['completedAt']).toEqual(new Date('2026-10-02T12:00:00.000Z'));

    const ticket = rows(context, 'tag').find((tag) => tag['name'] === 'Ticket') as Row;
    expect(rows(context, 'taskTag')).toEqual([
      expect.objectContaining({ taskId: task['id'], tagId: ticket['id'] }),
    ]);

    const values = rows(context, 'taskCustomFieldValue').filter(
      (value) => value['taskId'] === task['id'],
    );
    const high = rows(context, 'customFieldOption').find(
      (option) => option['label'] === 'High',
    ) as Row;
    expect(values.map((value) => value['optionIds'])).toContainEqual([high['id']]);
    expect(values.map((value) => value['textValue'])).toEqual(
      expect.arrayContaining(['Unit 4B', 'Acme Holdings']),
    );
    expect(rows(context, 'projectCustomField')).toHaveLength(3);

    expect(rows(context, 'follower')).toHaveLength(2);
    expect(rows(context, 'taskLike')).toHaveLength(1);
    expect(rows(context, 'taskDependency')).toEqual([
      expect.objectContaining({ blockedTaskId: task['id'], blockingTaskId: done['id'] }),
    ]);
  });

  it('nests subtasks one level, moving deeper ones up under the top task', async () => {
    const context = await setUp();
    const { job } = await runImport(context);

    const top = rows(context, 'task').find((row) => row['title'] === 'Fix the boiler') as Row;
    const subtasks = rows(context, 'task').filter((row) => row['parentTaskId'] === top['id']);
    expect(subtasks.map((row) => row['title']).sort()).toEqual([
      'Check pressure',
      'Write down the reading',
    ]);
    expect(
      subtasks.every((row) => row['projectId'] === top['projectId'] && row['sectionId'] === null),
    ).toBe(true);
    expect(job.snapshot().counts['flattened']).toEqual({ done: 1 });
  });

  it('keeps comments, not system history, crediting whoever wrote them', async () => {
    const context = await setUp();
    await runImport(context);

    const comments = rows(context, 'comment');
    expect(comments).toHaveLength(2);
    const fromAda = comments.find((comment) => String(comment['body']).includes('Thanks')) as Row;
    expect(fromAda['authorId']).toBe(context.starterId);
    expect(fromAda['createdAt']).toEqual(new Date('2026-10-03T08:00:00.000Z'));
    expect(rows(context, 'commentMention')).toHaveLength(1);
    expect(rows(context, 'commentLike')).toHaveLength(1);

    // Nobody to credit: posted by whoever ran it, saying whose words they are.
    const outside = comments.find((comment) =>
      String(comment['body']).includes('contractor'),
    ) as Row;
    expect(outside['body']).toBe(
      '<p><em>Outside Contractor wrote in Asana:</em></p><p>From a contractor</p>',
    );
  });

  it('copies Asana-held files into storage and links the rest', async () => {
    const context = await setUp();
    const { storage, asana } = await runImport(context);

    expect(asana.download).toHaveBeenCalledWith('https://files.asana.test/a1', 25 * 1024 * 1024);
    expect(storage.putObject).toHaveBeenCalledTimes(1);
    expect(rows(context, 'attachment')).toEqual([
      expect.objectContaining({
        filename: 'boiler.png',
        mimeType: 'image/png',
        status: 'READY',
        sizeBytes: 9,
      }),
    ]);
  });

  it('keeps every record as Asana sent it, for mapping later', async () => {
    const context = await setUp();
    const org = organisation();
    await runImport(context, org);

    const taskRef = rows(context, 'externalRef').find(
      (ref) => ref['entityType'] === 'task' && ref['externalId'] === 'T1',
    ) as Row;
    expect(taskRef['snapshot']).toEqual(org.tasks['T1']);

    const fileRef = rows(context, 'externalRef').find(
      (ref) => ref['entityType'] === 'attachment',
    ) as Row;
    // The signed download address is short-lived, so it is not kept.
    expect(fileRef['snapshot']).not.toHaveProperty('download_url');
  });

  it('updates in place when run again, instead of making a second copy', async () => {
    const context = await setUp();
    await runImport(context);
    const counts = () =>
      Object.fromEntries(
        [
          'user',
          'project',
          'section',
          'task',
          'comment',
          'attachment',
          'externalRef',
          'taskCustomFieldValue',
          'follower',
        ].map((name) => [name, rows(context, name).length]),
      );
    const before = counts();

    const org = organisation();
    (org.tasks['T1'] as Row)['name'] = 'Fix the boiler today';
    const storage = fakeStorage();
    const { status } = await runImport(context, org, storage);

    expect(status).toBe('SUCCEEDED');
    expect(counts()).toEqual(before);
    expect(rows(context, 'task').map((row) => row['title'])).toContain('Fix the boiler today');
    // The file came across the first time; it is not copied again.
    expect(storage.putObject).not.toHaveBeenCalled();
    const task = rows(context, 'task').find(
      (row) => row['title'] === 'Fix the boiler today',
    ) as Row;
    expect(String(task['description']).match(/Linked files/g)).toHaveLength(1);
  });

  /** The organisation after T1 was deleted: gone from every list, and 404 by gid. */
  function withoutT1(answer: () => unknown = () => notInAsana('T1')) {
    const org = organisation();
    const routes = org.routes;
    return {
      ...org,
      routes: (path: string, params: AsanaParams) => {
        if (path === '/tasks/T1') return answer() as unknown[];
        const result = routes(path, params);
        return path === '/tasks' ? result.filter((task) => (task as Row)['gid'] !== 'T1') : result;
      },
    };
  }

  function notInAsana(gid: string): never {
    throw new AsanaApiError(`/tasks/${gid}`, 404, 'Unknown object: ' + gid);
  }

  const taskTitled = (context: Awaited<ReturnType<typeof setUp>>, title: string) =>
    rows(context, 'task').find((row) => row['title'] === title) as Row;

  const taskRef = (context: Awaited<ReturnType<typeof setUp>>, gid: string) =>
    rows(context, 'externalRef').find(
      (ref) => ref['entityType'] === 'task' && ref['externalId'] === gid,
    ) as Row;

  it('archives a task deleted in Asana, with its subtasks, when run again', async () => {
    const context = await setUp();
    await runImport(context);

    const { status, job, asana } = await runImport(context, withoutT1());

    expect(status).toBe('SUCCEEDED');
    for (const title of ['Fix the boiler', 'Check pressure', 'Write down the reading']) {
      expect(taskTitled(context, title)['archivedAt']).toBeInstanceOf(Date);
    }
    expect(taskTitled(context, 'Order parts')['archivedAt']).toBeUndefined();
    for (const gid of ['T1', 'ST1', 'SST1']) {
      expect(taskRef(context, gid)['sourceDeletedAt']).toBeInstanceOf(Date);
    }
    // Asked about the parent only: Asana answers 403 for a deleted task's subtasks.
    const asked = asana.get.mock.calls
      .map(([path]) => path)
      .filter((path) => path.startsWith('/tasks/T') || path.startsWith('/tasks/S'));
    expect(asked).toEqual(['/tasks/T1']);
    expect(job.snapshot().counts['archived']).toEqual({ done: 3 });
    expect(rows(context, 'activityLog')).toContainEqual(
      expect.objectContaining({
        action: 'ARCHIVED',
        entity: 'TASK',
        entityId: taskTitled(context, 'Fix the boiler')['id'],
        summary: 'Archived task "Fix the boiler": deleted in Asana',
      }),
    );
  });

  it('leaves a task restored in CoreTask alone while Asana still has it deleted', async () => {
    const context = await setUp();
    await runImport(context);
    await runImport(context, withoutT1());
    taskTitled(context, 'Fix the boiler')['archivedAt'] = null;

    const { status, asana } = await runImport(context, withoutT1());

    expect(status).toBe('SUCCEEDED');
    expect(taskTitled(context, 'Fix the boiler')['archivedAt']).toBeNull();
    expect(asana.get).not.toHaveBeenCalledWith('/tasks/T1', expect.anything());
  });

  it('restores a task that comes back out of Asana’s trash', async () => {
    const context = await setUp();
    await runImport(context);
    await runImport(context, withoutT1());

    const { job } = await runImport(context);

    for (const title of ['Fix the boiler', 'Check pressure', 'Write down the reading']) {
      expect(taskTitled(context, title)['archivedAt']).toBeNull();
    }
    for (const gid of ['T1', 'ST1', 'SST1']) {
      expect(taskRef(context, gid)['sourceDeletedAt']).toBeNull();
    }
    expect(job.snapshot().counts['restored']).toEqual({ done: 3 });
  });

  /** `T1`'s rows in a linking table. */
  const ofT1 = (context: Awaited<ReturnType<typeof setUp>>, table: string) =>
    rows(context, table).filter(
      (row) => row['taskId'] === taskTitled(context, 'Fix the boiler')['id'],
    );

  /** The organisation with `T1` changed, and P1 or P2 no longer listing it if it left. */
  function withT1(change: Row) {
    const org = organisation();
    Object.assign(org.tasks['T1'] as Row, change);
    const projects = ((org.tasks['T1'] as Row)['memberships'] as Row[]).map(
      (membership) => (membership['project'] as Row)['gid'],
    );
    const routes = org.routes;
    return {
      ...org,
      routes: (path: string, params: AsanaParams) => {
        const result = routes(path, params);
        if (path !== '/tasks' || projects.includes(params['project'])) return result;
        return result.filter((task) => (task as Row)['gid'] !== 'T1');
      },
    };
  }

  it('takes off what Asana took off since the last run', async () => {
    const context = await setUp();
    await runImport(context);
    expect(ofT1(context, 'taskProject')).toHaveLength(1);
    expect(ofT1(context, 'taskTag')).toHaveLength(1);
    expect(ofT1(context, 'follower')).toHaveLength(2);
    expect(ofT1(context, 'taskLike')).toHaveLength(1);

    const { status, job } = await runImport(
      context,
      withT1({
        memberships: [{ project: { gid: 'P1' }, section: { gid: 'S1' } }],
        custom_type: null,
        followers: [{ gid: 'U1' }],
        likes: [],
      }),
    );

    expect(status).toBe('SUCCEEDED');
    expect(ofT1(context, 'taskProject')).toEqual([]);
    expect(ofT1(context, 'taskTag')).toEqual([]);
    expect(ofT1(context, 'follower').map((row) => row['userId'])).toEqual([context.starterId]);
    expect(ofT1(context, 'taskLike')).toEqual([]);
    expect(job.snapshot().counts).toMatchObject({
      unlinked: { done: 1 },
      untagged: { done: 1 },
      unfollowed: { done: 1 },
    });
  });

  it('leaves a tag or a follower added in CoreTask alone', async () => {
    const context = await setUp();
    await runImport(context);
    const taskId = taskTitled(context, 'Fix the boiler')['id'];
    const urgent = await context.db.table('tag').create({
      data: { workspaceId: context.workspaceId, name: 'Urgent', nameKey: 'urgent' },
    });
    await context.db.table('taskTag').create({ data: { taskId, tagId: urgent['id'] } });
    const cy = await context.db
      .table('user')
      .create({ data: { email: 'cy@example.com', name: 'Cy' } });
    await context.db
      .table('follower')
      .create({ data: { workspaceId: context.workspaceId, userId: cy['id'], taskId } });

    await runImport(context, withT1({ custom_type: null, followers: [{ gid: 'U1' }] }));

    expect(ofT1(context, 'taskTag').map((row) => row['tagId'])).toEqual([urgent['id']]);
    expect(
      ofT1(context, 'follower')
        .map((row) => row['userId'])
        .sort(),
    ).toEqual([context.starterId, cy['id']].sort());
  });

  it('moves a task taken out of its home project to the one it was linked to', async () => {
    const context = await setUp();
    await runImport(context);
    const p2 = rows(context, 'project').find((row) => row['name'] === 'Old leases') as Row;

    await runImport(context, withT1({ memberships: [{ project: { gid: 'P2' }, section: null }] }));

    expect(taskTitled(context, 'Fix the boiler')['projectId']).toBe(p2['id']);
    // Its home now, so no longer a link as well.
    expect(ofT1(context, 'taskProject')).toEqual([]);
  });

  it('keeps the link to a project Asana no longer lists, which the task did not leave', async () => {
    const context = await setUp();
    await runImport(context);
    const org = withT1({ memberships: [{ project: { gid: 'P1' }, section: { gid: 'S1' } }] });
    const routes = org.routes;

    // P2 made private: gone from the project list and from T1's memberships.
    const { job } = await runImport(context, {
      ...org,
      routes: (path: string, params: AsanaParams) =>
        path === '/projects' && params['archived'] === true ? [] : routes(path, params),
    });

    expect(ofT1(context, 'taskProject')).toHaveLength(1);
    expect(job.snapshot().counts['unlinked']).toBeUndefined();
  });

  it('deletes a comment deleted in Asana, and brings it back if Asana lists it again', async () => {
    const context = await setUp();
    await runImport(context);
    const taskId = taskTitled(context, 'Fix the boiler')['id'];
    const local = await context.db.table('comment').create({
      data: { workspaceId: context.workspaceId, authorId: context.starterId, taskId, body: 'Here' },
    });
    const org = organisation();
    const routes = org.routes;
    const withoutC1 = {
      ...org,
      routes: (path: string, params: AsanaParams) => {
        const result = routes(path, params);
        return path === '/tasks/T1/stories'
          ? result.filter((story) => (story as Row)['gid'] !== 'C1')
          : result;
      },
    };

    const { job } = await runImport(context, withoutC1);

    const thanks = rows(context, 'comment').find((row) =>
      String(row['body']).includes('Thanks'),
    ) as Row;
    expect(thanks['deletedAt']).toBeInstanceOf(Date);
    const others = rows(context, 'comment').filter((row) => row !== thanks);
    expect(others.map((row) => row['deletedAt'] ?? null)).toEqual([null, null]);
    expect(others).toContain(local);
    const ref = rows(context, 'externalRef').find(
      (row) => row['entityType'] === 'story' && row['externalId'] === 'C1',
    ) as Row;
    expect(ref['sourceDeletedAt']).toBeInstanceOf(Date);
    expect(job.snapshot().counts['commentsDeleted']).toEqual({ done: 1 });

    await runImport(context);

    expect(thanks['deletedAt']).toBeNull();
    expect(ref['sourceDeletedAt']).toBeNull();
  });

  it('reads a commented subtask that search no longer finds, so a deletion comes across', async () => {
    const context = await setUp();
    const org = organisation();
    const routes = org.routes;
    const withSubtaskComment = (comments: Row[]) => ({
      ...org,
      routes: (path: string, params: AsanaParams) =>
        path === '/tasks/SST1/stories' ? comments : routes(path, params),
    });
    const commentedOn =
      (found: boolean): Search =>
      (params) =>
        found && params['commented_on_by.any']
          ? [{ gid: 'SST1', created_at: '2026-10-05T00:00:00.000Z' }]
          : [];
    await runImport(
      context,
      withSubtaskComment([
        {
          gid: 'C9',
          resource_subtype: 'comment_added',
          text: 'Reading is 2 bar',
          created_by: { gid: 'U2', name: 'Bob Builder' },
        },
      ]),
      fakeStorage(),
      commentedOn(true),
    );
    const reading = rows(context, 'comment').find((row) =>
      String(row['body']).includes('2 bar'),
    ) as Row;
    expect(reading['deletedAt'] ?? null).toBeNull();

    await runImport(context, withSubtaskComment([]), fakeStorage(), commentedOn(false));

    expect(reading['deletedAt']).toBeInstanceOf(Date);
  });

  /** The organisation with Asana's record of two changes to T1. */
  function withChanges() {
    const org = organisation();
    const routes = org.routes;
    return {
      ...org,
      routes: (path: string, params: AsanaParams) => {
        const result = routes(path, params);
        if (path !== '/tasks/T1/stories') return result;
        return [
          ...result,
          {
            gid: 'H1',
            resource_subtype: 'assigned',
            text: 'Ada Lovelace assigned to Bob Builder',
            created_at: '2026-10-02T09:00:00.000Z',
            created_by: { gid: 'U1', name: 'Ada Lovelace' },
          },
          {
            gid: 'H2',
            resource_subtype: 'enum_custom_field_changed',
            text: 'Asana changed Priority to High',
            created_at: '2026-10-02T10:00:00.000Z',
            created_by: { gid: 'U1', name: 'Ada Lovelace' },
          },
        ];
      },
    };
  }

  /** Activity lines made from Asana's stories, not the run's own. */
  const fromAsana = (context: Awaited<ReturnType<typeof setUp>>) =>
    rows(context, 'activityLog').filter((row) => (row['metadata'] as Row | null)?.['story']);

  it('keeps Asana’s record of what changed on a task, once, in time order', async () => {
    const context = await setUp();
    const { job } = await runImport(context, withChanges());
    const again = await runImport(context, withChanges());

    const task = taskTitled(context, 'Fix the boiler');
    const lines = fromAsana(context).sort((a, b) => String(a['id']).localeCompare(String(b['id'])));
    expect(lines).toEqual([
      expect.objectContaining({
        entity: 'TASK',
        entityId: task['id'],
        projectId: task['projectId'],
        action: 'ASSIGNED',
        actorId: context.starterId,
        summary: 'assigned to Bob Builder',
        createdAt: new Date('2026-10-02T09:00:00.000Z'),
      }),
      // A rule's change: no person, as CoreTask shows a rule's.
      expect.objectContaining({
        action: 'UPDATED',
        actorId: null,
        summary: 'changed Priority to High',
      }),
    ]);
    expect(job.snapshot().counts['changeHistory']).toEqual({ done: 2 });
    expect(again.job.snapshot().counts['changeHistory']).toEqual({ done: 0 });
  });

  it('brings a project’s task templates, and lets one deleted in Asana go', async () => {
    const context = await setUp();
    await runImport(context);
    const p1 = rows(context, 'project').find((row) => row['name'] === 'Maintenance') as Row;
    expect(rows(context, 'taskTemplate')).toEqual([
      expect.objectContaining({
        projectId: p1['id'],
        name: 'New hire',
        title: 'Onboard a new hire',
        kind: 'TASK',
        dueInDays: 5,
        subtasks: [{ title: 'Laptop' }, { title: 'Badge' }],
      }),
    ]);
    expect(String(rows(context, 'taskTemplate')[0]?.['description'])).toContain('Welcome aboard');
    const ours = await context.db.table('taskTemplate').create({
      data: { workspaceId: context.workspaceId, projectId: p1['id'], name: 'Ours', title: 'Ours' },
    });

    const org = organisation();
    const routes = org.routes;
    await runImport(context, {
      ...org,
      routes: (path: string, params: AsanaParams) =>
        path === '/task_templates' ? [] : routes(path, params),
    });

    expect(rows(context, 'taskTemplate')).toEqual([ours]);
  });

  it('keeps a task Asana still has, or will not show, that this run did not reach', async () => {
    const context = await setUp();
    await runImport(context);

    // Moved to a project that does not come across.
    const moved = await runImport(
      context,
      withoutT1(() => ({ gid: 'T1' })),
    );
    // Moved to one the token cannot open.
    const hidden = await runImport(
      context,
      withoutT1(() => {
        throw new AsanaApiError('/tasks/T1', 403, 'Not authorized');
      }),
    );

    expect([moved.status, hidden.status]).toEqual(['SUCCEEDED', 'SUCCEEDED']);
    expect(taskTitled(context, 'Fix the boiler')['archivedAt']).toBeUndefined();
    expect(taskRef(context, 'T1')['sourceDeletedAt']).toBeUndefined();
  });

  it('does not ask about the tasks of a project Asana would not list', async () => {
    const context = await setUp();
    await runImport(context);
    const org = organisation();
    const routes = org.routes;

    const { status, asana } = await runImport(context, {
      ...org,
      routes: (path: string, params: AsanaParams) => {
        if (path === '/tasks' && params['project'] === 'P1') throw new Error('Asana timed out');
        return routes(path, params);
      },
    });

    expect(status).toBe('PARTIAL');
    // T2 is only in P1, which was not listed; T1 was reached through P2.
    expect(asana.get).not.toHaveBeenCalledWith('/tasks/T2', expect.anything());
    expect(taskTitled(context, 'Order parts')['archivedAt']).toBeUndefined();
  });

  it('imports a subtask Asana also lists in a project once, under its parent', async () => {
    const context = await setUp();
    const org = organisation();
    const routes = org.routes;
    const listedSubtask = {
      gid: 'ST1',
      name: 'Check pressure',
      num_subtasks: 1,
      parent: { gid: 'T1' },
      memberships: [{ project: { gid: 'P1' }, section: { gid: 'S2' } }],
    };
    const { job } = await runImport(context, {
      ...org,
      routes: (path: string, params: AsanaParams) => {
        const result = routes(path, params);
        return path === '/tasks' && params['project'] === 'P1'
          ? [...result, listedSubtask]
          : result;
      },
    });

    const top = rows(context, 'task').find((row) => row['title'] === 'Fix the boiler') as Row;
    const copies = rows(context, 'task').filter((row) => row['title'] === 'Check pressure');
    expect(copies).toHaveLength(1);
    expect(copies[0]?.['parentTaskId']).toBe(top['id']);
    expect(rows(context, 'task')).toHaveLength(4);
    expect(job.snapshot().counts['subtasksInProjects']).toEqual({ done: 1 });
  });

  it('creates a tag once when tasks naming it are written at the same time', async () => {
    const context = await setUp();
    const org = organisation();
    (org.tasks['T2'] as Row)['custom_type'] = { gid: 'CT', name: 'Ticket' };
    // The real database can interleave two upserts between the look and the insert.
    const tags = context.db.table('tag');
    const upsert = tags.upsert;
    tags.upsert = async (args) => {
      const existing = await tags.findUnique({ where: args.where });
      await new Promise((resolve) => setImmediate(resolve));
      return existing ? Object.assign(existing, args.update) : tags.create({ data: args.create });
    };
    const { job } = await runImport(context, org);
    tags.upsert = upsert;

    expect(job.snapshot().errors).toEqual([]);
    expect(rows(context, 'tag').filter((tag) => tag['name'] === 'Ticket')).toHaveLength(1);
    expect(rows(context, 'taskTag')).toHaveLength(2);
  });

  it('keeps a long text value to the 2,000 characters the field editor allows', async () => {
    const context = await setUp();
    const org = organisation();
    const long = 'x'.repeat(2_500);
    (org.tasks['T1'] as { custom_fields: Row[] }).custom_fields[1] = {
      gid: 'F2',
      resource_subtype: 'text',
      text_value: long,
    };
    const { job } = await runImport(context, org);

    const unit = rows(context, 'taskCustomFieldValue').find((value) =>
      String(value['textValue']).startsWith('xxx'),
    );
    expect(String(unit?.['textValue'])).toHaveLength(2_000);
    expect(job.snapshot().counts['textShortened']).toEqual({ done: 1 });
  });

  it('reads only the subtasks search says have comments or files, and every top-level task', async () => {
    const context = await setUp();
    const search: Search = (params) =>
      params['commented_on_by.any']
        ? [{ gid: 'SST1', created_at: '2026-10-05T00:00:00.000Z' }]
        : [];
    const { asana, job } = await runImport(context, organisation(), fakeStorage(), search);

    const storyCalls = asana.list.mock.calls
      .map(([path]) => path as string)
      .filter((path) => path.endsWith('/stories'));
    expect(storyCalls.sort()).toEqual([
      '/tasks/SST1/stories',
      '/tasks/T1/stories',
      '/tasks/T2/stories',
    ]);
    expect(job.snapshot().counts['historySkipped']).toEqual({ done: 1 });
    expect(job.snapshot().counts['historySearch']).toEqual({ done: 1 });
    // Both people went into the commenter search; files were searched for too.
    const searches = asana.get.mock.calls.filter(([path]) =>
      String(path).endsWith('/tasks/search'),
    );
    expect(searches.map(([, params]) => (params as AsanaParams)['commented_on_by.any'])).toContain(
      'U1,U2',
    );
    expect(searches.map(([, params]) => (params as AsanaParams)['has_attachment'])).toContain(true);
  });

  it('pages through search by creation time, dropping the overlap', async () => {
    const context = await setUp();
    const page = Array.from({ length: 100 }, (_, i) => ({
      gid: `S${i}`,
      created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
    }));
    const afters: (string | undefined)[] = [];
    const search: Search = (params) => {
      if (!params['has_attachment']) return [];
      afters.push(params['created_at.after'] as string | undefined);
      return afters.length === 1
        ? page
        : [page[99] as Row, { gid: 'S100', created_at: '2026-01-02T00:00:00.000Z' }];
    };
    const { job } = await runImport(context, organisation(), fakeStorage(), search);

    expect(afters).toEqual([undefined, '2026-01-01T00:01:38.999Z']);
    expect(job.snapshot().counts['historySearch']).toEqual({ done: 101 });
  });

  it('reads every subtask’s history when Asana refuses search', async () => {
    const context = await setUp();
    // No `search`: the fake answers 402, as Asana does on a plan without it.
    const { job, status } = await runImport(context);

    expect(status).toBe('SUCCEEDED');
    expect(job.snapshot().counts['historySearch']).toEqual({ done: 0, skipped: 1 });
  });

  it('ends the run, rather than reading every subtask, when search cannot be reached', async () => {
    const context = await setUp();
    const search: Search = () => {
      throw new TypeError('fetch failed');
    };

    await expect(runImport(context, organisation(), fakeStorage(), search)).rejects.toThrow(
      'Asana search did not answer: fetch failed',
    );
  });

  it('links a file storage refuses back to Asana, and reports it', async () => {
    const context = await setUp();
    const storage = fakeStorage();
    storage.assertUploadAllowed.mockImplementation(() => {
      throw new Error('The provided file type is not supported.');
    });
    const org = organisation();
    const routes = org.routes;
    const { job } = await runImport(
      context,
      {
        ...org,
        routes: (path: string, params: AsanaParams) =>
          path === '/attachments'
            ? routes(path, params).map((file) =>
                (file as Row)['gid'] === 'A1'
                  ? {
                      ...(file as Row),
                      permanent_url: 'https://app.asana.com/app/asana/-/get_asset?asset_id=A1',
                    }
                  : file,
              )
            : routes(path, params),
      },
      storage,
    );

    expect(rows(context, 'attachment')).toHaveLength(0);
    const task = rows(context, 'task').find((row) => row['title'] === 'Fix the boiler') as Row;
    expect(String(task['description'])).toContain('get_asset?asset_id=A1');
    expect(String(task['description'])).toContain('>boiler.png</a>');
    expect(job.snapshot().errors).toEqual([
      expect.objectContaining({
        kind: 'attachment',
        externalId: 'A1',
        message: 'The provided file type is not supported.',
      }),
    ]);
  });

  it('skips an empty file rather than reporting it or linking to it', async () => {
    const context = await setUp();
    const org = organisation();
    const routes = org.routes;
    const { job, asana, storage } = await runImport(context, {
      ...org,
      routes: (path: string, params: AsanaParams) =>
        path === '/attachments'
          ? [
              {
                gid: 'A0',
                name: 'void(0).url',
                host: 'asana',
                size: 0,
                download_url: 'https://files.asana.test/a0',
              },
            ]
          : routes(path, params),
    });

    expect(job.snapshot().errors).toEqual([]);
    expect(job.snapshot().counts['emptyFiles']).toEqual({ done: 1 });
    expect(rows(context, 'attachment')).toHaveLength(0);
    expect(asana.download).not.toHaveBeenCalled();
    expect(storage.putObject).not.toHaveBeenCalled();
    const task = rows(context, 'task').find((row) => row['title'] === 'Fix the boiler') as Row;
    expect(String(task['description'])).not.toContain('void(0).url');
  });

  it('records a failed record and carries on', async () => {
    const context = await setUp();
    const org = organisation();
    const routes = org.routes;
    const failing = {
      ...org,
      routes: (path: string, params: AsanaParams) => {
        if (path === '/tasks/T1/stories') throw new Error('Asana timed out');
        return routes(path, params);
      },
    };
    const { status, job } = await runImport(context, failing);

    expect(status).toBe('PARTIAL');
    expect(job.snapshot().errors).toEqual([
      expect.objectContaining({ kind: 'history', externalId: 'T1', message: 'Asana timed out' }),
    ]);
    expect(rows(context, 'task')).toHaveLength(4);
  });
});

describe('AsanaImportRun list layout, images and options', () => {
  const columnsOf = (context: Awaited<ReturnType<typeof setUp>>, projectName: string) => {
    const project = rows(context, 'project').find((row) => row['name'] === projectName) as Row;
    const view = rows(context, 'projectView').find(
      (row) => row['projectId'] === project['id'] && row['type'] === 'LIST',
    ) as Row | undefined;
    const settings = (view?.['settings'] ?? {}) as {
      columns?: { field: string; width?: number }[];
    };
    return settings.columns ?? [];
  };
  const fieldColumn = (context: Awaited<ReturnType<typeof setUp>>, gid: string) => {
    const ref = rows(context, 'externalRef').find(
      (row) => row['entityType'] === 'custom_field' && row['externalId'] === gid,
    ) as Row;
    return `custom:${ref['entityId'] as string}`;
  };

  it('lays a project’s List view out as Asana does, with its fields and none of CoreTask’s own', async () => {
    const context = await setUp();
    await runImport(context);

    const fields = columnsOf(context, 'Maintenance').map((column) => column.field);
    expect(fields).toEqual([
      'title',
      'assigneeId',
      'dueDate',
      fieldColumn(context, 'F1'),
      fieldColumn(context, 'F2'),
      fieldColumn(context, 'F3'),
      'tags',
    ]);
    expect(columnsOf(context, 'Old leases').map((column) => column.field)).toEqual([
      'title',
      'assigneeId',
      'dueDate',
      'tags',
    ]);
  });

  it('keeps widths and extra columns of a List view that was already there', async () => {
    const context = await setUp();
    await runImport(context);
    const view = rows(context, 'projectView').find((row) => row['type'] === 'LIST') as Row;
    const project = rows(context, 'project').find((row) => row['id'] === view['projectId']) as Row;
    // As CoreTask first made it, then widened, before the layout ran.
    view['settings'] = {
      columns: [
        { field: 'title', width: 420 },
        { field: 'assigneeId' },
        { field: 'priority' },
        { field: 'status' },
        { field: 'dueDate' },
        { field: 'createdAt' },
      ],
    };
    context.db.table('externalRef').rows = rows(context, 'externalRef').filter(
      (row) => row['entityType'] !== 'list_layout',
    );

    await runImport(context);

    const columns = columnsOf(context, project['name'] as string);
    expect(columns[0]).toEqual({ field: 'title', width: 420 });
    expect(columns.map((column) => column.field)).not.toContain('priority');
    expect(columns.map((column) => column.field)).not.toContain('status');
    expect(columns.at(-1)).toEqual({ field: 'createdAt' });
  });

  it('leaves a laid-out view as someone left it, adding only fields Asana added since', async () => {
    const context = await setUp();
    await runImport(context);
    const view = rows(context, 'projectView').find((row) => row['type'] === 'LIST') as Row;
    const removed = fieldColumn(context, 'F2');
    const settings = view['settings'] as { columns: { field: string }[] };
    settings.columns = settings.columns.filter((column) => column.field !== removed);

    const org = organisation();
    const routes = org.routes;
    await runImport(context, {
      ...org,
      routes: (path: string, params: AsanaParams) => {
        if (path === `/workspaces/${WS}/custom_fields`) {
          return [
            ...routes(path, params),
            { gid: 'F4', name: 'Budget', resource_subtype: 'number' },
          ];
        }
        if (path === '/projects/P1/custom_field_settings') {
          return [...routes(path, params), { gid: 'CFS4', custom_field: { gid: 'F4' } }];
        }
        return routes(path, params);
      },
    });

    const fields = columnsOf(context, 'Maintenance').map((column) => column.field);
    expect(fields).not.toContain(removed);
    expect(fields.slice(-2)).toEqual([fieldColumn(context, 'F4'), 'tags']);
  });

  it('puts an image pasted into a task’s text back in place, though no story told of the file', async () => {
    const context = await setUp();
    const org = organisation();
    (org.tasks['T2'] as Row)['html_notes'] =
      '<body>Parts list\n<img src="https://asanausercontent.com/p.png" data-asana-gid="A1" data-asana-type="attachment"></body>';
    await runImport(context, org);

    const attachmentRef = rows(context, 'externalRef').find(
      (row) => row['entityType'] === 'attachment' && row['externalId'] === 'A1',
    ) as Row;
    const task = rows(context, 'task').find((row) => row['title'] === 'Order parts') as Row;
    expect(String(task['description'])).toContain(
      `data-attachment="${attachmentRef['entityId'] as string}"`,
    );
  });

  it('reads a field again for an option added to it since, rather than clearing the value', async () => {
    const context = await setUp();
    const org = organisation();
    (org.tasks['T1'] as Row)['custom_fields'] = [
      { gid: 'F1', resource_subtype: 'enum', enum_value: { gid: 'O3' } },
    ];
    const routes = org.routes;
    await runImport(context, {
      ...org,
      routes: (path: string, params: AsanaParams) =>
        path === '/custom_fields/F1'
          ? ({
              gid: 'F1',
              name: 'Priority',
              resource_subtype: 'enum',
              enum_options: [
                { gid: 'O1', name: 'Low', color: 'green', enabled: true },
                { gid: 'O2', name: 'High', color: 'red', enabled: true },
                { gid: 'O3', name: 'Urgent', color: 'red', enabled: true },
              ],
            } as unknown as unknown[])
          : routes(path, params),
    });

    const urgent = rows(context, 'customFieldOption').find(
      (row) => row['label'] === 'Urgent',
    ) as Row;
    expect(urgent).toBeDefined();
    const task = rows(context, 'task').find((row) => row['title'] === 'Fix the boiler') as Row;
    const value = rows(context, 'taskCustomFieldValue').find(
      (row) => row['taskId'] === task['id'] && (row['optionIds'] as string[] | undefined)?.length,
    ) as Row;
    expect(value['optionIds']).toEqual([urgent['id']]);
  });
});

describe('AsanaImportRun live sync', () => {
  /** The organisation, with single tasks answered as `tasks` says. */
  function liveOrg(
    tasks: Record<string, () => unknown>,
    extra?: (path: string) => unknown[] | null,
  ) {
    const org = organisation();
    const routes = org.routes;
    return {
      ...org,
      routes: (path: string, params: AsanaParams) => {
        const one = /^\/tasks\/([^/]+)$/.exec(path)?.[1];
        if (one && tasks[one]) return tasks[one]() as unknown[];
        const answered = extra?.(path);
        if (answered) return answered;
        return routes(path, params);
      },
    };
  }

  async function liveRun(
    context: Awaited<ReturnType<typeof setUp>>,
    org: ReturnType<typeof liveOrg>,
  ) {
    const asana = fakeAsana(org.routes);
    const run = new AsanaImportRun(
      {
        prisma: context.db.prisma,
        asana: asana as unknown as AsanaApiClient,
        storage: fakeStorage() as unknown as StorageService,
        logger: logger as never,
        concurrency: 3,
      },
      null,
      context.workspaceId,
      WS,
      context.starterId,
    );
    await run.prepareLive();
    return { run, asana };
  }

  const titled = (context: Awaited<ReturnType<typeof setUp>>, title: string) =>
    rows(context, 'task').find((row) => row['title'] === title) as Row;

  it('brings a changed task across and keeps its place', async () => {
    const context = await setUp();
    await runImport(context);
    const before = { ...titled(context, 'Fix the boiler') };
    const org = organisation();
    const changed = { ...org.tasks['T1'], name: 'Fix the boiler today', assignee: { gid: 'U1' } };
    const { run } = await liveRun(context, liveOrg({ T1: () => changed }));

    const changes = await run.syncTasks(['T1'], new Set());

    const task = titled(context, 'Fix the boiler today');
    expect(task['id']).toBe(before['id']);
    expect(task['position']).toBe(before['position']);
    const ada = rows(context, 'user').find((row) => row['email'] === 'ada@example.com') as Row;
    expect(task['assigneeId']).toBe(ada['id']);
    expect(changes).toEqual([{ taskId: before['id'], projectIds: expect.any(Array) }]);
    expect(changes[0]?.projectIds).toContain(before['projectId']);
  });

  it('puts a new subtask under its parent, last', async () => {
    const context = await setUp();
    await runImport(context);
    const parent = titled(context, 'Fix the boiler');
    const subtask = { gid: 'ST2', name: 'Order a valve', parent: { gid: 'T1' }, num_subtasks: 0 };
    const { run } = await liveRun(context, liveOrg({ ST2: () => subtask }));

    await run.syncTasks(['ST2'], new Set());

    const added = titled(context, 'Order a valve');
    expect(added['parentTaskId']).toBe(parent['id']);
    const siblings = rows(context, 'task').filter(
      (row) => row['parentTaskId'] === parent['id'] && row['id'] !== added['id'],
    );
    for (const sibling of siblings) {
      expect(added['position'] as number).toBeGreaterThan(sibling['position'] as number);
    }
  });

  it('archives a task Asana deleted', async () => {
    const context = await setUp();
    await runImport(context);
    const { run } = await liveRun(
      context,
      liveOrg({
        T2: () => {
          throw new AsanaApiError('/tasks/T2', 404, 'Unknown object: T2');
        },
      }),
    );

    await run.syncTasks(['T2'], new Set());

    expect(titled(context, 'Order parts')['archivedAt']).toBeInstanceOf(Date);
    const ref = rows(context, 'externalRef').find(
      (row) => row['entityType'] === 'task' && row['externalId'] === 'T2',
    ) as Row;
    expect(ref['sourceDeletedAt']).toBeInstanceOf(Date);
  });

  /** The organisation with some answers replaced; `null` from `change` keeps the original. */
  function changedOrg(change: (path: string, params: AsanaParams) => unknown) {
    const org = organisation();
    const routes = org.routes;
    return {
      ...org,
      routes: (path: string, params: AsanaParams) =>
        (change(path, params) ?? routes(path, params)) as unknown[],
    };
  }

  const urgent = { gid: 'TG1', name: 'Urgent', color: 'dark-red' };
  const withTag = (path: string) => (path === `/workspaces/${WS}/tags` ? [urgent] : null);

  it('looks at fields, tags and projects, and writes nothing when none changed', async () => {
    const context = await setUp();
    await runImport(context, changedOrg(withTag));
    const { run, asana } = await liveRun(context, changedOrg(withTag));
    const writes = ['customField', 'tag', 'project'].map((name) =>
      jest.spyOn(context.db.table(name), 'update'),
    );
    const openStream = jest.fn(async () => undefined);
    // Preparing read the fields and tags once already.
    asana.list.mockClear();

    const changes = await run.syncDefinitions(openStream);

    expect(changes).toEqual({ fieldIds: [], createdProjectIds: [], updatedProjectIds: [] });
    for (const write of writes) expect(write).not.toHaveBeenCalled();
    expect(openStream).not.toHaveBeenCalled();
    expect(asana.list.mock.calls.map(([path]) => path).sort()).toEqual([
      '/projects',
      '/projects',
      `/workspaces/${WS}/custom_fields`,
      `/workspaces/${WS}/tags`,
    ]);
  });

  it('writes a field, a tag and a project Asana changed', async () => {
    const context = await setUp();
    await runImport(context, changedOrg(withTag));
    const tagId = (rows(context, 'tag').find((row) => row['name'] === 'Urgent') as Row)['id'];
    const org = organisation();
    // Changed in Asana after live sync got ready, as it would be.
    let changed = false;
    const { run } = await liveRun(
      context,
      changedOrg((path, params) => {
        if (!changed) return withTag(path);
        if (path === `/workspaces/${WS}/custom_fields`) {
          return org
            .routes(path, params)
            .map((field) =>
              (field as Row)['gid'] === 'F2' ? { ...(field as Row), name: 'Unit number' } : field,
            );
        }
        if (path === `/workspaces/${WS}/tags`) return [{ ...urgent, name: 'Very urgent' }];
        if (path === '/projects' && params['archived'] === false) {
          return org
            .routes(path, params)
            .map((project) => ({ ...(project as Row), name: 'Maintenance and repairs' }));
        }
        return null;
      }),
    );
    changed = true;

    const changes = await run.syncDefinitions(async () => undefined);

    const unit = rows(context, 'customField').find((row) => row['name'] === 'Unit number') as Row;
    expect(changes.fieldIds).toEqual([unit['id']]);
    // Renamed, not made again under its new name.
    expect(rows(context, 'tag').filter((row) => String(row['name']).includes('rgent'))).toEqual([
      expect.objectContaining({ id: tagId, name: 'Very urgent', nameKey: 'very urgent' }),
    ]);
    const project = rows(context, 'project').find(
      (row) => row['name'] === 'Maintenance and repairs',
    ) as Row;
    expect(changes.updatedProjectIds).toEqual([project['id']]);
    expect(changes.createdProjectIds).toEqual([]);
  });

  it('brings a new project across with its tasks, its stream opened first', async () => {
    const context = await setUp();
    await runImport(context);
    const org = organisation();
    const log: string[] = [];
    const renewals = { gid: 'P3', name: 'Renewals', privacy_setting: 'public_to_workspace' };
    const newTask = {
      gid: 'T9',
      name: 'Renew the lease',
      num_subtasks: 0,
      memberships: [{ project: { gid: 'P3' }, section: { gid: 'S9' } }],
    };
    const alsoHere = {
      ...org.tasks['T2'],
      memberships: [
        { project: { gid: 'P1' }, section: { gid: 'S2' } },
        { project: { gid: 'P3' }, section: { gid: 'S9' } },
      ],
    };
    const { run } = await liveRun(
      context,
      changedOrg((path, params) => {
        if (path === '/projects' && params['archived'] === false) {
          return [...org.routes(path, params), renewals];
        }
        if (path === '/projects/P3/sections') return [{ gid: 'S9', name: 'Up next' }];
        if (path === '/projects/P3/custom_field_settings') return [];
        if (path === '/tasks' && params['project'] === 'P3') {
          log.push('listed');
          return [newTask, alsoHere];
        }
        return null;
      }),
    );

    const changes = await run.syncDefinitions(async (projectGid) => {
      log.push(`opened ${projectGid}`);
    });

    expect(log).toEqual(['opened P3', 'listed']);
    const p3 = rows(context, 'project').find((row) => row['name'] === 'Renewals') as Row;
    expect(changes.createdProjectIds).toEqual([p3['id']]);
    const s9 = rows(context, 'section').find((row) => row['name'] === 'Up next') as Row;
    expect(titled(context, 'Renew the lease')).toMatchObject({
      projectId: p3['id'],
      sectionId: s9['id'],
    });
    // Already here from P1: it stays there, and P3 is one more of its projects.
    const orderParts = titled(context, 'Order parts');
    const p1 = rows(context, 'project').find((row) => row['name'] === 'Maintenance') as Row;
    expect(orderParts['projectId']).toBe(p1['id']);
    expect(
      rows(context, 'taskProject').filter((row) => row['taskId'] === orderParts['id']),
    ).toEqual([expect.objectContaining({ projectId: p3['id'], sectionId: s9['id'] })]);
    expect(run.liveProjectGids()).toContain('P3');
  });

  it('writes what changed on a task it reads, and leaves its comments be', async () => {
    const context = await setUp();
    await runImport(context);
    const org = organisation();
    const dueDateMoved = {
      gid: 'H3',
      resource_subtype: 'due_date_changed',
      text: 'Bob Builder changed the due date to Nov 2',
      created_at: '2026-10-04T09:00:00.000Z',
      created_by: { gid: 'U2', name: 'Bob Builder' },
    };
    const { run, asana } = await liveRun(
      context,
      liveOrg({ T1: () => org.tasks['T1'] }, (path) =>
        path === '/tasks/T1/stories' ? [...org.routes(path, {}), dueDateMoved] : null,
      ),
    );
    const commentWrites = jest.spyOn(context.db.table('comment'), 'update');

    await run.syncTasks(['T1'], new Set());

    const bob = rows(context, 'user').find((row) => row['email'] === 'bob@example.com') as Row;
    expect(
      rows(context, 'activityLog').find(
        (row) => (row['metadata'] as Row | null)?.['story'] === 'H3',
      ),
    ).toMatchObject({ actorId: bob['id'], summary: 'changed the due date to Nov 2' });
    expect(commentWrites).not.toHaveBeenCalled();
    // Files only when the events were about one.
    expect(asana.list).not.toHaveBeenCalledWith('/attachments', expect.anything());
  });

  it('reads a tag a task names that it has not seen', async () => {
    const context = await setUp();
    await runImport(context);
    const org = organisation();
    const tagged = { ...org.tasks['T1'], tags: [{ gid: 'TG7' }] };
    const { run } = await liveRun(
      context,
      liveOrg({ T1: () => tagged }, (path) =>
        path === '/tags/TG7'
          ? ({ gid: 'TG7', name: 'Waiting', color: 'light-yellow' } as unknown as unknown[])
          : null,
      ),
    );

    await run.syncTasks(['T1'], new Set());

    const waiting = rows(context, 'tag').find((row) => row['name'] === 'Waiting') as Row;
    expect(
      rows(context, 'taskTag').filter(
        (row) => row['taskId'] === titled(context, 'Fix the boiler')['id'],
      ),
    ).toContainEqual(expect.objectContaining({ tagId: waiting['id'] }));
    expect(
      rows(context, 'externalRef').find(
        (row) => row['entityType'] === 'tag' && row['externalId'] === 'TG7',
      ),
    ).toMatchObject({ entityId: waiting['id'] });
  });

  it('reads a project again when its events say it changed, writing it only if it did', async () => {
    const context = await setUp();
    await runImport(context);
    const org = organisation();
    const [listed] = org.routes('/projects', { archived: false }) as Row[];
    let answer: Row = { ...listed };
    const { run } = await liveRun(
      context,
      liveOrg({}, (path) => (path === '/projects/P1' ? (answer as unknown as unknown[]) : null)),
    );
    const update = jest.spyOn(context.db.table('project'), 'update');
    const p1 = rows(context, 'project').find((row) => row['name'] === 'Maintenance') as Row;

    expect(await run.syncProject('P1', new Set(['details']))).toBeNull();
    expect(update).not.toHaveBeenCalled();

    answer = { ...listed, name: 'Maintenance and repairs' };
    expect(await run.syncProject('P1', new Set(['details']))).toBe(p1['id']);
    expect(p1['name']).toBe('Maintenance and repairs');
  });

  it('deletes comments whose deletion an event told of without their task', async () => {
    const context = await setUp();
    await runImport(context);
    const task = titled(context, 'Fix the boiler');
    const { run } = await liveRun(context, liveOrg({}));

    const changes = await run.removeComments(['C1', 'C-unknown']);

    const thanks = rows(context, 'comment').find((row) =>
      String(row['body']).includes('Thanks'),
    ) as Row;
    expect(thanks['deletedAt']).toBeInstanceOf(Date);
    expect(changes).toEqual([{ taskId: task['id'], projectIds: [task['projectId']] }]);
    // Already gone: nothing to announce the second time.
    expect(await run.removeComments(['C1'])).toEqual([]);
  });

  it('reads a project’s sections again for a task moved into a new one', async () => {
    const context = await setUp();
    await runImport(context);
    const org = organisation();
    const moved = {
      ...org.tasks['T2'],
      memberships: [{ project: { gid: 'P1' }, section: { gid: 'S9' } }],
    };
    const { run } = await liveRun(
      context,
      liveOrg({ T2: () => moved }, (path) =>
        path === '/projects/P1/sections'
          ? [
              { gid: 'S1', name: 'To do' },
              { gid: 'S2', name: 'Done' },
              { gid: 'S9', name: 'Blocked' },
            ]
          : null,
      ),
    );

    await run.syncTasks(['T2'], new Set());

    const blocked = rows(context, 'section').find((row) => row['name'] === 'Blocked') as Row;
    expect(blocked).toBeDefined();
    expect(titled(context, 'Order parts')['sectionId']).toBe(blocked['id']);
  });

  it('leaves a new task in a project that did not come across for the next full run', async () => {
    const context = await setUp();
    await runImport(context);
    const before = rows(context, 'task').length;
    const elsewhere = { gid: 'T9', name: 'Elsewhere', memberships: [{ project: { gid: 'PX' } }] };
    const { run } = await liveRun(context, liveOrg({ T9: () => elsewhere }));

    expect(await run.syncTasks(['T9'], new Set())).toEqual([]);
    expect(rows(context, 'task')).toHaveLength(before);
  });
});

describe('AsanaLiveSyncService', () => {
  async function setUpLive(options: { needsFullSync: boolean; tokens: boolean }) {
    const context = await setUp();
    await runImport(context);
    Object.assign(rows(context, 'importRun')[0] as Row, {
      source: 'ASANA',
      status: 'SUCCEEDED',
      externalWorkspaceId: WS,
      finishedAt: new Date(Date.now() - 60_000),
      updatedAt: new Date(Date.now() - 60_000),
    });
    await context.db.table('asanaLiveSync').create({
      data: {
        workspaceId: context.workspaceId,
        enabled: true,
        enabledById: context.starterId,
        needsFullSync: options.needsFullSync,
        changesToday: 0,
      },
    });
    if (options.tokens) {
      for (const projectGid of ['P1', 'P2']) {
        await context.db.table('asanaEventStream').create({
          data: { workspaceId: context.workspaceId, projectGid, syncToken: `${projectGid}-token` },
        });
      }
    }
    return context;
  }

  function service(
    context: Awaited<ReturnType<typeof setUp>>,
    events: (resource: string, sync: string | null) => unknown,
    tasks: Record<string, () => unknown> = {},
    options: {
      routes?: (path: string, params: AsanaParams) => unknown;
      definitionsEvery?: number;
    } = {},
  ) {
    const org = organisation();
    const routes = org.routes;
    const asana = Object.assign(
      fakeAsana((path, params) => {
        const one = /^\/tasks\/([^/]+)$/.exec(path)?.[1];
        if (one && tasks[one]) return tasks[one]() as unknown[];
        return (options.routes?.(path, params) ?? routes(path, params)) as unknown[];
      }),
      { events: jest.fn(async (resource: string, sync: string | null) => events(resource, sync)) },
    );
    const queue = { add: jest.fn(async () => undefined) };
    const relay = { toProjectAudience: jest.fn(async () => undefined) };
    const live = new AsanaLiveSyncService(
      context.db.prisma,
      {
        asana: {
          enabled: true,
          concurrency: 3,
          liveDefinitionsIntervalMs: options.definitionsEvery,
        },
      } as never,
      asana as never,
      fakeStorage() as never,
      relay as never,
      queue as never,
    );
    return { live, queue, relay, asana };
  }

  const liveSync = (context: Awaited<ReturnType<typeof setUp>>) =>
    rows(context, 'asanaLiveSync')[0] as Row;

  it('starts with a full run, once every project’s stream has a token', async () => {
    const context = await setUpLive({ needsFullSync: true, tokens: false });
    const { live, queue } = service(context, (resource) => ({
      events: [],
      sync: `${resource}-fresh`,
      hasMore: false,
      lapsed: true,
    }));

    await live.tick();

    const streams = rows(context, 'asanaEventStream').map((row) => [
      row['projectGid'],
      row['syncToken'],
    ]);
    expect(streams).toEqual(
      expect.arrayContaining([
        ['P1', 'P1-fresh'],
        ['P2', 'P2-fresh'],
      ]),
    );
    expect(queue.add).toHaveBeenCalledWith('asana-import', expect.anything(), expect.anything());
    expect(liveSync(context)['needsFullSync']).toBe(false);
  });

  it('applies the tasks the events name and tells open boards', async () => {
    const context = await setUpLive({ needsFullSync: false, tokens: true });
    const org = organisation();
    const { live, queue, relay } = service(
      context,
      (resource, sync) => ({
        events:
          resource === 'P1'
            ? [{ action: 'changed', resource: { gid: 'T1', resource_type: 'task' } }]
            : [],
        sync: `${sync}+1`,
        hasMore: false,
        lapsed: false,
      }),
      { T1: () => ({ ...org.tasks['T1'], name: 'Fix the boiler today' }) },
    );

    const result = await live.tick();

    expect(result.changes).toBe(1);
    const task = rows(context, 'task').find((row) => row['title'] === 'Fix the boiler today');
    expect(task).toBeDefined();
    expect(relay.toProjectAudience).toHaveBeenCalledWith(
      context.workspaceId,
      task?.['projectId'],
      'work-item:updated',
      expect.objectContaining({ workItemId: task?.['id'], source: 'asana' }),
    );
    expect(queue.add).not.toHaveBeenCalled();
    expect(liveSync(context)['changesToday']).toBe(1);
    expect(liveSync(context)['lastChangeAt']).toBeInstanceOf(Date);
    const p1 = rows(context, 'asanaEventStream').find((row) => row['projectGid'] === 'P1') as Row;
    expect(p1['syncToken']).toBe('P1-token+1');
  });

  it('brings a new project across and tells whoever may see it', async () => {
    const context = await setUpLive({ needsFullSync: false, tokens: true });
    const org = organisation();
    const { live, relay } = service(
      context,
      (resource, sync) =>
        sync === null
          ? { events: [], sync: `${resource}-fresh`, hasMore: false, lapsed: true }
          : { events: [], sync: `${sync}+1`, hasMore: false, lapsed: false },
      {},
      {
        definitionsEvery: 300_000,
        routes: (path, params) => {
          if (path === '/projects' && params['archived'] === false) {
            return [...org.routes(path, params), { gid: 'P3', name: 'Renewals' }];
          }
          if (path === '/projects/P3/sections' || path === '/projects/P3/custom_field_settings') {
            return [];
          }
          if (path === '/tasks' && params['project'] === 'P3') return [];
          return null;
        },
      },
    );

    const result = await live.tick();
    // Looked at once per interval, not every tick.
    const second = await live.tick();

    const p3 = rows(context, 'project').find((row) => row['name'] === 'Renewals') as Row;
    expect(relay.toProjectAudience).toHaveBeenCalledWith(
      context.workspaceId,
      p3['id'],
      'project:created',
      expect.objectContaining({ projectId: p3['id'], source: 'asana' }),
    );
    expect(result.changes).toBe(1);
    expect(second.changes).toBe(0);
    const stream = rows(context, 'asanaEventStream').find((row) => row['projectGid'] === 'P3');
    expect(stream?.['syncToken']).toBe('P3-fresh+1');
  });

  it('asks for a full run when a stream’s token has lapsed', async () => {
    const context = await setUpLive({ needsFullSync: false, tokens: true });
    const { live, queue } = service(context, (resource, sync) => ({
      events: [],
      sync: resource === 'P1' ? 'P1-fresh' : `${sync}`,
      hasMore: false,
      lapsed: resource === 'P1',
    }));

    await live.tick();

    expect(queue.add).toHaveBeenCalledWith('asana-import', expect.anything(), expect.anything());
  });

  it('waits while a full run is going', async () => {
    const context = await setUpLive({ needsFullSync: false, tokens: true });
    await context.db.table('importRun').create({
      data: { workspaceId: context.workspaceId, status: 'RUNNING', updatedAt: new Date() },
    });
    const { live, asana } = service(context, () => {
      throw new Error('not expected');
    });

    expect(await live.tick()).toEqual({ workspaces: 1, changes: 0 });
    expect(asana.events).not.toHaveBeenCalled();
  });
});

describe('changeLine', () => {
  const story = (text: string, by: string | null) => ({
    gid: 'S',
    text,
    created_by: by ? { gid: 'U', name: by } : null,
  });

  it('leaves out whoever made the change, which CoreTask writes itself', () => {
    expect(changeLine(story('IT assigned to Earl', 'IT'))).toEqual({
      text: 'assigned to Earl',
      byRule: false,
    });
  });

  it('takes "Asana …" for a rule, whoever set it off', () => {
    expect(changeLine(story('Asana changed Status to New', 'IT'))).toEqual({
      text: 'changed Status to New',
      byRule: true,
    });
    expect(changeLine(story('created Review the request', null))).toEqual({
      text: 'created Review the request',
      byRule: true,
    });
  });

  it('has nothing to say for a story with no text', () => {
    expect(changeLine(story('', 'IT'))).toBeNull();
  });
});

describe('historyId', () => {
  it('is a UUID v7 at the story’s time, the same each time for the same story', () => {
    const at = new Date('2026-10-02T09:00:00.000Z');
    const id = historyId('ws', 'H1', at);

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(parseInt(id.replace(/-/g, '').slice(0, 12), 16)).toBe(at.getTime());
    expect(historyId('ws', 'H1', at)).toBe(id);
    expect(historyId('ws', 'H2', at)).not.toBe(id);
    expect(historyId('other', 'H1', at)).not.toBe(id);
  });
});

describe('readableError', () => {
  it('keeps the database’s own words from a Prisma error', () => {
    const prisma = new Error(
      [
        '',
        'Invalid `this.prisma.taskCustomFieldValue.upsert()` invocation in',
        'C:\\build\\run.js:938:52',
        '',
        '→ 938 await this.prisma.x(',
        'Error occurred during query execution:',
        'ConnectorError(ConnectorError { kind: QueryError(PostgresError { code: "54000", message: "index row size 3304 exceeds btree version 4 maximum 2704", severity: "ERROR" }) })',
      ].join('\n'),
    );
    const plain = new Error(
      ['', 'Invalid `x()` invocation in', 'C:\\run.js:1:1', 'Unique constraint failed'].join('\n'),
    );
    expect(readableError(prisma)).toBe('index row size 3304 exceeds btree version 4 maximum 2704');
    expect(readableError(plain)).toBe('Unique constraint failed');
    expect(readableError(new Error(' Asana timed out '))).toBe('Asana timed out');
  });
});

describe('pool', () => {
  it('runs every item, never more than the size at once', async () => {
    let running = 0;
    let peak = 0;
    const seen: number[] = [];
    await pool([1, 2, 3, 4, 5, 6, 7], 3, async (item) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setImmediate(resolve));
      seen.push(item);
      running -= 1;
    });
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(peak).toBe(3);
  });
});
