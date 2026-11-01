const {
  ChannelType,
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require("discord.js");
const { createEmbed, sendModerationLog } = require("../embeds");
const { setLogChannelId } = require("../settings");
const {
  deferEphemeralReply,
  replyEmbed,
  requirePermissions,
} = require("./helpers");

function guildOnly(command) {
  return command.setContexts(InteractionContextType.Guild);
}

function reasonFor(interaction) {
  return interaction.options.getString("reason") || "No reason provided";
}

function moderationFields(interaction, target, reason) {
  return [
    { name: "Target", value: `${target.tag} (\`${target.id}\`)` },
    { name: "Moderator", value: `${interaction.user.tag} (\`${interaction.user.id}\`)` },
    { name: "Reason", value: reason.slice(0, 1024) },
  ];
}

function actionBuilder(name, description, permission, includeReason = true) {
  const builder = guildOnly(
    new SlashCommandBuilder()
      .setName(name)
      .setDescription(description)
      .setDefaultMemberPermissions(permission)
      .addUserOption((option) =>
        option
          .setName("user")
          .setDescription("The member to moderate.")
          .setRequired(true),
      ),
  );

  if (includeReason) {
    builder.addStringOption((option) =>
      option
        .setName("reason")
        .setDescription("Why this action is being taken.")
        .setMaxLength(512),
    );
  }
  return builder;
}

const commandBuilders = [
  actionBuilder("ban", "Ban a member from this server.", PermissionFlagsBits.BanMembers),
  actionBuilder("kick", "Remove a member from this server.", PermissionFlagsBits.KickMembers),
  guildOnly(
    new SlashCommandBuilder()
      .setName("timeout")
      .setDescription("Temporarily prevent a member from interacting.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption((option) =>
        option
          .setName("user")
          .setDescription("The member to timeout.")
          .setRequired(true),
      )
      .addStringOption((option) =>
        option
          .setName("duration")
          .setDescription("Duration such as 10m, 2h, or 1d; maximum 28d.")
          .setRequired(true)
          .setMaxLength(8),
      )
      .addStringOption((option) =>
        option
          .setName("reason")
          .setDescription("Why this action is being taken.")
          .setMaxLength(512),
      ),
  ),
  guildOnly(
    new SlashCommandBuilder()
      .setName("clear")
      .setDescription("Delete between 1 and 100 recent messages.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
      .addIntegerOption((option) =>
        option
          .setName("amount")
          .setDescription("Number of recent messages to delete.")
          .setMinValue(1)
          .setMaxValue(100)
          .setRequired(true),
      ),
  ),
  guildOnly(
    new SlashCommandBuilder()
      .setName("setlogchannel")
      .setDescription("Choose where moderation and protection logs are sent.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addChannelOption((option) =>
        option
          .setName("channel")
          .setDescription("The channel for moderation logs.")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setRequired(true),
      ),
  ),
];

const commandHandlers = new Map([
  [
    "ban",
    async (interaction) => {
      const targetUser = interaction.options.getUser("user", true);
      const reason = reasonFor(interaction);
      await deferEphemeralReply(interaction);
      if (
        !(await requirePermissions(
          interaction,
          PermissionFlagsBits.BanMembers,
          PermissionFlagsBits.BanMembers,
        ))
      ) {
        return;
      }
      if (
        targetUser.id === interaction.user.id ||
        targetUser.id === interaction.client.user.id ||
        targetUser.id === interaction.guild.ownerId
      ) {
        await replyEmbed(
          interaction,
          createEmbed("Ban blocked", "You cannot ban yourself, the bot, or the server owner."),
        );
        return;
      }

      const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      if (targetMember && !targetMember.bannable) {
        await replyEmbed(
          interaction,
          createEmbed(
            "Ban blocked",
            "The bot's role must be higher than the target's role and have Ban Members permission.",
          ),
        );
        return;
      }

      await interaction.guild.members.ban(targetUser, {
        reason: `${reason} | Moderator: ${interaction.user.tag} (${interaction.user.id})`,
        deleteMessageSeconds: 0,
      });
      await replyEmbed(
        interaction,
        createEmbed("Member banned", `${targetUser.tag} was banned.`),
      );
      await sendModerationLog(interaction.guild, {
        title: "Member banned",
        fields: moderationFields(interaction, targetUser, reason),
      });
    },
  ],
  [
    "kick",
    async (interaction) => {
      const targetUser = interaction.options.getUser("user", true);
      const reason = reasonFor(interaction);
      await deferEphemeralReply(interaction);
      if (
        !(await requirePermissions(
          interaction,
          PermissionFlagsBits.KickMembers,
          PermissionFlagsBits.KickMembers,
        ))
      ) {
        return;
      }
      if (
        targetUser.id === interaction.user.id ||
        targetUser.id === interaction.client.user.id ||
        targetUser.id === interaction.guild.ownerId
      ) {
        await replyEmbed(
          interaction,
          createEmbed("Kick blocked", "You cannot kick yourself, the bot, or the server owner."),
        );
        return;
      }

      const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      if (!targetMember) {
        await replyEmbed(
          interaction,
          createEmbed("Member not found", "That user is not currently in this server."),
        );
        return;
      }
      if (!targetMember.kickable) {
        await replyEmbed(
          interaction,
          createEmbed("Kick blocked", "The bot's role must be higher than the target's role."),
        );
        return;
      }

      await targetMember.kick(
        `${reason} | Moderator: ${interaction.user.tag} (${interaction.user.id})`,
      );
      await replyEmbed(
        interaction,
        createEmbed("Member kicked", `${targetUser.tag} was kicked from the server.`),
      );
      await sendModerationLog(interaction.guild, {
        title: "Member kicked",
        fields: moderationFields(interaction, targetUser, reason),
      });
    },
  ],
  [
    "timeout",
    async (interaction) => {
      const targetUser = interaction.options.getUser("user", true);
      const durationInput = interaction.options.getString("duration", true).trim();
      const reason = reasonFor(interaction);
      const durationMatch = durationInput.match(/^([1-9]\d*)(s|m|h|d)$/i);
      if (!durationMatch) {
        await replyEmbed(
          interaction,
          createEmbed("Invalid duration", "Use a duration such as `10m`, `2h`, or `1d`."),
        );
        return;
      }

      const units = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
      const durationMs = Number(durationMatch[1]) * units[durationMatch[2].toLowerCase()];
      const maximumDuration = 28 * 86_400_000;
      if (!Number.isSafeInteger(durationMs) || durationMs > maximumDuration) {
        await replyEmbed(
          interaction,
          createEmbed("Invalid duration", "Timeouts must be 28 days or shorter."),
        );
        return;
      }

      await deferEphemeralReply(interaction);
      if (
        !(await requirePermissions(
          interaction,
          PermissionFlagsBits.ModerateMembers,
          PermissionFlagsBits.ModerateMembers,
        ))
      ) {
        return;
      }
      if (
        targetUser.id === interaction.user.id ||
        targetUser.id === interaction.client.user.id ||
        targetUser.id === interaction.guild.ownerId
      ) {
        await replyEmbed(
          interaction,
          createEmbed("Timeout blocked", "You cannot timeout yourself, the bot, or the server owner."),
        );
        return;
      }

      const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      if (!targetMember) {
        await replyEmbed(
          interaction,
          createEmbed("Member not found", "That user is not currently in this server."),
        );
        return;
      }
      if (!targetMember.moderatable) {
        await replyEmbed(
          interaction,
          createEmbed("Timeout blocked", "The bot's role must be higher than the target's role."),
        );
        return;
      }

      await targetMember.timeout(
        durationMs,
        `${reason} | Moderator: ${interaction.user.tag} (${interaction.user.id})`,
      );
      await replyEmbed(
        interaction,
        createEmbed("Member timed out", `${targetUser.tag} was timed out for ${durationInput}.`),
      );
      await sendModerationLog(interaction.guild, {
        title: "Member timed out",
        fields: [
          ...moderationFields(interaction, targetUser, reason),
          { name: "Duration", value: durationInput, inline: true },
        ],
      });
    },
  ],
  [
    "clear",
    async (interaction) => {
      const amount = interaction.options.getInteger("amount", true);
      await deferEphemeralReply(interaction);
      if (
        !(await requirePermissions(
          interaction,
          PermissionFlagsBits.ManageMessages,
          PermissionFlagsBits.ManageMessages,
        ))
      ) {
        return;
      }
      if (!interaction.channel || typeof interaction.channel.bulkDelete !== "function") {
        await replyEmbed(
          interaction,
          createEmbed("Unsupported channel", "Messages cannot be bulk-deleted in this channel."),
        );
        return;
      }

      const deleted = await interaction.channel.bulkDelete(amount, true);
      await replyEmbed(
        interaction,
        createEmbed(
          "Messages cleared",
          `Deleted ${deleted.size} recent message${deleted.size === 1 ? "" : "s"}. Messages older than 14 days are skipped by Discord.`,
        ),
      );
      await sendModerationLog(interaction.guild, {
        title: "Messages cleared",
        fields: [
          { name: "Moderator", value: `${interaction.user.tag} (\`${interaction.user.id}\`)` },
          { name: "Channel", value: `<#${interaction.channel.id}>` },
          { name: "Deleted", value: `${deleted.size}`, inline: true },
        ],
      });
    },
  ],
  [
    "setlogchannel",
    async (interaction) => {
      const channel = interaction.options.getChannel("channel", true);
      await deferEphemeralReply(interaction);
      const requiredBotPermissions =
        PermissionFlagsBits.ViewChannel |
        PermissionFlagsBits.SendMessages |
        PermissionFlagsBits.EmbedLinks;

      if (
        !(await requirePermissions(
          interaction,
          PermissionFlagsBits.ManageGuild,
          requiredBotPermissions,
          channel,
        ))
      ) {
        return;
      }

      await setLogChannelId(interaction.guild.id, channel.id);
      await replyEmbed(
        interaction,
        createEmbed("Moderation logs configured", `Logs will be sent to <#${channel.id}>.`),
      );
      await sendModerationLog(interaction.guild, {
        title: "Moderation log channel configured",
        fields: [
          { name: "Channel", value: `<#${channel.id}>` },
          { name: "Configured by", value: `${interaction.user.tag} (\`${interaction.user.id}\`)` },
        ],
      });
    },
  ],
]);

module.exports = {
  commandBuilders,
  commandHandlers,
};
