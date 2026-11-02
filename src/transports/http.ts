import { randomBytes, timingSafeEqual } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVER_VERSION } from "../server.js";
import { SCOPES } from "../scopes.js";
import type { TokenManager } from "../token-manager.js";

export interface ReauthOptions {
  tokens: TokenManager;
  redirectUri: string;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Accept the secret three ways so every MCP client can connect:
 *  - `Authorization: Bearer <token>` header (clients with an API-key field, e.g. Poke)
 *  - `/mcp/<token>` path (clients that only take a URL, e.g. claude.ai custom connectors)
 *  - `?key=<token>` query string (fallback)
 */
function requireAuth(token: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.get("authorization");
    const bearer = header?.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : undefined;
    const pathKey = typeof req.params.key === "string" ? req.params.key : undefined;
    const queryKey = typeof req.query.key === "string" ? req.query.key : undefined;
    const presented = bearer ?? pathKey ?? queryKey;

    if (presented && safeEqual(presented, token)) return next();
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Unauthorized" },
      id: null,
    });
  };
}

/**
 * Re-authorise from a phone, without the local CLI helper:
 *  1. GET  /auth/login?key=<token>  → redirects to Spotify's consent screen with every scope.
 *  2. Spotify redirects to the registered loopback URI (http://127.0.0.1:8888/callback?code=...).
 *     On a phone that page fails to load, but the URL holds the code.
 *  3. POST /auth/exchange (authenticated) with {"url": "<that URL>"} → the server swaps to the new
 *     refresh token immediately and returns it so it can be persisted in SPOTIFY_REFRESH_TOKEN.
 */
function registerReauth(app: express.Express, auth: ReturnType<typeof requireAuth>, opts: ReauthOptions) {
  const pendingStates = new Map<string, number>();

  app.get("/auth/login", auth, (_req, res) => {
    const state = randomBytes(16).toString("hex");
    pendingStates.set(state, Date.now());
    const url = new URL("https://accounts.spotify.com/authorize");
    url.search = new URLSearchParams({
      client_id: opts.tokens.clientIdValue,
      response_type: "code",
      redirect_uri: opts.redirectUri,
      scope: SCOPES,
      state,
      show_dialog: "true",
    }).toString();
    res.redirect(url.toString());
  });

  app.post("/auth/exchange", auth, async (req, res) => {
    const raw = typeof req.body?.url === "string" ? req.body.url : typeof req.body?.code === "string" ? req.body.code : "";
    let code = raw.trim();
    let state: string | null = null;
    try {
      const parsed = new URL(code);
      code = parsed.searchParams.get("code") ?? "";
      state = parsed.searchParams.get("state");
    } catch {
      // a bare code was posted
    }
    if (!code) {
      res.status(400).json({ error: "No authorization code found. Post {\"url\": \"<the full callback URL>\"}." });
      return;
    }
    // Codes expire after ~10 minutes; states older than 15 minutes are dropped either way.
    for (const [s, t] of pendingStates) if (Date.now() - t > 15 * 60_000) pendingStates.delete(s);
    if (state && !pendingStates.has(state)) {
      res.status(400).json({ error: "Unknown or expired state. Start again at /auth/login." });
      return;
    }
    if (state) pendingStates.delete(state);
    try {
      const result = await opts.tokens.exchangeCode(code, opts.redirectUri);
      res.json({
        ok: true,
        scope: result.scope,
        refreshToken: result.refreshToken,
        note: "Active now. Save refreshToken as SPOTIFY_REFRESH_TOKEN so it survives a restart.",
      });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}

export async function startHttp(
  makeServer: () => McpServer,
  port: number,
  authToken: string,
  reauth?: ReauthOptions,
): Promise<void> {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", name: "spotify-mcp", version: SERVER_VERSION });
  });

  // Stateless Streamable HTTP: a fresh server + transport per request, no sessions to leak or expire.
  const handle = async (req: Request, res: Response) => {
    const server = makeServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("MCP request failed:", err);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
      }
    }
  };

  const methodNotAllowed = (_req: Request, res: Response) => {
    res
      .status(405)
      .set("Allow", "POST")
      .json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
  };

  const auth = requireAuth(authToken);
  if (reauth) registerReauth(app, auth, reauth);
  for (const path of ["/mcp", "/mcp/:key"]) {
    app.post(path, auth, handle);
    app.get(path, auth, methodNotAllowed);
    app.delete(path, auth, methodNotAllowed);
  }

  await new Promise<void>((resolve) => {
    app.listen(port, "0.0.0.0", () => {
      console.log(`spotify-mcp ${SERVER_VERSION} listening on :${port} (POST /mcp, auth required)`);
      resolve();
    });
  });
}
