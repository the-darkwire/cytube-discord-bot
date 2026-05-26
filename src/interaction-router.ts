import type { Interaction } from "discord.js";
import { execute as executeCytubeCommand } from "./commands/cytube";

export const routeInteraction = async (interaction: Interaction) => {
  if (!interaction.isChatInputCommand()) return;

  switch (interaction.commandName) {
    case "cytube":
      await executeCytubeCommand(interaction);
      return;
    default:
      return;
  }
};
