import { API_PREFIX, WorkspaceRole } from '@coretask/contracts';
import request from 'supertest';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

/** Reads a CSV body back into rows — quoted cells, doubled quotes, CRLF. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const body = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (quoted) {
      if (char === '"' && body[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\r' && body[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i += 1;
    } else cell += char;
  }
  return rows;
}

/** A project's tasks as a CSV file, Asana's Export › CSV. */
describe('Project CSV export (e2e)', () => {
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

  const register = async (name: string) => {
    const response = await request(server())
      .post(url('/auth/register'))
      .send({ name, email: uniqueEmail(), password: VALID_PASSWORD })
      .expect(201);
    return {
      auth: { Authorization: `Bearer ${response.body.data.accessToken as string}` },
      userId: response.body.data.user.id as string,
    };
  };

  it('writes a row per task, subtasks under their parent, with every field', async () => {
    const owner = await register('Ada Owner');
    const outsider = await register('Oz Outsider');
    const workspace = await request(server())
      .post(url('/workspaces'))
      .set(owner.auth)
      .send({ name: 'Acme' })
      .expect(201);
    const workspaceId = workspace.body.data.id as string;
    await context.prisma.workspaceMember.create({
      data: { workspaceId, userId: outsider.userId, role: WorkspaceRole.MEMBER },
    });
    const createProject = async (name: string, visibility?: 'PRIVATE') =>
      (
        await request(server())
          .post(url(`/workspaces/${workspaceId}/projects`))
          .set(owner.auth)
          .send({ name, ...(visibility ? { visibility } : {}) })
          .expect(201)
      ).body.data.id as string;
    const projectId = await createProject('Leasing, Q4', 'PRIVATE');
    const otherId = await createProject('Maintenance');

    const fields = url(`/workspaces/${workspaceId}/projects/${projectId}/custom-fields`);
    const rent = await request(server())
      .post(fields)
      .set(owner.auth)
      .send({ name: 'Rent', type: 'NUMBER' })
      .expect(201);
    const stage = await request(server())
      .post(fields)
      .set(owner.auth)
      .send({ name: 'Stage', type: 'SINGLE_SELECT', options: [{ label: 'Signed' }] })
      .expect(201);
    await request(server())
      .post(fields)
      .set(owner.auth)
      .send({ name: 'Answer', type: 'FORMULA', settings: { expression: '42' } })
      .expect(201);

    const tasks = url(`/workspaces/${workspaceId}/tasks`);
    const task = async (body: Record<string, unknown>) =>
      (await request(server()).post(tasks).set(owner.auth).send(body).expect(201)).body.data as {
        id: string;
      };
    const lease = await task({
      title: 'Renew the lease, unit "12"',
      projectId,
      assigneeId: owner.userId,
      dueDate: '2026-10-30',
      description: '<p>Call the tenant first.</p>',
    });
    await task({ title: 'Collect the keys', parentTaskId: lease.id, projectId });
    await task({ title: '=HYPERLINK("http://evil.example")', projectId });
    const borrowed = await task({ title: 'Fix the boiler', projectId: otherId });
    await request(server())
      .post(url(`/workspaces/${workspaceId}/tasks/${borrowed.id}/projects`))
      .set(owner.auth)
      .send({ projectId })
      .expect(201);
    const valueUrl = (fieldId: string) =>
      url(`/workspaces/${workspaceId}/tasks/${lease.id}/custom-fields/${fieldId}`);
    await request(server())
      .put(valueUrl(rent.body.data.id as string))
      .set(owner.auth)
      .send({ number: 1450.5 })
      .expect(200);
    await request(server())
      .put(valueUrl(stage.body.data.id as string))
      .set(owner.auth)
      .send({ optionIds: [stage.body.data.options[0].id as string] })
      .expect(200);
    await request(server())
      .post(url(`/workspaces/${workspaceId}/tasks/${lease.id}/tags`))
      .set(owner.auth)
      .send({ name: 'Renewals' })
      .expect(201);

    const exportUrl = url(`/workspaces/${workspaceId}/projects/${projectId}/export/csv`);
    const response = await request(server()).get(exportUrl).set(owner.auth).expect(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toBe('attachment; filename="leasing-q4.csv"');
    expect(response.text.startsWith('\uFEFFTask ID,')).toBe(true);

    const [header, ...rows] = parseCsv(response.text);
    expect(header).toEqual([
      'Task ID',
      'Created At',
      'Completed At',
      'Last Modified',
      'Name',
      'Section/Column',
      'Assignee',
      'Assignee Email',
      'Start Date',
      'Due Date',
      'Status',
      'Priority',
      'Tags',
      'Notes',
      'Projects',
      'Parent task',
      'Rent',
      'Stage',
      'Answer',
    ]);
    const column = (name: string) => header.indexOf(name);
    const byName = new Map(rows.map((row) => [row[column('Name')], row]));
    expect(rows).toHaveLength(4);

    const leaseRow = byName.get('Renew the lease, unit "12"') as string[];
    expect(leaseRow[column('Task ID')]).toBe(lease.id);
    expect(leaseRow[column('Assignee')]).toBe('Ada Owner');
    expect(leaseRow[column('Due Date')]).toBe('2026-10-30');
    expect(leaseRow[column('Notes')]).toBe('Call the tenant first.');
    expect(leaseRow[column('Tags')]).toBe('Renewals');
    expect(leaseRow[column('Rent')]).toBe('1450.5');
    expect(leaseRow[column('Stage')]).toBe('Signed');
    expect(leaseRow[column('Answer')]).toBe('42');
    // The subtask comes straight after its parent, and names it.
    const leaseAt = rows.indexOf(leaseRow);
    expect(rows[leaseAt + 1][column('Name')]).toBe('Collect the keys');
    expect(rows[leaseAt + 1][column('Parent task')]).toBe('Renew the lease, unit "12"');
    // A task linked in from elsewhere lists both its projects.
    expect(byName.get('Fix the boiler')?.[column('Projects')]).toBe('Maintenance, Leasing, Q4');
    // A title that would run as a formula is kept as text.
    expect(byName.has('\'=HYPERLINK("http://evil.example")')).toBe(true);

    // A private project is not there for someone outside it.
    await request(server()).get(exportUrl).set(outsider.auth).expect(404);
  });
});
