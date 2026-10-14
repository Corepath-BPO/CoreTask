import { describe, expect, it } from 'vitest';

import {
  inboundAddress,
  parseAddressList,
  readInboundAddress,
  stripQuotedReply,
  taskIdFromRef,
  taskRef,
} from './project-email.js';

const TOKEN = '0123456789abcdef0123';
const TASK = '01a12296-7a2d-7ef3-aa54-cdfc64ba7da9';

describe('project addresses', () => {
  it('writes and reads the project address and a task reply address', () => {
    expect(inboundAddress(TOKEN, 'in.example.org')).toBe(`${TOKEN}@in.example.org`);
    const reply = inboundAddress(TOKEN, 'in.example.org', TASK);
    expect(reply).toBe(`${TOKEN}+01a122967a2d7ef3aa54cdfc64ba7da9@in.example.org`);
    expect(reply.split('@')[0]?.length).toBeLessThanOrEqual(64);
    expect(readInboundAddress(reply.toUpperCase(), 'IN.example.org')).toEqual({
      token: TOKEN,
      taskId: TASK,
    });
    expect(taskIdFromRef(taskRef(TASK))).toBe(TASK);
  });

  it('ignores other domains, other tokens, and a suffix that names no task', () => {
    expect(readInboundAddress(`${TOKEN}@elsewhere.org`, 'in.example.org')).toBeNull();
    expect(readInboundAddress('team@in.example.org', 'in.example.org')).toBeNull();
    expect(readInboundAddress(`${TOKEN}+urgent@in.example.org`, 'in.example.org')).toEqual({
      token: TOKEN,
      taskId: null,
    });
  });
});

describe('parseAddressList', () => {
  it('finds every address across headers, once, in lowercase', () => {
    expect(
      parseAddressList('"Doe, Jane" <Jane@X.com>, bob@y.org', ['jane@x.com', 'Cy <cy@z.io>'], null),
    ).toEqual(['jane@x.com', 'bob@y.org', 'cy@z.io']);
    expect(parseAddressList('undisclosed-recipients:;')).toEqual([]);
  });
});

describe('stripQuotedReply', () => {
  it('cuts at the quoted message in the usual shapes', () => {
    expect(
      stripQuotedReply('Sounds good.\n\nOn Mon, Oct 12, 2026 at 9:00 AM Ada wrote:\n> hi'),
    ).toBe('Sounds good.');
    expect(stripQuotedReply('Works.\nOn Mon, Oct 12, 2026 Ada <a@x.com>\nwrote:\n> hi')).toBe(
      'Works.',
    );
    expect(
      stripQuotedReply('Done\r\n\r\nFrom: Ada\r\nSent: Monday\r\nTo: Bea\r\nSubject: Re: x'),
    ).toBe('Done');
    expect(stripQuotedReply('Yes\n-----Original Message-----\nold')).toBe('Yes');
    expect(stripQuotedReply('Thanks\n-- \nBea, Leasing')).toBe('Thanks');
  });

  it('keeps everything when there is nothing but the quote', () => {
    expect(stripQuotedReply('> only a quote')).toBe('> only a quote');
    expect(stripQuotedReply('From: me, a line of thought')).toBe('From: me, a line of thought');
  });
});
