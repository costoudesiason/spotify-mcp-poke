import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SpotifyClient } from "./spotify-client.js";
import { registerPlaybackTools } from "./tools/playback.js";
import { registerSearchTools } from "./tools/search.js";
import { registerPlaylistTools } from "./tools/playlists.js";
import { registerPlaylistEditTools } from "./tools/playlist-edit.js";

export const SERVER_VERSION = "2.0.1";

export function buildServer(spotify: SpotifyClient): McpServer {
  const server = new McpServer(
    { name: "spotify-mcp", version: SERVER_VERSION },
    {
      instructions:
        "Tools for controlling Spotify playback, searching the catalog, and reading and editing the user's own playlists. " +
        "Playback control needs an active device and Spotify Premium. Spotify only allows reading or editing playlists the user owns " +
        "or collaborates on. Search returns at most 50 results per type; page with offset.",
    },
  );
  registerPlaybackTools(server, spotify);
  registerSearchTools(server, spotify);
  registerPlaylistTools(server, spotify);
  registerPlaylistEditTools(server, spotify);
  return server;
}
