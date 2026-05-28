import {
  SlashCommandBuilder,
  type SlashCommandOptionsOnlyBuilder,
} from "discord.js";
import type { SlashSheetCommandContext } from "../types.js";
import {
  addTrackOptionWhenNeeded,
  classChoices,
  stringChoices,
} from "./add-entry-command.js";

type SheetSlashBuilder =
  | SlashCommandBuilder
  | SlashCommandOptionsOnlyBuilder;

/**
 * Patch an existing row. Only options you fill in are applied; omit the rest / leave blank optional.
 */
export function createEditEntryCommand(ctx: SlashSheetCommandContext) {
  const cfg = ctx.sheetConfig;
  const e = cfg.enums;

  const classOpts = classChoices(cfg);
  const first = classOpts.shift();
  if (!first) throw new Error("No classes in sheets.json");

  let b: SheetSlashBuilder = new SlashCommandBuilder()
    .setName("edit-entry")
    .setDescription("Modify an existing car's entry — only send fields that change.")
    .addStringOption((o) =>
      o
        .setName("class")
        .setDescription("Class tab (e.g. S2)")
        .setRequired(true)
        .addChoices(first, ...classOpts)
    )
    .addStringOption((o) =>
      o
        .setName("car")
        .setDescription("Car name as in column B (e.g. Honda Beat 1991). Case-insensitive, normalized spaces.")
        .setRequired(true)
    );

  b = addTrackOptionWhenNeeded(b, ctx);

  return b
    .addStringOption((o) =>
      o
        .setName("time")
        .setDescription("Lap time. E.g. 43.6 or 43,6 (omit = keep old value)")
        .setRequired(false)
    )
    .addStringOption((o) =>
      o.setName("tuner").setDescription("Tuner name (e.g. TheDannny) (omit = keep old value)").setRequired(false)
    )
    .addStringOption((o) =>
      o
        .setName("tuner_share_code")
        .setDescription("Share code (9 digits, spaces OK). (omit = keep old value)")
        .setRequired(false)
    )
    .addStringOption((o) =>
      o.setName("driver").setDescription("Driver name (omit = keep old value)").setRequired(false)
    )
    .addStringOption((o) =>
      o
        .setName("difficulty")
        .setDescription("Difficulty tier (omit = keep old value)")
        .setRequired(false)
        .addChoices(...stringChoices(e.difficulty))
    )
    .addStringOption((o) =>
      o
        .setName("drivetrain")
        .setDescription("Drivetrain type (omit = keep old value)")
        .setRequired(false)
        .addChoices(...stringChoices(e.drivetrain))
    )
    .addStringOption((o) =>
      o
        .setName("tires")
        .setDescription("Tire type (omit = keep old value)")
        .setRequired(false)
        .addChoices(...stringChoices(e.tires))
    )
    .addStringOption((o) =>
      o
        .setName("engine")
        .setDescription("Engine type — type to search (omit = keep old value)")
        .setRequired(false)
        .setAutocomplete(true)
    )
    .addStringOption((o) =>
      o
        .setName("build_type")
        .setDescription("Build type (omit = keep old value)")
        .setRequired(false)
        .addChoices(...stringChoices(e.buildType))
    )
    .addStringOption((o) =>
      o
        .setName("performance")
        .setDescription("Performance preset (omit = keep old value)")
        .setRequired(false)
        .addChoices(...stringChoices(e.performance))
    )
    .addStringOption((o) =>
      o
        .setName("video")
        .setDescription("Video URL (e.g. YouTube or Streamable). (omit = keep old value)")
        .setRequired(false)
    )
    .addStringOption((o) =>
      o
        .setName("driving_characteristics")
        .setRequired(false)
        .setDescription(
          "Driving notes (e.g. understeery, throttle control, dislikes bumps). (omit = keep old value)"
        )
    )
    .addStringOption((o) =>
      o
        .setName("other_characteristics")
        .setRequired(false)
        .setDescription(
          "Other notes (e.g. dies at 320 km/h, shift 5.3k RPM, boaty). (omit = keep old value)"
        )
    )
    .addStringOption((o) =>
      o
        .setName("alternate_tunes")
        .setRequired(false)
        .setDescription(
          'Name|9-digit, comma-separated. (e.g. Fenrir3268|123456789). (omit = keep old value)'
        )
    );
}
