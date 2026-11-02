const TOKEN_URL = "https://accounts.spotify.com/api/token";
// Refresh a minute early so a token never expires mid-request.
const EXPIRY_SKEW_MS = 60_000;

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}

/** Turns a long-lived refresh token into cached, de-duplicated short-lived access tokens. */
export class TokenManager {
  private accessToken: string | null = null;
  private expiresAt = 0;
  private inFlight: Promise<string> | null = null;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private refreshToken: string,
  ) {}

  async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.expiresAt - EXPIRY_SKEW_MS) return this.accessToken;
    if (!this.inFlight) {
      this.inFlight = this.refresh().finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  /** Drop the cached token so the next call refreshes (used after a 401). */
  invalidate(): void {
    this.accessToken = null;
    this.expiresAt = 0;
  }

  private async refresh(): Promise<string> {
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: this.refreshToken }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Spotify token refresh failed (${res.status}): ${text}`);
    }
    const data = (await res.json()) as TokenResponse;
    this.accessToken = data.access_token;
    this.expiresAt = Date.now() + data.expires_in * 1000;
    // Spotify may rotate the refresh token; keep the newest one for the life of the process.
    if (data.refresh_token) this.refreshToken = data.refresh_token;
    return data.access_token;
  }
}
