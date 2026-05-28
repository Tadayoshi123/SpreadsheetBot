# Spreadsheet bot (Discord → Google Sheets)

Moderators add Forza Horizon–style tier-list rows via Discord slash commands (English). Data is written to your Google Sheet (columns **B–O**) with **cell notes** on **Tuner** (D) and **Alternative Tune(s)** (O) for share codes.

## Prerequisites

1. **Google Cloud**  
   - Create a project, enable **Google Sheets API**.  
   - Create a **service account** and download the JSON key.  
   - **Share** the target spreadsheet with the service account email (Editor).

2. **Discord**  
   - Create an application + bot, copy the **token**.  
   - Copy the **Application ID** (Client ID).  
   - Enable the **Server Members Intent** only if you rely on cached members (optional for slash commands; role IDs are usually present on the interaction payload).  
   - Note the **role ID(s)** that may use the bot.

## Configuration

1. Copy [`.env.example`](.env.example) to `.env` and fill values.
2. **Single spreadsheet (legacy)** — leave out `config/tracks.json` and set `SPREADSHEET_ID` + [`config/sheets.json`](config/sheets.json).
3. **Multiple spreadsheets (tracks)** — copy [`config/tracks.json.example`](config/tracks.json.example) to `config/tracks.json` and [`config/guild-tracks.json.example`](config/guild-tracks.json.example) to `config/guild-tracks.json`. Each track points at a spreadsheet ID and a sheet config file.

### Sheet config (`config/sheets.json` or per-track `sheetConfigPath`)

- `classToSheetTab`: keys are slash options (`R`, `S2`, …), values are **exact** Google Sheet tab titles.
- `defaultDataStartRow`: first **data** row (first car/time row, same row as the tier label if they share a row). Example: if headers are row 3 and the first car is row 4, use `4`.
- `engineDropdownBufferRows`: optional; empty rows below the last car that still get the engine dropdown (default `15`). Used by `npm run sync-engine-dropdowns` only.
- `enums`: kept in sync with your sheet data-validation lists; the bot rejects values not present here.

### Multi-track (`config/tracks.json` + `config/guild-tracks.json`)

- **`tracks`**: each entry is one tier list (`spreadsheetId`, `label`, `sheetConfigPath`, optional `allowedRoleIds`).
- **`guild-tracks`**: maps Discord guild ID → list of track IDs that server may use (+ optional `defaultTrack` when several).
- **Same service account** for all spreadsheets — share each sheet **Editor** with the service account email.
- **Slash commands** are registered **per guild** (via `DISCORD_GUILD_ID` or keys in `guild-tracks.json`) with enum choices = **union** of all tracks on that server; runtime validation uses the **selected track's** config.
- When a guild has **one** track, the `track` slash option is hidden. With **several** tracks, `track` uses **autocomplete** (optional at register time).
- **Add/edit:** `track` choices are filtered by the user's Discord roles vs each track's `allowedRoleIds`. One allowed track → auto-selected (leave `track` empty). Several → pick from autocomplete.
- **Lookup:** any member can query any track on the server; optional `defaultTrack` in `guild-tracks.json` when `track` is omitted.

### Onboarding a tester community

1. Duplicate your template Google Sheet.
2. Share the copy with the service account (Editor).
3. Add a track in `config/tracks.json` (new `spreadsheetId`, optional copy of `sheets.json` if enums differ).
4. Add the tester's guild ID in `config/guild-tracks.json` with the track id(s) they may use.
5. Optionally set `allowedRoleIds` on that track to restrict who can edit it (use **quoted strings** in JSON — numeric snowflakes lose precision).
6. `npm run build && npm run register` (with `DISCORD_GUILD_ID` including their server).
7. Redeploy the bot (config files must ship with the app on Discloud).

### Time format

`time` is parsed as a single number: comma or dot decimal separator is accepted (`43,6` and `43.6` are equivalent). **Smaller = faster.** The same string you type (trimmed) is written to column **C** when possible.

### Share codes

- Primary tuner: option `tuner_share_code` — **9 digits**; spaces allowed (`123 456 789`).
- Alternates: option `alternate_tunes`, entries `Name|123456789` separated by **commas** (line breaks also work; spaces allowed in codes).  
  Cell **O** shows names (multi-line); the **note** lists `Name - XXX XXX XXX` per line.

### `/add-entry` options

