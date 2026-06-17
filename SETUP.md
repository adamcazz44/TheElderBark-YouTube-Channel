# Setup — YouTube upload (one-time)

The pipeline uploads to **The Elder Bark** YouTube channel. Uploading to a channel requires
**OAuth 2.0** — a service account will not work. You complete this once; the durable refresh
token is stored in `.env`.

> Before starting: create the **The Elder Bark** YouTube channel (and **phone-verify** it at
> <https://www.youtube.com/verify> so custom thumbnails are allowed), signed in as the Google
> account that will own it. Use that same account everywhere below.

## 1. Create a Google Cloud project
1. Go to <https://console.cloud.google.com/> and sign in as the channel's Google account.
2. Top bar → project dropdown → **New Project** (name e.g. `the-elder-bark`) → **Create**, then select it.

## 2. Enable the YouTube Data API v3
1. **APIs & Services → Library**.
2. Search **"YouTube Data API v3"** → open it → **Enable**.

## 3. Configure the OAuth consent screen
1. **APIs & Services → OAuth consent screen**.
2. User type **External** → **Create**.
3. Fill app name (e.g. `The Elder Bark Uploader`), user support email, and developer email → **Save and Continue**.
4. **Scopes** — you can skip adding scopes here (the script requests them at runtime) → **Save and Continue**.
5. **Test users → + Add Users** → add the channel's Google account → **Save and Continue**.
   (While the app is in "Testing", only listed test users can authorize it — this is fine.)

## 4. Create OAuth 2.0 credentials (Desktop app)
1. **APIs & Services → Credentials → + Create Credentials → OAuth client ID**.
2. Application type: **Desktop app** (this auto-allows the loopback redirect the script uses,
   `http://localhost:8085/oauth2callback`).
3. **Create** → copy the **Client ID** and **Client secret**.

## 5. Put the credentials in `.env`
In `E:\TheElderBark\.env` (gitignored), add:
```
YOUTUBE_CLIENT_ID=<your client id>
YOUTUBE_CLIENT_SECRET=<your client secret>
```
(`YOUTUBE_REFRESH_TOKEN` is filled in automatically by the next step.)

## 6. Authorize (get the refresh token)
```sh
cd E:\TheElderBark
npm run auth:youtube
```
- A browser opens to Google's consent screen (if not, paste the URL the script prints).
- Sign in as the channel's account, click through the "unverified app" warning
  (**Advanced → Go to … (unsafe)** — expected while in Testing), and **Allow** both YouTube permissions.
- The script captures the callback on port 8085, writes `YOUTUBE_REFRESH_TOKEN` to `.env`, and prints
  `✅ YouTube OAuth complete. Refresh token saved to .env.`

> If you ever see "No refresh token returned", remove the app at
> <https://myaccount.google.com/permissions> and re-run — `prompt=consent` forces a fresh token.

## 7. Verify end-to-end
```sh
npm run pipeline -- "selective hearing in old age"
```
This generates captions (if needed), fetches footage (if needed), renders the video + thumbnail,
and uploads it **Private**. Confirm it appears in YouTube Studio, then QC and either publish or delete:
```sh
npm run publish -- <youtube_id>   # make Public
npm run reject  -- <youtube_id>   # delete from YouTube
```

## Daily automation
`npm run cron:daily` runs the pipeline for the next unused theme in `scripts/themes.js`
and tracks progress in `scripts/cron-state.json` (machine-local, gitignored): 1 video/day for the
30-theme launch month, then `phase` flips to `sustained`. Wire it as a live `hermes cron` job once
the channel is verified end-to-end. **Uploads stay Private — never auto-publish.**
