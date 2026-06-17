"use strict";
/**
 * auth-youtube.js — one-time YouTube OAuth 2.0 setup.
 * Reads YOUTUBE_CLIENT_ID/SECRET from .env, opens the consent screen, captures the callback
 * on http://localhost:3000/callback, exchanges the code for a refresh token, and writes
 * YOUTUBE_REFRESH_TOKEN back to .env.
 *
 * Usage: npm run auth:youtube
 */
const path = require("path");
const fs = require("fs");
const http = require("http");
const {exec} = require("child_process");
const {ROOT, SCOPES, getCreds, oauthClient} = require("./youtube-client");

const ENV_PATH = path.join(ROOT, ".env");
const PORT = 3000;
const REDIRECT = `http://localhost:${PORT}/callback`;

function upsertEnv(key, value) {
  let txt = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(txt)) txt = txt.replace(re, line);
  else {
    if (txt && !txt.endsWith("\n")) txt += "\n";
    txt += line + "\n";
  }
  fs.writeFileSync(ENV_PATH, txt);
}

function openBrowser(url) {
  const cmd =
    process.platform === "win32"
      ? `start "" "${url}"`
      : process.platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

function main() {
  const {clientId, clientSecret} = getCreds();
  if (!clientId || !clientSecret) {
    console.error("❌ Missing YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET in .env.");
    process.exit(1);
  }

  const oauth2 = oauthClient(REDIRECT);
  const authUrl = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // force a refresh_token even on re-auth
    scope: SCOPES,
  });

  const server = http.createServer(async (req, res) => {
    if (!req.url.startsWith("/callback")) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }
    const u = new URL(req.url, `http://localhost:${PORT}`);
    const err = u.searchParams.get("error");
    const code = u.searchParams.get("code");
    if (err) {
      res.end(`Auth error: ${err}`);
      console.error(`❌ OAuth error: ${err}`);
      server.close(() => process.exit(1));
      return;
    }
    if (!code) {
      res.end("Waiting for authorization code...");
      return;
    }
    try {
      const {tokens} = await oauth2.getToken(code);
      if (!tokens.refresh_token) {
        res.end("No refresh token returned. Revoke app access and retry.");
        console.error(
          "❌ No refresh token returned. Remove the app at https://myaccount.google.com/permissions, then re-run."
        );
        server.close(() => process.exit(1));
        return;
      }
      upsertEnv("YOUTUBE_REFRESH_TOKEN", tokens.refresh_token);
      res.end("✅ YouTube OAuth complete. You can close this tab and return to the terminal.");
      console.log("✅ YouTube OAuth complete. Refresh token saved to .env.");
      server.close(() => process.exit(0));
    } catch (e) {
      res.end(`Token exchange failed: ${e.message}`);
      console.error(`❌ Token exchange failed: ${e.message}`);
      server.close(() => process.exit(1));
    }
  });

  server.listen(PORT, () => {
    console.log(`🔐 Opening Google consent screen. If it doesn't open, paste this URL:\n${authUrl}\n`);
    openBrowser(authUrl);
  });
}

main();
