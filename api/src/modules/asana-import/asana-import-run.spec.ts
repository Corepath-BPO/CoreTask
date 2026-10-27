import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';

import type { PrismaService } from '../../database/prisma.service';
import type { AsanaApiClient, AsanaParams } from '../../integrations/asana/asana-api.client';
import type { StorageService } from '../../integrations/storage/storage.service';

import { AsanaImportRun, pool, readableError } from './asana-import-run';

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
    if (condition !== null && typeof condition === 'object' && !(condition instanceof Date)) {
      const operator = condition as { in?: unknown[]; not?: unknown };
      if ('in' in operator) return (operator.in ?? []).includes(value);
      if ('not' in operator) return value !== operator.not;
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
  upsert = async ({ where, create, update }: { where: Row; create: Row; update: Row }) => {
    const row = this.rows.find((candidate) => matches(candidate, where));
    if (row) return Object.assign(row, update);
    return this.insert(create);
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
      if (search && path.endsWith('/tasks/search')) return search(params);
      // The contractor is not in the workspace, and Asana will not say who they are;
      // and without `search`, this organisation has no search (a free Asana plan).
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
