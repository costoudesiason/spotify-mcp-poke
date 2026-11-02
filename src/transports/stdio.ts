import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export async function startStdio(makeServer: () => McpServer): Promise<void> {
  const server = makeServer();
  await server.connect(new StdioServerTransport());
  console.error("spotify-mcp running on stdio");
}
