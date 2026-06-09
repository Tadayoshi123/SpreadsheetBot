import { google } from "googleapis";
import type { sheets_v4 } from "googleapis";
import type { JWT } from "google-auth-library";
import type { AppConfig } from "./types.js";
import type { SheetsServiceRegistry } from "./service-registry.js";
import type { LastSubmission } from "./sheets.js";

const COL_COUNT = 7;
const DASH = "-";

const TABLE_HEADERS = [
  "Track",
  "Link",
  "Surface",
  "Type",
  "Meta focus",
  "Last updated",
  "Last submission (class, car, time, driver, date)",
] as const;

const TITLE = "FH6 Community Tune Lab by Fenrir";
const TAGLINE =
  "Community-driven Forza Horizon 6 tier lists — cars, tunes and lap times, track by track.";

const WELCOME =
  "FH6 Community Tune Lab catalogs and tests cars, their tunes and the lap times they achieve on specific Forza Horizon 6 tracks. " +
  "Each track has its own sheet organized as a tier list, so anyone can quickly read the current meta: which cars perform, with which build, and how fast. " +
  "Use the table at the bottom of this page to jump to any track sheet.";

const VOCAB: { label: string; text: string }[] = [
  {
    label: "About Tiers",
    text: "Tiers separate pace groups within a sheet: the higher the number, the slower the pace the tier covers.",
  },
  {
    label: "About Performance",
    text:
      '"B-Speed" is a "Balanced" branch for cars that reach above-average speeds without falling into the "Power" label.\n' +
      '"B-Accel" is a "Balanced" branch for cars with launch and/or acceleration better than average.\n' +
      '"B-Handling" is a "Balanced" branch for cars with above-average cornering without falling into the "Handling" label.',
  },
  {
    label: "About Build Type",
    text:
      '"Sweaty": engine swap and/or drivetrain swap, with aero.\n' +
      '"Aero": aero only, no engine swap nor drivetrain swap.\n' +
      '"Clean": drivetrain swap and changed wheels only.\n' +
      '"Stock look": looks exactly like stock, wheels included.\n' +
      '"Purist": no engine swap, drivetrain swap or aero (changed wheels allowed).\n' +
      '"Mod Purist": a "Purist" branch including non-affecting body parts (non-adjustable aero, bumpers, skirts).\n' +
      '"Purist + Stock Look": meets both the "Purist" and "Stock Look" categories.',
  },
  {
    label: "Other Info",
    text: 'Both the "Tuner" and "Alternative Tune(s)" columns carry the tune\'s share code as a cell note — hover over the cell to reveal it.',
  },
];

const DISCLAIMERS: string[] = [
  "This is a sheet built by and for the community; people submit their times, so some are naturally better optimized than others.",
  "No single track represents general racing perfectly — some cars will perform better or worse on other tracks.",
  "If two submissions share the same car with the exact same type of build, only the faster time stays, to avoid absolute duplicates.",
];

const SUBMISSIONS: string[] = [
  "To submit a time, players must provide video evidence of the car completing a clean run on the relevant track.",
  "The run must be valid and unflagged: any flagged lap, wall contact, wall-tap, or unclear footage results in the time being rejected.",
  "Times can be submitted through SpreadsheetBot in supported Discord servers, or via accredited staff members. Submissions may be reviewed before being accepted.",
];

const CREDITS: string[] = [
  "Spreadsheet concept by SulexPagMan, maintained by Fenrir & his SpreadsheetBot.",
  "Questions or submissions? Contact Fenrir on Discord: Tadayoshi123",
];

const COLUMN_WIDTHS = [230, 210, 120, 120, 150, 150, 340];

type Color = sheets_v4.Schema$Color;
const WHITE: Color = { red: 1, green: 1, blue: 1 };
const TITLE_BG: Color = { red: 0.12, green: 0.16, blue: 0.24 };
const SECTION_BG: Color = { red: 0.26, green: 0.26, blue: 0.26 };
const LABEL_BG: Color = { red: 0.812, green: 0.886, blue: 0.953 };
const CREDITS_BG: Color = { red: 0.953, green: 0.929, blue: 0.804 };

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
  return [
    last.carClass || DASH,
    last.car || DASH,
    last.time || DASH,
    last.driver || DASH,
    formatDate(last.timestampIso),
  ].join(" · ");
}

