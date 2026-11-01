const test = require("node:test");
const assert = require("node:assert/strict");

const settingsModule = require("../src/settings");
const embedsModule = require("../src/embeds");
const protectionPath = require.resolve("../src/protection");

const defaults = {
  spamMessageLimit: 3,
  raidJoinLimit: 3,
  spamTimeoutMinutes: 1,
  raidTimeoutMinutes: 10,
};

function loadProtection(t, overrides = {}) {
  const originalGetProtectionSettings = settingsModule.getProtectionSettings;
  const originalSendModerationLog = embedsModule.sendModerationLog;
  const logs = [];

  settingsModule.getProtectionSettings = async () => ({ ...defaults, ...overrides });
  embedsModule.sendModerationLog = async (_guild, log) => {
    logs.push(log);
  };
  delete require.cache[protectionPath];
  const protection = require(protectionPath);

  t.after(() => {
    settingsModule.getProtectionSettings = originalGetProtectionSettings;
    embedsModule.sendModerationLog = originalSendModerationLog;
    delete require.cache[protectionPath];
  });

  return { protection, logs };
}

function makeMessage({
  id,
  member = {},
  author = {},
  bulkDelete = async (ids) => ({ size: ids.length }),
} = {}) {
  const calls = { deleted: [], timeouts: [] };
  const guild = { id: "guild-1" };
  const messageMember = {
    moderatable: true,
    permissions: { has: () => false },
    timeout: async (...args) => calls.timeouts.push(args),
    ...member,
  };
  const messageAuthor = {
    id: "user-1",
    tag: "Member#1234",
    bot: false,
    ...author,
  };
  return {
    calls,
    message: {
      id,
      guild,
      member: messageMember,
      author: messageAuthor,
      channel: {
        id: "channel-1",
        bulkDelete: async (...args) => {
          calls.deleted.push(args);
          return bulkDelete(...args);
        },
      },
    },
  };
}

function makeMember({
  id,
  bot = false,
  elevated = false,
  moderatable = true,
  timeout = async () => {},
} = {}) {
  const calls = [];
  const member = {
    id,
    user: { id, tag: `Member-${id}`, bot },
    guild: { id: "guild-1", ownerId: "server-owner" },
    moderatable,
    permissions: { has: () => elevated },
    timeout: async (...args) => {
      calls.push(args);
      return timeout(...args);
    },
  };
  return { member, calls };
}

test("anti-spam waits for the configured message limit and acts at the threshold", async (t) => {
  const { protection, logs } = loadProtection(t);
  const messages = ["m1", "m2", "m3"].map((id) => makeMessage({ id }));

  await protection.handleMessageCreate(messages[0].message, { ownerId: null });
  await protection.handleMessageCreate(messages[1].message, { ownerId: null });

  assert.equal(messages[0].calls.deleted.length, 0);
  assert.equal(messages[0].calls.timeouts.length, 0);
  assert.equal(logs.length, 0);

  await protection.handleMessageCreate(messages[2].message, { ownerId: null });

  assert.deepEqual(messages[2].calls.deleted[0][0], ["m1", "m2", "m3"]);
  assert.equal(messages[2].calls.deleted[0][1], true);
  assert.equal(messages[2].calls.timeouts[0][0], 60_000);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].title, "Anti-spam action");
});

test("anti-spam continues safely and logs failures when Discord actions reject", async (t) => {
  t.mock.method(console, "error", () => {});
  const { protection, logs } = loadProtection(t);
  const messages = [
    makeMessage({ id: "m1" }),
    makeMessage({ id: "m2" }),
    makeMessage({
      id: "m3",
      bulkDelete: async () => {
        throw new Error("Cannot bulk delete");
      },
      member: {
        timeout: async () => {
          throw new Error("Cannot timeout");
        },
      },
    }),
  ];

  for (const { message } of messages) {
    await protection.handleMessageCreate(message, { ownerId: null });
  }

  assert.equal(logs.length, 1);
  assert.equal(logs[0].fields.find((field) => field.name === "Messages deleted").value, "0");
  assert.equal(
    logs[0].fields.find((field) => field.name === "Timeout applied").value,
    "No — check bot permissions",
  );
});

