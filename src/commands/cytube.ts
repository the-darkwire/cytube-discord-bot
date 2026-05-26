import {
  ActionRowBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  ChannelType,
  type ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import * as cytubeManager from "../cytube/manager";
import * as subscriptions from "../persistence/subscriptions";

const UNSUBSCRIBE_ALL_PREFIX = "cytube:unsubscribe-all:";

export const data = new SlashCommandBuilder()
  .setName("cytube")
  .setDescription("Manage CyTube channel subscriptions for this Discord channel")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false)
  .addSubcommand((sub) =>
    sub
      .setName("subscribe")
      .setDescription("Forward CyTube media-change events to a Discord channel")
      .addStringOption((opt) =>
        opt.setName("room").setDescription("The CyTube room name to follow").setRequired(true),
      )
      .addChannelOption((opt) =>
        opt
          .setName("channel")
          .setDescription("Discord channel to post to (defaults to the current channel)")
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("unsubscribe")
      .setDescription("Stop forwarding CyTube media-change events to a channel")
      .addStringOption((opt) =>
        opt
          .setName("room")
          .setDescription("Specific CyTube room to unsubscribe (required if many subs exist)")
          .setRequired(false),
      )
      .addChannelOption((opt) =>
        opt
          .setName("channel")
          .setDescription("Discord channel to unsubscribe (defaults to the current channel)")
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(false),
      ),
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
    const cytubeChannel = interaction.options.getString("room", true);
    const channelOption = interaction.options.getChannel("channel", false);
    const targetChannelId = channelOption?.id ?? interaction.channelId;
    const result = subscriptions.add({
      cytubeChannel,
      discordGuildId: interaction.guildId,
      discordChannelId: targetChannelId,
    });
    await cytubeManager.reconcile();
    await interaction.reply({
      content: result.added
        ? `Subscribed <#${targetChannelId}> to **${cytubeChannel}**.`
        : `<#${targetChannelId}> is already subscribed to **${cytubeChannel}**.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === "unsubscribe") {
    const roomOption = interaction.options.getString("room", false);
    const channelOption = interaction.options.getChannel("channel", false);
    const targetChannelId = channelOption?.id ?? interaction.channelId;

    if (roomOption) {
      const removed = subscriptions.removeOne(targetChannelId, roomOption);
      await interaction.reply({
        content: removed
          ? `Unsubscribed <#${targetChannelId}> from **${roomOption}**.`
          : `<#${targetChannelId}> is not subscribed to **${roomOption}**.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const existing = subscriptions.getByChannel(targetChannelId);
    if (existing.length === 0) {
      await interaction.reply({
        content: `<#${targetChannelId}> has no active CyTube subscriptions.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const [only] = existing;
    if (existing.length === 1 && only) {
      const removed = subscriptions.removeOne(targetChannelId, only.cytubeChannel);
      await interaction.reply({
        content: `Unsubscribed <#${targetChannelId}> from **${removed?.cytubeChannel}**.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const button = new ButtonBuilder()
      .setCustomId(`${UNSUBSCRIBE_ALL_PREFIX}${targetChannelId}`)
      .setLabel(`Unsubscribe all ${existing.length}`)
      .setStyle(ButtonStyle.Danger);
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(button);
    await interaction.reply({
      content: `<#${targetChannelId}> is subscribed to multiple CyTube rooms:\n${existing
        .map((s) => `• **${s.cytubeChannel}**`)
        .join(
          "\n",
        )}\n\nRe-run with \`room:<name>\` to remove a specific one, or click below to unsubscribe all.`,
      components: [row],
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

export const handleButton = async (interaction: ButtonInteraction) => {
  if (!interaction.customId.startsWith(UNSUBSCRIBE_ALL_PREFIX)) return;

  const channelId = interaction.customId.slice(UNSUBSCRIBE_ALL_PREFIX.length);
  const removed = subscriptions.removeAllForChannel(channelId);

  await interaction.update({
    content:
      removed.length === 0
        ? `<#${channelId}> already has no subscriptions.`
        : `Unsubscribed <#${channelId}> from ${removed.length} CyTube room(s): ${removed
            .map((r) => `**${r.cytubeChannel}**`)
            .join(", ")}.`,
    components: [],
  });
};
