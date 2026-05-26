import { Events } from "discord.js";
import { env } from "./src/config";
import { createCytubeClient } from "./src/cytube";
import { client as DiscordClient } from "./src/discord";
import { sendMessage } from "./src/discord/sendMessage";

DiscordClient.once(Events.ClientReady, async () => {
  if (!env.DISCORD_CHANNEL_ID) return;

  const sendMessageToTestChannel = (message: string) =>
    sendMessage(message, env.DISCORD_CHANNEL_ID as string);

  const CytubeClient = await createCytubeClient();

  // biome-ignore lint/suspicious/noExplicitAny: cytube-client ships no types (see CLAUDE.md).
  CytubeClient.on("changeMedia", (data: any) =>
    sendMessageToTestChannel(`Now playing: ${data.title} [${data.duration}]`),
  );
});
