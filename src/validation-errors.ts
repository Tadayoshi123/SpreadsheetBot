/** Thrown when user input fails config/sheet validation (safe to show in Discord). */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

const FIELD_LABELS: Record<string, string> = {
  difficulty: "difficulty",
  drivetrain: "drivetrain",
  tires: "tires",
  engine: "engine",
  build_type: "build type",
  performance: "performance",
};

const DISCORD_CONTENT_MAX = 1900;

/** User-facing message when an enum value is not allowed. Never dumps huge lists. */
export function formatInvalidEnumMessage(
  field: string,
  value: string,
  allowed: readonly string[]
): string {
  const label = FIELD_LABELS[field] ?? field;
  const lines = [`Invalid **${label}**: \`${value}\``];

  if (allowed.length <= 10) {
    lines.push(`Allowed values: ${allowed.join(", ")}`);
    return lines.join("\n");
  }

  lines.push(
    `This value is not in the sheet list (${allowed.length} options). ` +
      `Use the **${label}** autocomplete when filling \`/add-entry\` or \`/edit-entry\`.`
  );

  const suggestions = suggestSimilarValues(value, allowed, 5);
  if (suggestions.length > 0) {
    lines.push("", "Did you mean:");
    for (const s of suggestions) {
      lines.push(`• ${s}`);
    }
  }

  return lines.join("\n");
}

/** Best-effort fuzzy matches for autocomplete-style hints. */
export function suggestSimilarValues(
  value: string,
  allowed: readonly string[],
  max = 5
): string[] {
  const q = value.trim().toLowerCase();
  if (!q) return [];

  type Scored = { text: string; score: number };
  const scored: Scored[] = [];

  for (const candidate of allowed) {
    const c = candidate.toLowerCase();
    let score = 0;
    if (c === q) score = 100;
    else if (c.includes(q)) score = 60;
    else if (q.includes(c)) score = 40;
    else {
      const tokens = q.split(/[\s–\-]+/).filter((t) => t.length > 2);
      const hits = tokens.filter((t) => c.includes(t)).length;
      score = hits * 15;
    }
    if (score > 0) scored.push({ text: candidate, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, max).map((s) => s.text);
}

/** Format any caught error for a Discord reply (length-safe). */
export function formatDiscordErrorMessage(err: unknown): string {
  let body =
    err instanceof Error ? err.message : String(err ?? "Unknown error");
  body = body.trim() || "Unknown error";

  const header = "**Could not complete your request**\n\n";
  const maxBody = DISCORD_CONTENT_MAX - header.length - 20;
  if (body.length > maxBody) {
    body = `${body.slice(0, maxBody)}… _(message truncated)_`;
  }
  return header + body;
}
