import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import * as fs from "node:fs";
import * as path from "node:path";

const CONFIG_DIR = process.env.GOOGLE_MCP_CONFIG_DIR || path.join(process.env.HOME || "/home/ubuntu", ".config", "google-workspace-mcp");
const CREDENTIALS_PATH = path.join(CONFIG_DIR, "credentials.json");

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/drive",
];

// Cache auth clients by account name
const _authClients: Map<string, OAuth2Client> = new Map();

export function getConfigDir(): string {
  return CONFIG_DIR;
}

function getTokensPath(account: string): string {
  if (account === "default") return path.join(CONFIG_DIR, "tokens.json");
  return path.join(CONFIG_DIR, `tokens-${account}.json`);
}

export function listAccounts(): string[] {
  const accounts: string[] = [];
  if (!fs.existsSync(CONFIG_DIR)) return accounts;

  const files = fs.readdirSync(CONFIG_DIR);
  for (const f of files) {
    if (f === "tokens.json") {
      accounts.push("default");
    } else if (f.startsWith("tokens-") && f.endsWith(".json")) {
      accounts.push(f.replace("tokens-", "").replace(".json", ""));
    }
  }
  return accounts;
}

export function isConfigured(account: string = "default"): boolean {
  return fs.existsSync(CREDENTIALS_PATH) && fs.existsSync(getTokensPath(account));
}

export async function getAuthClient(account: string = "default"): Promise<OAuth2Client> {
  const cached = _authClients.get(account);
  if (cached) return cached;

  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error(`Google credentials not found at ${CREDENTIALS_PATH}. Place your OAuth client JSON there.`);
  }

  const tokensPath = getTokensPath(account);
  if (!fs.existsSync(tokensPath)) {
    throw new Error(`Google tokens not found at ${tokensPath}. Run the setup script to authorize account '${account}'.`);
  }

  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8"));
  const { client_id, client_secret, redirect_uris } = credentials.installed || credentials.web;

  const oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris?.[0] || "http://localhost:3000/oauth/callback");

  const tokens = JSON.parse(fs.readFileSync(tokensPath, "utf-8"));
  oauth2Client.setCredentials(tokens);

  oauth2Client.on("tokens", (newTokens) => {
    const merged = { ...tokens, ...newTokens };
    fs.writeFileSync(tokensPath, JSON.stringify(merged, null, 2));
  });

  _authClients.set(account, oauth2Client);
  return oauth2Client;
}

export function saveTokensForAccount(account: string, tokens: object): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(getTokensPath(account), JSON.stringify(tokens, null, 2));
}

export { SCOPES, CREDENTIALS_PATH };