| Option | Required | Sheet column |
|--------|----------|--------------|
| `track` | when server has multiple tier lists (autocomplete; omit if you only have one allowed list) | picks spreadsheet |
| `class` | yes | picks tab |
| `car` | yes | B |
| `time` | yes | C |
| `tuner` | yes | D (+ note) |
| `tuner_share_code` | yes | (note on D) |
| `driver` | yes | E |
| `difficulty` | yes | F (format from dropdown validation range + conditional rules on the tab, else an existing row) |
| `drivetrain` | yes | G |
| `tires` | yes | H |
| `engine` | yes | I |
| `build_type` | yes | J |
| `performance` | yes | K |
| `video` | yes | L (`HYPERLINK` with label **▶ Run** when value starts with `http://` or `https://`; otherwise plain text) |
| `driving_characteristics` | no | M (defaults to `-`) |
| `other_characteristics` | no | N (defaults to `-`) |
| `alternate_tunes` | no | O (+ optional note) |

### `/lookup-car`

Available to **@everyone** on any server listed in `guild-tracks.json` (no Sheet Manager role required). Shows the **B–O** row for one car in the chosen class (first matching row if several share the same normalized name). Match is the same as `/add-entry` (case-insensitive, normalized spaces). Reply is **ephemeral** so share codes in cell notes stay private. On servers with several tracks, pick **track** like other sheet commands. Run **`npm run register`** after pulling permission changes.

**Difficulty colours (column F):** the bot does not hardcode colours. On each class tab it reads the **data validation** on column F (dropdown `ONE_OF_RANGE` source list — style each option cell there) and any **conditional formatting** rules on column F (`TEXT_EQ` / `TEXT_NOT_EQ` per label). If a label is still missing, it falls back to copying format from an existing row. Empty tier lists work as long as the template defines the dropdown list (and/or conditional rules). Labels must match `enums.difficulty` in [`config/sheets.json`](config/sheets.json) for slash validation. Restart the bot after changing colours so the per-tab cache refreshes.

## Hosting (24/7)

- **Google Cloud e2-micro (Always Free, US region)** — recommended if you already use GCP. Step-by-step: **[docs/DEPLOY-GCP.md](docs/DEPLOY-GCP.md)** (`deploy/gcp/setup-vm.sh` + systemd). Clone on the VM via GitHub: **[docs/GITHUB-VM.md](docs/GITHUB-VM.md)**.
- **Discloud** — only viable on the free tier after slimming dependencies (RAM ~100 MB); see `discloud.config`.
- **Your PC** — `npm start` or a process manager while the machine is on.

## Run

```bash
npm install
npm run build
npm run register   # registers slash commands (needs DISCORD_CLIENT_ID)
npm start          # starts the bot
npm run sync-engine-dropdowns   # hidden _BotEngines sheet + column I dropdowns
```

### Engine dropdowns in Google Sheets

Instead of maintaining column **I** validation by hand, run **`npm run sync-engine-dropdowns`** after updating `enums.engine` in [`config/sheets.json`](config/sheets.json):

1. Creates or updates a **hidden** tab **`_BotEngines`** with one engine per row (column A).
2. Sets **one** **Data validation → Dropdown from range** rule per class tab on column **I**: from `defaultDataStartRow` through the **last row with a car** (column B) plus `engineDropdownBufferRows` (default **15**). Empty rows below that are left without validation. Inserting a row inside the validated range still inherits the same rule (same as a manual dropdown block).
3. Clears any previous bulk validation on column I (e.g. legacy 500-row sync) before applying the new range.
4. **Protects** the list range so editors are warned not to change it manually (update via config + sync instead).

The range used is `='_BotEngines'!$A$1:$A$N` where **N** matches your config. Re-run sync when you add engines to `sheets.json` or when manual edits grow past the buffered end of the sheet.

```bash
npm run build
npm run sync-engine-dropdowns
```

- Use **`DISCORD_GUILD_ID`** before `npm run register`: one guild ID **or comma-separated guild IDs** (test + prod) so slash commands appear there immediately.  
- Leave it **empty** for **global** registration (can take up to ~1 hour to show on every guild the bot joins).

## Behaviour notes

- **Sorted insert**: Finds the correct **tier** from column A thresholds, unmerges/remerges column A, inserts at the right lap-time rank within that tier.
- **Same car**: If column **B** matches (trim + case-insensitive, normalized spaces), the bot **replaces** the row **only when** the new time is strictly faster.
- On **429/503** from Google, requests **retry with backoff**.
- Duplicate message when time not improved uses the numeric parsed time printed as stored internally.

## Troubleshooting

- **`npm run register`** — `50001 Missing Access` for a guild listed in `DISCORD_GUILD_ID`: the bot account is not in that server, or it was added without the **`applications.commands`** OAuth scope. Generate a new invite in the Developer Portal (URL Generator) with **bot** + **applications.commands**, then add the bot on that server. Check the guild ID (right‑click server → Copy Server ID with Developer Mode).

- Column **L** URLs are written as `=HYPERLINK("…", "▶ Run")` so the sheet stays compact. Non-URL values (e.g. `non`) stay plain text.
