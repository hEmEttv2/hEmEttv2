const { EmbedBuilder } = require("discord.js");
const { getLogChannelId } = require("./settings");

const BRAND_PURPLE = 0x7c3aed;

function createEmbed(title, description) {
  const embed = new EmbedBuilder()
    .setColor(BRAND_PURPLE)
    .setTitle(title)
    .setFooter({ text: "hEmEttv2 • Black & Purple" })
    .setTimestamp();

  if (description) {
    embed.setDescription(description);
  }

  return embed;
}

async function sendModerationLog(guild, { title, description, fields = [] }) {
  const logChannelId = await getLogChannelId(guild.id);
  if (!logChannelId) {
    return false;
  }

  const channel = await guild.channels.fetch(logChannelId).catch((error) => {
    console.error(`Could not load the configured log channel for guild ${guild.id}:`, error);
    return null;
  });

  if (!channel?.isTextBased() || typeof channel.send !== "function") {
    console.error(`The configured moderation log channel for guild ${guild.id} is unavailable.`);
    return false;
  }

  const embed = createEmbed(title, description);
  if (fields.length > 0) {
    embed.addFields(fields.slice(0, 25));
  }

  try {
    await channel.send({
      embeds: [embed],
      allowedMentions: { parse: [] },
    });
    return true;
  } catch (error) {
    console.error(`Could not send a moderation log for guild ${guild.id}:`, error);
    return false;
  }
}

module.exports = {
  BRAND_PURPLE,
  createEmbed,
  sendModerationLog,
};
