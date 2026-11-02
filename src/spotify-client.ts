import { TokenManager } from "./token-manager.js";

const API_BASE = "https://api.spotify.com/v1";

export class SpotifyApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly reason?: string,
  ) {
    super(message);
    this.name = "SpotifyApiError";
  }
}

type Query = Record<string, string | number | boolean | undefined>;

interface RequestOptions {
  query?: Query;
  body?: unknown;
}

/** Thin Spotify Web API wrapper: auth, one 401 retry, one 429 retry, JSON in/out. */
export class SpotifyClient {
  constructor(private readonly tokens: TokenManager) {}

  get<T>(path: string, query?: Query) {
    return this.request<T>("GET", path, { query });
  }
  post<T>(path: string, body?: unknown, query?: Query) {
    return this.request<T>("POST", path, { body, query });
  }
  put<T>(path: string, body?: unknown, query?: Query) {
    return this.request<T>("PUT", path, { body, query });
  }
  delete<T>(path: string, body?: unknown, query?: Query) {
    return this.request<T>("DELETE", path, { body, query });
  }

  async request<T>(method: string, path: string, opts: RequestOptions = {}, attempt = 0): Promise<T> {
    const url = new URL(API_BASE + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }

    const token = await this.tokens.getAccessToken();
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.body);
    }

    const res = await fetch(url, { method, headers, body });

    if (res.status === 401 && attempt === 0) {
      this.tokens.invalidate();
      return this.request<T>(method, path, opts, attempt + 1);
    }
    if (res.status === 429 && attempt === 0) {
      const retryAfter = Math.min(Number(res.headers.get("retry-after") ?? "1"), 10);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      return this.request<T>(method, path, opts, attempt + 1);
    }

    const text = await res.text();
    if (!res.ok) {
      let message = text || res.statusText;
      let reason: string | undefined;
      try {
        const parsed = JSON.parse(text) as { error?: { message?: string; reason?: string } | string };
        if (typeof parsed.error === "object" && parsed.error) {
          message = parsed.error.message ?? message;
          reason = parsed.error.reason;
        } else if (typeof parsed.error === "string") {
          message = parsed.error;
        }
      } catch {
        // non-JSON body; keep raw text
      }
      throw new SpotifyApiError(res.status, message, reason);
    }

    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }
}
