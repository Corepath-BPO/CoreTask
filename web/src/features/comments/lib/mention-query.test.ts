import { describe, expect, it } from 'vitest';

import { applyMention, findMentionQuery, matchesQuery } from './mention-query';

const ADA = '019fc880-0000-7000-8000-00000000aaaa';

/** Caret defaults to the end, which is where it sits while typing. */
const at = (value: string, caret = value.length) => findMentionQuery(value, caret);

describe('findMentionQuery', () => {
  it('finds nothing in ordinary text', () => {
    expect(at('Just a comment')).toBeNull();
  });

  it('opens on a bare @ at the start', () => {
    expect(at('@')).toEqual({ start: 0, query: '' });
  });

  it('opens on an @ after whitespace', () => {
    expect(at('Ping @ma')).toEqual({ start: 5, query: 'ma' });
  });

  /** Otherwise every e-mail address in a comment pops the picker open. */
  it('ignores an @ in the middle of a word', () => {
    expect(at('mail me at ada@example.com')).toBeNull();
    expect(at('ada@ex')).toBeNull();
  });

  it('allows a space, so a surname can be reached', () => {
    expect(at('@Ada Lo')).toEqual({ start: 0, query: 'Ada Lo' });
  });

  it('closes once the @ is left standing alone', () => {
    expect(at('@ ')).toBeNull();
  });

  it('closes on a newline', () => {
    expect(at('@Ada\nnext line')).toBeNull();
  });

  it('closes once the query grows past a plausible name', () => {
    expect(at(`@${'x'.repeat(41)}`)).toBeNull();
  });

  /** A finished token contains brackets; the picker must not reopen inside one. */
  it('does not reopen inside a completed token', () => {
    expect(at(`@[Ada Lovelace](${ADA})`)).toBeNull();
  });

  it('reads the query up to the caret, not the end of the text', () => {
    const value = '@ma and some trailing words';
    expect(findMentionQuery(value, 3)).toEqual({ start: 0, query: 'ma' });
  });

  it('uses the nearest @ before the caret', () => {
    expect(at('@first then @second')).toEqual({ start: 12, query: 'second' });
  });
});

describe('matchesQuery', () => {
  const ada = { name: 'Ada Lovelace', email: 'ada@example.com' };

  it('matches everyone on an empty query', () => {
    expect(matchesQuery(ada, '')).toBe(true);
  });

  it('matches on any part of the name, case-insensitively', () => {
    expect(matchesQuery(ada, 'ada')).toBe(true);
    expect(matchesQuery(ada, 'LOVE')).toBe(true);
    expect(matchesQuery(ada, 'Ada Lo')).toBe(true);
  });

  it('matches on the e-mail, for people with a common first name', () => {
    expect(matchesQuery(ada, 'example.com')).toBe(true);
  });

  it('rejects a query that matches neither', () => {
    expect(matchesQuery(ada, 'grace')).toBe(false);
  });
});

describe('applyMention', () => {
  const user = { id: ADA, name: 'Ada Lovelace' };

  it('replaces the typed query with a token and a trailing space', () => {
    const value = 'Ping @ada';
    const result = applyMention(value, { start: 5, query: 'ada' }, value.length, user);

    expect(result.value).toBe(`Ping @[Ada Lovelace](${ADA}) `);
    expect(result.caret).toBe(result.value.length);
  });

  it('keeps text that follows the caret', () => {
    const value = 'Ping @ada about the bug';
    const result = applyMention(value, { start: 5, query: 'ada' }, 9, user);

    expect(result.value).toBe(`Ping @[Ada Lovelace](${ADA})  about the bug`);
  });

  /** The caret lands after the space, so the picker does not immediately reopen. */
  it('leaves the caret past the inserted token', () => {
    const value = 'Ping @ada about the bug';
    const result = applyMention(value, { start: 5, query: 'ada' }, 9, user);

    expect(findMentionQuery(result.value, result.caret)).toBeNull();
  });

  it('produces a token the parser accepts', () => {
    const value = '@ad';
    const result = applyMention(value, { start: 0, query: 'ad' }, value.length, user);

    expect(findMentionQuery(result.value, result.caret)).toBeNull();
    expect(result.value.trim()).toBe(`@[Ada Lovelace](${ADA})`);
  });
});
