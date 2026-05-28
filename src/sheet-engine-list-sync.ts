import { google } from "googleapis";
import type { sheets_v4 } from "googleapis";
import type { JWT } from "google-auth-library";
import type { SheetConfig } from "./types.js";

/** Hidden sheet that holds enum lists for dropdowns (do not rename manually). */
export const ENGINE_LIST_SHEET_TITLE = "_BotEngines";

const DEFAULT_ENGINE_DROPDOWN_BUFFER_ROWS = 15;

/** Clears any legacy bulk validation (e.g. former 500-row sync) before re-applying. */
const ENGINE_VALIDATION_CLEAR_ROW_COUNT = 500;

function a1EscapeSheetTitle(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

async function withBackoff<T>(
  fn: () => Promise<T>,
  maxAttempts = 5
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e: unknown) {
      lastErr = e;
      const status = (e as { code?: number })?.code;
      const msg = String((e as Error)?.message ?? e);
      const retryable =
        status === 429 ||
        status === 503 ||
        /429|rate|Quota|UNAVAILABLE|backendError/i.test(msg);
      if (!retryable || attempt === maxAttempts) throw e;
      await new Promise((r) =>
        setTimeout(r, Math.min(8000, 400 * 2 ** (attempt - 1)))
      );
    }
  }
  throw lastErr;
}

function engineListRangeFormula(engineCount: number): string {
  return `=${a1EscapeSheetTitle(ENGINE_LIST_SHEET_TITLE)}!$A$1:$A$${engineCount}`;
}

function engineDropdownBufferRows(sheetConfig: SheetConfig): number {
  const n = sheetConfig.engineDropdownBufferRows;
  if (n == null) return DEFAULT_ENGINE_DROPDOWN_BUFFER_ROWS;
  if (!Number.isInteger(n) || n < 0) {
    throw new Error("engineDropdownBufferRows must be a non-negative integer.");
  }
  return n;
}

/** Last 1-based row with a non-empty car name in column B, or null if none. */
export async function findLastCarRow1Based(
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabTitle: string,
  dataStartRow: number
): Promise<number | null> {
  const range = `${a1EscapeSheetTitle(tabTitle)}!B${dataStartRow}:B`;
  const res = await withBackoff(() =>
    sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
      majorDimension: "ROWS",
    })
  );
  const rows = res.data.values ?? [];
  for (let i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i]?.[0] ?? "").trim()) {
      return dataStartRow + i;
    }
  }
  return null;
}

/** Inclusive last 1-based row for column I validation (one contiguous rule per tab). */
export function resolveEngineValidationEndRow1Based(
  dataStartRow: number,
  lastCarRow1Based: number | null,
  bufferRows: number
): number {
  const anchor = lastCarRow1Based ?? dataStartRow;
  return Math.max(dataStartRow, anchor + bufferRows);
}

function clearEngineValidationRequest(
  tabSheetId: number,
  dataStart0: number
): sheets_v4.Schema$Request {
  return {
    setDataValidation: {
      range: {
        sheetId: tabSheetId,
        startRowIndex: dataStart0,
        endRowIndex: dataStart0 + ENGINE_VALIDATION_CLEAR_ROW_COUNT,
        startColumnIndex: 8,
        endColumnIndex: 9,
      },
      rule: null as unknown as sheets_v4.Schema$DataValidationRule,
    },
  };
}

function setEngineValidationRequest(
  tabSheetId: number,
  dataStart0: number,
  endRow1BasedInclusive: number,
  rangeFormula: string
): sheets_v4.Schema$Request {
  return {
    setDataValidation: {
      range: {
        sheetId: tabSheetId,
        startRowIndex: dataStart0,
        endRowIndex: endRow1BasedInclusive,
        startColumnIndex: 8,
        endColumnIndex: 9,
      },
      rule: {
        condition: {
          type: "ONE_OF_RANGE",
          values: [{ userEnteredValue: rangeFormula }],
        },
        showCustomUi: true,
        strict: true,
      },
    },
  };
}

/**
 * Ensures a hidden `_BotEngines` sheet exists, writes the engine list from config,
 * and points column I dropdowns on every class tab to that range (one rule per tab,
 * from defaultDataStartRow through last car row + buffer).
 */
