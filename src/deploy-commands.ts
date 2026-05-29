import { REST, Routes } from "discord.js";
import { data as cytubeCommandData } from "./commands/cytube";
import { env } from "./config";

if (!env.DISCORD_TOKEN) throw new Error("Missing DISCORD_TOKEN");
if (!env.DISCORD_CLIENT_ID) throw new Error("Missing DISCORD_CLIENT_ID");

const commands = [cytubeCommandData.toJSON()];

const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);

(async () => {
  try {
    console.log(`Refreshing ${commands.length} application (/) command(s)...`);
    const data = (await rest.put(Routes.applicationCommands(env.DISCORD_CLIENT_ID as string), {
      body: commands,
    })) as unknown[];
    console.log(`Reloaded ${data.length} application (/) command(s).`);
    // Importing `data` from src/commands/cytube transitively pulls in src/discord/index.ts,
    // which opens a gateway connection at module load. Without an explicit exit, that
    // connection keeps the event loop alive forever and the script hangs.
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
})();
