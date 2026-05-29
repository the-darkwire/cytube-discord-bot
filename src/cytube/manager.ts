import CytubeClient from "cytube-client";
import { sendMessage } from "../discord/sendMessage";
import * as subscriptions from "../persistence/subscriptions";

// biome-ignore lint/suspicious/noExplicitAny: cytube-client ships no types (see CLAUDE.md).
type CytubeInstance = any;

const clients = new Map<string, CytubeInstance>();

const handleChangeMedia =
  (cytubeChannel: string) =>
  // biome-ignore lint/suspicious/noExplicitAny: cytube-client event payload is untyped.
  async (data: any) => {
    const title = String(data.title ?? "Unknown");
    const duration = String(data.duration ?? "");
    const message = `Now playing on **[${cytubeChannel}](<https://cytu.be/r/${cytubeChannel}>)**: **${title}** [${duration}]`;
    const subs = subscriptions.getByCytubeChannel(cytubeChannel);
    for (const sub of subs) {
      try {
        await sendMessage(message, sub.discordChannelId);
      } catch (err) {
        console.error(`[cytube] failed to post for ${sub.discordChannelId}:`, err);
      }
    }
  };

// cytube-client fires `changeMedia` once on connect with the room's current media (so the
// client can render initial state). Treating that as a real change means we repost the current
// video into Discord on every bot restart. Suppress any changeMedia event within this window
// of opening the connection — real videos are minutes apart, so we lose nothing.
const INITIAL_STATE_SUPPRESS_WINDOW_MS = 5_000;

const startClient = async (cytubeChannel: string) => {
  if (clients.has(cytubeChannel)) return;
  console.log(`[cytube] connecting to ${cytubeChannel}`);
  try {
    const instance: CytubeInstance = await CytubeClient.connect(cytubeChannel);
    const connectedAt = Date.now();
    const handler = handleChangeMedia(cytubeChannel);
    // biome-ignore lint/suspicious/noExplicitAny: cytube-client event payload is untyped.
    instance.on("changeMedia", async (data: any) => {
      if (Date.now() - connectedAt < INITIAL_STATE_SUPPRESS_WINDOW_MS) {
        console.log(`[cytube] ${cytubeChannel} suppressing initial-state changeMedia event`);
        return;
      }
      await handler(data);
    });
    clients.set(cytubeChannel, instance);
  } catch (err) {
    console.error(`[cytube] failed to connect to ${cytubeChannel}:`, err);
  }
};

// Bring the set of running CyTube clients into line with the current set of subscriptions.
// Starts clients for new channels; leaves existing clients running (hobby-scale shortcut —
// idle CyTube clients are cheap, and bot restarts on every deploy will reset the world).
export const reconcile = async () => {
  const desired = new Set(subscriptions.uniqueCytubeChannels());
  for (const ch of desired) {
    if (!clients.has(ch)) await startClient(ch);
  }
};

// Close every active CyTube WebSocket so the server can free its connection slots immediately
// instead of waiting for timeout. cytube-client wraps socket.io; either close() or disconnect()
// is available depending on the version, so we probe both.
export const shutdown = () => {
  for (const [ch, instance] of clients.entries()) {
    try {
      if (typeof instance.close === "function") instance.close();
      else if (typeof instance.disconnect === "function") instance.disconnect();
    } catch (err) {
      console.error(`[cytube] error closing ${ch}:`, err);
    }
  }
  clients.clear();
};
