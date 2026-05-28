/** Cell display text for video links in column L. */
export const VIDEO_LINK_LABEL = "▶ Run";

function escapeFormulaString(value: string): string {
  return value.replace(/"/g, '""');
}

export function isLikelyVideoUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
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
