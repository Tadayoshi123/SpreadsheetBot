import { google } from "googleapis";
import type { sheets_v4 } from "googleapis";
import type { JWT } from "google-auth-library";
import type { AppConfig } from "./types.js";
import type { SheetsServiceRegistry } from "./service-registry.js";
import type { LastSubmission } from "./sheets.js";

const PORTAL_HEADERS = [
  "Track",
  "Link",
  "Surface",
  "Type",
  "Recommended Build",
  "Last updated",
  "Last submission (class, car, time, driver, date)",
] as const;

const COLUMN_COUNT = PORTAL_HEADERS.length;

const PORTAL_TITLE = "FH6 Community Tune Lab";
const PORTAL_SUBTITLE =
  "Community-driven car tuning & lap-time tier lists for Forza Horizon 6";
const PORTAL_CREDITS =
  "Concept originally created by SulexPagMan — Spreadsheets maintained by Fenrir & SpreadsheetBot";

/** 0-based layout: 4 banner rows, then the header row, then the data rows. */
const HEADER_ROW_INDEX = 4;
const DATA_START_ROW_INDEX = 5;

const DASH = "-";

function rgb(r: number, g: number, b: number): sheets_v4.Schema$Color {
  return { red: r / 255, green: g / 255, blue: b / 255 };
}

const COLOR = {
  bannerBg: rgb(11, 59, 57),
  headerBg: rgb(15, 118, 110),
  white: rgb(255, 255, 255),
  subtitleFg: rgb(225, 240, 238),
  creditFg: rgb(178, 212, 208),
  rowAltBg: rgb(236, 246, 245),
  border: rgb(180, 200, 198),
};

function a1EscapeSheetTitle(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

function spreadsheetUrl(spreadsheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
}

/** Best-effort short date (YYYY-MM-DD HH:mm UTC) from an ISO timestamp; "-" if invalid. */
function formatDate(iso: string): string {
  if (!iso) return DASH;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
  );
}

function lastSubmissionSummary(last: LastSubmission | null): string {
  if (!last) return DASH;
  const parts = [
    last.carClass || DASH,
    last.car || DASH,
    last.time || DASH,
    last.driver || DASH,
    formatDate(last.timestampIso),
  ];
  return parts.join(" · ");
}

type PortalRow = {
  label: string;
  url: string;
  cells: string[];
};

/**
 * Regenerate the portal spreadsheet's tab: a styled landing page (title,
 * subtitle, credits) plus one row per configured track with its metadata and
 * latest submission. No-op when the portal is not configured. Idempotent:
 * re-running overwrites values and formatting in place.
 */
export async function buildAndWritePortal(
  jwt: JWT,
  cfg: AppConfig,
  registry: SheetsServiceRegistry
): Promise<void> {
  if (!cfg.portal) return;

  const sheets = google.sheets({ version: "v4", auth: jwt });
  const { spreadsheetId, tabTitle } = cfg.portal;

  const sheetId = await ensurePortalTab(sheets, spreadsheetId, tabTitle);

  const rows: PortalRow[] = [];
  for (const track of cfg.tracks.values()) {
    let last: LastSubmission | null = null;
    try {
      last = await registry.getForTrack(track).readLastSubmission();
    } catch {
      last = null;
    }
    rows.push({
      label: track.label,
      url: spreadsheetUrl(track.spreadsheetId),
      cells: [
        track.label,
        track.label,
        track.surface ?? DASH,
        track.trackType ?? DASH,
        track.recommended ?? DASH,
        last ? formatDate(last.timestampIso) : DASH,
        lastSubmissionSummary(last),
      ],
    });
  }

  const escaped = a1EscapeSheetTitle(tabTitle);
  const blank = Array.from({ length: COLUMN_COUNT }, () => "");
  const bannerRow = (text: string) => [text, ...blank.slice(1)];

  const values: string[][] = [
    bannerRow(PORTAL_TITLE),
    bannerRow(PORTAL_SUBTITLE),
    bannerRow(PORTAL_CREDITS),
    [...blank],
    [...PORTAL_HEADERS],
    ...rows.map((r) => r.cells),
  ];

  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${escaped}!A1:Z`,
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${escaped}!A1`,
    valueInputOption: "RAW",
    requestBody: { values },
  });

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: buildFormattingRequests(sheetId, rows),
    },
  });
}

