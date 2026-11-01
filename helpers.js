const { MessageFlags } = require("discord.js");
const { createEmbed } = require("../embeds");

async function replyEmbed(interaction, embed, ephemeral = true) {
  const response = {
    embeds: [embed],
    allowedMentions: { parse: [] },
  };

  if (interaction.deferred) {
    return interaction.editReply(response);
  }

  if (ephemeral) {
    response.flags = MessageFlags.Ephemeral;
  }

  if (interaction.replied) {
    return interaction.followUp(response);
  }
  return interaction.reply(response);
}

async function deferEphemeralReply(interaction) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }
}

async function requirePermissions(
  interaction,
  userPermissions,
  botPermissions,
  channel = interaction.channel,
) {
  if (!interaction.inGuild()) {
    await replyEmbed(
      interaction,
      createEmbed("Server only", "This command can only be used inside a server."),
    );
    return false;
  }

  if (!interaction.memberPermissions?.has(userPermissions)) {
    await replyEmbed(
      interaction,
      createEmbed("Permission required", "You do not have permission to use this command."),
    );
    return false;
  }

  const botMember =
    interaction.guild.members.me ??
    (await interaction.guild.members.fetchMe().catch(() => null));
  if (!botMember) {
    await replyEmbed(
      interaction,
      createEmbed("Bot permissions unavailable", "The bot could not verify its server permissions."),
    );
    return false;
  }

  const effectivePermissions = channel
    ? channel.permissionsFor(botMember)
    : botMember.permissions;

  if (!effectivePermissions?.has(botPermissions)) {
    await replyEmbed(
      interaction,
      createEmbed(
        "Bot permission required",
        "The bot is missing one or more permissions needed for this action.",
      ),
    );
    return false;
  }

  return true;
}

module.exports = {
  deferEphemeralReply,
  replyEmbed,
  requirePermissions,
};