export async function syncEngineDropdownsForSpreadsheet(
  auth: JWT,
  spreadsheetId: string,
  sheetConfig: SheetConfig
): Promise<void> {
  const engines = sheetConfig.enums.engine;
  if (engines.length === 0) {
    throw new Error("No engines defined in sheet config.");
  }

  const bufferRows = engineDropdownBufferRows(sheetConfig);
  const sheets = google.sheets({ version: "v4", auth });

  const meta = await withBackoff(() =>
    sheets.spreadsheets.get({
      spreadsheetId,
      fields: "sheets.properties",
    })
  );

  const sheetProps = meta.data.sheets ?? [];
  let engineSheet = sheetProps.find(
    (s) => s.properties?.title === ENGINE_LIST_SHEET_TITLE
  );
  let engineSheetId = engineSheet?.properties?.sheetId;
  const creatingEngineSheet = engineSheetId == null;

  const setupRequests: sheets_v4.Schema$Request[] = [];

  if (engineSheetId == null) {
    setupRequests.push({
      addSheet: {
        properties: {
          title: ENGINE_LIST_SHEET_TITLE,
          hidden: true,
        },
      },
    });
  } else if (!engineSheet?.properties?.hidden) {
    setupRequests.push({
      updateSheetProperties: {
        properties: {
          sheetId: engineSheetId,
          hidden: true,
        },
        fields: "hidden",
      },
    });
  }

  if (setupRequests.length > 0) {
    const setupRes = await withBackoff(() =>
      sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: setupRequests },
      })
    );
    if (engineSheetId == null) {
      engineSheetId =
        setupRes.data.replies?.[0]?.addSheet?.properties?.sheetId ?? undefined;
    }
  }

  if (engineSheetId == null) {
    throw new Error(`Could not resolve sheet id for ${ENGINE_LIST_SHEET_TITLE}.`);
  }

  await withBackoff(() =>
    sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${a1EscapeSheetTitle(ENGINE_LIST_SHEET_TITLE)}!A1:A${engines.length}`,
      valueInputOption: "RAW",
      requestBody: {
        values: engines.map((e) => [e]),
      },
    })
  );

  const rangeFormula = engineListRangeFormula(engines.length);
  const dataStart0 = sheetConfig.defaultDataStartRow - 1;
  const validationRequests: sheets_v4.Schema$Request[] = [];

  for (const tabTitle of new Set(Object.values(sheetConfig.classToSheetTab))) {
    const tab = sheetProps.find((s) => s.properties?.title === tabTitle);
    const tabSheetId = tab?.properties?.sheetId;
    if (tabSheetId == null) {
      console.warn(
        `Skipping data validation: tab "${tabTitle}" not found in spreadsheet.`
      );
      continue;
    }

    const lastCarRow = await findLastCarRow1Based(
      sheets,
      spreadsheetId,
      tabTitle,
      sheetConfig.defaultDataStartRow
    );
    const endRow1Based = resolveEngineValidationEndRow1Based(
      sheetConfig.defaultDataStartRow,
      lastCarRow,
      bufferRows
    );

    console.log(
      `  ${tabTitle}: column I validation rows ${sheetConfig.defaultDataStartRow}–${endRow1Based}` +
        (lastCarRow != null ? ` (last car row ${lastCarRow})` : " (no cars yet)")
    );

    validationRequests.push(
      clearEngineValidationRequest(tabSheetId, dataStart0),
      setEngineValidationRequest(
        tabSheetId,
        dataStart0,
        endRow1Based,
        rangeFormula
      )
    );
  }

  if (creatingEngineSheet) {
    validationRequests.push({
      addProtectedRange: {
        protectedRange: {
          range: {
            sheetId: engineSheetId,
            startRowIndex: 0,
            endRowIndex: engines.length,
            startColumnIndex: 0,
            endColumnIndex: 1,
          },
          description:
            "Bot-managed engine list — edit config/sheets.json and run sync",
          warningOnly: false,
        },
      },
    });
  }

  await withBackoff(() =>
    sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: validationRequests },
    })
  );
}
