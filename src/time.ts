/**
 * Lap times: canonical display `M:SS.mmm` (e.g. `0:43.600`, `1:02.245`).
 * Internally stored as total seconds (float) for ordering — smaller = faster.
 * Legacy sheet values without a colon (e.g. `43.6`) are treated as seconds only.
 */

const COLON_LAP_TIME =
  /^(\d+):(\d{1,2})(?:[.,](\d+))?$/;

/** Seconds-only decimal (legacy), e.g. `43.6` or `43,600` */
const DECIMAL_SECONDS_ONLY = /^(\d+)(?:[.,](\d+))?$/;

function normalizeTimeInput(input: string): string {
  return input.trim().replace(",", ".");
}

/**
 * Parse lap time to total seconds (smaller = faster).
 */
export function parseLapTime(input: string): number {
  const s = normalizeTimeInput(input);
  if (!s) {
    throw new Error(`Invalid time: "${input}"`);
  }

  const colon = s.match(COLON_LAP_TIME);
  if (colon) {
    const minutes = Number(colon[1]);
    const secWhole = Number(colon[2]);
    const fracStr = colon[3];
    const secFrac = fracStr != null ? Number(`0.${fracStr}`) : 0;
    if (
      !Number.isFinite(minutes) ||
      !Number.isFinite(secWhole) ||
      !Number.isFinite(secFrac) ||
      secWhole >= 60
    ) {
      throw new Error(`Invalid time: "${input}"`);
    }
    const seconds = secWhole + secFrac;
    return minutes * 60 + seconds;
  }

  if (!DECIMAL_SECONDS_ONLY.test(s)) {
    throw new Error(`Invalid time: "${input}" (use M:SS.mmm, e.g. 0:43.600)`);
  }

  const n = Number.parseFloat(s);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Invalid time: "${input}"`);
  }
  return n;
}

/** Format total seconds as `M:SS.mmm` (sheet standard). */
export function formatLapTimeSeconds(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    throw new Error(`Invalid lap time seconds: ${totalSeconds}`);
  }
  const totalMs = Math.round(totalSeconds * 1000);
  const minutes = Math.floor(totalMs / 60_000);
  const remainderMs = totalMs % 60_000;
  const sec = Math.floor(remainderMs / 1000);
  const millis = remainderMs % 1000;
  return `${minutes}:${String(sec).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

/** Normalize user input to `M:SS.mmm` for column C. */
export function formatTimeForSheet(input: string): string {
  return formatLapTimeSeconds(parseLapTime(input));
}

/** Token in tier labels: `0:45.000` or legacy `45.000` */
const TIER_BOUND_TIME =
  /(\d+:\d{1,2}(?:[.,]\d+)?|\d+(?:[.,]\d+)?)/;

/** Upper bound from tier labels in column A, e.g. `T1 (<0:45.000)` → 45s */
export function parseTierMaxFromLabel(label: string): number | null {
  const m = label.trim().match(new RegExp(`<\\s*${TIER_BOUND_TIME.source}`));
  if (!m) return null;
  try {
    return parseLapTime(m[1]!);
  } catch {
    return null;
  }
}

/** Lower bound from tier labels in column A, e.g. `T5 (>1:30.000)` → 90s */
export function parseTierMinFromLabel(label: string): number | null {
  const m = label.trim().match(new RegExp(`>\\s*${TIER_BOUND_TIME.source}`));
  if (!m) return null;
  try {
    return parseLapTime(m[1]!);
  } catch {
    return null;
  }
}
