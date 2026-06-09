import { google } from "googleapis";
import type { JWT } from "google-auth-library";
import type { AppConfig } from "./types.js";
import type { SheetsServiceRegistry } from "./service-registry.js";
import type { LastSubmission } from "./sheets.js";

const PORTAL_HEADERS = [
  "Tracé",
  "Lien",
  "Surface",
  "Type",
  "Voiture/Perf recommandée",
  "Dernière MAJ",
  "Dernière soumission (classe, voiture, temps, conducteur, date)",
] as const;

const DASH = "-";

function a1EscapeSheetTitle(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

function spreadsheetUrl(spreadsheetId: string): string {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
}

function hyperlinkFormula(url: string, label: string): string {
  const safeUrl = url.replace(/"/g, '""');
  const safeLabel = label.replace(/"/g, '""');
  return `=HYPERLINK("${safeUrl}","${safeLabel}")`;
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

  await ensurePortalTab(sheets, spreadsheetId, tabTitle);

  const dataRows: string[][] = [];
  for (const track of cfg.tracks.values()) {
    let last: LastSubmission | null = null;
    try {
      last = await registry.getForTrack(track).readLastSubmission();
    } catch {
      last = null;
    }
    dataRows.push([
      track.label,
      hyperlinkFormula(spreadsheetUrl(track.spreadsheetId), track.label),
      track.surface ?? DASH,
      track.trackType ?? DASH,
      track.recommended ?? DASH,
      last ? formatDate(last.timestampIso) : DASH,
      lastSubmissionSummary(last),
    ]);
  }

  const escaped = a1EscapeSheetTitle(tabTitle);

  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${escaped}!A1:Z`,
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${escaped}!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[...PORTAL_HEADERS], ...dataRows] },
  });
}

async function ensurePortalTab(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string,
  tabTitle: string
): Promise<void> {
  const res = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties.title",
  });
  const exists = res.data.sheets?.some(
    (s) => s.properties?.title === tabTitle
  );
  if (exists) return;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: tabTitle } } }],
    },
  });
}
