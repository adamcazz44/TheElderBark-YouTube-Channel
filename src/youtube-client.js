"use strict";
/**
 * youtube-client.js — shared YouTube OAuth2 helper.
 * Credentials come from .env only; the durable refresh token mints fresh access tokens
 * on demand (access tokens are never stored).
 */
const path = require("path");
const {google} = require("googleapis");

const ROOT = path.join(__dirname, "..");
require("dotenv").config({path: path.join(ROOT, ".env")});

const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube",
];

function getCreds() {
  return {
    clientId: process.env.YOUTUBE_CLIENT_ID,
    clientSecret: process.env.YOUTUBE_CLIENT_SECRET,
    refreshToken: process.env.YOUTUBE_REFRESH_TOKEN,
  };
}

/** OAuth2 client for the interactive consent flow (auth-youtube.js). */
function oauthClient(redirectUri) {
  const {clientId, clientSecret} = getCreds();
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/** Authed OAuth2 client (refresh-token grant). Throws if any credential is missing. */
function authedOAuth2() {
  const {clientId, clientSecret, refreshToken} = getCreds();
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Missing YouTube OAuth credentials — run: npm run auth:youtube");
  }
  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({refresh_token: refreshToken});
  return oauth2;
}

/** Authenticated YouTube Data API v3 client. */
function authedYouTube() {
  return google.youtube({version: "v3", auth: authedOAuth2()});
}

/** Authenticated YouTube Analytics API v2 client (same OAuth credentials). */
function authedAnalytics() {
  return google.youtubeAnalytics({version: "v2", auth: authedOAuth2()});
}

module.exports = {ROOT, SCOPES, getCreds, oauthClient, authedOAuth2, authedYouTube, authedAnalytics};
