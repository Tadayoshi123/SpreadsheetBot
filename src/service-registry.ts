import type { JWT } from "google-auth-library";
import { SheetsEntryService } from "./sheets.js";
import type { ResolvedTrack } from "./types.js";

/** Cached SheetsEntryService per spreadsheet + sheet config file. */
export class SheetsServiceRegistry {
  private readonly cache = new Map<string, SheetsEntryService>();

  constructor(private readonly auth: JWT) {}

  getForTrack(track: ResolvedTrack): SheetsEntryService {
    const key = `${track.spreadsheetId}::${track.sheetConfigPath}`;
    let svc = this.cache.get(key);
    if (!svc) {
      svc = new SheetsEntryService(
        this.auth,
        track.spreadsheetId,
        track.sheetConfig
      );
      this.cache.set(key, svc);
    }
    return svc;
  }
}
