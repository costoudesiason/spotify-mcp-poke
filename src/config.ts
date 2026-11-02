import { z } from "zod";

const EnvSchema = z.object({
  SPOTIFY_CLIENT_ID: z.string().min(1, "SPOTIFY_CLIENT_ID is required"),
  SPOTIFY_CLIENT_SECRET: z.string().min(1, "SPOTIFY_CLIENT_SECRET is required"),
  SPOTIFY_REFRESH_TOKEN: z.string().min(1, "SPOTIFY_REFRESH_TOKEN is required (run `npm run auth`)"),
  MCP_TRANSPORT: z.enum(["stdio", "http"]).optional(),
  MCP_AUTH_TOKEN: z.string().optional(),
  SPOTIFY_REDIRECT_URI: z.string().optional(),
  PORT: z.coerce.number().int().positive().optional(),
});

export interface Config {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  transport: "stdio" | "http";
  port: number;
  authToken?: string;
  redirectUri: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `- ${i.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${msg}`);
  }
  const e = parsed.data;
  // Providing PORT (as Railway does) implies HTTP unless stdio is explicitly requested.
  const transport = e.MCP_TRANSPORT ?? (e.PORT ? "http" : "stdio");

  const authToken = e.MCP_AUTH_TOKEN?.trim() || undefined;
  if (transport === "http") {
    // Fail closed: the server acts as the account owner, so it must never be reachable without a secret.
    if (!authToken || authToken.length < 24) {
      throw new Error(
        "MCP_AUTH_TOKEN must be set (24+ chars) when MCP_TRANSPORT=http. Generate one with: openssl rand -hex 32",
      );
    }
  }

  return {
    clientId: e.SPOTIFY_CLIENT_ID,
    clientSecret: e.SPOTIFY_CLIENT_SECRET,
    refreshToken: e.SPOTIFY_REFRESH_TOKEN,
    transport,
    port: e.PORT ?? 8080,
    authToken,
    redirectUri: e.SPOTIFY_REDIRECT_URI || "http://127.0.0.1:8888/callback",
  };
}
