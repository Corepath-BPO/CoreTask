import { WorkspaceRole } from '@coretask/contracts';
import type { WebhookDelivery, WebhookEndpoint } from '@coretask/types';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';
import { queryClient } from '@/lib/api/query-client';

import { WebhooksPage } from './webhooks-page';

const WORKSPACE = '019fc880-0000-7000-8000-000000000000';
const ME = '019fc880-0000-7000-8000-00000000aaaa';

const list = vi.fn();
const create = vi.fn();
const update = vi.fn();
const remove = vi.fn();
const rotateSecret = vi.fn();
const test = vi.fn();
const deliveries = vi.fn();
const delivery = vi.fn();
const redeliver = vi.fn();

let activeRole: WorkspaceRole = WorkspaceRole.OWNER;

vi.mock('../api/webhooks.api', () => ({
  webhooksApi: {
    list: (...args: unknown[]) => list(...args),
    create: (...args: unknown[]) => create(...args),
    update: (...args: unknown[]) => update(...args),
    remove: (...args: unknown[]) => remove(...args),
    rotateSecret: (...args: unknown[]) => rotateSecret(...args),
    test: (...args: unknown[]) => test(...args),
    deliveries: (...args: unknown[]) => deliveries(...args),
    delivery: (...args: unknown[]) => delivery(...args),
    redeliver: (...args: unknown[]) => redeliver(...args),
  },
}));

vi.mock('@/features/workspaces/hooks/use-workspaces', () => ({
  useActiveWorkspace: () => ({
    workspace: { id: WORKSPACE, name: 'Acme Product', role: activeRole },
    workspaces: [],
    isLoading: false,
    select: vi.fn(),
  }),
}));

vi.mock('@/features/projects/hooks/use-projects', () => ({
  useProjects: () => ({
    data: { items: [{ id: '019fc880-0000-7000-8000-00000000bbbb', name: 'Platform Foundation' }] },
  }),
}));

function endpoint(overrides: Partial<WebhookEndpoint> = {}): WebhookEndpoint {
  return {
    id: 'hook-1',
    workspaceId: WORKSPACE,
    name: 'Nightly sync',
    url: 'https://n8n.example.com/webhook/coretask',
    events: ['task.created', 'task.completed'],
    project: null,
    enabled: true,
    disabledReason: null,
    consecutiveFailures: 0,
    lastDeliveryAt: '2026-09-14T10:00:00.000Z',
    lastDeliveryStatus: 'SUCCEEDED',
    lastSuccessAt: '2026-09-14T10:00:00.000Z',
    createdBy: { id: ME, name: 'Demo Owner', email: 'demo@coretask.dev', avatarUrl: null },
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-14T10:00:00.000Z',
    ...overrides,
  };
}

function deliveryRow(overrides: Partial<WebhookDelivery> = {}): WebhookDelivery {
  return {
    id: 'del-1',
    workspaceId: WORKSPACE,
    endpointId: 'hook-1',
    endpointName: 'Nightly sync',
    ruleId: null,
    eventType: 'task.completed',
    eventId: 'evt-1',
    correlationId: null,
    url: 'https://n8n.example.com/webhook/coretask',
    status: 'SUCCEEDED',
    attempt: 1,
    maxAttempts: 5,
    responseStatus: 200,
    error: null,
    durationMs: 142,
    nextAttemptAt: null,
    deliveredAt: '2026-09-14T10:00:00.000Z',
    createdAt: '2026-09-14T10:00:00.000Z',
    updatedAt: '2026-09-14T10:00:00.000Z',
    ...overrides,
  };
}

/**
 * The app's own query client, not a fresh one: the enable switch writes its
 * optimistic state through that instance, and a private client would never see
 * it. Cleared between tests so nothing leaks.
 */
