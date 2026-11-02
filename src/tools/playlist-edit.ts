import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SpotifyClient } from "../spotify-client.js";
import { extractId, fail, ok, safe, TRACK_URI } from "./helpers.js";

const playlistId = z.string().min(1).describe("The Spotify playlist ID (URIs and URLs are accepted too).");
const trackUris = z.array(z.string().regex(TRACK_URI)).min(1).max(100);

interface SnapshotResponse {
  snapshot_id: string;
}

export function registerPlaylistEditTools(server: McpServer, spotify: SpotifyClient) {
  server.registerTool(
    "create_playlist",
    {
      description: "Create a new playlist owned by the current user. Returns the new playlist's id and URI.",
      inputSchema: {
        name: z.string().min(1),
        description: z.string().optional().describe("Optional playlist description."),
        public: z.boolean().optional().describe("Whether the playlist is public. Defaults to false (private)."),
      },
    },
    safe(async ({ name, description, public: isPublic }) => {
      // Feb 2026: POST /users/{id}/playlists was removed in favour of POST /me/playlists.
      const p = await spotify.post<{ id: string; uri: string; name: string; external_urls?: { spotify?: string } }>(
        "/me/playlists",
        { name, description: description ?? "", public: isPublic ?? false },
      );
      return ok({ id: p.id, uri: p.uri, name: p.name, url: p.external_urls?.spotify });
    }),
  );

  server.registerTool(
    "add_tracks_to_playlist",
    {
      description: "Add one or more tracks (by Spotify track URI) to a playlist the user owns or collaborates on.",
      inputSchema: {
        playlistId,
        uris: trackUris,
        position: z.number().int().min(0).optional().describe("Zero-based index to insert at. Omit to append to the end."),
      },
    },
    safe(async ({ playlistId, uris, position }) => {
      const id = extractId(playlistId, "playlist");
      const res = await spotify.post<SnapshotResponse>(`/playlists/${id}/items`, { uris, position });
      return ok({ added: uris.length, position: position ?? "end", snapshotId: res.snapshot_id });
    }),
  );

  server.registerTool(
    "remove_tracks_from_playlist",
    {
      description: "Remove one or more tracks (by Spotify track URI) from a playlist. Removes every occurrence of each URI.",
      inputSchema: {
        playlistId,
        uris: trackUris,
        snapshotId: z.string().optional().describe("Optional playlist snapshot ID to remove against a specific version."),
      },
      annotations: { destructiveHint: true },
    },
    safe(async ({ playlistId, uris, snapshotId }) => {
      const id = extractId(playlistId, "playlist");
      // Feb 2026: the body field was renamed from `tracks` to `items`.
      const res = await spotify.delete<SnapshotResponse>(`/playlists/${id}/items`, {
        items: uris.map((uri) => ({ uri })),
        snapshot_id: snapshotId,
      });
      return ok({ removed: uris.length, snapshotId: res.snapshot_id });
    }),
  );

  server.registerTool(
    "reorder_or_replace_playlist_tracks",
    {
      description:
        "Reorder a range of tracks within a playlist, OR replace the playlist's entire track list. Provide `replaceUris` to replace, or `rangeStart` + `insertBefore` to reorder, not both.",
      inputSchema: {
        playlistId,
        replaceUris: z
          .array(z.string().regex(TRACK_URI))
          .max(100)
          .optional()
          .describe("REPLACE mode: the new, complete ordered list of track URIs (max 100). An empty list clears the playlist."),
        rangeStart: z.number().int().min(0).optional().describe("REORDER mode: zero-based index of the first track to move."),
        insertBefore: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("REORDER mode: zero-based index to insert the moved tracks before."),
        rangeLength: z.number().int().min(1).optional().describe("REORDER mode: how many tracks to move (default 1)."),
        snapshotId: z.string().optional().describe("REORDER mode: optional playlist snapshot ID."),
      },
      annotations: { destructiveHint: true },
    },
    safe(async ({ playlistId, replaceUris, rangeStart, insertBefore, rangeLength, snapshotId }) => {
      const id = extractId(playlistId, "playlist");
      const replacing = replaceUris !== undefined;
      const reordering = rangeStart !== undefined || insertBefore !== undefined;

      if (replacing && reordering) return fail("Provide either `replaceUris` or `rangeStart` + `insertBefore`, not both.");
      if (replacing) {
        const res = await spotify.put<SnapshotResponse>(`/playlists/${id}/items`, { uris: replaceUris });
        return ok({ mode: "replace", trackCount: replaceUris!.length, snapshotId: res.snapshot_id });
      }
      if (rangeStart === undefined || insertBefore === undefined) {
        return fail("Reorder mode needs both `rangeStart` and `insertBefore`.");
      }
      const res = await spotify.put<SnapshotResponse>(`/playlists/${id}/items`, {
        range_start: rangeStart,
        insert_before: insertBefore,
        range_length: rangeLength ?? 1,
        snapshot_id: snapshotId,
      });
      return ok({ mode: "reorder", rangeStart, insertBefore, rangeLength: rangeLength ?? 1, snapshotId: res.snapshot_id });
    }),
  );

  server.registerTool(
    "update_playlist_details",
    {
      description: "Rename a playlist or change its description / public flag. Provide at least one field.",
      inputSchema: {
        playlistId,
        name: z.string().min(1).optional().describe("New playlist name."),
        description: z.string().optional().describe("New playlist description."),
        public: z.boolean().optional().describe("New public/private flag."),
      },
    },
    safe(async ({ playlistId, name, description, public: isPublic }) => {
      if (name === undefined && description === undefined && isPublic === undefined) {
        return fail("Provide at least one of `name`, `description`, or `public`.");
      }
      const id = extractId(playlistId, "playlist");
      await spotify.put(`/playlists/${id}`, { name, description, public: isPublic });
      return ok({ updated: id, name, description, public: isPublic });
    }),
  );

  server.registerTool(
    "delete_playlist",
    {
      description:
        "Delete a playlist the user owns (Spotify implements this as removing it from the user's library), or unfollow someone else's.",
      inputSchema: { playlistId },
      annotations: { destructiveHint: true },
    },
    safe(async ({ playlistId }) => {
      const id = extractId(playlistId, "playlist");
      // Feb 2026: DELETE /playlists/{id}/followers was replaced by DELETE /me/library.
      await spotify.delete("/me/library", undefined, { uris: `spotify:playlist:${id}` });
      return ok({ deleted: id });
    }),
  );
}
