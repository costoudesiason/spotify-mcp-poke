import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { SpotifyClient } from "../spotify-client.js";
import { ok, safe, TRACK_URI } from "./helpers.js";

const deviceId = z.string().optional().describe("Optional device ID to target; defaults to the current active device.");

interface PlaybackState {
  is_playing: boolean;
  progress_ms: number | null;
  shuffle_state?: boolean;
  repeat_state?: string;
  currently_playing_type?: string;
  device?: { id: string | null; name: string; type: string; volume_percent: number | null };
  item?: {
    name: string;
    uri: string;
    duration_ms: number;
    artists?: { name: string }[];
    album?: { name: string };
    show?: { name: string };
  } | null;
}

export function registerPlaybackTools(server: McpServer, spotify: SpotifyClient) {
  server.registerTool(
    "get_playback_state",
    {
      description:
        "Check what is currently playing on the user's Spotify account, including track, artist, device, and progress.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    safe(async () => {
      const state = await spotify.get<PlaybackState | undefined>("/me/player", { additional_types: "track,episode" });
      if (!state) return ok({ active: false, message: "Nothing is playing and no device is active." });
      const item = state.item;
      return ok({
        active: true,
        isPlaying: state.is_playing,
        type: state.currently_playing_type,
        track: item
          ? {
              name: item.name,
              uri: item.uri,
              artists: item.artists?.map((a) => a.name) ?? (item.show ? [item.show.name] : []),
              album: item.album?.name,
              durationMs: item.duration_ms,
            }
          : null,
        progressMs: state.progress_ms,
        shuffle: state.shuffle_state,
        repeat: state.repeat_state,
        device: state.device
          ? { id: state.device.id, name: state.device.name, type: state.device.type, volume: state.device.volume_percent }
          : null,
      });
    }),
  );

  server.registerTool(
    "play_track",
    {
      description:
        "Start playback of a specific track on the user's active device. Takes a Spotify track URI (spotify:track:...).",
      inputSchema: { uri: z.string().regex(TRACK_URI), deviceId },
    },
    safe(async ({ uri, deviceId }) => {
      await spotify.put("/me/player/play", { uris: [uri] }, { device_id: deviceId });
      return ok(`Playing ${uri}.`);
    }),
  );

  server.registerTool(
    "resume_playback",
    {
      description: "Resume playback where it was paused on the user's active device.",
      inputSchema: { deviceId },
    },
    safe(async ({ deviceId }) => {
      await spotify.put("/me/player/play", undefined, { device_id: deviceId });
      return ok("Playback resumed.");
    }),
  );

  server.registerTool(
    "pause_playback",
    {
      description: "Pause playback on the user's active device.",
      inputSchema: { deviceId },
    },
    safe(async ({ deviceId }) => {
      await spotify.put("/me/player/pause", undefined, { device_id: deviceId });
      return ok("Playback paused.");
    }),
  );

  server.registerTool(
    "skip_next",
    {
      description: "Skip to the next track in the user's current playback queue.",
      inputSchema: { deviceId },
    },
    safe(async ({ deviceId }) => {
      await spotify.post("/me/player/next", undefined, { device_id: deviceId });
      return ok("Skipped to the next track.");
    }),
  );

  server.registerTool(
    "skip_previous",
    {
      description: "Go back to the previous track.",
      inputSchema: { deviceId },
    },
    safe(async ({ deviceId }) => {
      await spotify.post("/me/player/previous", undefined, { device_id: deviceId });
      return ok("Went back to the previous track.");
    }),
  );

  server.registerTool(
    "add_to_queue",
    {
      description: "Add a track to the end of the user's playback queue.",
      inputSchema: { uri: z.string().regex(TRACK_URI), deviceId },
    },
    safe(async ({ uri, deviceId }) => {
      await spotify.post("/me/player/queue", undefined, { uri, device_id: deviceId });
      return ok(`Queued ${uri}.`);
    }),
  );
}
