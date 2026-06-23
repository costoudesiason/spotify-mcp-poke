# spotify-mcp-poke

  A [Model Context Protocol](https://modelcontextprotocol.io) server that exposes the
  [Spotify Web API](https://developer.spotify.com/documentation/web-api) as tools an LLM can call —
  playback control, catalog search, full playlist access **and editing**, and track recommendations.

  Built with **Node.js + TypeScript** and the official `@modelcontextprotocol/sdk`. Runs locally over
  **stdio** (for clients like Claude Desktop) or over **Streamable HTTP** for hosted deployments
  (e.g. Railway, where it exposes `POST /mcp` and a `GET /health` check).

  ## Tools (13)

  | Tool | Description |
  | --- | --- |
  | `get_playback_state` | Check what is currently playing (track, artist, device, progress). |
  | `play_track` | Start playback of a track by its Spotify URI (`spotify:track:...`). |
  | `pause_playback` | Pause playback on the active device. |
  | `skip_next` | Skip to the next track in the queue. |
  | `search_tracks` | Search the catalog for tracks, artists, albums, or playlists. |
  | `get_user_playlists` | List the current user's playlists (paginated). |
  | `get_playlist_tracks` | Retrieve the tracks inside a playlist by ID (paginated). |
  | `get_recommendations` | Suggest songs from seed tracks, artists, and/or genres. |
  | `create_playlist` | Create a new playlist for the current user. |
  | `add_tracks_to_playlist` | Add tracks (by URI) to a playlist. |
  | `remove_tracks_from_playlist` | Remove tracks (by URI) from a playlist. |
  | `reorder_or_replace_playlist_tracks` | Reorder a range of tracks, or replace the whole track list. |
  | `update_playlist_details` | Rename a playlist or change its description / public flag. |

  > **Playback tools** (`play_track`, `pause_playback`, `skip_next`) require **Spotify Premium** and an
  > **active device** (have the Spotify app open somewhere). Without an active device the API returns
  > `404 No active device`.

  > **`get_recommendations`** uses an endpoint Spotify
  > [deprecated on 2024-11-27](https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api)
  > for apps created after that date — newer apps receive a `404`. The tool is implemented to spec and
  > returns a clear explanation when unavailable. Everything else is unaffected.

  > **Playlist editing** needs the `playlist-modify-public` and `playlist-modify-private` scopes (requested
  > by `npm run auth`). The tools transparently handle **both** the classic (`/playlists/{id}/tracks`) and
  > newer (`/playlists/{id}/items`) Spotify playlist API shapes.

  ## Prerequisites

  - Node.js 20+
  - A Spotify account (Premium for playback control)
  - A Spotify app — create one at the [Developer Dashboard](https://developer.spotify.com/dashboard)

  ## 1. Create a Spotify app

  1. [Developer Dashboard](https://developer.spotify.com/dashboard) → **Create app**.
  2. Note the **Client ID** and **Client Secret**.
  3. Under **Redirect URIs**, add exactly: `http://127.0.0.1:8888/callback`
     (must match `SPOTIFY_REDIRECT_URI` below — Spotify requires a loopback IP, not `localhost`).

  ## 2. Install & configure

  ```bash
  npm install
  cp .env.example .env
  ```

  Fill in `.env`:

  ```env
  SPOTIFY_CLIENT_ID=...
  SPOTIFY_CLIENT_SECRET=...
  SPOTIFY_REDIRECT_URI=http://127.0.0.1:8888/callback
  # SPOTIFY_REFRESH_TOKEN is filled in by the next step
  ```

  ## 3. Get a refresh token

  A small Express-based helper runs the OAuth flow locally and prints a refresh token:

  ```bash
  npm run auth
  ```

  1. It prints an authorization URL — open it in your browser.
  2. Approve the requested scopes.
  3. Spotify redirects back to the local helper, which exchanges the code and prints your **refresh token**.
  4. Paste it into `.env` as `SPOTIFY_REFRESH_TOKEN`.

  The refresh token is long-lived; the server uses it to mint short-lived access tokens automatically.
  The deployed server never runs the browser flow — it just refreshes silently with this token.

  ## 4. Run locally (stdio)

  ```bash
  npm run build
  npm start
  # or, without building:
  npm run dev
  ```

  ### Connect from Claude Desktop

  Add to your `claude_desktop_config.json`:

  ```json
  {
    "mcpServers": {
      "spotify": {
        "command": "node",
        "args": ["/absolute/path/to/spotify-mcp/dist/index.js"],
        "env": {
          "SPOTIFY_CLIENT_ID": "...",
          "SPOTIFY_CLIENT_SECRET": "...",
          "SPOTIFY_REFRESH_TOKEN": "...",
          "SPOTIFY_REDIRECT_URI": "http://127.0.0.1:8888/callback"
        }
      }
    }
  }
  ```

  ## 5. Run over HTTP

  Set `MCP_TRANSPORT=http` (or just provide `PORT`) and the server starts a Streamable HTTP endpoint at
  `POST /mcp`, with a health check at `GET /health`:

  ```bash

```bash
MCP_TRANSPORT=http PORT=8080 npm start
```

## Deploy to Railway

This repo includes a `Dockerfile` and `railway.json`.

1. Create a new Railway project from this repo (it auto-detects the Dockerfile).
2. Add the environment variables in the Railway dashboard:
   - `SPOTIFY_CLIENT_ID`
   - `SPOTIFY_CLIENT_SECRET`
   - `SPOTIFY_REFRESH_TOKEN`
   - `SPOTIFY_REDIRECT_URI`
   - `MCP_TRANSPORT=http` (the Dockerfile sets this by default)
3. Railway injects `PORT` automatically; the server binds to it.
4. Deploy. Your MCP endpoint will be `https://<your-app>.up.railway.app/mcp`.

> Generate the refresh token **locally** with `npm run auth` first, then paste it into Railway — the
> OAuth redirect flow only needs to run once, on your machine.

### Using it from an MCP client

Point your client (Claude Desktop, Poke, etc.) at the Streamable HTTP endpoint — **including the
`/mcp` path** — and leave any API-key field empty (auth is handled server-side via env vars):

```
https://<your-app>.up.railway.app/mcp
```

## Project structure

```
src/
  index.ts              # entry point: config → client → transport
  config.ts             # env validation (zod) + transport selection
  token-manager.ts      # refresh-token → access-token, cached & de-duped
  spotify-client.ts     # thin typed Spotify Web API wrapper
  server.ts             # builds the MCP server and registers tools
  transports/
    stdio.ts            # stdio transport (local clients)
    http.ts             # Streamable HTTP transport (hosted)
  tools/
    helpers.ts          # shared result/error formatting
    playback.ts         # get_playback_state, play_track, pause_playback, skip_next
    search.ts           # search_tracks
    playlists.ts        # get_user_playlists, get_playlist_tracks
    playlist-edit.ts    # create_playlist, add/remove/reorder/replace, update_playlist_details
    recommendations.ts  # get_recommendations
scripts/
  get-refresh-token.ts  # local OAuth helper (Express)
```

## Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `SPOTIFY_CLIENT_ID` | yes | Spotify app client ID. |
| `SPOTIFY_CLIENT_SECRET` | yes | Spotify app client secret. |
| `SPOTIFY_REDIRECT_URI` | yes (auth helper) | Must match the dashboard redirect URI. |
| `SPOTIFY_REFRESH_TOKEN` | yes (server) | Long-lived token from `npm run auth`. |
| `MCP_TRANSPORT` | no | `stdio` (default) or `http`. |
| `PORT` | no | HTTP port (Railway sets this automatically). |

## License

MIT

A couple of notes:
- It's secret-free — safe for a public repo. No client ID/secret/token anywhere.
- I kept the deploy URL generic (https://<your-app>.up.railway.app/mcp) rather than hardcoding your live instance, which is the right call for a public README.
- It's already written to README.md in the project too, so it'll match whenever you push the code.
