/**
 * One-time local OAuth helper. Prints a Spotify refresh token for SPOTIFY_REFRESH_TOKEN.
 * Usage: fill SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET / SPOTIFY_REDIRECT_URI in .env, then `npm run auth`.
 */
import { randomBytes } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import express from "express";
import { SCOPES } from "../src/scopes.js";

if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const clientId = process.env.SPOTIFY_CLIENT_ID;
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
const redirectUri = process.env.SPOTIFY_REDIRECT_URI ?? "http://127.0.0.1:8888/callback";
if (!clientId || !clientSecret) {
  console.error("Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env first.");
  process.exit(1);
}


const state = randomBytes(16).toString("hex");
const redirect = new URL(redirectUri);
const app = express();

app.get(redirect.pathname, async (req, res) => {
  if (req.query.state !== state) {
    res.status(400).send("State mismatch.");
    return;
  }
  const code = typeof req.query.code === "string" ? req.query.code : undefined;
  if (!code) {
    res.status(400).send(`Authorization failed: ${req.query.error ?? "no code"}`);
    return;
  }
  const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
  });
  const data = (await tokenRes.json()) as { refresh_token?: string; error?: string };
  if (!tokenRes.ok || !data.refresh_token) {
    res.status(500).send(`Token exchange failed: ${JSON.stringify(data)}`);
    return;
  }
  res.send("Done. Copy the refresh token from your terminal.");
  console.log(`\nSPOTIFY_REFRESH_TOKEN=${data.refresh_token}\n`);
  setTimeout(() => process.exit(0), 200);
});

app.listen(Number(redirect.port || 8888), redirect.hostname, () => {
  const url = new URL("https://accounts.spotify.com/authorize");
  url.search = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: SCOPES,
    state,
  }).toString();
  console.log(`Open this URL in your browser:\n\n${url}\n`);
});
