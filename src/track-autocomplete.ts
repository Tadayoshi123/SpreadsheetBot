import type { ApplicationCommandOptionChoiceData } from "discord.js";

const DISCORD_CHOICE_LIMIT = 25;
const DISCORD_NAME_MAX = 100;
const DISCORD_VALUE_MAX = 100;

/** Filter tier lists for Discord autocomplete (max 25 choices). */
export function trackAutocompleteChoices(
  tracks: readonly { id: string; label: string }[],
  query: string
): ApplicationCommandOptionChoiceData<string>[] {
  const q = query.trim().toLowerCase();
  let matched = tracks;
  if (q) {
    matched = tracks.filter(
      (t) =>
        t.id.toLowerCase().includes(q) || t.label.toLowerCase().includes(q)
    );
  }
  return matched.slice(0, DISCORD_CHOICE_LIMIT).map((t) => ({
    name: truncateChoiceName(t.label),
    value: t.id.slice(0, DISCORD_VALUE_MAX),
  }));
}

function truncateChoiceName(label: string): string {
  if (label.length <= DISCORD_NAME_MAX) return label;
  return `${label.slice(0, DISCORD_NAME_MAX - 3)}...`;
}
