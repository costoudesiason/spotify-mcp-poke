import { loadConfig } from "./config.js";
import { TokenManager } from "./token-manager.js";
import { SpotifyClient } from "./spotify-client.js";
import { buildServer } from "./server.js";
import { startStdio } from "./transports/stdio.js";
import { startHttp } from "./transports/http.js";

async function main() {
  const config = loadConfig();
  const spotify = new SpotifyClient(new TokenManager(config.clientId, config.clientSecret, config.refreshToken));
  const makeServer = () => buildServer(spotify);

  if (config.transport === "http") {
    await startHttp(makeServer, config.port, config.authToken!);
  } else {
    await startStdio(makeServer);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
