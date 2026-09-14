/**
 * Formula fields: a small arithmetic language over a project's own fields.
 *
 *   expression := term (('+' | '-') term)*
 *   term       := unary (('*' | '/') unary)*
 *   unary      := '-' unary | primary
 *   primary    := NUMBER | FIELD_REF | call | '(' expression ')'
 *   call       := 'today' '(' ')' | 'days_between' '(' expression ',' expression ')'
 *   FIELD_REF  := '{field:' uuid '}'
 *
 * Two types: NUMBER (literals, number/rating/formula fields, arithmetic,
 * `days_between`) and DATE (date fields, `today()`). The root must be a
 * NUMBER. Pure and dependency-free, because the server validates with it and
 * the client both validates and renders with it; a formula that parses on
 * one side and not the other would be a field nobody could save.
 *
 * References are by field *id*, so a rename never breaks a formula. The
 * editor shows `{Effort}` and converts through `labelsToExpression`.
 */

import { FORMULA_MAX_DEPTH, FORMULA_MAX_LENGTH, FORMULA_MAX_REFERENCES } from './limits.js';

export type FormulaNode =
  | { kind: 'number'; value: number }
  | { kind: 'field'; id: string }
  | { kind: 'neg'; operand: FormulaNode }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/'; left: FormulaNode; right: FormulaNode }
  | { kind: 'call'; name: 'today' | 'days_between'; args: FormulaNode[] };

export interface FormulaError {
  message: string;
  /** Character offset into the expression, for the editor to point at. */
  position: number;
}

export type FormulaParseResult =
  { ok: true; ast: FormulaNode } | { ok: false; error: FormulaError };

/** `{field:<uuid>}` — the only way a formula names a field. */
export const FIELD_TOKEN =
  /\{field:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\}/gi;

type Token =
  | { type: 'number'; value: number; position: number }
  | { type: 'field'; id: string; position: number }
  | { type: 'ident'; name: string; position: number }
  | { type: 'op'; value: '+' | '-' | '*' | '/' | '(' | ')' | ','; position: number }
  | { type: 'end'; position: number };

function tokenize(expression: string): Token[] | FormulaError {
  const tokens: Token[] = [];
  let index = 0;

  while (index < expression.length) {
    const char = expression[index] as string;

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if ('+-*/(),'.includes(char)) {
      tokens.push({
        type: 'op',
        value: char as Token & { type: 'op' } extends { value: infer V } ? V : never,
        position: index,
      });
      index += 1;
      continue;
    }

    if (/[0-9.]/.test(char)) {
      const match = /^\d*\.?\d+|^\d+\.?/.exec(expression.slice(index));
      if (!match || match[0] === '.') {
        return { message: 'Expected a number.', position: index };
      }
      tokens.push({ type: 'number', value: Number(match[0]), position: index });
      index += match[0].length;
      continue;
    }

    if (char === '{') {
      const rest = expression.slice(index);
      const match = new RegExp(`^${FIELD_TOKEN.source}`, 'i').exec(rest);
      if (!match) {
        const close = rest.indexOf('}');
        return {
          message:
            close === -1 ? 'A field reference is not closed.' : 'That is not a field reference.',
          position: index,
        };
      }
      tokens.push({ type: 'field', id: (match[1] as string).toLowerCase(), position: index });
      index += match[0].length;
      continue;
    }

    if (/[A-Za-z_]/.test(char)) {
      const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(expression.slice(index)) as RegExpExecArray;
      tokens.push({ type: 'ident', name: match[0].toLowerCase(), position: index });
      index += match[0].length;
      continue;
    }

    return { message: `Unexpected character “${char}”.`, position: index };
  }

  tokens.push({ type: 'end', position: expression.length });
  return tokens;
}