/**
 * Accumulates sheet content (values) and the formatting/merge/link requests
 * needed to render the single-page hub. Row indices are tracked as rows are
 * appended so formatting can target them precisely.
 */
class HubBuilder {
  readonly values: string[][] = [];
  readonly merges: sheets_v4.Schema$Request[] = [];
  readonly formats: sheets_v4.Schema$Request[] = [];
  readonly links: sheets_v4.Schema$Request[] = [];

  constructor(private readonly sheetId: number) {}

  private push(cells: string[]): number {
    const padded = [...cells];
    while (padded.length < COL_COUNT) padded.push("");
    const idx = this.values.length;
    this.values.push(padded);
    return idx;
  }

  private merge(rowIdx: number, startCol = 0, endCol = COL_COUNT): void {
    this.merges.push({
      mergeCells: {
        range: this.range(rowIdx, rowIdx + 1, startCol, endCol),
        mergeType: "MERGE_ALL",
      },
    });
  }

  private format(
    rowIdx: number,
    startCol: number,
    endCol: number,
    fmt: sheets_v4.Schema$CellFormat
  ): void {
    this.formats.push({
      repeatCell: {
        range: this.range(rowIdx, rowIdx + 1, startCol, endCol),
        cell: { userEnteredFormat: fmt },
        fields: "userEnteredFormat",
      },
    });
  }

  private range(
    startRow: number,
    endRow: number,
    startCol: number,
    endCol: number
  ): sheets_v4.Schema$GridRange {
    return {
      sheetId: this.sheetId,
      startRowIndex: startRow,
      endRowIndex: endRow,
      startColumnIndex: startCol,
      endColumnIndex: endCol,
    };
  }

  spacer(): void {
    this.push([""]);
  }

  banner(): void {
    const titleRow = this.push([TITLE]);
    this.merge(titleRow);
    this.format(titleRow, 0, COL_COUNT, {
      backgroundColor: TITLE_BG,
      horizontalAlignment: "CENTER",
      verticalAlignment: "MIDDLE",
      textFormat: { foregroundColor: WHITE, bold: true, fontSize: 16 },
    });

    const tagRow = this.push([TAGLINE]);
    this.merge(tagRow);
    this.format(tagRow, 0, COL_COUNT, {
      horizontalAlignment: "CENTER",
      wrapStrategy: "WRAP",
      textFormat: { italic: true },
    });
  }

  section(title: string): void {
    const idx = this.push([title]);
    this.merge(idx);
    this.format(idx, 0, COL_COUNT, {
      backgroundColor: SECTION_BG,
      verticalAlignment: "MIDDLE",
      textFormat: { foregroundColor: WHITE, bold: true, fontSize: 11 },
    });
  }

  paragraph(text: string): void {
    const idx = this.push([text]);
    this.merge(idx);
    this.format(idx, 0, COL_COUNT, {
      verticalAlignment: "TOP",
      wrapStrategy: "WRAP",
    });
  }

  /** Label cell (column A) + wrapped text spanning the rest of the row. */
  labelled(label: string, text: string): void {
    const idx = this.push([label, text]);
    this.merge(idx, 1, COL_COUNT);
    this.format(idx, 0, 1, {
      backgroundColor: LABEL_BG,
      verticalAlignment: "TOP",
      wrapStrategy: "WRAP",
      textFormat: { bold: true },
    });
    this.format(idx, 1, COL_COUNT, {
      verticalAlignment: "TOP",
      wrapStrategy: "WRAP",
    });
  }

  bullet(text: string): void {
    this.paragraph(`•  ${text}`);
  }

  credit(text: string): void {
    const idx = this.push([text]);
    this.merge(idx);
    this.format(idx, 0, COL_COUNT, {
      backgroundColor: CREDITS_BG,
      verticalAlignment: "MIDDLE",
      wrapStrategy: "WRAP",
      textFormat: { bold: true },
    });
  }

