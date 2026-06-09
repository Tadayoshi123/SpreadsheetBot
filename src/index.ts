import {
  ActivityType,
  Client,
  Events,
  GatewayIntentBits,
  InteractionType,
  MessageFlags,
} from "discord.js";
import { loadAppConfig } from "./config.js";
import { createSheetsJwt } from "./auth-google.js";
import type { EditEntryPayload, NewEntryPayload } from "./sheets.js";
import { memberAllowedTrackIds } from "./permissions.js";
import { SheetsServiceRegistry } from "./service-registry.js";
import { buildAndWritePortal } from "./portal.js";
import type {
  ResolvedTrack,
  SubmissionAction,
  SubmissionContext,
  SubmissionResult,
} from "./types.js";
import type { ChatInputCommandInteraction } from "discord.js";
import { engineAutocompleteChoices } from "./engine-autocomplete.js";
import { trackAutocompleteChoices } from "./track-autocomplete.js";
import { trackIdsForGuild } from "./config.js";
import {
  readTrackOption,
  resolveTrackContext,
  enginesForAutocomplete,
} from "./track-resolver.js";
import {
  HELP_EMBED_DESCRIPTION_MAX,
  SHEET_MANAGER_HELP_BODY,
} from "./slash/help-command.js";

const SHEET_COMMANDS = new Set([
  "help",
  "add-entry",
  "lookup-car",
  "edit-entry",
]);

process.on("unhandledRejection", (r) =>
  console.error("unhandledRejection", r)
);

const cfg = loadAppConfig();

if (cfg.allowedRoleIds.length === 0) {
  console.warn(
    "Warning: DISCORD_ALLOWED_ROLE_IDS is empty — no one may use slash commands safely."
  );
}

const jwt = createSheetsJwt();
const registry = new SheetsServiceRegistry(jwt);

/** Regenerate the portal (fire-and-forget; never throws). */
function regeneratePortal(reason: string): void {
  if (!cfg.portal) return;
  buildAndWritePortal(jwt, cfg, registry).catch((err) => {
    console.error(`Portal regeneration failed (${reason}):`, err);
  });
}

/**
 * Append the submission to the track's `_SubmissionLog` and refresh the portal.
 * Best-effort: failures are logged but never surfaced to the user.
 */
