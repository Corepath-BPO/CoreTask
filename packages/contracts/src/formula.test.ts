import { describe, expect, it } from 'vitest';

import {
  evaluateFormula,
  expressionToLabels,
  formulaReferences,
  labelsToExpression,
  parseFormula,
  validateFormula,
  type FormulaFieldRef,
} from './formula.js';

const EFFORT = '019fc880-0000-7000-8000-00000000e001';
const RATE = '019fc880-0000-7000-8000-00000000e002';
const START = '019fc880-0000-7000-8000-00000000e003';
const DUE = '019fc880-0000-7000-8000-00000000e004';
const TOTAL = '019fc880-0000-7000-8000-00000000e005';
const OTHER = '019fc880-0000-7000-8000-00000000e006';
const STARS = '019fc880-0000-7000-8000-00000000e007';
const NAME = '019fc880-0000-7000-8000-00000000e008';

const ref = (id: string) => `{field:${id}}`;

const fields = new Map<string, FormulaFieldRef>([
  [EFFORT, { id: EFFORT, name: 'Effort', type: 'NUMBER' }],
  [RATE, { id: RATE, name: 'Rate', type: 'NUMBER' }],
  [START, { id: START, name: 'Start', type: 'DATE' }],
  [DUE, { id: DUE, name: 'Due', type: 'DATE' }],
  [STARS, { id: STARS, name: 'Stars', type: 'RATING' }],
  [NAME, { id: NAME, name: 'Name', type: 'TEXT' }],
  [
    TOTAL,
    { id: TOTAL, name: 'Total', type: 'FORMULA', expression: `${ref(EFFORT)} * ${ref(RATE)}` },
  ],
  [OTHER, { id: OTHER, name: 'Other', type: 'FORMULA', expression: `${ref(TOTAL)} + 1` }],
]);

const ok = (expression: string, selfId?: string) => {
  const result = validateFormula(expression, { fields, selfId });
  if (!result.ok) throw new Error(result.error.message);
  return result;
};

const fails = (expression: string, selfId?: string) => {
  const result = validateFormula(expression, { fields, selfId });
  if (result.ok) throw new Error('expected a failure');
  return result.error;
};

describe('parseFormula', () => {
  it('respects precedence and brackets', () => {
    const parsed = parseFormula('1 + 2 * 3');
    expect(parsed.ok && parsed.ast).toEqual({
      kind: 'binary',
      op: '+',
      left: { kind: 'number', value: 1 },
      right: {
        kind: 'binary',
        op: '*',
        left: { kind: 'number', value: 2 },
        right: { kind: 'number', value: 3 },
      },
    });

    const bracketed = parseFormula('(1 + 2) * 3');
    expect(bracketed.ok && bracketed.ast.kind === 'binary' && bracketed.ast.op).toBe('*');
  });

  it('reads unary minus, decimals and field references', () => {
    const parsed = parseFormula(`-${ref(EFFORT)} * 0.5`);
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && formulaReferences(parsed.ast)).toEqual([EFFORT]);
  });

  it.each([
    ['', 'empty'],
    ['1 +', 'ends too soon'],
    ['(1 + 2', 'closing bracket'],
    ['1 2', 'end of the formula'],
    ['{field:nope}', 'not a field reference'],
    ['{field:' + EFFORT, 'not closed'],
    ['foo(1)', 'Unknown function'],
    ['today(1)', 'no arguments'],
    ['days_between(1)', 'two dates'],
    ['1 $ 2', 'Unexpected character'],
  ])('refuses %s', (expression, message) => {
    const parsed = parseFormula(expression);
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.error.message).toMatch(new RegExp(message, 'i'));
  });
});

