import CytubeClient from "cytube-client";
import type { ThreadChannel } from "discord.js";
import { sendMessage } from "../discord/sendMessage";
import * as subscriptions from "../persistence/subscriptions";

// biome-ignore lint/suspicious/noExplicitAny: cytube-client ships no types (see CLAUDE.md).
type CytubeInstance = any;

const clients = new Map<string, CytubeInstance>();
// Per (cytubeChannel, discordChannelId) pair: the thread under the most recent "Now playing"
// message. CyTube chat messages get mirrored into here for as long as the video plays. Lost on
// bot restart — the next changeMedia event will start fresh threads.
const activeThreads = new Map<string, ThreadChannel>();

const threadKey = (cytubeChannel: string, discordChannelId: string) =>
  `${cytubeChannel}:${discordChannelId}`;

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// CyTube's chat protocol emits messages as HTML (with <b>, <i>, links as <a href>, and special
// chars escaped as entities). Discord's chat is markdown. We strip tags and decode the common
// entities to get plain text; loses bold/italic styling but stays safe.
const sanitizeCytubeMessage = (s: string) =>
  s
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

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
        const sent = await sendMessage(message, sub.discordChannelId);
        // Start a thread under the "Now playing" message for chat mirroring during this video.
        // Auto-archive after 1h of inactivity; archived threads still auto-unarchive on send.
        const thread = await sent.startThread({
          name: truncate(title, 100),
          autoArchiveDuration: 60,
        });
        activeThreads.set(threadKey(cytubeChannel, sub.discordChannelId), thread);
      } catch (err) {
        console.error(`[cytube] failed to post/thread for ${sub.discordChannelId}:`, err);
      }
    }
  };

const handleChatMsg =
  (cytubeChannel: string) =>
  // biome-ignore lint/suspicious/noExplicitAny: cytube-client event payload is untyped.
  async (data: any) => {
    const username = String(data.username ?? "");
    const rawMsg = String(data.msg ?? "");
    // Skip server announcements and shadow-banned messages.
    if (username === "[server]" || data.meta?.shadow) return;
    const msg = sanitizeCytubeMessage(rawMsg).trim();
    if (!msg) return;

    const formatted = truncate(`**${username}**: ${msg}`, 2000);
    const subs = subscriptions.getByCytubeChannel(cytubeChannel);
    for (const sub of subs) {
      const thread = activeThreads.get(threadKey(cytubeChannel, sub.discordChannelId));
      if (!thread) continue;
      try {
        await thread.send(formatted);
      } catch (err) {
        console.error(
          `[cytube] failed to mirror chat to thread for ${sub.discordChannelId}:`,
          err,
        );
      }
    }
  };

const startClient = async (cytubeChannel: string) => {
  if (clients.has(cytubeChannel)) return;
  console.log(`[cytube] connecting to ${cytubeChannel}`);
  try {
    const instance: CytubeInstance = await CytubeClient.connect(cytubeChannel);
    instance.on("changeMedia", handleChangeMedia(cytubeChannel));
    instance.on("chatMsg", handleChatMsg(cytubeChannel));
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
