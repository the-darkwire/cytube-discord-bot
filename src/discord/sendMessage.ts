import type { Message, TextChannel } from "discord.js";
import { client } from ".";

export const sendMessage = async (message: string, channelID: string): Promise<Message> => {
  const channel = client.channels.cache.get(channelID) as TextChannel | undefined;
  if (!channel) {
    throw new Error(`channel ${channelID} not found in cache`);
  }
  return channel.send(message);
};