describe('validateFormula', () => {
  it('accepts arithmetic over number, rating and formula fields', () => {
    expect(
      ok(`${ref(EFFORT)} * ${ref(RATE)} + ${ref(STARS)} - ${ref(TOTAL)} / 2`).references,
    ).toEqual([EFFORT, RATE, STARS, TOTAL]);
  });

  it('accepts days_between over dates and today()', () => {
    expect(ok(`days_between(${ref(START)}, ${ref(DUE)})`).ok).toBe(true);
    expect(ok(`days_between(today(), ${ref(DUE)}) * ${ref(RATE)}`).ok).toBe(true);
  });

  it('refuses a field that is not on the project, or not a number or date', () => {
    expect(fails(`${ref('019fc880-0000-7000-8000-00000000ffff')} + 1`).message).toMatch(
      /not on this project/,
    );
    expect(fails(`${ref(NAME)} + 1`).message).toMatch(/text field/);
  });

  it('refuses arithmetic on dates and a date as the answer', () => {
    expect(fails(`${ref(DUE)} - ${ref(START)}`).message).toMatch(/days_between/);
    expect(fails(`days_between(${ref(EFFORT)}, ${ref(DUE)})`).message).toMatch(/two dates/);
    expect(fails(`${ref(DUE)}`).message).toMatch(/work out to a number/);
    expect(fails('today()').message).toMatch(/work out to a number/);
  });

  it('refuses a formula that names itself, directly or through another', () => {
    expect(fails(`${ref(TOTAL)} + 1`, TOTAL).message).toMatch(/refer to itself/);
    // Total → Effort × Rate is fine; but Effort defined as Total would loop.
    expect(fails(`${ref(OTHER)} * 2`, TOTAL).message).toMatch(/loop/);
  });

  it('points at the reference it complains about', () => {
    const expression = `1 + ${ref('019fc880-0000-7000-8000-00000000ffff')}`;
    expect(fails(expression).position).toBe(4);
  });
});

describe('evaluateFormula', () => {
  const values: Record<string, number | Date | null> = {
    [EFFORT]: 3,
    [RATE]: 2.5,
    [STARS]: 4,
    [START]: new Date('2026-09-01T00:00:00.000Z'),
    [DUE]: new Date('2026-09-12T00:00:00.000Z'),
  };
  const ctx = {
    valueOf: (id: string) => values[id] ?? null,
    today: () => new Date('2026-09-10T00:00:00.000Z'),
  };
  const run = (expression: string) => {
    const parsed = parseFormula(expression);
    if (!parsed.ok) throw new Error(parsed.error.message);
    return evaluateFormula(parsed.ast, ctx);
  };

  it('does arithmetic', () => {
    expect(run(`${ref(EFFORT)} * ${ref(RATE)}`)).toBe(7.5);
    expect(run(`(${ref(EFFORT)} + 1) * 2 - ${ref(STARS)} / 2`)).toBe(6);
    expect(run(`-${ref(EFFORT)}`)).toBe(-3);
  });

  it('counts days, from midnight to midnight, and from today', () => {
    expect(run(`days_between(${ref(START)}, ${ref(DUE)})`)).toBe(11);
    expect(run(`days_between(${ref(DUE)}, ${ref(START)})`)).toBe(-11);
    expect(run(`days_between(today(), ${ref(DUE)})`)).toBe(2);
  });

  it('is null over an unset field, a zero divisor, and anything not finite', () => {
    expect(run(`${ref(TOTAL)} + 1`)).toBeNull();
    expect(run(`${ref(EFFORT)} / 0`)).toBeNull();
    expect(run(`days_between(${ref(START)}, ${ref(TOTAL)})`)).toBeNull();
  });
});

describe('labels', () => {
  const nameOf = (id: string) => fields.get(id)?.name;
  const idOf = (label: string) => {
    const matches = [...fields.values()].filter(
      (field) => field.name.toLowerCase() === label.toLowerCase(),
    );
    if (matches.length === 0) return undefined;
    if (matches.length > 1) return 'AMBIGUOUS' as const;
    return matches[0]?.id;
  };

  it('round-trips between ids and names', () => {
    const expression = `${ref(EFFORT)} * ${ref(RATE)}`;
    const text = expressionToLabels(expression, nameOf);
    expect(text).toBe('{Effort} * {Rate}');
    expect(labelsToExpression(text, idOf)).toEqual({ ok: true, expression });
  });

  it('leaves an unknown id alone on the way out, and names an unknown label on the way in', () => {
    const stray = '019fc880-0000-7000-8000-00000000ffff';
    expect(expressionToLabels(`${ref(stray)} + 1`, nameOf)).toBe(`${ref(stray)} + 1`);
    const result = labelsToExpression('{Nope} + 1', idOf);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.message).toMatch(/no field called “Nope”/);
  });

  it('refuses an ambiguous label', () => {
    const twice = (label: string) => (label === 'Effort' ? ('AMBIGUOUS' as const) : idOf(label));
    const result = labelsToExpression('{Effort} + 1', twice);
    expect(!result.ok && result.error.message).toMatch(/Two fields are called/);
  });
});
