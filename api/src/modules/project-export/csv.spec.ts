import { csvCell, toCsv } from './csv';

describe('csv', () => {
  it('quotes what needs quoting and doubles quotes', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('Rent, deposit')).toBe('"Rent, deposit"');
    expect(csvCell('the "big" one')).toBe('"the ""big"" one"');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(null)).toBe('');
  });

  it('keeps typed text from running as a formula, but not numbers or dates', () => {
    expect(csvCell('=HYPERLINK("http://evil")')).toBe('"\'=HYPERLINK(""http://evil"")"');
    expect(csvCell('+1 555')).toBe("'+1 555");
    expect(csvCell('@sum')).toBe("'@sum");
    expect(csvCell('-not a number')).toBe("'-not a number");
    expect(csvCell(-12.5)).toBe('-12.5');
    expect(csvCell({ raw: '2026-10-14' })).toBe('2026-10-14');
    expect(csvCell(Number.NaN)).toBe('');
  });

  it('writes a BOM, then CRLF rows', () => {
    expect(
      toCsv([
        ['Name', 'Due'],
        ['Renew', { raw: '2026-10-30' }],
      ]),
    ).toBe('\uFEFFName,Due\r\nRenew,2026-10-30\r\n');
  });
});