class Parser {
  private index = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): FormulaNode {
    const node = this.expression();
    const token = this.peek();
    if (token.type !== 'end') {
      throw new ParseFailure('Expected the end of the formula.', token.position);
    }
    return node;
  }

  private peek(): Token {
    return this.tokens[this.index] as Token;
  }

  private take(): Token {
    const token = this.peek();
    this.index += 1;
    return token;
  }

  private isOp(token: Token, ...values: string[]): token is Token & { type: 'op' } {
    return token.type === 'op' && values.includes(token.value);
  }

  private expression(): FormulaNode {
    let left = this.term();
    for (;;) {
      const token = this.peek();
      if (!this.isOp(token, '+', '-')) return left;
      this.take();
      left = { kind: 'binary', op: token.value as '+' | '-', left, right: this.term() };
    }
  }

  private term(): FormulaNode {
    let left = this.unary();
    for (;;) {
      const token = this.peek();
      if (!this.isOp(token, '*', '/')) return left;
      this.take();
      left = { kind: 'binary', op: token.value as '*' | '/', left, right: this.unary() };
    }
  }

  private unary(): FormulaNode {
    const token = this.peek();
    if (this.isOp(token, '-')) {
      this.take();
      return { kind: 'neg', operand: this.unary() };
    }
    return this.primary();
  }

  private primary(): FormulaNode {
    const token = this.take();

    switch (token.type) {
      case 'number':
        return { kind: 'number', value: token.value };
      case 'field':
        return { kind: 'field', id: token.id };
      case 'ident':
        return this.call(token);
      case 'op':
        if (token.value === '(') {
          const inner = this.expression();
          const close = this.take();
          if (!this.isOp(close, ')')) {
            throw new ParseFailure('Expected a closing bracket.', close.position);
          }
          return inner;
        }
        throw new ParseFailure(`Unexpected “${token.value}”.`, token.position);
      case 'end':
        throw new ParseFailure('The formula ends too soon.', token.position);
    }
  }

  private call(token: Token & { type: 'ident' }): FormulaNode {
    const open = this.take();
    if (!this.isOp(open, '(')) {
      throw new ParseFailure(`“${token.name}” must be followed by brackets.`, open.position);
    }

    if (token.name === 'today') {
      const close = this.take();
      if (!this.isOp(close, ')')) {
        throw new ParseFailure('today() takes no arguments.', close.position);
      }
      return { kind: 'call', name: 'today', args: [] };
    }

    if (token.name === 'days_between') {
      const first = this.expression();
      const comma = this.take();
      if (!this.isOp(comma, ',')) {
        throw new ParseFailure(
          'days_between needs two dates, separated by a comma.',
          comma.position,
        );
      }
      const second = this.expression();
      const close = this.take();
      if (!this.isOp(close, ')')) {
        throw new ParseFailure('Expected a closing bracket.', close.position);
      }
      return { kind: 'call', name: 'days_between', args: [first, second] };
    }

    throw new ParseFailure(`Unknown function “${token.name}”.`, token.position);
  }
}

class ParseFailure extends Error {
  constructor(
    message: string,
    readonly position: number,
  ) {
    super(message);
  }
}

/** Syntax only. Whether the fields exist is `validateFormula`'s question. */
export function parseFormula(expression: string): FormulaParseResult {
  if (expression.trim() === '')
    return { ok: false, error: { message: 'The formula is empty.', position: 0 } };
  if (expression.length > FORMULA_MAX_LENGTH) {
    return {
      ok: false,
      error: {
        message: `A formula is at most ${FORMULA_MAX_LENGTH} characters.`,
        position: FORMULA_MAX_LENGTH,
      },
    };
  }

  const tokens = tokenize(expression);
  if (!Array.isArray(tokens)) return { ok: false, error: tokens };

  try {
    return { ok: true, ast: new Parser(tokens).parse() };
  } catch (error) {
    if (error instanceof ParseFailure) {
      return { ok: false, error: { message: error.message, position: error.position } };
    }
    throw error;
  }
}

/** Every field a formula reads, in the order first named, without repeats. */
export function formulaReferences(ast: FormulaNode): string[] {
  const seen = new Set<string>();
  const walk = (node: FormulaNode): void => {
    switch (node.kind) {
      case 'field':
        seen.add(node.id);
        return;
      case 'neg':
        walk(node.operand);
        return;
      case 'binary':
        walk(node.left);
        walk(node.right);
        return;
      case 'call':
        node.args.forEach(walk);
        return;
      default:
        return;
    }
  };
  walk(ast);
  return [...seen];
}

