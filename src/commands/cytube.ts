import {
  type ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import * as cytubeManager from "../cytube/manager";
import * as subscriptions from "../persistence/subscriptions";

export const data = new SlashCommandBuilder()
  .setName("cytube")
  .setDescription("Manage CyTube channel subscriptions for this Discord channel")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false)
  .addSubcommand((sub) =>
    sub
      .setName("subscribe")
      .setDescription("Forward CyTube media-change events to this Discord channel")
      .addStringOption((opt) =>
        opt
          .setName("channel")
          .setDescription("The CyTube channel name to follow")
          .setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("unsubscribe")
      .setDescription("Stop forwarding CyTube media-change events to this channel"),
  )
  .addSubcommand((sub) =>
    sub.setName("list").setDescription("List CyTube subscriptions in this server"),
  );

export const execute = async (interaction: ChatInputCommandInteraction) => {
  if (!interaction.guildId || !interaction.channelId) {
    await interaction.reply({
      content: "This command must be used in a server text channel.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const sub = interaction.options.getSubcommand();

  if (sub === "subscribe") {
    const cytubeChannel = interaction.options.getString("channel", true);
    const result = subscriptions.add({
      cytubeChannel,
      discordGuildId: interaction.guildId,
      discordChannelId: interaction.channelId,
    });
    await cytubeManager.reconcile();
    const message = result.replaced
      ? `Replaced previous subscription (**${result.replaced.cytubeChannel}** → this channel) with **${cytubeChannel}**.`
      : result.added
        ? `Subscribed: media changes on **${cytubeChannel}** will be posted here.`
        : `This channel is already subscribed to **${cytubeChannel}**.`;
    await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
    return;
  }

  if (sub === "unsubscribe") {
    const removed = subscriptions.remove(interaction.channelId);
    await interaction.reply({
      content: removed
        ? `Unsubscribed from **${removed.cytubeChannel}**.`
        : "This channel has no active CyTube subscription.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === "list") {
    const guildSubs = subscriptions.getByGuild(interaction.guildId);
    await interaction.reply({
      content:
        guildSubs.length === 0
          ? "No CyTube subscriptions in this server."
          : `Subscriptions in this server:\n${guildSubs
              .map((s) => `• <#${s.discordChannelId}> → **${s.cytubeChannel}**`)
              .join("\n")}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
};
