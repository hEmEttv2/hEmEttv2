const test = require("node:test");
const assert = require("node:assert/strict");

const { requirePermissions } = require("../src/commands/helpers");

function makeInteraction(overrides = {}) {
  const replies = [];
  const botPermissions = { has: () => true };
  const botMember = { permissions: botPermissions };
  const channelPermissions = { has: () => true };
  const interaction = {
    deferred: false,
    replied: false,
    inGuild: () => true,
    memberPermissions: { has: () => true },
    guild: {
      members: {
        me: botMember,
        fetchMe: async () => botMember,
      },
    },
    channel: {
      permissionsFor: () => channelPermissions,
    },
    reply: async (response) => {
      replies.push(response);
    },
    followUp: async (response) => {
      replies.push(response);
    },
    ...overrides,
  };

  return { interaction, replies, botMember, botPermissions, channelPermissions };
}

function responseTitle(replies) {
  return replies[0]?.embeds?.[0]?.data?.title;
}

test("permission checks reject commands outside a server", async () => {
  const { interaction, replies } = makeInteraction({ inGuild: () => false });

  assert.equal(await requirePermissions(interaction, 1, 2), false);
  assert.equal(responseTitle(replies), "Server only");
});

test("permission checks reject users missing the command permission", async () => {
  const { interaction, replies } = makeInteraction({
    memberPermissions: { has: () => false },
  });
  let fetchedBot = false;
  interaction.guild.members.fetchMe = async () => {
    fetchedBot = true;
    return interaction.guild.members.me;
  };

  assert.equal(await requirePermissions(interaction, 1, 2), false);
  assert.equal(responseTitle(replies), "Permission required");
  assert.equal(fetchedBot, false);
});

test("permission checks deny when the bot's permissions cannot be fetched", async () => {
  const { interaction, replies } = makeInteraction({
    guild: {
      members: {
        me: null,
        fetchMe: async () => {
          throw new Error("Discord API unavailable");
        },
      },
    },
  });

  assert.equal(await requirePermissions(interaction, 1, 2), false);
  assert.equal(responseTitle(replies), "Bot permissions unavailable");
});

test("permission checks reject a bot missing a channel permission", async () => {
  const { interaction, replies } = makeInteraction({
    channel: { permissionsFor: () => ({ has: () => false }) },
  });

  assert.equal(await requirePermissions(interaction, 1, 2), false);
  assert.equal(responseTitle(replies), "Bot permission required");
});

test("permission checks allow the required user and channel permissions", async () => {
  const { interaction } = makeInteraction();

  assert.equal(await requirePermissions(interaction, 1, 2), true);
});

test("permission checks use the bot's server permissions without a channel", async () => {
  const botPermissions = { has: () => true };
  const { interaction } = makeInteraction({
    channel: null,
    guild: { members: { me: { permissions: botPermissions } } },
  });

  assert.equal(await requirePermissions(interaction, 1, 2), true);
});

