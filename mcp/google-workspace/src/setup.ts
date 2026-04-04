#!/usr/bin/env node

/**
 * Setup script for Google Workspace MCP server.
 * Handles OAuth authorization flow for multiple accounts.
 *
 * Usage:
 *   npx tsx src/setup.ts [account-name]
 *   # account-name defaults to "default"
 *   # Example: npx tsx src/setup.ts work
 */

import * as fs from "node:fs";
import * as http from "node:http";
import * as url from "node:url";
import { google } from "googleapis";
import { getConfigDir, CREDENTIALS_PATH, SCOPES, saveTokensForAccount } from "./auth.js";

const accountName = process.argv[2] || "default";

async function setup() {
  const configDir = getConfigDir();

  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.error(`\nPlace your Google OAuth credentials at:\n  ${CREDENTIALS_PATH}\n`);
    console.error("Steps:");
    console.error("1. Go to https://console.cloud.google.com");
    console.error("2. Create/select a project");
    console.error("3. Enable Gmail API, Google Calendar API, Google Drive API");
    console.error("4. Go to 'OAuth consent screen' → configure as External, add test user");
    console.error("5. Go to 'Credentials' → Create OAuth 2.0 Client ID (Desktop app)");
    console.error("6. Download the JSON and save it as credentials.json in the config dir\n");
    console.error(`Config dir: ${configDir}`);
    process.exit(1);
  }

  console.log(`\nAuthorizing account: ${accountName}\n`);

  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf-8"));
  const { client_id, client_secret } = credentials.installed || credentials.web;
  const redirectUri = "http://localhost:3000/oauth/callback";

  const oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirectUri);
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });

  console.log(`Open this URL in your browser:\n\n${authUrl}\n`);
  console.log("Waiting for OAuth callback on http://localhost:3000...\n");

  return new Promise<void>((resolve) => {
    const server = http.createServer(async (req, res) => {
      const parsed = url.parse(req.url || "", true);
      if (parsed.pathname === "/oauth/callback" && parsed.query.code) {
        const code = parsed.query.code as string;
        try {
          const { tokens } = await oauth2Client.getToken(code);
          saveTokensForAccount(accountName, tokens);
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(`<h1>Account '${accountName}' authorized! You can close this tab.</h1>`);
          console.log(`\nTokens saved for account '${accountName}'`);
          console.log("Scopes authorized: Gmail, Calendar, Drive");
        } catch (err) {
          res.writeHead(500, { "Content-Type": "text/html" });
          res.end(`<h1>Error: ${err}</h1>`);
          console.error("Failed to exchange code:", err);
        }
        server.close();
        resolve();
      }
    });
    server.listen(3000);
  });
}

setup();
