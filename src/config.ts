import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";
import type {
  AppConfig,
  GuildTrackBinding,
  GuildTracksFile,
  ResolvedTrack,
  SheetConfig,
  SlashSheetCommandContext,
  TrackConfigRaw,
  TracksFile,
} from "./types.js";
import { unionSheetConfigs } from "./sheet-config-union.js";

dotenv.config();

function loadJsonFile<T>(pathAbs: string): T {
  const raw = readFileSync(pathAbs, "utf8");
  return JSON.parse(raw) as T;
}

export function loadSheetJson(pathRel: string): SheetConfig {
  const pathResolved = resolve(pathRel);
  return loadJsonFile<SheetConfig>(pathResolved);
}

function parseCommaList(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function resolveConfigPath(envKey: string, defaultRel: string): string {
  const fromEnv = process.env[envKey]?.trim();
  return resolve(fromEnv ?? defaultRel);
}

function normalizeAllowedRoleIds(
  raw: (string | number)[] | undefined,
  trackId: string
): string[] {
  if (!raw?.length) return [];
  return raw.map((id, index) => {
    if (typeof id === "number") {
      throw new Error(
        `Track "${trackId}": allowedRoleIds[${index}] must be a JSON string, not a number (Discord snowflake IDs lose precision in JSON numbers).`
      );
    }
    const normalized = id.trim();
    if (!/^\d{17,20}$/.test(normalized)) {
      throw new Error(
        `Track "${trackId}": allowedRoleIds[${index}] is not a valid Discord role id.`
      );
    }
    return normalized;
  });
}

function resolveTrack(
  id: string,
  raw: TrackConfigRaw,
  cwd: string
): ResolvedTrack {
  if (!raw.spreadsheetId?.trim()) {
    throw new Error(`Track "${id}": spreadsheetId is required.`);
  }
  if (!raw.label?.trim()) {
    throw new Error(`Track "${id}": label is required.`);
  }
  const sheetConfigPath = resolve(cwd, raw.sheetConfigPath);
  if (!existsSync(sheetConfigPath)) {
    throw new Error(
      `Track "${id}": sheet config not found at ${sheetConfigPath}`
    );
  }
  return {
    id,
    label: raw.label.trim(),
    spreadsheetId: raw.spreadsheetId.trim(),
    sheetConfigPath,
    sheetConfig: loadSheetJson(sheetConfigPath),
    allowedRoleIds: normalizeAllowedRoleIds(raw.allowedRoleIds, id),
  };
}

function loadTracksMap(cwd: string): {
  tracks: Map<string, ResolvedTrack>;
  legacySingleTrack: boolean;
} {
  const tracksPath = resolveConfigPath(
    "TRACKS_CONFIG_PATH",
    resolve(cwd, "config/tracks.json")
  );

  if (existsSync(tracksPath)) {
    const file = loadJsonFile<TracksFile>(tracksPath);
    const entries = Object.entries(file.tracks ?? {});
    if (entries.length === 0) {
      throw new Error(`${tracksPath}: "tracks" must contain at least one entry.`);
    }
    const tracks = new Map<string, ResolvedTrack>();
    for (const [id, raw] of entries) {
      if (tracks.has(id)) {
        throw new Error(`Duplicate track id "${id}" in ${tracksPath}.`);
      }
      tracks.set(id, resolveTrack(id, raw, cwd));
    }
    return { tracks, legacySingleTrack: false };
  }

  const spreadsheetId = process.env.SPREADSHEET_ID?.trim();
  if (!spreadsheetId) {
    throw new Error(
      "Either config/tracks.json or SPREADSHEET_ID is required (legacy single-track mode)."
    );
  }
  const cfgPath =
    process.env.CONFIG_PATH?.trim() ??
    resolve(cwd, "config/sheets.json");
  const sheetConfigPath = resolve(cfgPath);
  if (!existsSync(sheetConfigPath)) {
    throw new Error(`Sheet config not found: ${sheetConfigPath}`);
  }
  const track: ResolvedTrack = {
    id: "default",
    label: "Default",
    spreadsheetId,
    sheetConfigPath,
    sheetConfig: loadSheetJson(sheetConfigPath),
    allowedRoleIds: [],
  };
  return { tracks: new Map([["default", track]]), legacySingleTrack: true };
}

function loadGuildTracks(cwd: string): Record<string, GuildTrackBinding> {
  const guildPath = resolveConfigPath(
    "GUILD_TRACKS_CONFIG_PATH",
    resolve(cwd, "config/guild-tracks.json")
  );
  if (!existsSync(guildPath)) return {};
  const file = loadJsonFile<GuildTracksFile>(guildPath);
  return file.guilds ?? {};
}

function validateGuildTracks(
  guildTracks: Record<string, GuildTrackBinding>,
  tracks: Map<string, ResolvedTrack>
): void {
  for (const [guildId, binding] of Object.entries(guildTracks)) {
    if (!binding.tracks?.length) {
      throw new Error(
        `guild-tracks.json: guild ${guildId} must list at least one track.`
      );
    }
    for (const tid of binding.tracks) {
      if (!tracks.has(tid)) {
        throw new Error(
          `guild-tracks.json: guild ${guildId} references unknown track "${tid}".`
        );
      }
    }
    if (binding.defaultTrack != null && !binding.tracks.includes(binding.defaultTrack)) {
      throw new Error(
        `guild-tracks.json: guild ${guildId} defaultTrack "${binding.defaultTrack}" is not in tracks list.`
      );
    }
  }
}

export function loadAppConfig(): AppConfig {
  const token = process.env.DISCORD_TOKEN?.trim();
  if (!token) throw new Error("DISCORD_TOKEN is required");

  const cwd = process.cwd();
  const { tracks, legacySingleTrack } = loadTracksMap(cwd);
  const guildTracks = loadGuildTracks(cwd);
  validateGuildTracks(guildTracks, tracks);

  const allowedRoleIds = parseCommaList(process.env.DISCORD_ALLOWED_ROLE_IDS);

  return {
    discordToken: token,
    discordGuildIds: parseCommaList(process.env.DISCORD_GUILD_ID),
    allowedRoleIds,
    tracks,
    guildTracks,
    legacySingleTrack,
  };
}

/** Track IDs this guild may use (runtime). */
export function trackIdsForGuild(
  cfg: AppConfig,
  guildId: string
): string[] {
  const binding = cfg.guildTracks[guildId];
  if (binding) return binding.tracks;

  if (cfg.tracks.size === 1) {
    return [cfg.tracks.keys().next().value!];
  }

  if (cfg.legacySingleTrack) {
    return ["default"];
  }

  return [];
}

/** Build slash registration context for a guild (or all tracks when guildId is null). */
export function slashContextForGuild(
  cfg: AppConfig,
  guildId: string | null
): SlashSheetCommandContext {
  const trackIds =
    guildId != null
      ? trackIdsForGuild(cfg, guildId)
      : [...cfg.tracks.keys()];

  if (trackIds.length === 0) {
    throw new Error(
      guildId != null
        ? `Guild ${guildId} has no tracks configured in guild-tracks.json.`
        : "No tracks configured."
    );
  }

  const resolved = trackIds.map((id) => {
    const t = cfg.tracks.get(id);
    if (!t) throw new Error(`Unknown track "${id}".`);
    return t;
  });

  return {
    sheetConfig: unionSheetConfigs(resolved.map((t) => t.sheetConfig)),
    tracks: resolved.map((t) => ({ id: t.id, label: t.label })),
    showTrackOption: resolved.length > 1,
  };
}