async function recordSubmission(params: {
  interaction: ChatInputCommandInteraction;
  track: ResolvedTrack;
  action: SubmissionAction;
  result: SubmissionResult;
  carClass: string;
  car: string;
  time: string;
  driver: string;
}): Promise<void> {
  const { interaction, track, action, result } = params;
  try {
    let messageUrl: string | undefined;
    try {
      const reply = await interaction.fetchReply();
      if (interaction.guildId && interaction.channelId && reply.id) {
        messageUrl = `https://discord.com/channels/${interaction.guildId}/${interaction.channelId}/${reply.id}`;
      }
    } catch {
      messageUrl = undefined;
    }

    const context: SubmissionContext = {
      userId: interaction.user.id,
      username: interaction.user.username,
      guildId: interaction.guildId ?? "",
      channelId: interaction.channelId ?? "",
      messageUrl,
    };

    await registry.getForTrack(track).appendSubmissionLog({
      timestampIso: new Date().toISOString(),
      action,
      outcome: result.outcome,
      trackId: track.id,
      carClass: params.carClass,
      car: params.car,
      time: params.time,
      driver: params.driver,
      context,
    });
  } catch (err) {
    console.error("Submission log append failed:", err);
  }

  if (result.outcome === "added" || result.outcome === "updated") {
    regeneratePortal(`after ${action}`);
  }
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  const trackCount = cfg.tracks.size;
  if (trackCount > 1) {
    console.log(`Multi-track mode: ${trackCount} tier list(s) loaded.`);
  }
  const presenceName =
    process.env.DISCORD_BOT_ACTIVITY?.trim() || "Use /help";
  c.user?.setPresence({
    status: "online",
    activities: [{ name: presenceName, type: ActivityType.Playing }],
  });

  if (cfg.portal) {
    console.log(`Portal enabled (spreadsheet ${cfg.portal.spreadsheetId}).`);
    regeneratePortal("startup");
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isAutocomplete()) {
    const cmd = interaction.commandName;
    if (
      cmd !== "add-entry" &&
      cmd !== "edit-entry" &&
      cmd !== "lookup-car"
    ) {
      return;
    }

    const focused = interaction.options.getFocused(true);

    try {
      if (!interaction.inGuild() || !interaction.guildId) {
        await interaction.respond([]);
        return;
      }

      if (focused.name === "track") {
        const trackIds =
          cmd === "lookup-car"
            ? trackIdsForGuild(cfg, interaction.guildId)
            : memberAllowedTrackIds(
                cfg,
                interaction.guildId,
                interaction.member
              );
        const tracks = trackIds
          .map((id) => {
            const t = cfg.tracks.get(id);
            return t ? { id, label: t.label } : null;
          })
          .filter((t): t is { id: string; label: string } => t != null);
        await interaction.respond(
          trackAutocompleteChoices(tracks, focused.value)
        );
        return;
      }

      if (focused.name !== "engine") return;
      if (cmd === "lookup-car") return;

      const trackOption = readTrackOption((name) =>
        interaction.options.getString(name)
      );
      const engines = enginesForAutocomplete(
        cfg,
        interaction.guildId,
        trackOption,
        interaction.member,
        cmd
      );
      const choices = engineAutocompleteChoices(engines, focused.value);
      await interaction.respond(choices);
    } catch {
      await interaction.respond([]);
    }
    return;
  }

  if (
    interaction.type !== InteractionType.ApplicationCommand ||
    !interaction.isChatInputCommand()
  ) {
    return;
  }

  if (!SHEET_COMMANDS.has(interaction.commandName)) return;

  if (!interaction.inGuild()) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: "This command must be run in a server.",
    });
    return;
  }

  const ephemeral =
    interaction.commandName === "lookup-car" ||
    interaction.commandName === "help";
  await interaction.deferReply(
    ephemeral ? { flags: MessageFlags.Ephemeral } : {}
  );

  try {
    if (!interaction.member) {
      await interaction.editReply({
        content: "Could not resolve your member profile in this server.",
      });
      return;
    }

    if (interaction.commandName === "help") {
      await interaction.editReply({
        embeds: [
          {
            title: "SpreadsheetBot",
            description: SHEET_MANAGER_HELP_BODY.slice(
              0,
              HELP_EMBED_DESCRIPTION_MAX
            ),
            color: 0x5865f2,
          },
        ],
      });
      return;
    }

    const guildId = interaction.guildId!;
    const trackOption = readTrackOption((name) =>
      interaction.options.getString(name)
    );
    const isLookup = interaction.commandName === "lookup-car";
    const { track } = resolveTrackContext(
      cfg,
      guildId,
      trackOption,
      interaction.member,
      { lookup: isLookup }
    );
    const sheets = registry.getForTrack(track);

    if (isLookup) {
      const carClass = interaction.options.getString("class", true);
      const carName = interaction.options.getString("car", true);
      const text = await sheets.lookupCarFormatted(carClass, carName);
      await interaction.editReply({
        content: `**Track:** ${track.label}\n\n${text}`,
      });
      return;
    }

    if (track.allowedRoleIds.length === 0 && cfg.allowedRoleIds.length === 0) {
      await interaction.editReply({
        content:
          "Bot configuration error: administrator must set DISCORD_ALLOWED_ROLE_IDS or track allowedRoleIds.",
      });
      return;
    }

    if (interaction.commandName === "edit-entry") {
      const edit: EditEntryPayload = {
        car_class: interaction.options.getString("class", true),
        car: interaction.options.getString("car", true),
      };

      let s = interaction.options.getString("time");
      if (s !== null && s.trim()) edit.time = s;

      s = interaction.options.getString("tuner");
      if (s !== null) edit.tuner = s;

      s = interaction.options.getString("tuner_share_code");
      if (s !== null && s.trim()) edit.tuner_share_code = s.trim();

      s = interaction.options.getString("driver");
      if (s !== null) edit.driver = s;

      s = interaction.options.getString("difficulty");
      if (s !== null) edit.difficulty = s;

      s = interaction.options.getString("drivetrain");
      if (s !== null) edit.drivetrain = s;

      s = interaction.options.getString("tires");
      if (s !== null) edit.tires = s;

      s = interaction.options.getString("engine");
      if (s !== null) edit.engine = s;

      s = interaction.options.getString("build_type");
      if (s !== null) edit.build_type = s;

      s = interaction.options.getString("performance");
      if (s !== null) edit.performance = s;

      s = interaction.options.getString("video");
      if (s !== null) edit.video = s;

      s = interaction.options.getString("driving_characteristics");
      if (s !== null) edit.driving_characteristics = s;

      s = interaction.options.getString("other_characteristics");
      if (s !== null) edit.other_characteristics = s;

      s = interaction.options.getString("alternate_tunes");
      if (s !== null) edit.alternate_tunes = s;

      const summary = await sheets.editEntry(edit);
      await interaction.editReply({
        content: `**Track:** ${track.label}\n${summary.message}`,
      });
      await recordSubmission({
        interaction,
        track,
        action: "edit",
        result: summary,
        carClass: edit.car_class,
        car: edit.car,
        time: edit.time ?? "",
        driver: edit.driver ?? "",
      });
      return;
    }

    const payload: NewEntryPayload = {
      car_class: interaction.options.getString("class", true),
      car: interaction.options.getString("car", true),
      time: interaction.options.getString("time", true),
      tuner: interaction.options.getString("tuner", true),
      tuner_share_code: interaction.options.getString("tuner_share_code", true),
      driver: interaction.options.getString("driver", true),
      difficulty: interaction.options.getString("difficulty", true),
      drivetrain: interaction.options.getString("drivetrain", true),
      tires: interaction.options.getString("tires", true),
      engine: interaction.options.getString("engine", true),
      build_type: interaction.options.getString("build_type", true),
      performance: interaction.options.getString("performance", true),
      video: interaction.options.getString("video", true),
      driving_characteristics:
        interaction.options.getString("driving_characteristics") ?? null,
      other_characteristics:
        interaction.options.getString("other_characteristics") ?? null,
      alternate_tunes: interaction.options.getString("alternate_tunes") ?? null,
    };

    const summary = await sheets.addOrUpdateRow(payload);
    await interaction.editReply({
      content: `**Track:** ${track.label}\n${summary.message}`,
    });
    await recordSubmission({
      interaction,
      track,
      action: "add",
      result: summary,
      carClass: payload.car_class,
      car: payload.car,
      time: payload.time,
      driver: payload.driver,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await interaction.editReply({
      content: `Request failed: ${msg}`,
    });
  }
});

await client.login(cfg.discordToken);
