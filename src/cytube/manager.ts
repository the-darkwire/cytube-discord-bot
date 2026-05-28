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
    const message = `Now playing on **${cytubeChannel}**: ${title} [${duration}]`;
    const subs = subscriptions.getByCytubeChannel(cytubeChannel);
    for (const sub of subs) {
      try {
        await sendMessage(message, sub.discordChannelId);
      } catch (err) {
        console.error(`[cytube] failed to post for ${sub.discordChannelId}:`, err);
      }
    }
  };

const startClient = async (cytubeChannel: string) => {
  if (clients.has(cytubeChannel)) return;
  console.log(`[cytube] connecting to ${cytubeChannel}`);
  try {
    const instance: CytubeInstance = await CytubeClient.connect(cytubeChannel);
    instance.on("changeMedia", handleChangeMedia(cytubeChannel));
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
