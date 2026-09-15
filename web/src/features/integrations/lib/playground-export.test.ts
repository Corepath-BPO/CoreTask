import { describe, expect, it } from 'vitest';

import {
  buildRequest,
  maskSecret,
  maskedHeaders,
  missingFields,
  playgroundCall,
} from './playground-calls';
import { toCurl, toN8nNode } from './playground-export';

const API = 'http://localhost:3000/api/v1';
const WS = '019fc880-0000-7000-8000-000000000000';
const SECTION = '019fc880-0000-7000-8000-00000000cccc';
const KEY = 'ctk_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefg';

describe('playground requests', () => {
  it('builds a create-task request with only the fields that were filled', () => {
    const request = buildRequest({
      call: playgroundCall('create-task'),
      apiUrl: API,
      workspaceId: WS,
      values: { projectId: 'p-1', sectionId: SECTION, title: 'Filed', description: '  ' },
      credential: { kind: 'api-key', key: KEY },
      idempotencyKey: 'run-1',
    });

    expect(request.method).toBe('POST');
    expect(request.url).toBe(`${API}/workspaces/${WS}/tasks`);
    expect(request.headers).toMatchObject({
      'X-API-Key': KEY,
      'Content-Type': 'application/json',
      'Idempotency-Key': 'run-1',
    });
    // The project only helped pick the section; the blank description is dropped.
    expect(JSON.parse(request.body ?? '')).toEqual({ sectionId: SECTION, title: 'Filed' });
  });

  it('sends the session token when running as the signed-in person', () => {
    const request = buildRequest({
      call: playgroundCall('whoami'),
      apiUrl: API,
      workspaceId: WS,
      values: {},
      credential: { kind: 'session', token: 'jwt-token' },
    });

    expect(request.headers['Authorization']).toBe('Bearer jwt-token');
    expect(request.headers['X-API-Key']).toBeUndefined();
    expect(request.body).toBeNull();
    expect(request.headers['Idempotency-Key']).toBeUndefined();
  });

  it('ignores an idempotency key on a call that does not take one', () => {
    const request = buildRequest({
      call: playgroundCall('complete-task'),
      apiUrl: API,
      workspaceId: WS,
      values: { taskId: 't-1' },
      credential: { kind: 'api-key', key: KEY },
      idempotencyKey: 'run-1',
    });

    expect(request.headers['Idempotency-Key']).toBeUndefined();
    expect(JSON.parse(request.body ?? '')).toEqual({ status: 'DONE' });
  });

  it('names the required fields that are still empty', () => {
    expect(missingFields(playgroundCall('create-task'), { title: 'x' })).toEqual({
      projectId: 'Project is required.',
      sectionId: 'Section is required.',
    });
    expect(missingFields(playgroundCall('whoami'), {})).toEqual({});
  });

  it('masks secrets for the screen and reveals them for the terminal', () => {
    expect(maskSecret(KEY)).toBe('ctk_AbCd…');
    expect(maskedHeaders({ Authorization: 'Bearer abcdefgh', Accept: 'x' })).toEqual({
      Authorization: 'Bearer abcd…',
      Accept: 'x',
    });

    const request = buildRequest({
      call: playgroundCall('add-comment'),
      apiUrl: API,
      workspaceId: WS,
      values: { taskId: 't-1', body: 'Hello' },
      credential: { kind: 'api-key', key: KEY },
    });

    expect(toCurl(request, { reveal: false })).toContain(`-H 'X-API-Key: ctk_AbCd…'`);
    const revealed = toCurl(request, { reveal: true });
    expect(revealed).toContain(`-H 'X-API-Key: ${KEY}'`);
    expect(revealed).toContain(`-d '{"body":"Hello"}'`);
    expect(revealed.startsWith(`curl -X POST '${API}/workspaces/${WS}/tasks/t-1/comments'`)).toBe(
      true,
    );
  });

  it('exports an n8n HTTP Request node without the key in it', () => {
    const call = playgroundCall('create-task');
    const request = buildRequest({
      call,
      apiUrl: API,
      workspaceId: WS,
      values: { sectionId: SECTION, title: 'Filed' },
      credential: { kind: 'api-key', key: KEY },
    });

    const exported = JSON.parse(toN8nNode(request, call)) as {
      nodes: { name: string; type: string; parameters: Record<string, unknown> }[];
    };
    const node = exported.nodes[0]!;

    expect(node.type).toBe('n8n-nodes-base.httpRequest');
    expect(node.name).toBe('CoreTask: Create a task');
    expect(node.parameters).toMatchObject({
      method: 'POST',
      url: request.url,
      genericAuthType: 'httpHeaderAuth',
      sendBody: true,
      specifyBody: 'json',
    });
    expect(node.parameters['headerParameters']).toEqual({
      parameters: [{ name: 'Idempotency-Key', value: '={{ $execution.id }}-{{ $itemIndex }}' }],
    });
    expect(toN8nNode(request, call)).not.toContain(KEY);
  });
});
