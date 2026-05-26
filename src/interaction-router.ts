import type { Interaction } from "discord.js";
import {
  execute as executeCytubeCommand,
  handleButton as handleCytubeButton,
} from "./commands/cytube";

export const routeInteraction = async (interaction: Interaction) => {
  try {
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
  } catch (err) {
    // Top-level guard. Discord.js emits an 'error' event on the Client when an interaction
    // handler throws, and an unhandled 'error' event crashes the process. Most common cause
    // here: the 3-second interaction token expired before we replied (network blip, slow
    // handler, etc.) and the subsequent reply() failed with "Unknown interaction" (10062).
    console.error("[router] interaction handler error:", err);
  }
};
