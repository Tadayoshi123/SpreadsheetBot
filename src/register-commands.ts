import { REST, Routes } from "discord.js";
import { loadAppConfig, slashContextForGuild } from "./config.js";
import { createAddEntryCommand } from "./slash/add-entry-command.js";
import { createLookupCarCommand } from "./slash/lookup-car-command.js";
import { createEditEntryCommand } from "./slash/edit-entry-command.js";
import { createHelpCommand } from "./slash/help-command.js";

const clientId = process.env.DISCORD_CLIENT_ID?.trim();
if (!clientId) throw new Error("DISCORD_CLIENT_ID is required to register slash commands.");

const cfg = loadAppConfig();
const rest = new REST({ version: "10" }).setToken(cfg.discordToken);

function commandBodyForGuild(guildId: string | null) {
  const ctx = slashContextForGuild(cfg, guildId);
  return [
    createHelpCommand().toJSON(),
    createAddEntryCommand(ctx).toJSON(),
    createLookupCarCommand(ctx).toJSON(),
    createEditEntryCommand(ctx).toJSON(),
  ];
}

/**
 * Guild command registration returns 403 + code 50001 if the bot is not in that server or the
 * invite lacked scope `applications.commands`.
 */
function registerErrorHint(guildId: string, err: unknown): string {
  const code = (err as { code?: number }).code;
  if (code === 50001) {
    return (
      `guild ${guildId}: Missing Access (50001) — invite the bot into this server with scope ` +
      `**applications.commands**, or check the guild ID.`
    );
  }
  const msg = err instanceof Error ? err.message : String(err);
  return `guild ${guildId}: ${msg}`;
}

/** Guild IDs to register: env list, or all keys from guild-tracks.json. */
function guildIdsToRegister(): string[] {
  if (cfg.discordGuildIds.length > 0) return cfg.discordGuildIds;
  return Object.keys(cfg.guildTracks);
}

const guildIds = guildIdsToRegister();

if (guildIds.length > 0) {
  let anyFailed = false;
  for (const guildId of guildIds) {
    try {
      const body = commandBodyForGuild(guildId);
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
        body,
      });
      console.log(`Registered guild commands on guild ${guildId}.`);
    } catch (err) {
      anyFailed = true;
      console.error(registerErrorHint(guildId, err));
    }
  }
  if (anyFailed) {
    process.exitCode = 1;
  }
} else {
  const body = commandBodyForGuild(null);
  await rest.put(Routes.applicationCommands(clientId), { body });
  console.log("Registered global application commands.");
}
