import type { SubmissionAction, SubmissionContext, SubmissionOutcome } from "./types.js";

/** Tab name used for the append-only submission journal in each track spreadsheet. */
export const SUBMISSION_LOG_TAB = "_SubmissionLog";

/** Header row, in column order. Keep in sync with {@link buildSubmissionLogRow}. */
export const SUBMISSION_LOG_HEADERS = [
  "Timestamp ISO",
  "Action",
  "Outcome",
  "Discord User ID",
  "Username",
  "Guild ID",
  "Channel ID",
  "Track ID",
  "Class",
  "Car",
  "Time",
  "Driver",
  "Message Link",
] as const;

export type SubmissionLogEntry = {
  timestampIso: string;
  action: SubmissionAction;
  outcome: SubmissionOutcome;
  trackId: string;
  carClass: string;
  car: string;
  time: string;
  driver: string;
  context: SubmissionContext;
};

/** Build one journal row (string cells) matching {@link SUBMISSION_LOG_HEADERS}. */
export function buildSubmissionLogRow(e: SubmissionLogEntry): string[] {
  return [
    e.timestampIso,
    e.action,
    e.outcome,
    e.context.userId,
    e.context.username,
    e.context.guildId,
    e.context.channelId,
    e.trackId,
    e.carClass,
    e.car,
    e.time,
    e.driver,
    e.context.messageUrl ?? "",
  ];
}
