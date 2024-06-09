import { client as DiscordClient } from "./src/discord";
import { createCytubeClient } from "./src/cytube";
import { Events } from "discord.js";
import { sendMessage } from "./src/discord/sendMessage";
import { env } from "./src/config";

DiscordClient.once(Events.ClientReady, async (readyDiscordClient) => {
  if (!env.DISCORD_CHANNEL_ID) return;

  const sendMessageToTestChannel = (message: string) =>
    sendMessage(message, env.DISCORD_CHANNEL_ID as string);

  const CytubeClient = await createCytubeClient();

  CytubeClient.on("changeMedia", (data: any) =>
    sendMessageToTestChannel(`Now playing: ${data.title} [${data.duration}]`)
  );
});
