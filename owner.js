const {
  InteractionContextType,
  SlashCommandBuilder,
} = require("discord.js");
const { createEmbed } = require("../embeds");
const { replyEmbed } = require("./helpers");

const commandBuilder = new SlashCommandBuilder()
  .setName("owner")
  .setDescription("Open the owner-only bot status panel.")
  .setContexts(InteractionContextType.Guild);

const commandHandler = async (interaction, { client, ownerId }) => {
  if (!ownerId) {
    await replyEmbed(
      interaction,
      createEmbed(
        "Owner access is not configured",
        "Add your Discord user ID to the Replit environment variable `OWNER_ID`, then restart the bot.",
      ),
    );
    return;
  }

  if (interaction.user.id !== ownerId) {
    await replyEmbed(
      interaction,
      createEmbed("Owner only", "This command is available only to the configured bot owner."),
    );
    return;
  }

  const embed = createEmbed("hEmEttv2 • Owner panel", "Owner verification succeeded.")
    .addFields(
      { name: "Bot", value: client.user.tag, inline: true },
      { name: "Servers", value: `${client.guilds.cache.size}`, inline: true },
      { name: "Gateway latency", value: `${client.ws.ping} ms`, inline: true },
      { name: "Uptime", value: `${Math.floor(process.uptime() / 60)} minutes`, inline: true },
    );
  await replyEmbed(interaction, embed);
};

module.exports = {
  commandBuilder,
  commandHandler,
};
