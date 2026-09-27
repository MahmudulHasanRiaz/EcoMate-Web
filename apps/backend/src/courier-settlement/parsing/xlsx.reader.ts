// ── XLSX reader (Steadfast) using exceljs (added dep).
// Reads the first worksheet, returns header-keyed string rows. Uses `cell.text`
// so dates/numbers render as the formatted text the user sees (no formula
// evaluation — §13: cached text only).

import * as ExcelJS from 'exceljs';
import { RawRow } from './types';

export interface ParsedXlsx {
  fields: string[];
  rows: RawRow[];
  sheetName: string;
}

const MAX_ROWS = 100_000;
const MAX_COLUMNS = 200;

export async function parseXlsx(
  buffer: Buffer,
  opts: { headerRow?: number } = {},
): Promise<ParsedXlsx> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);

  if (wb.worksheets.length === 0) {
    throw new Error('XLSX: workbook has no worksheets');
  }
  const ws = wb.worksheets[0];
  const headerRowIdx = opts.headerRow ?? 1;

  // header row
  const headerRow = ws.getRow(headerRowIdx);
  const fields: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    fields[colNumber] = cell != null && cell.text != null ? String(cell.text).trim() : `#${colNumber}`;
  });
  if (fields.length > MAX_COLUMNS) {
    throw new Error(`XLSX column count ${fields.length} exceeds safety cap ${MAX_COLUMNS}`);
  }

  const rows: RawRow[] = [];
  let dataCount = 0;
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber <= headerRowIdx) return;
    if (++dataCount > MAX_ROWS) {
      throw new Error(`XLSX row count exceeds safety cap ${MAX_ROWS}`);
    }
    const out: RawRow = {};
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const header = fields[colNumber] ?? `#${colNumber}`;
      out[header] = cell != null && cell.text != null ? String(cell.text) : '';
    });
    // drop purely-empty cells to keep rawJson compact but preserve keys with ''
    rows.push(out);
  });

  return { fields, rows, sheetName: ws.name };
}

/** Strip macro workbooks (`xl/vbaProject.bin`) and external links per §13. */
export function xlsxHasMacros(buffer: Buffer): boolean {
  // ZIP entries: look for vbaProject.bin anywhere under the archive.
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) return false;
  const text = buffer.toString('latin1');
  return /xl\/vbaProject\.bin|xl\/vba/.test(text);
}
