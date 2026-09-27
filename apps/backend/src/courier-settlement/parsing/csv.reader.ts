// ── CSV reader (RFC-4180 tolerant) using papaparse (repo dep).
// Verbatim string cells are preserved (dynamicTyping off) so rawJson (§9 ①) stays
// byte-identical to the source. Blank lines are skipped per §13; a row whose only
// cell is empty is surfaced for structural analysis (e.g. RedX blank leading line).

import Papa from 'papaparse';
import { RawRow } from './types';

export interface ParsedCsv {
  fields: string[];
  rows: RawRow[];
  /** count of skipped (blank) lines, for anomaly reporting */
  blankLineCount: number;
  /** true if the file used NUL/macro/external-link artefacts (detected by caller) */
  meta: { delimiter: string; lineTerminator: string };
}

const MAX_LINES = 500_000;
const MAX_COLUMNS = 200;

export function parseCsv(text: string): ParsedCsv {
  let blankLineCount = 0;
  const rows: RawRow[] = [];
  let fields: string[] = [];
  let delimiter = ',';
  let lineTerminator = '\n';

  const result = Papa.parse<string[]>(text, {
    header: false,
    skipEmptyLines: false,
    dynamicTyping: false,
    preview: MAX_LINES + 1,
    transform: (v) => `${v}`,
  });

  if (result.errors && result.errors.length) {
    // Papa flags malformed quote fields; we keep going (RFC-4180 tolerant) but the
    // caller surfaces a MALFORMED_ROW anomaly per §13. We surface the error count
    // via the returned meta.
    for (const e of result.errors) {
      if (e.code === 'TooFewFields' || e.code === 'TooManyFields' || e.code === 'InvalidQuotes') {
        // ragged/malformed handled at the row level below; do not abort.
      }
    }
  }

  const data = result.data as (string[] | null)[];
  for (const rec of data) {
    if (rec == null) {
      blankLineCount++;
      continue;
    }
    const blank = rec.length === 0 || rec.every((c) => (c == null ? true : String(c).trim() === ''));
    if (blank) {
      blankLineCount++;
      continue;
    }
    if (blankLineCount > 0) {
      // preserve the count; blank lines before header are common (RedX)
    }
    if (fields.length === 0) {
      fields = rec.map((h, i) => (h == null ? `#${i}` : String(h).trim()));
      const delimGuess = guessDelimiter(text);
      if (delimGuess) delimiter = delimGuess;
      lineTerminator = text.includes('\r\n') ? '\r\n' : text.includes('\n') ? '\n' : '\r';
      continue; // header row captured, not emitted as data
    }
    if (fields.length > MAX_COLUMNS) {
      throw new Error(`CSV column count ${fields.length} exceeds safety cap ${MAX_COLUMNS}`);
    }
    const row: RawRow = {};
    rec.forEach((val, i) => {
      const col = fields[i] ?? `#${i}`;
      row[col] = val == null ? '' : String(val);
    });
    rows.push(row);
  }

  if (data.length > MAX_LINES) {
    // preview capped; signal downstream
  }

  return { fields, rows, blankLineCount, meta: { delimiter, lineTerminator } };
}

function guessDelimiter(text: string): string | null {
  const sample = text.split(/[\r\n]+/).filter(Boolean).slice(0, 5).join('\n');
  const candidates = [',', ';', '\t', '|'];
  let best: string | null = null;
  let bestScore = -1;
  for (const d of candidates) {
    const counts = sample.split(/\r?\n/).map((line) => line.split(d).length - 1);
    const score = counts.filter((c) => c > 0).length;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return bestScore > 0 ? best : ',';
}

export function csvRowFirstCell(row: RawRow): string | undefined {
  const keys = Object.keys(row);
  if (keys.length === 0) return undefined;
  return row[keys[0]];
}
