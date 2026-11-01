const {
  ChannelType,
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require("discord.js");
const { createEmbed, sendModerationLog } = require("../embeds");
const {
  deferEphemeralReply,
  replyEmbed,
  requirePermissions,
} = require("./helpers");

function guildOnly(command) {
  return command.setContexts(InteractionContextType.Guild);
}

const commandBuilders = [
  guildOnly(
    new SlashCommandBuilder()
      .setName("ping")
      .setDescription("Check whether hEmEttv2 is active."),
  ),
  guildOnly(
    new SlashCommandBuilder()
      .setName("help")
      .setDescription("Show commands, access requirements, and protection details."),
  ),
  guildOnly(
    new SlashCommandBuilder()
      .setName("say")
      .setDescription("Post a message without triggering user mentions.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
      .addStringOption((option) =>
        option
          .setName("message")
          .setDescription("The message to post.")
          .setMaxLength(2000)
          .setRequired(true),
      )
      .addChannelOption((option) =>
        option
          .setName("channel")
          .setDescription("Where to post; defaults to this channel.")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
      ),
  ),
  guildOnly(
    new SlashCommandBuilder()
      .setName("announce")
      .setDescription("Post a branded announcement embed.")
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addStringOption((option) =>
        option
          .setName("message")
          .setDescription("The announcement text.")
          .setMaxLength(2000)
          .setRequired(true),
      )
      .addChannelOption((option) =>
        option
          .setName("channel")
          .setDescription("Where to post; defaults to this channel.")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
      ),
  ),
  guildOnly(
    new SlashCommandBuilder()
      .setName("serverinfo")
      .setDescription("Show information about this server."),
  ),
  guildOnly(
    new SlashCommandBuilder()
      .setName("userinfo")
      .setDescription("Show information about a server member.")
      .addUserOption((option) =>
        option
          .setName("user")
          .setDescription("The member to look up; defaults to you."),
      ),
  ),
];

const commandHandlers = new Map([
  [
    "ping",
    async (interaction) => {
      await interaction.reply("Pong! Bot aktif.");
    },
  ],
  [
    "help",
    async (interaction) => {
      const embed = createEmbed(
        "hEmEttv2 • Command Center",
        "A server moderation and safety bot. Commands that change messages or members require the listed server permissions.",
      ).addFields(
        {
          name: "General",
          value:
            "`/ping` — Check bot status\n`/help` — View the command guide\n`/helpai question:` — Ask for Turkish command help\n`/serverinfo` — View server details\n`/userinfo [user]` — View member details",
        },
        {
          name: "Moderation",
          value:
            "`/ban` — Ban a member (Ban Members)\n`/kick` — Kick a member (Kick Members)\n`/timeout` — Timeout a member (Moderate Members)\n`/clear` — Remove recent messages (Manage Messages)",
        },
        {
          name: "Messages and logs",
          value:
            "`/say` — Post a message (Manage Messages)\n`/announce` — Post an announcement (Manage Server)\n`/setlogchannel` — Configure moderation logs (Manage Server)",
        },
        {
          name: "Owner and protection",
          value:
            "`/owner` — Owner-only status panel (requires `OWNER_ID`)\n`/protection-settings` — Tune this server's spam and raid response (Manage Server)\nAnti-spam rate limits message floods; anti-raid temporarily times out new members during a join burst.",
        },
      );

      await replyEmbed(interaction, embed);
    },
  ],
  [
    "say",
    async (interaction) => {
      const message = interaction.options.getString("message", true);
      const channel = interaction.options.getChannel("channel") ?? interaction.channel;
      const requiredBotPermissions =
        PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages;

      await deferEphemeralReply(interaction);
      if (
        !(await requirePermissions(
          interaction,
          PermissionFlagsBits.ManageMessages,
          requiredBotPermissions,
          channel,
        ))
      ) {
        return;
      }

      await channel.send({
        content: message,
        allowedMentions: { parse: [] },
      });
      await replyEmbed(
        interaction,
        createEmbed("Message posted", `Posted in <#${channel.id}>.`),
      );
      await sendModerationLog(interaction.guild, {
        title: "Message posted",
        fields: [
          { name: "Moderator", value: `${interaction.user.tag} (\`${interaction.user.id}\`)` },
          { name: "Channel", value: `<#${channel.id}>` },
        ],
      });
    },
  ],
  [
    "announce",
    async (interaction) => {
      const message = interaction.options.getString("message", true);
      const channel = interaction.options.getChannel("channel") ?? interaction.channel;
      const requiredBotPermissions =
        PermissionFlagsBits.ViewChannel |
        PermissionFlagsBits.SendMessages |
        PermissionFlagsBits.EmbedLinks;

      await deferEphemeralReply(interaction);
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

      const announcement = createEmbed("Server announcement", message);
      await channel.send({
        embeds: [announcement],
        allowedMentions: { parse: [] },
      });
      await replyEmbed(
        interaction,
        createEmbed("Announcement posted", `Posted in <#${channel.id}>.`),
      );
      await sendModerationLog(interaction.guild, {
        title: "Announcement posted",
        fields: [
          { name: "Moderator", value: `${interaction.user.tag} (\`${interaction.user.id}\`)` },
          { name: "Channel", value: `<#${channel.id}>` },
        ],
      });
    },
  ],
  [
    "serverinfo",
    async (interaction) => {
      if (!interaction.inGuild()) {
        await replyEmbed(
          interaction,
          createEmbed("Server only", "This command can only be used inside a server."),
        );
        return;
      }

      const guild = interaction.guild;
      const textChannels = guild.channels.cache.filter((channel) =>
        [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type),
      ).size;
      const voiceChannels = guild.channels.cache.filter((channel) =>
        [ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(channel.type),
      ).size;
      const embed = createEmbed(guild.name, `Server ID: \`${guild.id}\``)
        .addFields(
          { name: "Owner", value: `<@${guild.ownerId}>`, inline: true },
          { name: "Members", value: `${guild.memberCount}`, inline: true },
          { name: "Created", value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:F>` },
          { name: "Text channels", value: `${textChannels}`, inline: true },
          { name: "Voice channels", value: `${voiceChannels}`, inline: true },
          { name: "Roles", value: `${guild.roles.cache.size - 1}`, inline: true },
        );

      const icon = guild.iconURL({ size: 256 });
      if (icon) {
        embed.setThumbnail(icon);
      }
      await replyEmbed(interaction, embed);
    },
  ],
  [
    "userinfo",
    async (interaction) => {
      if (!interaction.inGuild()) {
        await replyEmbed(
          interaction,
          createEmbed("Server only", "This command can only be used inside a server."),
        );
        return;
      }

      const user = interaction.options.getUser("user") ?? interaction.user;
      await deferEphemeralReply(interaction);
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      const fields = [
        { name: "Username", value: user.tag, inline: true },
        { name: "User ID", value: `\`${user.id}\``, inline: true },
        { name: "Account created", value: `<t:${Math.floor(user.createdTimestamp / 1000)}:F>` },
        {
          name: "Server status",
          value: member
            ? `Joined <t:${Math.floor(member.joinedTimestamp / 1000)}:F>\nHighest role: ${member.roles.highest}`
            : "Not currently in this server.",
        },
      ];
      const embed = createEmbed("User information", `Details for ${user.tag}.`)
        .addFields(fields)
        .setThumbnail(user.displayAvatarURL({ size: 256 }));

      await replyEmbed(interaction, embed);
    },
  ],
]);

module.exports = {
  commandBuilders,
  commandHandlers,
};
