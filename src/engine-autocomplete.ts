import type { ApplicationCommandOptionChoiceData } from "discord.js";

const DISCORD_CHOICE_LIMIT = 25;
const DISCORD_NAME_MAX = 100;
const DISCORD_VALUE_MAX = 100;

/** Filter engines for Discord autocomplete (max 25 choices). */
export function engineAutocompleteChoices(
  engines: readonly string[],
  query: string
): ApplicationCommandOptionChoiceData<string>[] {
  const q = query.trim().toLowerCase();
  let matched = engines;
  if (q) {
    matched = engines.filter((e) => e.toLowerCase().includes(q));
  }
  return matched.slice(0, DISCORD_CHOICE_LIMIT).map((engine) => ({
    name: truncateChoiceName(engine),
    value: engine.slice(0, DISCORD_VALUE_MAX),
  }));
}

function truncateChoiceName(label: string): string {
  if (label.length <= DISCORD_NAME_MAX) return label;
  return `${label.slice(0, DISCORD_NAME_MAX - 3)}...`;
}
