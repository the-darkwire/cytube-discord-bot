import { TextChannel } from "discord.js";
import { client } from ".";

export const sendMessage = (message: string, channelID: string) => {
  const channel = client.channels.cache.get(channelID) as TextChannel;

  channel.send(message);
};
