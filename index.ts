import { Events } from "discord.js";
import { env } from "./src/config";
import * as cytubeManager from "./src/cytube/manager";
import { client as DiscordClient } from "./src/discord";
import { routeInteraction } from "./src/interaction-router";
import * as subscriptions from "./src/persistence/subscriptions";

DiscordClient.once(Events.ClientReady, async () => {
  console.log("Discord client ready");

  subscriptions.init();

  // Auto-migrate from the legacy env-based single subscription. On the existing deployment
  // CYTUBE_CHANNEL + DISCORD_CHANNEL_ID are set; the first time this code runs there are no
  // subscriptions in the JSON store yet, so we seed one from env. The env vars become
  // unnecessary after this; they can be removed on the next deploy.
  if (subscriptions.getAll().length === 0 && env.CYTUBE_CHANNEL && env.DISCORD_CHANNEL_ID) {
    const channel = DiscordClient.channels.cache.get(env.DISCORD_CHANNEL_ID);
    if (channel && "guildId" in channel && channel.guildId) {
      console.log(
        `[migrate] seeding subscription from env: ${env.CYTUBE_CHANNEL} → ${env.DISCORD_CHANNEL_ID}`,
      );
      subscriptions.add({
        cytubeChannel: env.CYTUBE_CHANNEL,
        discordGuildId: channel.guildId,
        discordChannelId: env.DISCORD_CHANNEL_ID,
      });
    } else {
      console.warn(
        `[migrate] env-based subscription set but channel ${env.DISCORD_CHANNEL_ID} not in cache; skipping`,
      );
    }
  }

  await cytubeManager.reconcile();
});

DiscordClient.on(Events.InteractionCreate, routeInteraction);

let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] received ${signal}, closing CyTube and Discord clients...`);
  try {
    cytubeManager.shutdown();
    await DiscordClient.destroy();
  } catch (err) {
    console.error("[shutdown] error during shutdown:", err);
  }
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
