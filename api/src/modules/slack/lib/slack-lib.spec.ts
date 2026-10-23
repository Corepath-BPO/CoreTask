import { randomBytes } from 'node:crypto';

import { SlackAction } from '@coretask/contracts';

import { openToken, sealToken } from '../../../common/utils/sealed-token';
import {
  acknowledgedBlocks,
  createTaskModal,
  messagePermalink,
  slackToPlainText,
  taskActions,
} from './slack-blocks';
import { signSlackRequest, verifySlackRequest } from './slack-signature';

describe('Slack request signatures', () => {
  const secret = 'signing-secret';
  const body = 'token=x&team_id=T1&text=Fix+the+gate';
  const now = 1_760_000_000;

  it('accepts what was signed with the secret, within five minutes', () => {
    const signature = signSlackRequest(secret, now - 60, body);
    expect(verifySlackRequest(secret, { timestamp: String(now - 60), signature, body }, now)).toBe(
      true,
    );
  });

  it('matches Slack’s documented example', () => {
    // From Slack's "Verifying requests from Slack" guide.
    const exampleSecret = '8f742231b10e8888abcd99yyyzzz85a5';
    const exampleBody =
      'token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&team_domain=testteamnow&channel_id=G8PSS9T3V&channel_name=foobar&user_id=U2CERLKJA&user_name=roadrunner&command=%2Fwebhook-collect&text=&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2FT1DC2JH3J%2F397700885554%2F96rGlfmibIGlgcZRskXaIFfN&trigger_id=398738663015.47445629121.803a0bc887a14d10d2c447fce8b6703c';
    expect(signSlackRequest(exampleSecret, 1531420618, exampleBody)).toBe(
      'v0=a2114d57b48eac39b9ad189dd8316235a7b4a8d21a10bd27519666489c69b503',
    );
  });

  it('refuses another secret, another body, and a stale timestamp', () => {
    const signature = signSlackRequest(secret, now, body);
    const check = (over: Partial<{ timestamp: string; signature: string; body: string }>) =>
      verifySlackRequest(secret, { timestamp: String(now), signature, body, ...over }, now);

    expect(check({ signature: signSlackRequest('other', now, body) })).toBe(false);
    expect(check({ body: `${body}&text=extra` })).toBe(false);
    expect(
      verifySlackRequest(
        secret,
        {
          timestamp: String(now - 301),
          signature: signSlackRequest(secret, now - 301, body),
          body,
        },
        now,
      ),
    ).toBe(false);
    expect(check({ timestamp: 'soon' })).toBe(false);
    expect(check({ signature: '' })).toBe(false);
  });
});

describe('sealed tokens', () => {
  const key = randomBytes(32);

  it('reads back what it sealed, for the same purpose, until it expires', () => {
    const token = sealToken(key, 'slack-link', { slackUserId: 'U1' }, 60, 1_000_000);
    expect(openToken(key, 'slack-link', token, 1_000_000)).toEqual({ slackUserId: 'U1' });
    expect(openToken(key, 'slack-install', token, 1_000_000)).toBeNull();
    expect(openToken(key, 'slack-link', token, 1_000_000 + 61_000)).toBeNull();
  });

  it('refuses a changed payload and another key', () => {
    const token = sealToken(key, 'slack-link', { slackUserId: 'U1' }, 60);
    const [payload, mac] = token.split('.');
    const forged = Buffer.from(
      Buffer.from(payload ?? '', 'base64url')
        .toString('utf8')
        .replace('U1', 'U2'),
    ).toString('base64url');

    expect(openToken(key, 'slack-link', `${forged}.${mac}`)).toBeNull();
    expect(openToken(randomBytes(32), 'slack-link', token)).toBeNull();
    expect(openToken(key, 'slack-link', 'not-a-token')).toBeNull();
  });
});

describe('Slack blocks', () => {
  it('turns Slack markup back into words', () => {
    expect(
      slackToPlainText(
        'Gate <@U123> is stuck &amp; noisy, see <https://ex.org/a|the log> in <#C1|ops> <!here> &lt;3',
      ),
    ).toBe('Gate @someone is stuck & noisy, see the log (https://ex.org/a) in #ops @here <3');
    expect(slackToPlainText('<mailto:a@b.org|a@b.org> <https://ex.org>')).toBe(
      'a@b.org https://ex.org',
    );
  });

  it('builds a message link the way Slack does, and only from safe parts', () => {
    expect(messagePermalink('acme', 'C1', '1712345678.000200')).toBe(
      'https://acme.slack.com/archives/C1/p1712345678000200',
    );
    expect(messagePermalink('evil.example/x', 'C1', '1.2')).toBeNull();
    expect(messagePermalink(undefined, 'C1', '1.2')).toBeNull();
  });

  it('prefills the form and remembers where it came from', () => {
    const view = createTaskModal({
      title: 'Fix the gate',
      metadata: { channelId: 'C1' },
    }) as { private_metadata: string; blocks: { element: Record<string, unknown> }[] };
    expect(JSON.parse(view.private_metadata)).toEqual({ channelId: 'C1' });
    expect(view.blocks[0]?.element['initial_value']).toBe('Fix the gate');
    expect(view.blocks[1]?.element['type']).toBe('external_select');
  });

  it('gives an open task its buttons, an approval no "Mark complete", a done one just the link', () => {
    const ids = (block: Record<string, unknown>) =>
      (block['elements'] as { action_id: string }[]).map((element) => element.action_id);
    const base = { id: 't-1', url: 'https://app/t-1' };

    expect(ids(taskActions({ ...base, completed: false }))).toEqual([
      SlackAction.COMPLETE,
      SlackAction.ASSIGN_TO_ME,
      SlackAction.OPEN,
    ]);
    expect(ids(taskActions({ ...base, completed: false, approval: true }))).toEqual([
      SlackAction.ASSIGN_TO_ME,
      SlackAction.OPEN,
    ]);
    expect(ids(taskActions({ ...base, completed: true }))).toEqual([SlackAction.OPEN]);
  });

  it('redraws a post after a click: one note, buttons for the task as it is now', () => {
    const original = [
      { type: 'section', text: { type: 'mrkdwn', text: 'Ada added *Fix*' } },
      taskActions({ id: 't-1', url: 'u', completed: false }),
    ];
    const once = acknowledgedBlocks(original, 'Taken by Bea', {
      id: 't-1',
      url: 'u',
      completed: false,
    });
    const twice = acknowledgedBlocks(once, 'Done by Bea', { id: 't-1', url: 'u', completed: true });

    expect(twice).toHaveLength(3);
    expect(twice[0]).toEqual(original[0]);
    expect((twice[1] as { elements: { text: string }[] }).elements[0]?.text).toBe('Done by Bea');
    expect((twice[2] as { elements: unknown[] }).elements).toHaveLength(1);
  });
});
