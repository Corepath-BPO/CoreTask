import { describe, expect, it } from 'vitest';

import { ImportParseError, parseCsv } from './parse-csv';

describe('parseCsv', () => {
  it('parses plain rows', () => {
    const { headers, rows } = parseCsv('a,b,c\n1,2,3\n4,5,6');
    expect(headers).toEqual(['a', 'b', 'c']);
    expect(rows).toEqual([
      ['1', '2', '3'],
      ['4', '5', '6'],
    ]);
  });

  it('keeps commas inside quoted fields', () => {
    const { rows } = parseCsv('a,b\n"one, two",3');
    expect(rows).toEqual([['one, two', '3']]);
  });

  it('unescapes doubled quotes', () => {
    const { rows } = parseCsv('a\n"say ""hi"" now"');
    expect(rows).toEqual([['say "hi" now']]);
  });

  it('keeps newlines inside quoted fields, LF and CRLF alike', () => {
    const { rows } = parseCsv('a,b\n"line one\nline two",x\n"crlf\r\nhere",y');
    expect(rows).toEqual([
      ['line one\nline two', 'x'],
      ['crlf\r\nhere', 'y'],
    ]);
  });

  it('round-trips a large multi-line cell intact', () => {
    const notes = Array.from({ length: 200 }, (_, i) => `bullet ${i}, "quoted"`).join('\n');
    const escaped = notes.replaceAll('"', '""');
    const { rows } = parseCsv(`name,notes\ntask,"${escaped}"`);
    expect(rows[0]?.[1]).toBe(notes);
  });

  it('treats CRLF, LF and lone CR as record separators', () => {
    const { rows } = parseCsv('a\r\n1\r2\n3');
    expect(rows).toEqual([['1'], ['2'], ['3']]);
  });

  it('strips a UTF-8 BOM from the first header only', () => {
    const { headers } = parseCsv('﻿a,b\n1,2');
    expect(headers).toEqual(['a', 'b']);
  });

  it('pads short rows to the header length', () => {
    const { rows } = parseCsv('a,b,c,d\n1,2');
    expect(rows).toEqual([['1', '2', '', '']]);
  });

  it('keeps extra cells on rows longer than the header', () => {
    const { rows } = parseCsv('a,b\n1,2,3');
    expect(rows).toEqual([['1', '2', '3']]);
  });

  it('does not emit a phantom row for a trailing newline', () => {
    const { rows } = parseCsv('a,b\n1,2\n');
    expect(rows).toHaveLength(1);
  });

  it('keeps empty fields between commas', () => {
    const { rows } = parseCsv('a,b,c\n1,,3');
    expect(rows).toEqual([['1', '', '3']]);
  });

  it('tolerates a stray quote mid-field as a literal character', () => {
    const { rows } = parseCsv('a,b\nsay "hi",2');
    expect(rows).toEqual([['say "hi"', '2']]);
  });

  it('keeps text after a closing quote rather than dropping it', () => {
    const { rows } = parseCsv('a,b\n"one" more,2');
    expect(rows).toEqual([['one more', '2']]);
  });

  it('throws with the opening line number for an unterminated quote', () => {
    expect(() => parseCsv('a,b\n1,"never closed')).toThrowError(ImportParseError);
    try {
      parseCsv('a,b\n1,"never closed');
    } catch (error) {
      expect((error as ImportParseError).line).toBe(2);
    }
  });
});
