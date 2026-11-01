const fs = require("node:fs/promises");
const path = require("node:path");

const settingsFile = path.join(process.cwd(), "data", "guild-settings.json");
let settings = null;
let writeQueue = Promise.resolve();

const PROTECTION_DEFAULTS = Object.freeze({
  spamMessageLimit: 7,
  raidJoinLimit: 8,
  spamTimeoutMinutes: 1,
  raidTimeoutMinutes: 10,
});

const PROTECTION_LIMITS = Object.freeze({
  spamMessageLimit: Object.freeze({ min: 3, max: 20 }),
  raidJoinLimit: Object.freeze({ min: 3, max: 20 }),
  spamTimeoutMinutes: Object.freeze({ min: 1, max: 60 }),
  raidTimeoutMinutes: Object.freeze({ min: 1, max: 60 }),
});

async function loadGuildSettings() {
  if (settings) {
    return settings;
  }

  try {
    const content = await fs.readFile(settingsFile, "utf8");
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Guild settings must be a JSON object.");
    }
    settings = parsed;
  } catch (error) {
    if (error.code === "ENOENT") {
      settings = {};
    } else {
      throw new Error(`Could not load ${settingsFile}: ${error.message}`);
    }
  }

  return settings;
}

async function getLogChannelId(guildId) {
  const currentSettings = await loadGuildSettings();
  return currentSettings[guildId]?.moderationLogChannelId ?? null;
}

function queueGuildSettingsUpdate(guildId, update, errorMessage) {
  const nextWrite = writeQueue.catch(() => {}).then(async () => {
    const currentSettings = await loadGuildSettings();
    const previousSettings = currentSettings[guildId];
    currentSettings[guildId] = update(previousSettings);

    try {
      const snapshot = JSON.stringify(currentSettings, null, 2);
      await fs.mkdir(path.dirname(settingsFile), { recursive: true });
      const temporaryFile = `${settingsFile}.tmp`;
      await fs.writeFile(temporaryFile, snapshot, "utf8");
      await fs.rename(temporaryFile, settingsFile);
    } catch (error) {
      if (previousSettings === undefined) {
        delete currentSettings[guildId];
      } else {
        currentSettings[guildId] = previousSettings;
      }
      throw new Error(`${errorMessage}: ${error.message}`);
    }

    return currentSettings[guildId];
  });
  writeQueue = nextWrite;
  return nextWrite;
}

async function setLogChannelId(guildId, channelId) {
  return queueGuildSettingsUpdate(
    guildId,
    (previousSettings) => ({
      ...previousSettings,
      moderationLogChannelId: channelId,
    }),
    "Could not save the moderation log channel",
  );
}

function isValidProtectionValue(name, value) {
  const limits = PROTECTION_LIMITS[name];
  return (
    limits &&
    Number.isSafeInteger(value) &&
    value >= limits.min &&
    value <= limits.max
  );
}

async function getProtectionSettings(guildId) {
  const currentSettings = await loadGuildSettings();
  const savedProtection = currentSettings[guildId]?.protection;
  const protection = { ...PROTECTION_DEFAULTS };

  if (savedProtection && typeof savedProtection === "object" && !Array.isArray(savedProtection)) {
    for (const name of Object.keys(PROTECTION_DEFAULTS)) {
      const value = savedProtection[name];
      if (isValidProtectionValue(name, value)) {
        protection[name] = value;
      }
    }
  }

  return protection;
}

async function setProtectionSettings(guildId, updates) {
  if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
    throw new Error("Protection settings must be provided as an object.");
  }

  const entries = Object.entries(updates);
  if (entries.length === 0) {
    throw new Error("At least one protection setting must be provided.");
  }

  for (const [name, value] of entries) {
    if (!Object.hasOwn(PROTECTION_DEFAULTS, name) || !isValidProtectionValue(name, value)) {
      const limits = PROTECTION_LIMITS[name];
      if (limits) {
        throw new Error(`${name} must be a whole number from ${limits.min} to ${limits.max}.`);
      }
      throw new Error(`Unknown protection setting: ${name}.`);
    }
  }

  return queueGuildSettingsUpdate(
    guildId,
    (previousSettings) => ({
      ...previousSettings,
      protection: {
        ...previousSettings?.protection,
        ...updates,
      },
    }),
    "Could not save protection settings",
  );
}

module.exports = {
  PROTECTION_DEFAULTS,
  PROTECTION_LIMITS,
  getLogChannelId,
  getProtectionSettings,
  loadGuildSettings,
  setLogChannelId,
  setProtectionSettings,
};
