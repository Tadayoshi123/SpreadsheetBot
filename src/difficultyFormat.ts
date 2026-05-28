import type { sheets_v4 } from "googleapis";

/** Column F (Difficulty), zero-based. */
export const DIFFICULTY_COLUMN_INDEX = 5;

export type DifficultyFormatMap = Map<string, sheets_v4.Schema$CellFormat>;

export function a1EscapeSheetTitle(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

export function difficultyCellText(
  cell: sheets_v4.Schema$CellData | undefined
): string {
  if (!cell) return "";
  const formatted = cell.formattedValue?.trim();
  if (formatted) return formatted;
  const entered = cell.userEnteredValue;
  if (entered?.stringValue?.trim()) return entered.stringValue.trim();
  return "";
}

/** Parse `='Sheet'!$A$1:$A$8` or `=$A$1:$A$8` from a ONE_OF_RANGE validation formula. */
export function parseOneOfRangeReference(
  formula: string
): { sheetTitle: string | null; a1Range: string } | null {
  const body = formula.trim().replace(/^=/, "");
  const bang = body.indexOf("!");
  if (bang >= 0) {
    let sheet = body.slice(0, bang);
    if (sheet.startsWith("'") && sheet.endsWith("'")) {
      sheet = sheet.slice(1, -1).replace(/''/g, "'");
    }
    const a1Range = body.slice(bang + 1).trim();
    if (!a1Range) return null;
    return { sheetTitle: sheet, a1Range };
  }
  if (/^\$?[A-Za-z]+\$?\d+/i.test(body)) {
    return { sheetTitle: null, a1Range: body };
  }
  return null;
}

export function validationListRangeA1(
  parsed: { sheetTitle: string | null; a1Range: string },
  defaultTabTitle: string
): string {
  const sheet = parsed.sheetTitle ?? defaultTabTitle;
  return `${a1EscapeSheetTitle(sheet)}!${parsed.a1Range}`;
}

function gridRangeCoversDifficultyColumn(
  range: sheets_v4.Schema$GridRange,
  sheetId: number
): boolean {
  if (range.sheetId != null && range.sheetId !== sheetId) return false;
  const startCol = range.startColumnIndex ?? 0;
  const endCol = range.endColumnIndex ?? 999;
  return startCol <= DIFFICULTY_COLUMN_INDEX && endCol > DIFFICULTY_COLUMN_INDEX;
}

function conditionLabel(condition: sheets_v4.Schema$BooleanCondition): string | null {
  const type = condition.type;
  if (type !== "TEXT_EQ" && type !== "TEXT_NOT_EQ") return null;
  const raw = condition.values?.[0]?.userEnteredValue?.trim();
  return raw || null;
}

/** Colours from conditional-format rules that target column F (e.g. text equals "Hard"). */
export function mergeDifficultyFormatsFromConditionalRules(
  map: DifficultyFormatMap,
  rules: readonly sheets_v4.Schema$ConditionalFormatRule[] | undefined,
  sheetId: number
): void {
  for (const rule of rules ?? []) {
    const booleanRule = rule.booleanRule;
    if (!booleanRule?.format) continue;
    if (
      !rule.ranges?.some((r) => gridRangeCoversDifficultyColumn(r, sheetId))
    ) {
      continue;
    }
    const label = conditionLabel(booleanRule.condition ?? {});
    if (!label) continue;
    map.set(label.toLowerCase(), booleanRule.format);
  }
}

export function cellFormatForDifficultyStyle(
  cell: sheets_v4.Schema$CellData | undefined
): sheets_v4.Schema$CellFormat | null {
  if (!cell) return null;
  return cell.effectiveFormat ?? cell.userEnteredFormat ?? null;
}

/** Colours from each styled cell in the dropdown source range (ONE_OF_RANGE list). */
export function mergeDifficultyFormatsFromGridRows(
  map: DifficultyFormatMap,
  rowData: readonly sheets_v4.Schema$RowData[] | undefined
): void {
  for (const row of rowData ?? []) {
    for (const cell of row.values ?? []) {
      const label = difficultyCellText(cell);
      if (!label) continue;
      const format = cellFormatForDifficultyStyle(cell);
      if (!format) continue;
      map.set(label.toLowerCase(), format);
    }
  }
}

/** Apply a resolved format to column F on one row. */
export function buildApplyDifficultyFormatRequest(
  sheetId: number,
  targetRowZeroBased: number,
  format: sheets_v4.Schema$CellFormat
): sheets_v4.Schema$Request {
  return {
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: targetRowZeroBased,
        endRowIndex: targetRowZeroBased + 1,
        startColumnIndex: DIFFICULTY_COLUMN_INDEX,
        endColumnIndex: DIFFICULTY_COLUMN_INDEX + 1,
      },
      cell: { userEnteredFormat: format },
      fields:
        "userEnteredFormat.backgroundColor,userEnteredFormat.textFormat",
    },
  };
}

/** Fallback: copy column F styling from another data row with the same label. */
export function buildCopyDifficultyFormatRequest(
  sheetId: number,
  sourceRowZeroBased: number,
  targetRowZeroBased: number
): sheets_v4.Schema$Request {
  const col = DIFFICULTY_COLUMN_INDEX;
  const oneRow = (row: number) => ({
    sheetId,
    startRowIndex: row,
    endRowIndex: row + 1,
    startColumnIndex: col,
    endColumnIndex: col + 1,
  });
  return {
    copyPaste: {
      source: oneRow(sourceRowZeroBased),
      destination: oneRow(targetRowZeroBased),
      pasteType: "PASTE_FORMAT",
    },
  };
}
