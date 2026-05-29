import type { sheets_v4 } from "googleapis";

/** Cell display text for video links in column L. */
export const VIDEO_LINK_LABEL = "▶ Run";

function escapeFormulaString(value: string): string {
  return value.replace(/"/g, '""');
}

export function isLikelyVideoUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

/** Pull URL from a column-L cell (formula, hyperlink metadata, or plain URL). */
export function extractVideoUrlFromCell(
  cell: sheets_v4.Schema$CellData | null | undefined
): string | null {
  if (!cell) return null;

  const link = cell.hyperlink?.trim();
  if (link && isLikelyVideoUrl(link)) return link;

  const formula =
    cell.userEnteredValue?.formulaValue?.trim() ??
    cell.effectiveValue?.formulaValue?.trim();
  if (formula) {
    const m = formula.match(/HYPERLINK\s*\(\s*"((?:[^"]|"")*)"/i);
    if (m) {
      const url = m[1]!.replace(/""/g, '"');
      if (isLikelyVideoUrl(url)) return url;
    }
  }

  const raw = cell.userEnteredValue?.stringValue?.trim();
  if (raw && isLikelyVideoUrl(raw)) return raw;

  return null;
}

/**
 * Writes a compact HYPERLINK formula for column L, or plain text when not a URL.
 */
export function formatVideoForSheet(
  video: string,
  label: string = VIDEO_LINK_LABEL
): string {
  const trimmed = video.trim();
  if (!trimmed || !isLikelyVideoUrl(trimmed)) {
    return trimmed;
  }
  const url = escapeFormulaString(trimmed);
  const text = escapeFormulaString(label);
  return `=HYPERLINK("${url}", "${text}")`;
}

/**
 * On edit: values.get only returns "▶ Run", not the URL — rebuild HYPERLINK from grid data.
 */
export function preserveVideoForSheet(
  gridCell: sheets_v4.Schema$CellData | null | undefined,
  valuesColumnText: string,
  patch: string | undefined
): string {
  if (patch !== undefined) {
    return formatVideoForSheet(patch);
  }
  const url = extractVideoUrlFromCell(gridCell);
  if (url) return formatVideoForSheet(url);
  const fromValues = valuesColumnText.trim();
  if (isLikelyVideoUrl(fromValues)) return formatVideoForSheet(fromValues);
  return fromValues;
}
