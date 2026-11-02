# spotify-mcp-poke

A [Model Context Protocol](https://modelcontextprotocol.io) server that exposes the
[Spotify Web API](https://developer.spotify.com/documentation/web-api) as tools an LLM can call:
playback control, catalog search, and full playlist reading **and editing**.

Built with **Node.js + TypeScript** and the official `@modelcontextprotocol/sdk`. Runs locally over
**stdio** (Claude Desktop, etc.) or over **Streamable HTTP** for hosted deployments (Railway), where it
exposes an authenticated `POST /mcp` and an open `GET /health`.

Targets the Spotify API as it stands after the
[February 2026 dev-mode changes](https://developer.spotify.com/documentation/web-api/references/changes/february-2026)
(`/playlists/{id}/items`, `POST /me/playlists`, `DELETE /me/library`, search capped at 10 per request).

## Tools (16)

| Tool | Description |
| --- | --- |
| `get_playback_state` | What's playing: track, artists, device, progress, shuffle/repeat. |
| `play_track` | Play a track by URI (`spotify:track:...`). |
| `resume_playback` | Resume where playback was paused. |
| `pause_playback` | Pause the active device. |
| `skip_next` / `skip_previous` | Next or previous track. |
| `add_to_queue` | Queue a track. |
| `search_tracks` | Search tracks, artists, albums, playlists. Up to 50 per type (paged internally 10 at a time). |
| `get_user_playlists` | List the user's playlists with `isOwner` and track counts. Paginated. |
| `get_playlist_tracks` | Tracks in a playlist the user owns or collaborates on. Paginated. |
| `create_playlist` | Create a playlist (private by default). |
| `add_tracks_to_playlist` | Add tracks by URI, optionally at a position. |
| `remove_tracks_from_playlist` | Remove tracks by URI. |
| `reorder_or_replace_playlist_tracks` | Move a range of tracks, or replace the whole list. |
| `update_playlist_details` | Rename, change description, or toggle public. |
| `delete_playlist` | Delete an owned playlist (or unfollow someone else's). |

Notes:

- **Playback tools** need **Spotify Premium** and an **active device** (Spotify open somewhere).
- Spotify dev-mode apps can only read or edit playlists the user **owns or collaborates on**. Other
  playlists still list with metadata and track counts, but their contents may be unreadable.
- `get_recommendations` was removed: Spotify killed `/v1/recommendations` for apps created after
  2024-11-27, so it could only ever fail.

## Prerequisites

- Node.js 20+
- A Spotify account. The app owner needs **Premium** for dev-mode apps to work at all.
- A Spotify app from the [Developer Dashboard](https://developer.spotify.com/dashboard)

## 1. Create a Spotify app

1. Developer Dashboard → **Create app**. Note the **Client ID** and **Client Secret**.
2. Under **Redirect URIs**, add exactly `http://127.0.0.1:8888/callback` (Spotify requires a loopback IP, not `localhost`).

## 2. Install, configure, get a refresh token

```bash
npm install
cp .env.example .env      # fill SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET
npm run auth              # open the printed URL, approve, copy SPOTIFY_REFRESH_TOKEN into .env
```

The refresh token is long-lived; the server mints short-lived access tokens from it automatically.

## 3. Run

```bash
npm run build && npm start               # stdio
MCP_TRANSPORT=http PORT=8080 MCP_AUTH_TOKEN=$(openssl rand -hex 32) npm start   # HTTP
```

## Authentication (HTTP mode)

The server acts as **your** Spotify account, so HTTP mode refuses to start without `MCP_AUTH_TOKEN`
(24+ characters). Every `/mcp` request must present it in one of three ways:

| Method | Use it for |
| --- | --- |
| `Authorization: Bearer <token>` | Clients with an API key / header field (Poke) |
| `https://<host>/mcp/<token>` | Clients that only take a URL (claude.ai custom connectors) |
| `https://<host>/mcp?key=<token>` | Fallback |

Treat the `/mcp/<token>` URL like a password. Rotate by changing `MCP_AUTH_TOKEN` on Railway.

## Deploy to Railway

`railway.json` configures Railpack, `npm run build`, `npm start`, and a `/health` healthcheck.

Variables: `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REFRESH_TOKEN`, `MCP_TRANSPORT=http`,
`MCP_AUTH_TOKEN`. Railway injects `PORT`.

## Connect a client

- **claude.ai**: Settings → Connectors → Add custom connector → URL `https://<host>/mcp/<token>`.
- **Poke / header-capable clients**: URL `https://<host>/mcp`, API key `<token>`.
- **Claude Desktop (local)**:

```json
{
  "mcpServers": {
    "spotify": {
      "command": "node",
      "args": ["/absolute/path/to/spotify-mcp-poke/dist/index.js"],
      "env": {
        "SPOTIFY_CLIENT_ID": "...",
        "SPOTIFY_CLIENT_SECRET": "...",
        "SPOTIFY_REFRESH_TOKEN": "..."
      }
    }
  }
}
```

## Project structure

```
src/
  index.ts              # entry: config → client → transport
  config.ts             # env validation (zod); HTTP fails closed without MCP_AUTH_TOKEN
  token-manager.ts      # refresh token → cached, de-duped access tokens
  spotify-client.ts     # typed fetch wrapper; retries once on 401 and 429
  server.ts             # builds the McpServer and registers tools
  transports/
    stdio.ts
    http.ts             # stateless Streamable HTTP + auth
  tools/
    helpers.ts          # results, errors with actionable hints, ID parsing, paging
    playback.ts
    search.ts
    playlists.ts        # read
    playlist-edit.ts    # write
scripts/
  get-refresh-token.ts  # local OAuth helper
```

## License

MIT
