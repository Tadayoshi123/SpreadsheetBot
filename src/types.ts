export type SheetConfig = {
  defaultDataStartRow: number;
  /** Extra empty rows below the last car (column B) that keep column I validation. Default 15. */
  engineDropdownBufferRows?: number;
  classToSheetTab: Record<string, string>;
  enums: {
    difficulty: string[];
    drivetrain: string[];
    tires: string[];
    engine: string[];
    buildType: string[];
    performance: string[];
  };
};

/** Raw entry in config/tracks.json (before sheet JSON is loaded). */
export type TrackConfigRaw = {
  label: string;
  spreadsheetId: string;
  sheetConfigPath: string;
  /** Empty = inherit DISCORD_ALLOWED_ROLE_IDS. Must be JSON strings (snowflakes lose precision as numbers). */
  allowedRoleIds?: (string | number)[];
};

export type TracksFile = {
  tracks: Record<string, TrackConfigRaw>;
};

export type GuildTrackBinding = {
  tracks: string[];
  defaultTrack?: string;
};

export type GuildTracksFile = {
  guilds: Record<string, GuildTrackBinding>;
};

/** Track after sheet config JSON is loaded at startup. */
export type ResolvedTrack = {
  id: string;
  label: string;
  spreadsheetId: string;
  sheetConfigPath: string;
  sheetConfig: SheetConfig;
  allowedRoleIds: string[];
};

export type AppConfig = {
  discordToken: string;
  /** Slash commands registered here (comma-separated in env). Empty = global register when running register script. */
  discordGuildIds: string[];
  allowedRoleIds: string[];
  tracks: Map<string, ResolvedTrack>;
  guildTracks: Record<string, GuildTrackBinding>;
  /** True when using legacy SPREADSHEET_ID fallback (no tracks.json). */
  legacySingleTrack: boolean;
};

export type TrackContext = {
  trackId: string;
  track: ResolvedTrack;
};

export type SlashSheetCommandContext = {
  sheetConfig: SheetConfig;
  tracks: { id: string; label: string }[];
  showTrackOption: boolean;
};

export type ParsedAlternate = { name: string; codeDigits: string };
