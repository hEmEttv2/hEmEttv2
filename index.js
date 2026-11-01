const {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
} = require("discord.js");
const {
  commandAssistantMetadata,
  commandDefinitions,
  commandHandlers,
} = require("./src/commands");
const { loadGuildSettings } = require("./src/settings");
const {
  handleGuildMemberAdd,
  handleMessageCreate,
} = require("./src/protection");

const token = process.env.DISCORD_TOKEN;
const ownerId = process.env.OWNER_ID?.trim() || null;
const memberIntentEnabled = process.env.ENABLE_MEMBER_INTENT === "true";

if (!token) {
  console.error("Missing DISCORD_TOKEN. Add it in Replit Secrets before starting the bot.");
  process.exit(1);
}

if (ownerId && !/^\d{17,20}$/.test(ownerId)) {
  console.error("OWNER_ID must be a Discord user ID containing 17 to 20 digits.");
  process.exit(1);
}

const intents = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
];
if (memberIntentEnabled) {
  intents.push(GatewayIntentBits.GuildMembers);
}

const client = new Client({ intents });

client.once(Events.ClientReady, async (readyClient) => {
  try {
    await loadGuildSettings();
    await readyClient.application.commands.set(commandDefinitions);
    console.log(
      `hEmEttv2 is online as ${readyClient.user.tag}; registered ${commandDefinitions.length} slash commands.`,
    );

    if (!ownerId) {
      console.warn("OWNER_ID is not configured; the owner-only /owner command is disabled.");
    }
    if (!memberIntentEnabled) {
      console.warn(
        "Anti-raid join detection is disabled. Enable Server Members Intent and set ENABLE_MEMBER_INTENT=true to turn it on.",
      );
    }
  } catch (error) {
    console.error("Bot startup failed while loading settings or registering commands:", error);
    await readyClient.destroy();
    process.exitCode = 1;
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  const handler = commandHandlers.get(interaction.commandName);
  if (!handler) {
    return;
  }

  try {
    await handler(interaction, {
      client,
      ownerId,
      commandDefinitions,
      commandAssistantMetadata,
    });
  } catch (error) {
    console.error(`Command /${interaction.commandName} failed:`, error);
    const response = {
      content: "The command could not be completed. Check the bot's permissions and try again.",
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    };

    if (interaction.deferred) {
      await interaction.editReply({
        content: response.content,
        allowedMentions: response.allowedMentions,
      }).catch((replyError) => {
        console.error("Could not send the command error response:", replyError);
      });
    } else if (interaction.replied) {
      await interaction.followUp(response).catch((replyError) => {
        console.error("Could not send the command error response:", replyError);
      });
    } else {
      await interaction.reply(response).catch((replyError) => {
        console.error("Could not send the command error response:", replyError);
      });
    }
  }
});

client.on(Events.MessageCreate, (message) => {
  handleMessageCreate(message, { ownerId }).catch((error) => {
    console.error("Anti-spam handler failed:", error);
  });
});

client.on(Events.GuildMemberAdd, (member) => {
  handleGuildMemberAdd(member, { ownerId }).catch((error) => {
    console.error("Anti-raid handler failed:", error);
  });
});

client.on(Events.Error, (error) => {
  console.error("Discord client error:", error);
});

client.login(token).catch((error) => {
  console.error("Could not connect to Discord. Check DISCORD_TOKEN and the bot application:", error);
  process.exitCode = 1;
});