function renderPage() {
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WebhooksPage />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe('WebhooksPage', () => {
  beforeEach(() => {
    queryClient.clear();
    for (const fn of [
      list,
      create,
      update,
      remove,
      rotateSecret,
      test,
      deliveries,
      delivery,
      redeliver,
    ]) {
      fn.mockReset();
    }
    activeRole = WorkspaceRole.OWNER;
    list.mockResolvedValue([endpoint()]);
    deliveries.mockResolvedValue({ items: [], hasMore: false, nextBefore: null });
  });

  it('lists endpoints with their events, scope and last delivery', async () => {
    renderPage();

    expect(await screen.findByText('Nightly sync')).toBeInTheDocument();
    expect(screen.getByText('https://n8n.example.com/webhook/coretask')).toBeInTheDocument();
    expect(screen.getByText('Task created')).toBeInTheDocument();
    expect(screen.getByText('Task completed')).toBeInTheDocument();
    expect(screen.getByText('All projects')).toBeInTheDocument();
    expect(screen.getByText('Delivered')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Nightly sync enabled' })).toBeChecked();
  });

  it('renders nothing for a member and never requests the list', () => {
    activeRole = WorkspaceRole.MEMBER;
    const { container } = renderPage();

    expect(container).toBeEmptyDOMElement();
    expect(list).not.toHaveBeenCalled();
  });

  it('flips the switch at once and rolls back when the server refuses', async () => {
    const user = userEvent.setup();
    let reject: (error: Error) => void = () => undefined;
    update.mockImplementation(() => new Promise((_resolve, rej) => (reject = rej)));
    renderPage();

    const toggle = await screen.findByRole('switch', { name: 'Nightly sync enabled' });
    await user.click(toggle);

    expect(update).toHaveBeenCalledWith(WORKSPACE, 'hook-1', { enabled: false });
    await waitFor(() => expect(toggle).not.toBeChecked());

    reject(new Error('nope'));
    await waitFor(() => expect(toggle).toBeChecked());
  });

  it('explains an endpoint that switched itself off', async () => {
    list.mockResolvedValue([
      endpoint({
        enabled: false,
        disabledReason: 'Disabled automatically after 20 consecutive failed deliveries.',
        consecutiveFailures: 20,
        lastDeliveryStatus: 'FAILED',
      }),
    ]);
    renderPage();

    expect(await screen.findByText('Auto-disabled')).toBeInTheDocument();
    expect(screen.getByText('20 consecutive failures')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Nightly sync enabled' })).not.toBeChecked();
  });

  it('adds an endpoint and shows the signing secret once, masked', async () => {
    const user = userEvent.setup();
    const secret = 'whsec_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefg';
    create.mockResolvedValue({ endpoint: endpoint({ id: 'hook-2', name: 'Zapier' }), secret });
    renderPage();

    await screen.findByText('Nightly sync');
    await user.click(screen.getByRole('button', { name: 'Add endpoint' }));
    const dialog = screen.getByRole('dialog');

    // Empty submit: every required field says so, and nothing is sent.
    await user.click(within(dialog).getByRole('button', { name: 'Add endpoint' }));
    expect(await within(dialog).findByText(/name the endpoint/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/enter the url/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/at least one event/i)).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText(/^name/i), 'Zapier');
    await user.type(within(dialog).getByLabelText(/^url/i), 'https://hooks.zapier.com/x');
    await user.click(within(dialog).getByLabelText('Task created'));
    await user.click(within(dialog).getByRole('button', { name: 'Add endpoint' }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(WORKSPACE, {
        name: 'Zapier',
        url: 'https://hooks.zapier.com/x',
        events: ['task.created'],
        projectId: null,
      }),
    );

    const revealed = await screen.findByLabelText('Signing secret');
    expect(revealed).toHaveValue(secret);
    expect(revealed).toHaveAttribute('type', 'password');
  });

  it('edits without ever showing a secret', async () => {
    const user = userEvent.setup();
    update.mockResolvedValue(endpoint({ name: 'Renamed' }));
    renderPage();

    await screen.findByText('Nightly sync');
    await user.click(screen.getByRole('button', { name: 'Actions for Nightly sync' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/^name/i)).toHaveValue('Nightly sync');
    expect(within(dialog).queryByLabelText('Signing secret')).not.toBeInTheDocument();

    await user.clear(within(dialog).getByLabelText(/^name/i));
    await user.type(within(dialog).getByLabelText(/^name/i), 'Renamed');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        WORKSPACE,
        'hook-1',
        expect.objectContaining({ name: 'Renamed', events: ['task.created', 'task.completed'] }),
      ),
    );
  });

  it('rotates the secret only after confirmation, then shows the new one', async () => {
    const user = userEvent.setup();
    rotateSecret.mockResolvedValue({ secret: 'whsec_new_secret_value_0123456789abcdef' });
    renderPage();

    await screen.findByText('Nightly sync');
    await user.click(screen.getByRole('button', { name: 'Actions for Nightly sync' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Rotate secret' }));

    const confirm = await screen.findByRole('alertdialog');
    expect(rotateSecret).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole('button', { name: 'Rotate' }));

    await waitFor(() => expect(rotateSecret).toHaveBeenCalledWith(WORKSPACE, 'hook-1'));
    expect(await screen.findByLabelText('Signing secret')).toHaveValue(
      'whsec_new_secret_value_0123456789abcdef',
    );
  });

  it('sends a test event and deletes after confirmation', async () => {
    const user = userEvent.setup();
    test.mockResolvedValue({ deliveryId: 'del-9' });
    remove.mockResolvedValue(undefined);
    renderPage();

    await screen.findByText('Nightly sync');
    await user.click(screen.getByRole('button', { name: 'Actions for Nightly sync' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Send test event' }));
    await waitFor(() => expect(test).toHaveBeenCalledWith(WORKSPACE, 'hook-1'));

    await user.click(screen.getByRole('button', { name: 'Actions for Nightly sync' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(remove).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(WORKSPACE, 'hook-1'));
  });

  it('shows recent deliveries and loads a payload on demand', async () => {
    const user = userEvent.setup();
    deliveries.mockResolvedValue({ items: [deliveryRow()], hasMore: false, nextBefore: null });
    delivery.mockResolvedValue({
      ...deliveryRow(),
      payload: { id: 'evt-1', type: 'task.completed', data: { task: { id: 'task-1' } } },
      responseBody: '{"ok":true}',
      attempts: [
        {
          at: '2026-09-14T10:00:00.000Z',
          succeeded: true,
          responseStatus: 200,
          error: null,
          durationMs: 142,
        },
      ],
    });
    renderPage();

    await screen.findByText('Nightly sync');
    await user.click(screen.getByRole('button', { name: 'Actions for Nightly sync' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Recent deliveries' }));

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Delivered')).toBeInTheDocument();
    expect(within(dialog).getByText(/HTTP 200/)).toBeInTheDocument();
    expect(deliveries).toHaveBeenCalledWith(
      WORKSPACE,
      expect.objectContaining({ endpointId: 'hook-1' }),
    );

    await user.click(within(dialog).getByRole('button', { name: 'Show payload' }));
    expect(await within(dialog).findByText(/"type": "task.completed"/)).toBeInTheDocument();
    expect(delivery).toHaveBeenCalledWith(WORKSPACE, 'del-1');
  });

  it('queues a settled delivery again, and offers nothing for one still in flight', async () => {
    const user = userEvent.setup();
    deliveries.mockResolvedValue({
      items: [
        deliveryRow({ id: 'del-failed', status: 'FAILED', responseStatus: 404, error: 'HTTP 404' }),
        deliveryRow({ id: 'del-pending', status: 'PENDING', responseStatus: null, attempt: 1 }),
      ],
      hasMore: false,
      nextBefore: null,
    });
    redeliver.mockResolvedValue(deliveryRow({ id: 'del-failed', status: 'PENDING', attempt: 0 }));
    renderPage();

    await screen.findByText('Nightly sync');
    await user.click(screen.getByRole('button', { name: 'Actions for Nightly sync' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Recent deliveries' }));

    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('Failed');
    // One settled row, one pending: exactly one way to push again.
    const buttons = within(dialog).getAllByRole('button', { name: 'Redeliver' });
    expect(buttons).toHaveLength(1);

    await user.click(buttons[0]!);
    await waitFor(() => expect(redeliver).toHaveBeenCalledWith(WORKSPACE, 'del-failed'));
  });
});
