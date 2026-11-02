import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SpotifyClient } from "../spotify-client.js";
import { ok, safe } from "./helpers.js";

// Spotify's Feb 2026 dev-mode change capped /search at 10 results per request.
const SPOTIFY_PAGE = 10;
const MAX_REQUESTS = 24;

type SearchType = "track" | "artist" | "album" | "playlist";

interface Paging<T> {
  items: (T | null)[];
  total: number;
  next: string | null;
}

interface SearchResponse {
  tracks?: Paging<{ name: string; uri: string; duration_ms: number; artists: { name: string }[]; album: { name: string } }>;
  artists?: Paging<{ name: string; uri: string; genres?: string[] }>;
  albums?: Paging<{ name: string; uri: string; release_date?: string; total_tracks?: number; artists: { name: string }[] }>;
  playlists?: Paging<{ name: string; uri: string; id: string; owner?: { display_name?: string }; description?: string }>;
}

const KEY: Record<SearchType, keyof SearchResponse> = {
  track: "tracks",
  artist: "artists",
  album: "albums",
  playlist: "playlists",
};

export function registerSearchTools(server: McpServer, spotify: SpotifyClient) {
  server.registerTool(
    "search_tracks",
    {
      description:
        "Search the Spotify catalog for tracks, artists, albums, or playlists. Use the `types` argument to control what is returned (defaults to tracks). Supports Spotify field filters in the query, e.g. 'artist:Fred again.. year:2023'.",
      inputSchema: {
        query: z.string().min(1),
        types: z
          .array(z.enum(["track", "artist", "album", "playlist"]))
          .min(1)
          .optional()
          .describe('What to search for. Defaults to ["track"].'),
        limit: z.number().int().min(1).max(50).optional().describe("Maximum results per type (1-50, default 10)."),
        offset: z.number().int().min(0).max(950).optional().describe("Index of the first result (for paging)."),
      },
      annotations: { readOnlyHint: true },
    },
    safe(async ({ query, types, limit, offset }) => {
      const wanted: SearchType[] = types ?? ["track"];
      const target = limit ?? 10;
      const start = offset ?? 0;

      const collected: Partial<Record<keyof SearchResponse, unknown[]>> = {};
      const seen: Partial<Record<keyof SearchResponse, Set<string>>> = {};
      const totals: Partial<Record<keyof SearchResponse, number>> = {};
      // Each type pages independently. Dev-mode Spotify can return fewer items than `limit` and its
      // `total`/`next` are unreliable, so advance by what actually came back and stop on an empty page.
      const cursor = new Map<SearchType, number>(wanted.map((t) => [t, start]));

      for (let request = 0; cursor.size > 0 && request < MAX_REQUESTS; request++) {
        // Types that share an offset can share a request.
        const byOffset = new Map<number, SearchType[]>();
        for (const [t, off] of cursor) byOffset.set(off, [...(byOffset.get(off) ?? []), t]);
        const [off, types] = [...byOffset.entries()][0];

        const res = await spotify.get<SearchResponse>("/search", {
          q: query,
          type: types.join(","),
          limit: SPOTIFY_PAGE,
          offset: off,
        });
        for (const t of types) {
          const key = KEY[t];
          const paging = res[key];
          const raw = paging?.items ?? [];
          if (paging) totals[key] = paging.total;
          const bucket = (collected[key] ??= []);
          const ids = (seen[key] ??= new Set());
          for (const item of raw) {
            if (!item || ids.has(item.uri) || bucket.length >= target) continue;
            ids.add(item.uri);
            bucket.push(item);
          }
          if (raw.length === 0 || bucket.length >= target) cursor.delete(t);
          else cursor.set(t, off + raw.length);
        }
      }

      const out: Record<string, unknown> = { query, offset: start };
      if (collected.tracks) {
        out.tracks = (collected.tracks as NonNullable<SearchResponse["tracks"]>["items"]).map((t) => ({
          name: t!.name,
          uri: t!.uri,
          artists: t!.artists.map((a) => a.name),
          album: t!.album?.name,
          durationMs: t!.duration_ms,
        }));
      }
      if (collected.artists) {
        out.artists = (collected.artists as NonNullable<SearchResponse["artists"]>["items"]).map((a) => ({
          name: a!.name,
          uri: a!.uri,
          genres: a!.genres ?? [],
        }));
      }
      if (collected.albums) {
        out.albums = (collected.albums as NonNullable<SearchResponse["albums"]>["items"]).map((a) => ({
          name: a!.name,
          uri: a!.uri,
          artists: a!.artists.map((x) => x.name),
          releaseDate: a!.release_date,
          totalTracks: a!.total_tracks,
        }));
      }
      if (collected.playlists) {
        out.playlists = (collected.playlists as NonNullable<SearchResponse["playlists"]>["items"]).map((p) => ({
          name: p!.name,
          id: p!.id,
          uri: p!.uri,
          owner: p!.owner?.display_name,
          description: p!.description,
        }));
      }
      out.totals = totals;
      return ok(out);
    }),
  );
}
