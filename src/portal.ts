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
  "Recommended car/perf",
  "Last updated",
  "Last submission (class, car, time, driver, date)",
] as const;

const DASH = "-";

function a1EscapeSheetTitle(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

function spreadsheetUrl(spreadsheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
}

/** Best-effort short date (YYYY-MM-DD HH:mm) from an ISO timestamp; "-" if invalid. */
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
 * Regenerate the portal spreadsheet's "Tracks" tab: one row per configured
 * track with its static metadata plus the latest submission read from each
 * track's `_SubmissionLog`. No-op when the portal is not configured.
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

  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${escaped}!A1:Z`,
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${escaped}!A1`,
    valueInputOption: "RAW",
    requestBody: {
      values: [[...PORTAL_HEADERS], ...rows.map((r) => r.cells)],
    },
  });

  // Hyperlinks via cell metadata (works on any sheet locale; no HYPERLINK formula).
  if (rows.length > 0) {
    const linkRequests: sheets_v4.Schema$Request[] = rows.map((row, i) => ({
      updateCells: {
        range: {
          sheetId,
          startRowIndex: 1 + i,
          endRowIndex: 2 + i,
          startColumnIndex: 1,
          endColumnIndex: 2,
        },
        rows: [
          {
            values: [
              {
                userEnteredValue: { stringValue: row.label },
                textFormatRuns: [
                  {
                    startIndex: 0,
                    format: { link: { uri: row.url } },
                  },
                ],
              },
            ],
          },
        ],
        fields: "userEnteredValue,textFormatRuns",
      },
    }));

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: linkRequests },
    });
  }
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
  const newId =
    addRes.data.replies?.[0]?.addSheet?.properties?.sheetId;
  if (newId == null) {
    throw new Error(`Failed to create portal tab "${tabTitle}".`);
  }
  return newId;
}
