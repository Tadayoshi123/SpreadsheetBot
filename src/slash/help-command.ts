import { SlashCommandBuilder } from "discord.js";

/** Embed description for `/help` (Discord limit 4096; plain `content` is capped at 2000). */
export const HELP_EMBED_DESCRIPTION_MAX = 4096;

/** Embed body for `/help` (available to all server members). */
export const SHEET_MANAGER_HELP_BODY = `
**SpreadsheetBot** updates shared Google Sheets (**columns B–O** per class tab). Lap times: **smaller = faster**. Share codes are stored in **cell notes** on **Tuner (D)** and **Alternative tune(s) (O)**.

**Who can use what**
• **/help** and **/lookup-car** — any server member (only you see the reply).
• **/add-entry** and **/edit-entry** — roles configured by administrators (typically **Sheet Manager**).

**Share codes**
Primary tuner: **9 digits** (spaces OK, e.g. \`123 456 789\`).
Alternate tunes (\`alternate_tunes\`): **Name|9-digit code**, comma-separated — e.g. \`Fenrir3268|123456789\`. Avoid commas in the name. On **/edit-entry**, \`-\` alone in \`alternate_tunes\` clears column **O**.

**Several spreadsheets**
If your server has more than one, pick **\`track\`** (type to search). For add/edit you only see the ones your roles allow; if you only have one, leave **\`track\`** empty.

**Commands**
**\/add-entry** — Adds a row; **class** picks the sheet tab. Duplicate **car** names are only updated when the new lap time is **strictly faster**. **Engine** uses autocomplete.

**\/lookup-car** — Look up a **car** in column **B** (case-insensitive, normalized spaces).

**\/edit-entry** — Change only the fields you fill in; others stay as-is. A new **lap time** re-sorts the row within the sheet.
`.trim();

export function createHelpCommand() {
  return new SlashCommandBuilder()
    .setName("help")
    .setDescription("SpreadsheetBot — commands and who can use them.")
    .setDefaultMemberPermissions(null);
}
