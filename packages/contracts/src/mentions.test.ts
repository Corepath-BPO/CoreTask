import { describe, expect, it } from 'vitest';

import {
  formatMention,
  MENTION_PATTERN,
  parseMentionIds,
  parseMentions,
  stripMentionTokens,
} from './mentions.js';

const ADA = '019fc880-0000-7000-8000-00000000aaaa';
const GRACE = '019fc880-0000-7000-8000-00000000bbbb';

describe('parseMentions', () => {
  it('finds nothing in a body without tokens', () => {
    expect(parseMentions('Just a normal comment about @ signs and [brackets].')).toEqual([]);
  });

  it('extracts the id and label of a mention', () => {
    expect(parseMentions(`Hey @[Ada Lovelace](${ADA}), take a look`)).toEqual([
      { userId: ADA, label: 'Ada Lovelace' },
    ]);
  });

  it('keeps the order they were written in', () => {
    const body = `@[Ada](${ADA}) and @[Grace](${GRACE})`;
    expect(parseMentions(body).map((m) => m.label)).toEqual(['Ada', 'Grace']);
  });

  /** One mention of a person, however many times their name appears. */
  it('de-duplicates the same user', () => {
    const body = `@[Ada](${ADA}) — sorry, @[Ada](${ADA}) again`;
    expect(parseMentions(body)).toHaveLength(1);
  });

  it('normalises the id case, so a token typed in caps still matches', () => {
    expect(parseMentions(`@[Ada](${ADA.toUpperCase()})`)[0]?.userId).toBe(ADA);
  });

  it('ignores a token whose id is not a UUID', () => {
    expect(parseMentions('@[Ada](not-a-uuid)')).toEqual([]);
    expect(parseMentions('@[Ada]()')).toEqual([]);
  });

  it('ignores an unterminated or malformed token', () => {
    expect(parseMentions(`@[Ada(${ADA})`)).toEqual([]);
    expect(parseMentions(`@Ada](${ADA})`)).toEqual([]);
  });

  it('reads tokens across newlines', () => {
    expect(parseMentionIds(`line one\n@[Ada](${ADA})\nline three`)).toEqual([ADA]);
  });

  /**
   * The pattern carries the global flag, which makes it stateful. Anything
   * reusing the exported constant directly would skip every other match, so the
   * helpers must not share one traversal.
   */
  it('returns the same result when called repeatedly', () => {
    const body = `@[Ada](${ADA}) @[Grace](${GRACE})`;

    expect(parseMentionIds(body)).toEqual([ADA, GRACE]);
    expect(parseMentionIds(body)).toEqual([ADA, GRACE]);
    expect(parseMentionIds(body)).toEqual([ADA, GRACE]);
  });

  it('leaves the exported pattern usable after a helper has run', () => {
    const body = `@[Ada](${ADA})`;
    parseMentionIds(body);

    expect(MENTION_PATTERN.lastIndex).toBe(0);
  });
});

describe('formatMention', () => {
  it('round-trips through the parser', () => {
    const token = formatMention(ADA, 'Ada Lovelace');
    expect(parseMentions(`Hi ${token}`)).toEqual([{ userId: ADA, label: 'Ada Lovelace' }]);
  });

  /** A `]` in a display name would otherwise end the label early. */
  it('strips brackets from a label so the token cannot be broken', () => {
    const token = formatMention(ADA, 'Ada [The Countess] Lovelace');

    expect(token).toBe(`@[Ada The Countess Lovelace](${ADA})`);
    expect(parseMentions(token)).toHaveLength(1);
  });
});

describe('stripMentionTokens', () => {
  it('leaves readable text for places that cannot render markup', () => {
    expect(stripMentionTokens(`Hey @[Ada Lovelace](${ADA}), look at this`)).toBe(
      'Hey @Ada Lovelace, look at this',
    );
  });

  it('leaves a body without tokens untouched', () => {
    expect(stripMentionTokens('Nothing to do here')).toBe('Nothing to do here');
  });

  it('handles several tokens in one body', () => {
    expect(stripMentionTokens(`@[Ada](${ADA}) and @[Grace](${GRACE})`)).toBe('@Ada and @Grace');
  });
});
