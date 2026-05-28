import { readFileSync } from "node:fs";
import { JWT } from "google-auth-library";

/**
 * Loads service account credentials from GOOGLE_SERVICE_ACCOUNT_JSON
 * or from the file pointed to by GOOGLE_APPLICATION_CREDENTIALS.
 */
export function createSheetsJwt(): JWT {
  const inline = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  let creds:
    | { client_email: string; private_key: string; [k: string]: unknown }
    | undefined;

  if (inline) {
    creds = JSON.parse(inline) as typeof creds;
  } else {
    const path = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
    if (!path) {
      throw new Error(
        "Set GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS"
      );
    }
    const raw = readFileSync(path, "utf8");
    creds = JSON.parse(raw) as typeof creds;
  }

  if (!creds?.client_email || !creds?.private_key) {
    throw new Error("Invalid service account JSON (client_email / private_key)");
  }

  return new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}
