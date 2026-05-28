import {
  SlashCommandBuilder,
  type SlashCommandOptionsOnlyBuilder,
} from "discord.js";
import type { SheetConfig, SlashSheetCommandContext } from "../types.js";

type SheetSlashBuilder =
  | SlashCommandBuilder
  | SlashCommandOptionsOnlyBuilder;

/**
 * Appends optional `track` (autocomplete) when the guild has multiple tier lists.
 * Must run after all required options — Discord rejects optional-before-required ordering.
 */
export function addTrackOptionWhenNeeded(
  builder: SheetSlashBuilder,
  ctx: SlashSheetCommandContext
): SheetSlashBuilder {
  if (!ctx.showTrackOption) return builder;
  return builder.addStringOption((o) =>
    o
      .setName("track")
      .setDescription(
        "Spreadsheet — type to search (omit if you only have access to one)"
      )
      .setRequired(false)
      .setAutocomplete(true)
  );
}

/** Shared by `/add-entry`, `/lookup-car`, etc. */
export function classChoices(cfg: SheetConfig) {
  return Object.keys(cfg.classToSheetTab).map((k) => ({
    name: `${k}`,
    value: k,
  }));
}

export function stringChoices(names: readonly string[]) {
  return [...names].map((v) => ({ name: v, value: v }));
}

/** Build Discord slash-command definition from sheet config enums */
export function createAddEntryCommand(ctx: SlashSheetCommandContext) {
  const cfg = ctx.sheetConfig;
  const e = cfg.enums;

  const classOpts = classChoices(cfg);

  const first = classOpts.shift();
  if (!first) throw new Error("No classes in sheets.json");

  let opt = new SlashCommandBuilder()
    .setName("add-entry")
    .setDescription(
      "Add a new car entry to the spreadsheet. Sorted by lap time."
    )
    .addStringOption((o) =>
      o
        .setName("class")
        .setDescription("Sheet tab (e.g. S2)")
        .setRequired(true)
        .addChoices(first, ...classOpts)
    )
    .addStringOption((o) =>
      o
        .setName("car")
        .setDescription("In-game car name (e.g. Honda Beat 1991)")
        .setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("time").setDescription("Lap time (e.g. 43.6 or 43,6)").setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("tuner").setDescription("Tuner name (e.g. TheDannny)").setRequired(true)
    )
    .addStringOption((o) =>
      o
        .setName("tuner_share_code")
        .setDescription("Share code (9 digits, spaces OK). (e.g. 123456789)")
        .setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("driver").setDescription("Driver name (e.g. TheDannny)").setRequired(true)
    )
    .addStringOption((o) =>
      o
        .setName("difficulty")
        .setDescription("Difficulty tier")
        .setRequired(true)
        .addChoices(...stringChoices(e.difficulty))
    )
    .addStringOption((o) =>
      o
        .setName("drivetrain")
        .setDescription("Drivetrain type")
        .setRequired(true)
        .addChoices(...stringChoices(e.drivetrain))
    )
    .addStringOption((o) =>
      o
        .setName("tires")
        .setDescription("Tire type")
        .setRequired(true)
        .addChoices(...stringChoices(e.tires))
    )
    .addStringOption((o) =>
      o
        .setName("engine")
        .setDescription("Engine type — type to search")
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption((o) =>
      o
        .setName("build_type")
        .setDescription("Build type")
        .setRequired(true)
        .addChoices(...stringChoices(e.buildType))
    )
    .addStringOption((o) =>
      o
        .setName("performance")
        .setDescription("Performance preset")
        .setRequired(true)
        .addChoices(...stringChoices(e.performance))
    )
    .addStringOption((o) =>
      o
        .setName("video")
        .setDescription("Video URL (e.g. YouTube or Streamable)")
        .setRequired(true)
    );

  opt = addTrackOptionWhenNeeded(opt, ctx);

  opt = opt
    .addStringOption((o) =>
      o
        .setName("driving_characteristics")
        .setDescription(
          "Optional driving hints (e.g. understeery, throttle control, dislikes bumps)"
        )
        .setRequired(false)
    )
    .addStringOption((o) =>
      o
        .setName("other_characteristics")
        .setDescription(
          "Optional other notes (e.g. dies at 320 km/h, shift 5.3k RPM, boaty)"
        )
        .setRequired(false)
    )
    .addStringOption((o) =>
      o
        .setName("alternate_tunes")
        .setDescription(
          `Optional alts: Name|9-digit, comma-separated. (e.g. Fenrir3268|123456789)`
        )
        .setRequired(false)
    );

  return opt;
}
