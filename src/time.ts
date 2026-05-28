/**
 * Lap time as shown in the sheet: decimal uses comma or dot (e.g. 43,000 or 43.000).
 * Parsed as a single float for ordering (smaller = faster).
 */
export function parseLapTime(input: string): number {
  const s = input.trim().replace(",", ".");
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid time: "${input}"`);
  }
  return n;
}

/** Upper bound from tier labels in column A, e.g. `T1 (<45.000)` → 45 */
export function parseTierMaxFromLabel(label: string): number | null {
  const m = label.trim().match(/<\s*([\d]+(?:[.,]\d+)?)/);
  if (!m) return null;
  try {
    return parseLapTime(m[1]!);
  } catch {
    return null;
  }
}

/** Lower bound from tier labels in column A, e.g. `T5 (>48.000)` → 48 */
export function parseTierMinFromLabel(label: string): number | null {
  const m = label.trim().match(/>\s*([\d]+(?:[.,]\d+)?)/);
  if (!m) return null;
  try {
    return parseLapTime(m[1]!);
  } catch {
    return null;
  }
}

/** Display string preserving user-style comma if they used it */
export function formatTimeForSheet(input: string): string {
  return input.trim();
}
