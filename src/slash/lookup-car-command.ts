import {
  SlashCommandBuilder,
  type SlashCommandOptionsOnlyBuilder,
} from "discord.js";
import type { SlashSheetCommandContext } from "../types.js";
import { addTrackOptionWhenNeeded, classChoices } from "./add-entry-command.js";

type SheetSlashBuilder =
  | SlashCommandBuilder
  | SlashCommandOptionsOnlyBuilder;

/** `/lookup-car` — show row B–O (+ cell notes on D and O) for class + car name match */
export function createLookupCarCommand(ctx: SlashSheetCommandContext) {
  const opts = classChoices(ctx.sheetConfig);
  const first = opts.shift();
  if (!first) throw new Error("No classes in sheets.json");

  let b: SheetSlashBuilder = new SlashCommandBuilder()
    .setName("lookup-car")
    .setDescription("Look up a car entry in the spreadsheet.")
    .setDefaultMemberPermissions(null)
    .addStringOption((o) =>
      o
        .setName("class")
        .setDescription("Class tab (e.g. S2)")
        .setRequired(true)
        .addChoices(first, ...opts)
    )
    .addStringOption((o) =>
      o
        .setName("car")
        .setDescription(
          "In-game car name (e.g. Honda Beat 1991). Case-insensitive, normalized spaces."
        )
        .setRequired(true)
    );

  return addTrackOptionWhenNeeded(b, ctx);
}
