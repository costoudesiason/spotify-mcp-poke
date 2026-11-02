import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { SpotifyApiError } from "../spotify-client.js";

export const TRACK_URI = /^spotify:track:[A-Za-z0-9]+$/;

export function ok(data: unknown): CallToolResult {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: "text", text }] };
}

export function fail(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Turn any thrown error into a tool error with a hint the model can act on. */
export function toToolError(err: unknown): CallToolResult {
  if (err instanceof SpotifyApiError) {
    const hint = hintFor(err);
    return fail(`Spotify API error ${err.status}: ${err.message}${hint ? `\nHint: ${hint}` : ""}`);
  }
  const message = err instanceof Error ? err.message : String(err);
  return fail(`Error: ${message}`);
}

function hintFor(err: SpotifyApiError): string | undefined {
  if (err.reason === "NO_ACTIVE_DEVICE" || (err.status === 404 && /device/i.test(err.message))) {
    return "No active Spotify device. Open Spotify on a phone or computer and start anything, then retry.";
  }
  if (err.reason === "PREMIUM_REQUIRED") return "Playback control needs Spotify Premium.";
  if (err.status === 401) return "The refresh token may be revoked. Re-run `npm run auth` and update SPOTIFY_REFRESH_TOKEN.";
  if (err.status === 403) {
    return "Forbidden. Usually a missing OAuth scope (re-run `npm run auth`) or a playlist you neither own nor collaborate on.";
  }
  return undefined;
}

/** Wrap a handler so errors become tool errors instead of protocol errors. */
export function safe<A>(fn: (args: A) => Promise<CallToolResult>) {
  return async (args: A): Promise<CallToolResult> => {
    try {
      return await fn(args);
    } catch (err) {
      return toToolError(err);
    }
  };
}

/** Accept a raw ID, a spotify:<type>:ID URI, or an open.spotify.com URL. */
export function extractId(input: string, type: string): string {
  const s = input.trim();
  const uri = s.match(new RegExp(`^spotify:${type}:([A-Za-z0-9]+)$`));
  if (uri) return uri[1];
  const url = s.match(new RegExp(`open\\.spotify\\.com/(?:[a-z-]+/)?${type}/([A-Za-z0-9]+)`));
  if (url) return url[1];
  return s;
}

export function pageInfo(offset: number, returned: number, total: number | null | undefined) {
  const t = typeof total === "number" ? total : null;
  return { total: t, offset, returned, hasMore: t === null ? false : offset + returned < t };
}
