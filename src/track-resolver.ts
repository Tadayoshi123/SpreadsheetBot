import { trackIdsForGuild } from "./config.js";
import { memberAllowedTrackIds } from "./permissions.js";
import type { APIInteractionGuildMember, GuildMember } from "discord.js";
import type { AppConfig, TrackContext } from "./types.js";

export type ResolveTrackOptions = {
  /** `/lookup-car` — any server member; guild track list, not role-filtered. */
  lookup?: boolean;
};

/**
 * Map slash `track` input to a track id (config key).
 * Accepts id (`shirakawa`) or display label (`Shirakawa Circuit`) — users often type the label.
 */
export function resolveTrackOptionToId(
  cfg: AppConfig,
  guildTrackIds: readonly string[],
  trackOption: string
): string | null {
  const raw = trackOption.trim();
  if (!raw) return null;

  if (guildTrackIds.includes(raw)) return raw;

  const lower = raw.toLowerCase();
  for (const id of guildTrackIds) {
    if (id.toLowerCase() === lower) return id;
    const label = cfg.tracks.get(id)?.label.trim();
    if (label && label.toLowerCase() === lower) return id;
  }
  return null;
}

/**
 * Resolve which tier list track an interaction targets.
 * Add/edit: filtered by member roles (tracks.json allowedRoleIds).
 * Lookup: all tracks configured on the guild.
 */
export function resolveTrackContext(
  cfg: AppConfig,
  guildId: string,
  trackOption: string | null,
  member: GuildMember | APIInteractionGuildMember | null,
  options?: ResolveTrackOptions
): TrackContext {
  const guildTrackIds = trackIdsForGuild(cfg, guildId);
  if (guildTrackIds.length === 0) {
    throw new Error(
      "This server is not set up with any spreadsheet yet. Ask an administrator."
    );
  }

  const allowedIds = options?.lookup
    ? guildTrackIds
    : memberAllowedTrackIds(cfg, guildId, member);

  if (!options?.lookup && allowedIds.length === 0) {
    throw new Error(
      "You do not have permission to edit any spreadsheet on this server."
    );
  }

  const binding = cfg.guildTracks[guildId];
  let trackId: string;

  if (allowedIds.length === 1) {
    trackId = allowedIds[0]!;
    if (trackOption != null && trackOption.trim()) {
      const resolved = resolveTrackOptionToId(cfg, guildTrackIds, trackOption);
      if (resolved && resolved !== trackId) {
        const hint = options?.lookup
          ? "This server only has one spreadsheet; do not set **track**."
          : "You only have access to one spreadsheet; leave **track** empty or pick the one you are allowed to use.";
        throw new Error(hint);
      }
    }
  } else if (trackOption != null && trackOption.trim()) {
    const resolved = resolveTrackOptionToId(cfg, guildTrackIds, trackOption);
    trackId = resolved ?? trackOption.trim();
  } else if (options?.lookup && binding?.defaultTrack) {
    trackId = binding.defaultTrack;
  } else {
    throw new Error(
      options?.lookup
        ? "This server has multiple tier lists — choose **track** (or set defaultTrack in guild-tracks.json)."
        : "Choose a **track** (tier list) — start typing to see the lists you can use."
    );
  }

  const track = cfg.tracks.get(trackId);
  if (!track) {
    throw new Error(
      `Unknown track **${trackOption?.trim() || trackId}**. Pick **track** from the autocomplete list (do not type the full name).`
    );
  }

  if (!allowedIds.includes(trackId)) {
    throw new Error(
      options?.lookup
        ? "That spreadsheet is not available on this server."
        : "You do not have permission to use that spreadsheet."
    );
  }

  return { trackId, track };
}

/** Read optional `track` slash option (absent when guild registered without it). */
export function readTrackOption(
  getString: (name: string) => string | null
): string | null {
  return getString("track");
}

/** Resolve track for autocomplete (engine needs a track config). */
export function resolveTrackForAutocomplete(
  cfg: AppConfig,
  guildId: string,
  trackOption: string | null,
  member: GuildMember | APIInteractionGuildMember | null,
  commandName: string
): TrackContext {
  return resolveTrackContext(cfg, guildId, trackOption, member, {
    lookup: commandName === "lookup-car",
  });
}

/**
 * Engine list for autocomplete. Works without `track` when the member has one
 * allowed list, or unions engines across their allowed lists as a fallback.
 */
export function enginesForAutocomplete(
  cfg: AppConfig,
  guildId: string,
  trackOption: string | null,
  member: GuildMember | APIInteractionGuildMember | null,
  commandName: string
): readonly string[] {
  if (trackOption?.trim()) {
    const guildTrackIds = trackIdsForGuild(cfg, guildId);
    const trackId = resolveTrackOptionToId(cfg, guildTrackIds, trackOption);
    if (trackId) {
      const engines = cfg.tracks.get(trackId)?.sheetConfig.enums.engine;
      if (engines) return engines;
    }
    try {
      const { track } = resolveTrackForAutocomplete(
        cfg,
        guildId,
        trackOption,
        member,
        commandName
      );
      return track.sheetConfig.enums.engine;
    } catch {
      return [];
    }
  }

  const allowedIds =
    commandName === "lookup-car"
      ? trackIdsForGuild(cfg, guildId)
      : memberAllowedTrackIds(cfg, guildId, member);

  if (allowedIds.length === 1) {
    return cfg.tracks.get(allowedIds[0]!)?.sheetConfig.enums.engine ?? [];
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of allowedIds) {
    const engines = cfg.tracks.get(id)?.sheetConfig.enums.engine;
    if (!engines) continue;
    for (const e of engines) {
      if (!seen.has(e)) {
        seen.add(e);
        out.push(e);
      }
    }
  }
  return out;
}
