import { timingSafeEqual } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVER_VERSION } from "../server.js";

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

export async function startHttp(makeServer: () => McpServer, port: number, authToken: string): Promise<void> {
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
