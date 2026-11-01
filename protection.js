const { PermissionFlagsBits } = require("discord.js");
const { sendModerationLog } = require("./embeds");
const { getProtectionSettings } = require("./settings");

const SPAM_WINDOW_MS = 5_000;
const RAID_WINDOW_MS = 10_000;
const RAID_MODE_MS = 10 * 60_000;

const spamStateByMember = new Map();
const raidStateByGuild = new Map();

function isModerator(member) {
  return (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ManageMessages) ||
    member.permissions.has(PermissionFlagsBits.ModerateMembers) ||
    member.permissions.has(PermissionFlagsBits.ManageGuild)
  );
}

function memberKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

async function handleMessageCreate(message, { ownerId }) {
  if (!message.guild || !message.member || message.author.bot) {
    return;
  }
  if (ownerId && message.author.id === ownerId) {
    return;
  }
  if (isModerator(message.member)) {
    return;
  }

  const settings = await getProtectionSettings(message.guild.id);
  const spamTimeoutMs = settings.spamTimeoutMinutes * 60_000;
  const now = Date.now();
  const key = memberKey(message.guild.id, message.author.id);
  const state = spamStateByMember.get(key) ?? {
    messages: [],
    cooldownUntil: 0,
    lastSeenAt: now,
  };
  state.lastSeenAt = now;
  state.messages = state.messages.filter((entry) => now - entry.timestamp <= SPAM_WINDOW_MS);
  state.messages.push({ id: message.id, timestamp: now });
  spamStateByMember.set(key, state);

  if (spamStateByMember.size > 3_000) {
    for (const [memberId, entry] of spamStateByMember) {
      if (now - entry.lastSeenAt > 60_000) {
        spamStateByMember.delete(memberId);
      }
    }
  }

  if (
    state.messages.length < settings.spamMessageLimit ||
    now < state.cooldownUntil
  ) {
    return;
  }

  state.cooldownUntil = now + spamTimeoutMs;
  const messageIds = state.messages.map((entry) => entry.id);
  state.messages = [];

  let deletedCount = 0;
  try {
    const deleted = await message.channel.bulkDelete(messageIds, true);
    deletedCount = deleted.size;
  } catch (error) {
    console.error(`Anti-spam could not delete messages in guild ${message.guild.id}:`, error);
  }

  let timedOut = false;
  try {
    if (message.member.moderatable) {
      await message.member.timeout(spamTimeoutMs, "hEmEttv2 anti-spam: message flood");
      timedOut = true;
    }
  } catch (error) {
    console.error(`Anti-spam could not timeout member ${message.author.id}:`, error);
  }

  await sendModerationLog(message.guild, {
    title: "Anti-spam action",
    description: `${message.author.tag} exceeded the rate limit.`,
    fields: [
      { name: "Member", value: `${message.author.tag} (\`${message.author.id}\`)` },
      { name: "Channel", value: `<#${message.channel.id}>` },
      { name: "Messages deleted", value: `${deletedCount}`, inline: true },
      {
        name: "Timeout applied",
        value: timedOut
          ? `${settings.spamTimeoutMinutes} minute${settings.spamTimeoutMinutes === 1 ? "" : "s"}`
          : "No — check bot permissions",
        inline: true,
      },
    ],
  });
}

function hasElevatedRole(member) {
  return (
    member.id === member.guild.ownerId ||
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ManageGuild) ||
    member.permissions.has(PermissionFlagsBits.ModerateMembers)
  );
}

async function timeoutRaidMember(member, timeoutMs) {
  if (member.user.bot || hasElevatedRole(member) || !member.moderatable) {
    return false;
  }

  try {
    await member.timeout(timeoutMs, "hEmEttv2 anti-raid: join burst");
    return true;
  } catch (error) {
    console.error(`Anti-raid could not timeout member ${member.id}:`, error);
    return false;
  }
}

async function handleGuildMemberAdd(member, { ownerId }) {
  if (member.user.bot || (ownerId && member.id === ownerId)) {
    return;
  }

  const settings = await getProtectionSettings(member.guild.id);
  const raidTimeoutMs = settings.raidTimeoutMinutes * 60_000;
  const now = Date.now();
  const state = raidStateByGuild.get(member.guild.id) ?? {
    recentJoins: [],
    raidUntil: 0,
  };
  state.recentJoins = state.recentJoins.filter(
    (entry) => now - entry.joinedAt <= RAID_WINDOW_MS,
  );
  state.recentJoins.push({ member, joinedAt: now });

  const raidAlreadyActive = now < state.raidUntil;
  const raidTriggered = !raidAlreadyActive && state.recentJoins.length >= settings.raidJoinLimit;
  let membersToTimeout = [];

  if (raidTriggered) {
    state.raidUntil = now + RAID_MODE_MS;
    membersToTimeout = state.recentJoins.map((entry) => entry.member);
  } else if (raidAlreadyActive) {
    membersToTimeout = [member];
  }
  raidStateByGuild.set(member.guild.id, state);

  if (membersToTimeout.length === 0) {
    return;
  }

  const results = await Promise.all(
    membersToTimeout.map((joinedMember) => timeoutRaidMember(joinedMember, raidTimeoutMs)),
  );
  const timedOutCount = results.filter(Boolean).length;

  if (raidTriggered) {
    await sendModerationLog(member.guild, {
      title: "Anti-raid protection activated",
      description: `Detected ${state.recentJoins.length} new members within ${RAID_WINDOW_MS / 1000} seconds. New arrivals will be timed out for ${settings.raidTimeoutMinutes} minute${settings.raidTimeoutMinutes === 1 ? "" : "s"} while raid protection is active.`,
      fields: [
        { name: "Timed out", value: `${timedOutCount} of ${membersToTimeout.length}`, inline: true },
        { name: "Protection window", value: `${RAID_MODE_MS / 60_000} minutes`, inline: true },
        {
          name: "Bot permission",
          value: timedOutCount > 0
            ? "Moderate Members available"
            : "Timeouts failed; check role order and Moderate Members permission",
        },
      ],
    });
    return;
  }

  await sendModerationLog(member.guild, {
    title: "Anti-raid action",
    description: `${member.user.tag} joined while raid protection was active.`,
    fields: [
      { name: "Member", value: `${member.user.tag} (\`${member.id}\`)` },
      {
        name: "Timeout applied",
        value: timedOutCount > 0
          ? `${settings.raidTimeoutMinutes} minute${settings.raidTimeoutMinutes === 1 ? "" : "s"}`
          : "No — check bot permissions",
      },
    ],
  });
}

module.exports = {
  handleGuildMemberAdd,
  handleMessageCreate,
};