/** What the validator needs to know about a field a formula may name. */
export interface FormulaFieldRef {
  id: string;
  name: string;
  type: string;
  /** Present for a FORMULA field, so cycles through it can be followed. */
  expression?: string | null | undefined;
}

export interface FormulaContext {
  fields: ReadonlyMap<string, FormulaFieldRef>;
  /** The field being defined, so it cannot name itself. */
  selfId?: string | undefined;
}

export type FormulaValidation =
  { ok: true; ast: FormulaNode; references: string[] } | { ok: false; error: FormulaError };

const NUMBER_TYPES = new Set(['NUMBER', 'RATING', 'FORMULA']);

type ValueType = 'NUMBER' | 'DATE';

/**
 * Syntax, references, types, cycles and size — everything the server checks
 * before a formula is saved, and everything the editor shows while one is
 * typed.
 */
export function validateFormula(expression: string, ctx: FormulaContext): FormulaValidation {
  const parsed = parseFormula(expression);
  if (!parsed.ok) return parsed;

  const references = formulaReferences(parsed.ast);
  if (references.length > FORMULA_MAX_REFERENCES) {
    return {
      ok: false,
      error: {
        message: `A formula may name at most ${FORMULA_MAX_REFERENCES} fields.`,
        position: 0,
      },
    };
  }

  try {
    typeOf(parsed.ast, ctx, expression);
    for (const id of references) {
      assertNoCycle(id, ctx, [ctx.selfId ?? ''], 1, expression);
    }
  } catch (error) {
    if (error instanceof ParseFailure) {
      return { ok: false, error: { message: error.message, position: error.position } };
    }
    throw error;
  }

  if (typeOf(parsed.ast, ctx, expression) !== 'NUMBER') {
    return { ok: false, error: { message: 'A formula must work out to a number.', position: 0 } };
  }

  return { ok: true, ast: parsed.ast, references };
}

function positionOf(expression: string, id: string): number {
  const index = expression.toLowerCase().indexOf(`{field:${id}}`);
  return index === -1 ? 0 : index;
}

function typeOf(node: FormulaNode, ctx: FormulaContext, expression: string): ValueType {
  switch (node.kind) {
    case 'number':
      return 'NUMBER';
    case 'field': {
      if (node.id === ctx.selfId) {
        throw new ParseFailure(
          'A formula cannot refer to itself.',
          positionOf(expression, node.id),
        );
      }
      const field = ctx.fields.get(node.id);
      if (!field) {
        throw new ParseFailure(
          'That field is not on this project.',
          positionOf(expression, node.id),
        );
      }
      if (NUMBER_TYPES.has(field.type)) return 'NUMBER';
      if (field.type === 'DATE') return 'DATE';
      throw new ParseFailure(
        `“${field.name}” is a ${field.type.toLowerCase().replace('_', ' ')} field; only number, rating, formula and date fields can be used.`,
        positionOf(expression, node.id),
      );
    }
    case 'neg':
      if (typeOf(node.operand, ctx, expression) !== 'NUMBER') {
        throw new ParseFailure('Only a number can be negated.', 0);
      }
      return 'NUMBER';
    case 'binary': {
      const left = typeOf(node.left, ctx, expression);
      const right = typeOf(node.right, ctx, expression);
      if (left !== 'NUMBER' || right !== 'NUMBER') {
        throw new ParseFailure(
          'Dates cannot be added, subtracted, multiplied or divided; use days_between().',
          0,
        );
      }
      return 'NUMBER';
    }
    case 'call':
      if (node.name === 'today') return 'DATE';
      for (const arg of node.args) {
        if (typeOf(arg, ctx, expression) !== 'DATE') {
          throw new ParseFailure('days_between() takes two dates.', 0);
        }
      }
      return 'NUMBER';
  }
}

