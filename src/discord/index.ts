import { Client, GatewayIntentBits } from "discord.js";
import { env } from "../config";

export const client = new Client({
  intents: [GatewayIntentBits.Guilds],
}) as Client<true>;

client.login(env.DISCORD_TOKEN);
