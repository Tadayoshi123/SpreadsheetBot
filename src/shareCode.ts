import type { ParsedAlternate } from "./types.js";

/** Extract 9 digits from "123 456 789" or "123456789" */
export function normalizeShareCode(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 9) {
    throw new Error(
      `Share code must be 9 digits (got ${digits.length}): "${raw}"`
    );
  }
  return digits;
}

export function formatShareCodeDisplay(digits: string): string {
  const d = normalizeShareCode(digits);
  return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6, 9)}`;
}

export function buildTunerNote(tunerName: string, shareCodeRaw: string): string {
  const fmt = formatShareCodeDisplay(shareCodeRaw);
  return `${tunerName.trim()} - ${fmt}`;
}

/** 9-digit string from a tuner cell note like "Name - 123 456 789", or null if unparseable */
export function extractTunerShareCodeDigitsFromNote(note: string): string | null {
  const trimmed = note.trim();
  if (!trimmed) return null;
  const idx = trimmed.lastIndexOf(" - ");
  const frag = idx >= 0 ? trimmed.slice(idx + 3).trim() : trimmed;
  try {
    return normalizeShareCode(frag);
  } catch {
    return null;
  }
}

/**
 * Alternate tunings: segments separated by commas and/or line breaks (Discord is single-line friendly).
 * Each segment: `Name|123456789` or `Name|123 456 789`. Do not use commas inside the name (before `|`).
 */
export function parseAlternatesBlock(block: string): ParsedAlternate[] {
  const segments = block
    .split(/\r?\n/)
    .flatMap((line) => line.split(","))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const out: ParsedAlternate[] = [];
  for (const segment of segments) {
    const pipe = segment.indexOf("|");
    if (pipe < 0) {
      throw new Error(
        `Invalid alternate entry (use Name|code, separate entries with commas): "${segment}"`
      );
    }
    const name = segment.slice(0, pipe).trim();
    const codePart = segment.slice(pipe + 1).trim();
    if (!name)
      throw new Error(`Missing tuner name in alternate entry: "${segment}"`);
    const codeDigits = normalizeShareCode(codePart);
    out.push({ name, codeDigits });
  }
  return out;
}

export function alternatesCellText(alts: ParsedAlternate[]): string {
  return alts.map((a) => a.name).join("\n");
}

export function alternatesNote(alts: ParsedAlternate[]): string {
  return alts
    .map((a) => `${a.name} - ${formatShareCodeDisplay(a.codeDigits)}`)
    .join("\n");
}

/**
 * Lookup display: tuner note is usually "Name - XXX XXX XXX" → single line Share Code only.
 */
export function lookupTunerShareLine(note: string): string {
  const trimmed = note.trim();
  const idx = trimmed.lastIndexOf(" - ");
  const codeFrag =
    idx >= 0 ? trimmed.slice(idx + 3).trim() : trimmed;
  try {
    return `Share Code - ${formatShareCodeDisplay(codeFrag)}`;
  } catch {
    return trimmed;
  }
}

/**
 * Lookup display: one alt → "Share Code - …"; multiple → one "TunerName - XXX XXX XXX" per line.
 */
export function lookupAlternateShareLines(note: string): string[] {
  const lines = note
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return [];

  if (lines.length === 1) {
    const line = lines[0]!;
    const idx = line.lastIndexOf(" - ");
    const codeFrag = idx >= 0 ? line.slice(idx + 3).trim() : line;
    try {
      return [`Share Code - ${formatShareCodeDisplay(codeFrag)}`];
    } catch {
      return [line];
    }
  }

  const out: string[] = [];
  for (const line of lines) {
    const idx = line.lastIndexOf(" - ");
    if (idx < 0) {
      try {
        out.push(`Share Code - ${formatShareCodeDisplay(line)}`);
      } catch {
        out.push(line);
      }
      continue;
    }
    const name = line.slice(0, idx).trim();
    const codeFrag = line.slice(idx + 3).trim();
    try {
      out.push(`${name} - ${formatShareCodeDisplay(codeFrag)}`);
    } catch {
      out.push(line);
    }
  }
  return out;
}
