import { readFileSync } from "node:fs";
import { JWT } from "google-auth-library";

type ServiceAccountCreds = {
  client_email: string;
  private_key: string;
  [k: string]: unknown;
};

/**
 * Fixes PEM after copy/paste into .env (literal \\n, CRLF, stray spaces).
 * OpenSSL 3 on Linux often fails with DECODER routines::unsupported otherwise.
 */
export function normalizePrivateKeyPem(key: string): string {
  let pem = key.trim();
  if (pem.includes("\\n")) {
    pem = pem.replace(/\\n/g, "\n");
  }
  pem = pem.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  // Collapsed PEM on one line (common when JSON was mangled in .env)
  if (pem.includes("-----BEGIN") && !pem.includes("\n")) {
    pem = pem
      .replace(/-----BEGIN ([A-Z ]+)-----/, "-----BEGIN $1-----\n")
      .replace(/-----END ([A-Z ]+)-----/, "\n-----END $1-----\n");
  }
  return pem.endsWith("\n") ? pem : `${pem}\n`;
}

function loadServiceAccountCreds(): ServiceAccountCreds {
  const inline = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  let creds: ServiceAccountCreds | undefined;

  if (inline) {
    creds = JSON.parse(inline) as ServiceAccountCreds;
  } else {
    const path = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
    if (!path) {
      throw new Error(
        "Set GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS"
      );
    }
    const raw = readFileSync(path, "utf8");
    creds = JSON.parse(raw) as ServiceAccountCreds;
  }

  if (!creds?.client_email || !creds?.private_key) {
    throw new Error("Invalid service account JSON (client_email / private_key)");
  }

  creds.private_key = normalizePrivateKeyPem(creds.private_key);
  return creds;
}

/**
 * Loads service account credentials from GOOGLE_SERVICE_ACCOUNT_JSON
 * or from the file pointed to by GOOGLE_APPLICATION_CREDENTIALS.
 */
export function createSheetsJwt(): JWT {
  const creds = loadServiceAccountCreds();

  return new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}