  tableHeader(): void {
    const idx = this.push([...TABLE_HEADERS]);
    this.format(idx, 0, COL_COUNT, {
      backgroundColor: SECTION_BG,
      verticalAlignment: "MIDDLE",
      wrapStrategy: "WRAP",
      textFormat: { foregroundColor: WHITE, bold: true },
    });
  }

  trackRow(label: string, url: string, cells: string[]): void {
    const idx = this.push(cells);
    this.format(idx, 0, COL_COUNT, {
      verticalAlignment: "TOP",
      wrapStrategy: "WRAP",
    });
    this.links.push({
      updateCells: {
        range: this.range(idx, idx + 1, 1, 2),
        rows: [
          {
            values: [
              {
                userEnteredValue: { stringValue: label },
                textFormatRuns: [
                  { startIndex: 0, format: { link: { uri: url } } },
                ],
              },
            ],
          },
        ],
        fields: "userEnteredValue,textFormatRuns",
      },
    });
  }

  columnWidthRequests(): sheets_v4.Schema$Request[] {
    return COLUMN_WIDTHS.map((width, i) => ({
      updateDimensionProperties: {
        range: {
          sheetId: this.sheetId,
          dimension: "COLUMNS",
          startIndex: i,
          endIndex: i + 1,
        },
        properties: { pixelSize: width },
        fields: "pixelSize",
      },
    }));
  }
}

/**
 * Regenerate the portal spreadsheet's single hub page: a styled welcome +
 * concept presentation (reusing the per-track summary content) followed by a
 * table of every configured track with its metadata and latest submission.
 * No-op when the portal is not configured.
 */
export async function buildAndWritePortal(
  jwt: JWT,
  cfg: AppConfig,
  registry: SheetsServiceRegistry
): Promise<void> {
  if (!cfg.portal) return;

  const sheets = google.sheets({ version: "v4", auth: jwt });
  const { spreadsheetId, tabTitle } = cfg.portal;
  const escaped = a1EscapeSheetTitle(tabTitle);

  const sheetId = await ensurePortalTab(sheets, spreadsheetId, tabTitle);
  const b = new HubBuilder(sheetId);

  b.banner();
  b.spacer();

  b.section("Welcome");
  b.paragraph(WELCOME);
  b.spacer();

  b.section("Sheet Vocabulary & Relevant Info");
  for (const v of VOCAB) b.labelled(v.label, v.text);
  b.spacer();

  b.section("Disclaimers");
  for (const d of DISCLAIMERS) b.bullet(d);
  b.spacer();

  b.section("How Submissions Work");
  for (const s of SUBMISSIONS) b.bullet(s);
  b.spacer();

  b.section("Credits & Contact");
  for (const c of CREDITS) b.credit(c);
  b.spacer();

  b.section("Tracks");
  b.tableHeader();
  for (const track of cfg.tracks.values()) {
    let last: LastSubmission | null = null;
    try {
      last = await registry.getForTrack(track).readLastSubmission();
    } catch {
      last = null;
    }
    b.trackRow(track.label, spreadsheetUrl(track.spreadsheetId), [
      track.label,
      track.label,
      track.surface ?? DASH,
      track.trackType ?? DASH,
      track.recommended ?? DASH,
      last ? formatDate(last.timestampIso) : DASH,
      lastSubmissionSummary(last),
    ]);
  }

  // Best-effort reset of previous merges/formats so a shrinking layout leaves
  // no stragglers. Ignored on first run when nothing exists yet.
  try {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            unmergeCells: {
              range: { sheetId, startRowIndex: 0, endRowIndex: 1000, startColumnIndex: 0, endColumnIndex: 26 },
            },
          },
          {
            repeatCell: {
              range: { sheetId, startRowIndex: 0, endRowIndex: 1000, startColumnIndex: 0, endColumnIndex: 26 },
              cell: { userEnteredFormat: {} },
              fields: "userEnteredFormat",
            },
          },
        ],
      },
    });
  } catch {
    // no-op
  }

  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${escaped}!A1:Z`,
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${escaped}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: b.values },
  });

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        ...b.columnWidthRequests(),
        ...b.merges,
        ...b.formats,
        ...b.links,
      ],
    },
  });
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
