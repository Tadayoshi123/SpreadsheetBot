import { loadAppConfig } from "./config.js";
import { createSheetsJwt } from "./auth-google.js";
import { syncEngineDropdownsForSpreadsheet } from "./sheet-engine-list-sync.js";

const cfg = loadAppConfig();
const jwt = createSheetsJwt();

const seen = new Set<string>();

for (const track of cfg.tracks.values()) {
  if (!track.spreadsheetId.trim()) {
    console.warn(`Skipping track "${track.id}": empty spreadsheetId.`);
    continue;
  }
  const key = `${track.spreadsheetId}::${track.sheetConfigPath}`;
  if (seen.has(key)) continue;
  seen.add(key);

  console.log(
    `Syncing engine dropdowns for track "${track.id}" (${track.label})…`
  );
  await syncEngineDropdownsForSpreadsheet(
    jwt,
    track.spreadsheetId,
    track.sheetConfig
  );
  console.log(`  → spreadsheet ${track.spreadsheetId}`);
}

console.log("Done.");
