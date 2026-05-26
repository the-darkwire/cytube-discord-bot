import type { Interaction } from "discord.js";
import { execute as executeCytubeCommand, handleButton as handleCytubeButton } from "./commands/cytube";

export const routeInteraction = async (interaction: Interaction) => {
  if (interaction.isChatInputCommand()) {
    switch (interaction.commandName) {
      case "cytube":
        await executeCytubeCommand(interaction);
        return;
      default:
        return;
    }
  }

  if (interaction.isButton()) {
    if (interaction.customId.startsWith("cytube:")) {
      await handleCytubeButton(interaction);
      return;
    }
  }
};
