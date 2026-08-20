/**
 * A minimal RFC 4180 CSV parser.
 *
 * Hand-rolled rather than a dependency: the app parses exactly one CSV shape
 * (a project export), and the whole format fits in one state machine. Asana's
 * exports are the hard case this must survive — Notes cells embed commas,
 * double quotes and multi-line text, and the file opens with a UTF-8 BOM.
 *
 * Lenient by design: a malformed quote never throws data away, it degrades
 * the way spreadsheet apps do. The only fatal input is a quote that is still
 * open at the end of the file — there is no honest way to guess where that
 * field was meant to end.
 */

export interface ParsedCsv {
  /** The header row. The BOM, if any, is stripped from the first cell. */
  headers: string[];
  /** Data rows, each padded with '' to `headers.length`. */
  rows: string[][];
}

export class ImportParseError extends Error {
  constructor(
    message: string,
    /** 1-based line where the problem starts. */
    readonly line: number,
  ) {
    super(message);
    this.name = 'ImportParseError';
  }
}

export function parseCsv(text: string): ParsedCsv {
  // `File.text()` decodes a UTF-8 BOM to U+FEFF; it belongs to the encoding,
  // not the first header.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const records: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  /** Whether the current field opened with a quote — see the stray-quote rule. */
  let fieldWasQuoted = false;
  let line = 1;
  let quoteOpenedAt = 0;

  const endField = () => {
    row.push(field);
    field = '';
    fieldWasQuoted = false;
  };

  const endRecord = () => {
    endField();
    records.push(row);
    row = [];
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          // An escaped quote: `""` inside a quoted field is a literal `"`.
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        // Everything else is literal — including commas and newlines, which
        // is the whole reason quoted fields exist.
        if (ch === '\n') line++;
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      if (field === '' && !fieldWasQuoted) {
        inQuotes = true;
        fieldWasQuoted = true;
        quoteOpenedAt = line;
      } else {
        // A quote mid-field (or after a closed quote) is not valid CSV.
        // Excel keeps it as a literal character; losing data would be worse
        // than tolerating a sloppy writer, so this does the same.
        field += ch;
      }
      continue;
    }

    if (ch === ',') {
      endField();
      continue;
    }

    if (ch === '\n' || ch === '\r') {
      // \r\n counts once; a lone \r (old Mac exports) still ends the record.
      if (ch === '\r' && input[i + 1] === '\n') i++;
      line++;
      endRecord();
      continue;
    }

    field += ch;
  }

  if (inQuotes) {
    throw new ImportParseError(
      `A quoted value starting on line ${quoteOpenedAt} is never closed.`,
      quoteOpenedAt,
    );
  }

  // Flush the final record — but a trailing newline must not produce a
  // phantom row of one empty field.
  if (field !== '' || row.length > 0) endRecord();

  const [headers = [], ...rows] = records;

  return {
    headers: headers.map((header) => header.trim()),
    rows: rows.map((cells) => {
      // Asana omits trailing empty columns; padding keeps every row
      // addressable by header index. Longer rows keep their extra cells —
      // the mapper decides what to do with them.
      if (cells.length >= headers.length) return cells;
      return cells.concat(Array.from({ length: headers.length - cells.length }, () => ''));
    }),
  };
}