function assertNoCycle(
  id: string,
  ctx: FormulaContext,
  stack: string[],
  depth: number,
  expression: string,
): void {
  if (stack.includes(id)) {
    throw new ParseFailure(
      'These formulas refer to each other in a loop.',
      positionOf(expression, id),
    );
  }
  if (depth > FORMULA_MAX_DEPTH) {
    throw new ParseFailure(
      `Formulas may only nest ${FORMULA_MAX_DEPTH} deep.`,
      positionOf(expression, id),
    );
  }

  const field = ctx.fields.get(id);
  if (!field || field.type !== 'FORMULA' || !field.expression) return;

  const parsed = parseFormula(field.expression);
  if (!parsed.ok) return;

  for (const next of formulaReferences(parsed.ast)) {
    assertNoCycle(next, ctx, [...stack, id], depth + 1, expression);
  }
}

export type FormulaValue = number | Date | null;

export interface EvaluationContext {
  /** The task's value for a field: a number, a date, or nothing. */
  valueOf: (fieldId: string) => FormulaValue;
  today: () => Date;
}

const DAY_MS = 86_400_000;

function utcMidnight(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * A number, or null. Null anywhere is null everywhere — a formula over an
 * unset field has no answer, and `0` would be a lie. Division by zero, NaN
 * and infinity are null for the same reason.
 */
export function evaluateFormula(ast: FormulaNode, ctx: EvaluationContext): number | null {
  const result = evaluate(ast, ctx);
  if (result === null || result instanceof Date) return null;
  return Number.isFinite(result) ? result : null;
}

function evaluate(node: FormulaNode, ctx: EvaluationContext): FormulaValue {
  switch (node.kind) {
    case 'number':
      return node.value;
    case 'field':
      return ctx.valueOf(node.id);
    case 'neg': {
      const value = evaluate(node.operand, ctx);
      return typeof value === 'number' ? -value : null;
    }
    case 'binary': {
      const left = evaluate(node.left, ctx);
      const right = evaluate(node.right, ctx);
      if (typeof left !== 'number' || typeof right !== 'number') return null;
      switch (node.op) {
        case '+':
          return left + right;
        case '-':
          return left - right;
        case '*':
          return left * right;
        case '/':
          return right === 0 ? null : left / right;
      }
      return null;
    }
    case 'call': {
      if (node.name === 'today') return ctx.today();
      const [a, b] = node.args.map((arg) => evaluate(arg, ctx));
      if (!(a instanceof Date) || !(b instanceof Date)) return null;
      return Math.round((utcMidnight(b) - utcMidnight(a)) / DAY_MS);
    }
  }
}

/** `{field:<uuid>}` → `{Effort}`, for the editor. An unknown id stays as it is. */
export function expressionToLabels(
  expression: string,
  nameOf: (fieldId: string) => string | undefined,
): string {
  return expression.replace(new RegExp(FIELD_TOKEN.source, 'gi'), (match, id: string) => {
    const name = nameOf(id.toLowerCase());
    return name === undefined ? match : `{${name}}`;
  });
}

export type LabelLookup = (label: string) => string | 'AMBIGUOUS' | undefined;

/**
 * `{Effort}` → `{field:<uuid>}`, for saving. A label two fields share is
 * refused rather than guessed, and one nobody has is named in the error.
 */
export function labelsToExpression(
  text: string,
  idOf: LabelLookup,
): { ok: true; expression: string } | { ok: false; error: FormulaError } {
  let error: FormulaError | null = null;

  const expression = text.replace(/\{([^{}]+)\}/g, (match, label: string, offset: number) => {
    if (error) return match;
    const trimmed = label.trim();
    if (/^field:/i.test(trimmed)) return match;

    const id = idOf(trimmed);
    if (id === undefined) {
      error = {
        message: `There is no field called “${trimmed}” on this project.`,
        position: offset,
      };
      return match;
    }
    if (id === 'AMBIGUOUS') {
      error = {
        message: `Two fields are called “${trimmed}”; rename one so the formula can tell them apart.`,
        position: offset,
      };
      return match;
    }
    return `{field:${id}}`;
  });

  return error ? { ok: false, error } : { ok: true, expression };
}
