/**
 * A number or a date goes in as it is; text a person typed is guarded, because
 * a spreadsheet runs a cell that starts like a formula.
 */
export type CsvCell = string | number | null | { raw: string };

/** Characters that make Excel, Sheets or Numbers read a cell as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * One cell, RFC 4180: quoted when it holds a comma, quote or line break, with
 * quotes doubled. Typed text that would start a formula gets a leading `'`,
 * the spreadsheet convention for "this is text" (OWASP's CSV injection advice).
 */
export function csvCell(cell: CsvCell): string {
  if (cell === null) return '';
  let text: string;
  if (typeof cell === 'number') text = Number.isFinite(cell) ? String(cell) : '';
  else if (typeof cell === 'object') text = cell.raw;
  else text = FORMULA_START.test(cell) ? `'${cell}` : cell;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * A whole file: CRLF rows, as RFC 4180 has them, after a byte-order mark so
 * Excel reads the file as UTF-8 rather than mangling every accent.
 */
export function toCsv(rows: readonly (readonly CsvCell[])[]): string {
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
