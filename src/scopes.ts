/** Every OAuth scope the server's tools can use. Shared by the CLI auth helper and the hosted re-auth flow. */
export const SCOPES = [
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-public",
  "playlist-modify-private",
  "user-library-read",
  "user-library-modify",
  "user-top-read",
  "user-read-recently-played",
].join(" ");
