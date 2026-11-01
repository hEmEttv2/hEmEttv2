const {
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require("discord.js");
const { createEmbed } = require("../embeds");
const {
  PROTECTION_DEFAULTS,
  PROTECTION_LIMITS,
  getProtectionSettings,
  setProtectionSettings,
} = require("../settings");
const {
  deferEphemeralReply,
  replyEmbed,
  requirePermissions,
} = require("./helpers");

function guildOnly(command) {
  return command.setContexts(InteractionContextType.Guild);
}

const commandBuilder = guildOnly(
  new SlashCommandBuilder()
    .setName("protection-settings")
    .setDescription("View or adjust this server's spam and raid protection.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption((option) =>
      option
        .setName("spam-limit")
        .setDescription("Messages in five seconds that trigger anti-spam (3–20).")
        .setMinValue(PROTECTION_LIMITS.spamMessageLimit.min)
        .setMaxValue(PROTECTION_LIMITS.spamMessageLimit.max),
    )
    .addIntegerOption((option) =>
      option
        .setName("raid-join-limit")
        .setDescription("Joins in ten seconds that trigger anti-raid (3–20).")
        .setMinValue(PROTECTION_LIMITS.raidJoinLimit.min)
        .setMaxValue(PROTECTION_LIMITS.raidJoinLimit.max),
    )
    .addIntegerOption((option) =>
      option
        .setName("spam-timeout-minutes")
        .setDescription("Automatic anti-spam timeout in minutes (1–60).")
        .setMinValue(PROTECTION_LIMITS.spamTimeoutMinutes.min)
        .setMaxValue(PROTECTION_LIMITS.spamTimeoutMinutes.max),
    )
    .addIntegerOption((option) =>
      option
        .setName("raid-timeout-minutes")
        .setDescription("Automatic anti-raid timeout in minutes (1–60).")
        .setMinValue(PROTECTION_LIMITS.raidTimeoutMinutes.min)
        .setMaxValue(PROTECTION_LIMITS.raidTimeoutMinutes.max),
    ),
);

function settingsDescription(settings) {
  return [
    `Spam trigger: **${settings.spamMessageLimit} messages in 5 seconds** (default: ${PROTECTION_DEFAULTS.spamMessageLimit}).`,
    `Raid trigger: **${settings.raidJoinLimit} joins in 10 seconds** (default: ${PROTECTION_DEFAULTS.raidJoinLimit}).`,
    `Anti-spam timeout: **${settings.spamTimeoutMinutes} minute${settings.spamTimeoutMinutes === 1 ? "" : "s"}** (default: ${PROTECTION_DEFAULTS.spamTimeoutMinutes} minute).`,
    `Anti-raid timeout: **${settings.raidTimeoutMinutes} minute${settings.raidTimeoutMinutes === 1 ? "" : "s"}** (default: ${PROTECTION_DEFAULTS.raidTimeoutMinutes} minutes).`,
  ].join("\n");
}

async function commandHandler(interaction) {
  await deferEphemeralReply(interaction);
  if (
    !(await requirePermissions(
      interaction,
      PermissionFlagsBits.ManageGuild,
      PermissionFlagsBits.ViewChannel,
    ))
  ) {
    return;
  }

  const optionNames = [
    ["spam-limit", "spamMessageLimit"],
    ["raid-join-limit", "raidJoinLimit"],
    ["spam-timeout-minutes", "spamTimeoutMinutes"],
    ["raid-timeout-minutes", "raidTimeoutMinutes"],
  ];
  const updates = {};
  for (const [optionName, settingName] of optionNames) {
    const value = interaction.options.getInteger(optionName);
    if (value !== null) {
      updates[settingName] = value;
    }
  }

  if (Object.keys(updates).length === 0) {
    const settings = await getProtectionSettings(interaction.guild.id);
    await replyEmbed(
      interaction,
      createEmbed("Server protection settings", settingsDescription(settings)),
    );
    return;
  }

  const settings = await setProtectionSettings(interaction.guild.id, updates);
  await replyEmbed(
    interaction,
    createEmbed("Protection settings updated", settingsDescription(settings)),
  );
}

module.exports = {
  commandBuilder,
  commandHandler,
};
