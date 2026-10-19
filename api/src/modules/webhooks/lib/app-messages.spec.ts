import type { WebhookEventPayload } from '@coretask/types';

import { renderAppMessage } from './app-messages';

const context = {
  projectName: 'Maintenance',
  sectionName: 'Done',
  webUrl: 'https://app.example.org',
};

const event = (over: Partial<WebhookEventPayload>): WebhookEventPayload => ({
  id: 'e-1',
  type: 'task.completed',
  createdAt: '2026-10-14T00:00:00Z',
  workspaceId: 'ws',
  projectId: 'p-1',
  actor: { id: 'u-1', name: 'Ada Owner', kind: 'user' },
  causedByRuleId: null,
  correlationId: null,
  data: {
    task: {
      id: 't-1',
      title: 'Fix <!channel> leak',
      projectId: 'p-1',
      dueDate: '2026-10-20T00:00:00.000Z',
      assignee: { name: 'Bea Member' },
    },
  },
  changes: null,
  ...over,
});

describe('renderAppMessage', () => {
  it('writes Slack mrkdwn with a link, escaping what could mention a channel', () => {
    const body = renderAppMessage('SLACK', event({}), context) as {
      text: string;
      blocks: { text?: { text: string }; elements?: { text: string }[] }[];
    };
    expect(body.text).toBe('Ada Owner completed “Fix <!channel> leak”');
    expect(body.blocks[0]?.text?.text).toBe(
      '*Ada Owner* completed <https://app.example.org/projects/p-1/list?task=t-1|Fix &lt;!channel&gt; leak>',
    );
    expect(body.blocks.at(-1)?.elements?.[0]?.text).toBe('Maintenance · CoreTask');
  });

  it('quotes a comment, says where a task moved and who it went to', () => {
    const comment = renderAppMessage(
      'SLACK',
      event({
        type: 'comment.created',
        data: {
          task: event({}).data['task'],
          comment: { body: '<p>Booked for <b>Tuesday</b></p>' },
        },
      }),
      context,
    ) as { blocks: { text?: { text: string } }[] };
    expect(comment.blocks[0]?.text?.text).toContain('commented on');
    expect(comment.blocks[1]?.text?.text).toBe('>Booked for Tuesday');

    const moved = renderAppMessage('GOOGLE_CHAT', event({ type: 'task.moved' }), context) as {
      text: string;
    };
    expect(moved.text.split('\n')[0]).toBe(
      '*Ada Owner* moved <https://app.example.org/projects/p-1/list?task=t-1|Fix ‹!channel› leak> to Done',
    );
    const assigned = renderAppMessage('TEAMS', event({ type: 'task.assigned' }), context) as {
      attachments: { content: { body: { text: string }[]; actions: { url: string }[] } }[];
    };
    const card = assigned.attachments[0]?.content;
    expect(card?.body[0]?.text).toContain('to Bea Member');
    expect(card?.actions[0]?.url).toBe('https://app.example.org/projects/p-1/list?task=t-1');
  });

  it('keeps Discord from mentioning anyone and dates due-date changes', () => {
    const body = renderAppMessage(
      'DISCORD',
      event({
        type: 'task.due_date_changed',
        actor: { id: 'u', name: '@everyone', kind: 'user' },
      }),
      context,
    ) as { content: string; allowed_mentions: { parse: string[] } };
    expect(body.allowed_mentions.parse).toEqual([]);
    expect(body.content).toContain('\\@everyone');
    expect(body.content).toContain('to Oct 20, 2026');
  });

  it('posts a status update with its status, title and summary', () => {
    const body = renderAppMessage(
      'SLACK',
      event({
        type: 'project.status_updated',
        data: {
          statusUpdate: {
            id: 'su-1',
            status: 'AT_RISK',
            title: 'Week 42',
            summary: 'Two units behind.',
            nextSteps: null,
          },
        },
      }),
      context,
    ) as { text: string; blocks: { text?: { text: string } }[] };
    expect(body.text).toBe('Ada Owner posted a status update: “At risk — Week 42”');
    expect(body.blocks.map((block) => block.text?.text)).toContain('>Two units behind.');
  });

  it('says a deleted task is gone, and passes a ping’s words through', () => {
    const gone = renderAppMessage('SLACK', event({ data: { task: null } }), context) as {
      text: string;
    };
    expect(gone.text).toBe('Ada Owner completed “a task that has since been deleted”');
    const ping = renderAppMessage(
      'GOOGLE_CHAT',
      event({ type: 'ping', data: { message: 'CoreTask will post Maintenance updates here.' } }),
      context,
    ) as { text: string };
    expect(ping.text).toBe('CoreTask will post Maintenance updates here.\nMaintenance · CoreTask');
  });
});