test("anti-spam ignores bots, the configured owner, and moderators", async (t) => {
  const { protection, logs } = loadProtection(t);
  const bot = makeMessage({ id: "bot-message", author: { bot: true } });
  const owner = makeMessage({ id: "owner-message", author: { id: "owner" } });
  const moderator = makeMessage({
    id: "moderator-message",
    member: { permissions: { has: () => true } },
  });

  await protection.handleMessageCreate(bot.message, { ownerId: null });
  await protection.handleMessageCreate(owner.message, { ownerId: "owner" });
  await protection.handleMessageCreate(moderator.message, { ownerId: null });

  assert.equal(bot.calls.deleted.length + owner.calls.deleted.length + moderator.calls.deleted.length, 0);
  assert.equal(logs.length, 0);
});

test("anti-raid triggers at the configured join limit and times out the burst", async (t) => {
  const { protection, logs } = loadProtection(t);
  const arrivals = ["a", "b", "c"].map((id) => makeMember({ id }));

  await protection.handleGuildMemberAdd(arrivals[0].member, { ownerId: null });
  await protection.handleGuildMemberAdd(arrivals[1].member, { ownerId: null });

  assert.equal(arrivals[0].calls.length, 0);
  assert.equal(arrivals[1].calls.length, 0);
  assert.equal(logs.length, 0);

  await protection.handleGuildMemberAdd(arrivals[2].member, { ownerId: null });

  assert.deepEqual(arrivals.map(({ calls }) => calls.length), [1, 1, 1]);
  assert.equal(arrivals[0].calls[0][0], 10 * 60_000);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].title, "Anti-raid protection activated");
  assert.equal(logs[0].fields.find((field) => field.name === "Timed out").value, "3 of 3");
});

test("anti-raid times out new arrivals while raid protection is active", async (t) => {
  const { protection, logs } = loadProtection(t);
  const arrivals = ["a", "b", "c", "d"].map((id) => makeMember({ id }));

  for (const { member } of arrivals) {
    await protection.handleGuildMemberAdd(member, { ownerId: null });
  }

  assert.deepEqual(arrivals.map(({ calls }) => calls.length), [1, 1, 1, 1]);
  assert.equal(logs.length, 2);
  assert.equal(logs[1].title, "Anti-raid action");
});

test("anti-raid skips bots and elevated members", async (t) => {
  const { protection, logs } = loadProtection(t);
  const bot = makeMember({ id: "bot", bot: true });
  const moderator = makeMember({ id: "mod", elevated: true });
  const owner = makeMember({ id: "server-owner" });

  await protection.handleGuildMemberAdd(bot.member, { ownerId: null });
  await protection.handleGuildMemberAdd(moderator.member, { ownerId: null });
  await protection.handleGuildMemberAdd(owner.member, { ownerId: null });

  assert.equal(bot.calls.length + moderator.calls.length + owner.calls.length, 0);
  assert.equal(logs.length, 0);
});

test("anti-raid reports when Discord rejects timeouts for the join burst", async (t) => {
  t.mock.method(console, "error", () => {});
  const { protection, logs } = loadProtection(t);
  const arrivals = ["a", "b", "c"].map((id) =>
    makeMember({
      id,
      timeout: async () => {
        throw new Error("Cannot timeout");
      },
    }),
  );

  for (const { member } of arrivals) {
    await protection.handleGuildMemberAdd(member, { ownerId: null });
  }

  assert.equal(logs.length, 1);
  assert.equal(logs[0].fields.find((field) => field.name === "Timed out").value, "0 of 3");
  assert.match(logs[0].fields.find((field) => field.name === "Bot permission").value, /Timeouts failed/);
});

