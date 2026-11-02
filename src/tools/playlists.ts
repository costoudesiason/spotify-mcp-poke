import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SpotifyApiError, type SpotifyClient } from "../spotify-client.js";
import { extractId, fail, ok, pageInfo, safe } from "./helpers.js";

interface Paging<T> {
  items: T[];
  total: number;
  next: string | null;
}

interface SimplePlaylist {
  id: string;
  name: string;
  uri: string;
  description: string | null;
  public: boolean | null;
  collaborative: boolean;
  owner: { id: string; display_name?: string | null };
  // Feb 2026 renamed `tracks` -> `items`; non-owned playlists may have neither.
  items?: { total: number } | null;
  tracks?: { total: number } | null;
}

interface PlayableItem {
  type?: string;
  name: string;
  uri: string;
  duration_ms: number;
  artists?: { name: string }[];
  album?: { name: string };
  show?: { name: string };
}

interface PlaylistEntry {
  added_at: string | null;
  is_local?: boolean;
  item?: PlayableItem | null;
  track?: PlayableItem | null;
}

export function trackCount(p: SimplePlaylist): number | null {
  return p.items?.total ?? p.tracks?.total ?? null;
}

let cachedUserId: string | null = null;
export async function currentUserId(spotify: SpotifyClient): Promise<string> {
  if (!cachedUserId) cachedUserId = (await spotify.get<{ id: string }>("/me")).id;
  return cachedUserId;
}

export function registerPlaylistTools(server: McpServer, spotify: SpotifyClient) {
  server.registerTool(
    "get_user_playlists",
    {
      description:
        "List the current user's playlists (owned and followed). `isOwner` marks playlists the user can edit; only those (and collaborative ones) can be modified.",
      inputSchema: {
        limit: z.number().int().min(1).max(50).optional().describe("Page size (1-50, default 20)."),
        offset: z.number().int().min(0).optional().describe("Index of the first playlist to return."),
      },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ limit, offset }) => {
      const off = offset ?? 0;
      const [page, me] = await Promise.all([
        spotify.get<Paging<SimplePlaylist | null>>("/me/playlists", { limit: limit ?? 20, offset: off }),
        currentUserId(spotify),
      ]);
      const playlists = page.items.filter((p): p is SimplePlaylist => p !== null);
      return ok({
        ...pageInfo(off, page.items.length, page.total),
        playlists: playlists.map((p) => ({
          id: p.id,
          name: p.name,
          uri: p.uri,
          description: p.description ?? "",
          owner: p.owner?.display_name ?? p.owner?.id,
          isOwner: p.owner?.id === me,
          collaborative: p.collaborative,
          public: p.public,
          totalTracks: trackCount(p),
        })),
      });
    }),
  );

  server.registerTool(
    "get_playlist_tracks",
    {
      description:
        "Retrieve the tracks inside a playlist by its ID. Works for playlists the user owns or collaborates on; Spotify blocks reading other people's playlists for dev-mode apps. Page with `offset` while `hasMore` is true.",
      inputSchema: {
        playlistId: z
          .string()
          .min(1)
          .describe("The Spotify playlist ID (the part after spotify:playlist: or in the playlist URL). URIs and URLs are accepted too."),
        limit: z.number().int().min(1).max(100).optional().describe("Page size (1-100, default 50)."),
        offset: z.number().int().min(0).optional().describe("Index of the first track to return."),
      },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ playlistId, limit, offset }) => {
      const id = extractId(playlistId, "playlist");
      const off = offset ?? 0;
      const query = { limit: limit ?? 50, offset: off, additional_types: "track,episode" };

      let page: Paging<PlaylistEntry>;
      try {
        page = await spotify.get<Paging<PlaylistEntry>>(`/playlists/${id}/items`, query);
      } catch (err) {
        if (!(err instanceof SpotifyApiError) || ![403, 404].includes(err.status)) throw err;
        // Some non-owned playlists still answer on the legacy path; try it before giving up.
        try {
          page = await spotify.get<Paging<PlaylistEntry>>(`/playlists/${id}/tracks`, query);
        } catch {
          return fail(
            `Can't read playlist ${id} (Spotify ${err.status}: ${err.message}). Spotify only lets dev-mode apps read playlists the user owns or collaborates on.`,
          );
        }
      }

      const tracks = page.items.map((entry, i) => {
        const it = entry.item ?? entry.track;
        return {
          position: off + i,
          name: it?.name ?? null,
          uri: it?.uri ?? null,
          type: it?.type ?? "track",
          artists: it?.artists?.map((a) => a.name) ?? (it?.show ? [it.show.name] : []),
          album: it?.album?.name,
          durationMs: it?.duration_ms,
          addedAt: entry.added_at,
          isLocal: entry.is_local ?? false,
        };
      });
      return ok({ playlistId: id, ...pageInfo(off, page.items.length, page.total), tracks });
    }),
  );
}