function buildFormattingRequests(
  sheetId: number,
  rows: PortalRow[]
): sheets_v4.Schema$Request[] {
  const lastRowExclusive = DATA_START_ROW_INDEX + rows.length;
  const requests: sheets_v4.Schema$Request[] = [];

  requests.push({
    updateSheetProperties: {
      properties: {
        sheetId,
        gridProperties: { frozenRowCount: HEADER_ROW_INDEX + 1 },
      },
      fields: "gridProperties.frozenRowCount",
    },
  });

  // Reset any previous merges in the banner area, then re-merge each banner row.
  requests.push({
    unmergeCells: {
      range: {
        sheetId,
        startRowIndex: 0,
        endRowIndex: HEADER_ROW_INDEX,
        startColumnIndex: 0,
        endColumnIndex: COLUMN_COUNT,
      },
    },
  });
  for (let r = 0; r < HEADER_ROW_INDEX; r++) {
    requests.push({
      mergeCells: {
        mergeType: "MERGE_ALL",
        range: {
          sheetId,
          startRowIndex: r,
          endRowIndex: r + 1,
          startColumnIndex: 0,
          endColumnIndex: COLUMN_COUNT,
        },
      },
    });
  }

  requests.push(
    bannerFormat(sheetId, 0, {
      backgroundColor: COLOR.bannerBg,
      textFormat: {
        foregroundColor: COLOR.white,
        bold: true,
        fontSize: 18,
      },
    }),
    bannerFormat(sheetId, 1, {
      backgroundColor: COLOR.bannerBg,
      textFormat: {
        foregroundColor: COLOR.subtitleFg,
        italic: true,
        fontSize: 11,
      },
    }),
    bannerFormat(sheetId, 2, {
      backgroundColor: COLOR.bannerBg,
      textFormat: {
        foregroundColor: COLOR.creditFg,
        italic: true,
        fontSize: 9,
      },
    }),
    bannerFormat(sheetId, 3, { backgroundColor: COLOR.bannerBg })
  );

  requests.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: HEADER_ROW_INDEX,
        endRowIndex: HEADER_ROW_INDEX + 1,
        startColumnIndex: 0,
        endColumnIndex: COLUMN_COUNT,
      },
      cell: {
        userEnteredFormat: {
          backgroundColor: COLOR.headerBg,
          horizontalAlignment: "LEFT",
          verticalAlignment: "MIDDLE",
          textFormat: { foregroundColor: COLOR.white, bold: true, fontSize: 10 },
        },
      },
      fields:
        "userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)",
    },
  });

  if (rows.length > 0) {
    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: DATA_START_ROW_INDEX,
          endRowIndex: lastRowExclusive,
          startColumnIndex: 0,
          endColumnIndex: COLUMN_COUNT,
        },
        cell: {
          userEnteredFormat: {
            verticalAlignment: "MIDDLE",
            wrapStrategy: "WRAP",
            textFormat: { fontSize: 10 },
          },
        },
        fields:
          "userEnteredFormat(verticalAlignment,wrapStrategy,textFormat)",
      },
    });

    for (let i = 0; i < rows.length; i++) {
      if (i % 2 === 1) {
        requests.push({
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: DATA_START_ROW_INDEX + i,
              endRowIndex: DATA_START_ROW_INDEX + i + 1,
              startColumnIndex: 0,
              endColumnIndex: COLUMN_COUNT,
            },
            cell: { userEnteredFormat: { backgroundColor: COLOR.rowAltBg } },
            fields: "userEnteredFormat.backgroundColor",
          },
        });
      }
    }

    requests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: DATA_START_ROW_INDEX,
          endRowIndex: lastRowExclusive,
          startColumnIndex: 0,
          endColumnIndex: 1,
        },
        cell: { userEnteredFormat: { textFormat: { bold: true } } },
        fields: "userEnteredFormat.textFormat.bold",
      },
    });

    // Track-name hyperlinks in the Link column via cell metadata (locale-safe;
    // no HYPERLINK formula so it works on French-locale spreadsheets).
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      requests.push({
        updateCells: {
          range: {
            sheetId,
            startRowIndex: DATA_START_ROW_INDEX + i,
            endRowIndex: DATA_START_ROW_INDEX + i + 1,
            startColumnIndex: 1,
            endColumnIndex: 2,
          },
          rows: [
            {
              values: [
                {
                  userEnteredValue: { stringValue: row.label },
                  textFormatRuns: [
                    { startIndex: 0, format: { link: { uri: row.url } } },
                  ],
                },
              ],
            },
          ],
          fields: "userEnteredValue,textFormatRuns",
        },
      });
    }

    const solid = {
      style: "SOLID" as const,
      color: COLOR.border,
    };
    requests.push({
      updateBorders: {
        range: {
          sheetId,
          startRowIndex: HEADER_ROW_INDEX,
          endRowIndex: lastRowExclusive,
          startColumnIndex: 0,
          endColumnIndex: COLUMN_COUNT,
        },
        top: solid,
        bottom: solid,
        left: solid,
        right: solid,
        innerHorizontal: solid,
        innerVertical: solid,
      },
    });
  }

  const widths: Record<number, number> = {
    0: 240,
    1: 220,
    2: 120,
    3: 110,
    4: 180,
    5: 150,
    6: 380,
  };
  for (const [col, px] of Object.entries(widths)) {
    requests.push({
      updateDimensionProperties: {
        range: {
          sheetId,
          dimension: "COLUMNS",
          startIndex: Number(col),
          endIndex: Number(col) + 1,
        },
        properties: { pixelSize: px },
        fields: "pixelSize",
      },
    });
  }

  requests.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: "ROWS", startIndex: 0, endIndex: 1 },
      properties: { pixelSize: 44 },
      fields: "pixelSize",
    },
  });

  return requests;
}

function bannerFormat(
  sheetId: number,
  rowIndex: number,
  format: sheets_v4.Schema$CellFormat
): sheets_v4.Schema$Request {
  return {
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: rowIndex,
        endRowIndex: rowIndex + 1,
        startColumnIndex: 0,
        endColumnIndex: COLUMN_COUNT,
      },
      cell: {
        userEnteredFormat: {
          horizontalAlignment: "CENTER",
          verticalAlignment: "MIDDLE",
          ...format,
        },
      },
      fields:
        "userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,textFormat)",
    },
  };
}

async function ensurePortalTab(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  tabTitle: string
): Promise<number> {
  const res = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties(sheetId,title)",
  });
  const found = res.data.sheets?.find((s) => s.properties?.title === tabTitle);
  const existingId = found?.properties?.sheetId;
  if (existingId != null) return existingId;

  const addRes = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: tabTitle } } }],
    },
  });
  const newId = addRes.data.replies?.[0]?.addSheet?.properties?.sheetId;
  if (newId == null) {
    throw new Error(`Failed to create portal tab "${tabTitle}".`);
  }
  return newId;
}
