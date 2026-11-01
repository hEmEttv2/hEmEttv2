const test = require("node:test");
const assert = require("node:assert/strict");

const helpers = require("../src/commands/helpers");
const embeds = require("../src/embeds");
const settings = require("../src/settings");

const originalRequirePermissions = helpers.requirePermissions;
const originalReplyEmbed = helpers.replyEmbed;
const originalSendModerationLog = embeds.sendModerationLog;
const originalSetLogChannelId = settings.setLogChannelId;

let permissionsAllowed = true;
let permissionChecks = [];
let moderationLogs = [];

helpers.requirePermissions = async (...args) => {
  permissionChecks.push(args);
  return permissionsAllowed;
};
helpers.replyEmbed = async (interaction, embed) => {
  interaction.responses.push(embed.data.title);
};
embeds.sendModerationLog = async (_guild, log) => {
  moderationLogs.push(log);
};
settings.setLogChannelId = async () => {};

const { commandHandlers } = require("../src/commands/moderation");

test.beforeEach(() => {
  permissionsAllowed = true;
  permissionChecks = [];
  moderationLogs = [];
});

test.after(() => {
  helpers.requirePermissions = originalRequirePermissions;
  helpers.replyEmbed = originalReplyEmbed;
  embeds.sendModerationLog = originalSendModerationLog;
  settings.setLogChannelId = originalSetLogChannelId;
});

function makeInteraction({
  targetMember = {},
  targetUser = { id: "target", tag: "Target#1234" },
  values = {},
  members = {},
} = {}) {
  const calls = { bans: [], fetches: [], kicks: [], timeouts: [] };
  const member = {
    bannable: true,
    kickable: true,
    moderatable: true,
    kick: async (...args) => calls.kicks.push(args),
    timeout: async (...args) => calls.timeouts.push(args),
    ...targetMember,
  };
  const guildMembers = {
    fetch: async (id) => {
      calls.fetches.push(id);
      return member;
    },
    ban: async (...args) => calls.bans.push(args),
    ...members,
  };
  const interaction = {
    responses: [],
    user: { id: "moderator", tag: "Moderator#1234" },
    client: { user: { id: "bot" } },
    guild: {
      ownerId: "owner",
      id: "guild",
      members: guildMembers,
    },
    options: {
      getUser: () => targetUser,
      getString: (name) => values[name] ?? null,
      getInteger: (name) => values[name],
      getChannel: (name) => values[name],
    },
  };
  return { interaction, calls, member, targetUser };
}

test("commands stop before acting when the permission check denies the moderator", async () => {
  permissionsAllowed = false;
  const { interaction, calls } = makeInteraction();

  await commandHandlers.get("ban")(interaction);

  assert.deepEqual(interaction.responses, []);
  assert.equal(calls.fetches.length, 0);
  assert.equal(calls.bans.length, 0);
  assert.equal(permissionChecks.length, 1);
});

test("ban is blocked when the target outranks the bot", async () => {
  const { interaction, calls } = makeInteraction({
    targetMember: { bannable: false },
  });

  await commandHandlers.get("ban")(interaction);

  assert.deepEqual(interaction.responses, ["Ban blocked"]);
  assert.equal(calls.bans.length, 0);
  assert.equal(moderationLogs.length, 0);
});

test("kick is blocked when the target outranks the bot", async () => {
  const { interaction, calls } = makeInteraction({
    targetMember: { kickable: false },
  });

  await commandHandlers.get("kick")(interaction);

  assert.deepEqual(interaction.responses, ["Kick blocked"]);
  assert.equal(calls.kicks.length, 0);
  assert.equal(moderationLogs.length, 0);
});

test("timeout is blocked when the target outranks the bot", async () => {
  const { interaction, calls } = makeInteraction({
    values: { duration: "10m" },
    targetMember: { moderatable: false },
  });

  await commandHandlers.get("timeout")(interaction);

  assert.deepEqual(interaction.responses, ["Timeout blocked"]);
  assert.equal(calls.timeouts.length, 0);
  assert.equal(moderationLogs.length, 0);
});

test("timeout accepts the maximum duration of 28 days", async () => {
  const { interaction, calls } = makeInteraction({
    values: { duration: "28d", reason: "reviewed" },
  });

  await commandHandlers.get("timeout")(interaction);

  assert.equal(calls.timeouts.length, 1);
  assert.equal(calls.timeouts[0][0], 28 * 24 * 60 * 60 * 1000);
  assert.deepEqual(interaction.responses, ["Member timed out"]);
  assert.equal(moderationLogs.length, 1);
});

test("timeout rejects malformed, zero, and over-limit durations without fetching the target", async (t) => {
  const invalidDurations = ["", "0m", "1.5h", "2w", "29d", "999999999999999999d"];

  for (const duration of invalidDurations) {
    await t.test(`rejects ${JSON.stringify(duration)}`, async () => {
      const { interaction, calls } = makeInteraction({ values: { duration } });

      await commandHandlers.get("timeout")(interaction);

      assert.deepEqual(interaction.responses, ["Invalid duration"]);
      assert.equal(permissionChecks.length, 0);
      assert.equal(calls.fetches.length, 0);
      assert.equal(calls.timeouts.length, 0);
    });
  }
});

test("ban API failures propagate without reporting success", async () => {
  const { interaction } = makeInteraction({
    members: {
      ban: async () => {
        throw new Error("Missing permissions");
      },
    },
  });

  await assert.rejects(commandHandlers.get("ban")(interaction), /Missing permissions/);
  assert.deepEqual(interaction.responses, []);
  assert.equal(moderationLogs.length, 0);
});

test("timeout API failures propagate without reporting success", async () => {
  const { interaction } = makeInteraction({
    values: { duration: "10m" },
    targetMember: {
      timeout: async () => {
        throw new Error("Discord API unavailable");
      },
    },
  });

  await assert.rejects(
    commandHandlers.get("timeout")(interaction),
    /Discord API unavailable/,
  );
  assert.deepEqual(interaction.responses, []);
  assert.equal(moderationLogs.length, 0);
});
