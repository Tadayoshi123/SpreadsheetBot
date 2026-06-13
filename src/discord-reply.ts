import type { EditEntryPayload } from "./sheets.js";
import type { SubmissionOutcome, SubmissionResult } from "./types.js";
import { isLikelyVideoUrl } from "./video-hyperlink.js";

const EDIT_FIELD_LABELS: Record<string, string> = {
  time: "time",
  tuner: "tuner",
  tuner_share_code: "tuner share code",
  driver: "driver",
  difficulty: "difficulty",
  drivetrain: "drivetrain",
  tires: "tires",
  engine: "engine",
  build_type: "build type",
  performance: "performance",
  video: "video",
  driving_characteristics: "driving characteristics",
  other_characteristics: "other characteristics",
  alternate_tunes: "alternate tunes",
};

function outcomeHint(outcome: SubmissionOutcome): string | null {
  switch (outcome) {
    case "rejected-not-faster":
      return (
        "_This car is already listed with a faster or equal time. " +
        "Use `/edit-entry` to change tuner, video or other fields without beating the current time._"
      );
    case "updated":
      return null;
    case "added":
      return null;
  }
}

/** Fields explicitly patched by `/edit-entry` (excluding class + car identifiers). */
export function changedEditFieldLabels(edit: EditEntryPayload): string[] {
  const out: string[] = [];
  for (const [key, label] of Object.entries(EDIT_FIELD_LABELS)) {
    if (edit[key as keyof EditEntryPayload] !== undefined) {
      out.push(label);
    }
  }
  return out;
}

/** Raw video URL to append for Discord auto-embed on `/add-entry`. */
export function videoUrlForAdd(video: string): string | null {
  const trimmed = video.trim();
  return isLikelyVideoUrl(trimmed) ? trimmed : null;
}

/** Raw video URL when `/edit-entry` supplied a new `video` option. */
export function videoUrlForEdit(video: string | undefined): string | null {
  if (video === undefined) return null;
  const trimmed = video.trim();
  if (!trimmed || !isLikelyVideoUrl(trimmed)) return null;
  return trimmed;
}

export function buildAddReplyContent(params: {
  trackLabel: string;
  result: SubmissionResult;
  video: string;
}): string {
  return assembleReply({
    trackLabel: params.trackLabel,
    result: params.result,
    videoUrl: videoUrlForAdd(params.video),
  });
}

export function buildEditReplyContent(params: {
  trackLabel: string;
  result: SubmissionResult;
  edit: EditEntryPayload;
}): string {
  const changed = changedEditFieldLabels(params.edit);
  return assembleReply({
    trackLabel: params.trackLabel,
    result: params.result,
    videoUrl: videoUrlForEdit(params.edit.video),
    changedFields: changed.length ? changed : undefined,
  });
}

function assembleReply(params: {
  trackLabel: string;
  result: SubmissionResult;
  videoUrl: string | null;
  changedFields?: string[];
}): string {
  const lines: string[] = [`**Track:** ${params.trackLabel}`];

  if (params.changedFields?.length) {
    lines.push(`**Updated fields:** ${params.changedFields.join(", ")}`);
  }

  lines.push(params.result.message);

  const hint = outcomeHint(params.result.outcome);
  if (hint) lines.push("", hint);

  if (
    params.videoUrl &&
    params.result.outcome !== "rejected-not-faster"
  ) {
    lines.push("", params.videoUrl);
  }

  return lines.join("\n");
}
