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
  /** Portal metadata (free text, optional). */
  surface?: string;
  /** Portal metadata: circuit, sprint, trail, etc. (optional). */
  trackType?: string;
  /** Portal metadata: recommended cars / performance (optional). */
  recommended?: string;
};

/** Portal spreadsheet config (top-level "portal" block in tracks.json). */
export type PortalConfigRaw = {
  spreadsheetId: string;
  tabTitle?: string;
};

export type PortalConfig = {
  spreadsheetId: string;
  tabTitle: string;
};

export type TracksFile = {
  tracks: Record<string, TrackConfigRaw>;
  portal?: PortalConfigRaw;
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
  /** Portal metadata (optional). */
  surface?: string;
  trackType?: string;
  recommended?: string;
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
  /** Portal spreadsheet (undefined = portal feature disabled). */
  portal?: PortalConfig;
};

export type TrackContext = {
  trackId: string;
  track: ResolvedTrack;
};

/** Outcome of an add/edit write, for traceability + portal. */
export type SubmissionOutcome = "added" | "updated" | "rejected-not-faster";

export type SubmissionAction = "add" | "edit";

/** Structured result returned by addOrUpdateRow / editEntry. */
export type SubmissionResult = {
  /** Human-readable text used for the Discord reply. */
  message: string;
  outcome: SubmissionOutcome;
  tabTitle: string;
  /** 1-based physical row written (0 when nothing was written, e.g. rejected). */
  physicalRow: number;
};

/** Discord context captured at submission time for the log. */
export type SubmissionContext = {
  userId: string;
  username: string;
  guildId: string;
  channelId: string;
  messageUrl?: string;
};

export type SlashSheetCommandContext = {
  sheetConfig: SheetConfig;
  tracks: { id: string; label: string }[];
  showTrackOption: boolean;
};

export type ParsedAlternate = { name: string; codeDigits: string };
