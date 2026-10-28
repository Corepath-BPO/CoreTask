import { describe, expect, it } from 'vitest';

import { queryWords, rankByWords } from './gallery-search';

const cards = [
  'Assign whoever owns a section. When a task lands in a section, hand it to the person.',
  'Move completed tasks out of the way. When a task is completed, move it to Done.',
  'Give new tasks a due date. When a task is created, set its due date a week out.',
];

describe('queryWords', () => {
  it('keeps the words that say what is wanted, cut back to a stem', () => {
    expect(queryWords('Assigned tasks when they are moved to Week 1')).toEqual([
      'assign',
      'mov',
      'week',
    ]);
  });

  it('drops words every rule shares', () => {
    expect(queryWords('When a task is created, automate the rule')).toEqual(['creat']);
  });
});

describe('rankByWords', () => {
  const rank = (query: string) => rankByWords(cards, query, (card) => card).map((c) => c[0]);

  it('finds a card from a sentence, not only a keyword', () => {
    expect(rank('assign tasks when they move to a section')).toEqual(['A', 'M']);
  });

  it('puts the card sharing the most words first', () => {
    expect(rank('move completed work to done')).toEqual(['M']);
    expect(rank('set a due date when a task is moved')).toEqual(['G', 'M']);
  });

  it('keeps everything, in order, with nothing worth matching typed', () => {
    expect(rank('')).toEqual(['A', 'M', 'G']);
    expect(rank('the task')).toEqual(['A', 'M', 'G']);
  });

  it('leaves out a card that shares no word', () => {
    expect(rank('webhook')).toEqual([]);
  });
});
