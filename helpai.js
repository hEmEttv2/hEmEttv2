const {
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
} = require("discord.js");
const { buildCommandCatalog } = require("../ai/command-catalog");
const { getCommandAssistance } = require("../ai/xai-assistant");
const { createEmbed } = require("../embeds");
const {
  deferEphemeralReply,
  replyEmbed,
} = require("./helpers");

const REQUEST_LIMIT = 5;
const REQUEST_WINDOW_MS = 60_000;
const requestTimesByUser = new Map();

const commandBuilder = new SlashCommandBuilder()
  .setName("helpai")
  .setDescription("Komutlar hakkında Türkçe yardım al veya hataları çöz.")
  .setContexts(InteractionContextType.Guild)
  .addStringOption((option) =>
    option
      .setName("question")
      .setDescription("Ne yapmak istiyorsun veya hangi hatayı aldın?")
      .setMaxLength(1000)
      .setRequired(true),
  );

function isRateLimited(userId) {
  const now = Date.now();
  const recentRequests = (requestTimesByUser.get(userId) ?? []).filter(
    (timestamp) => now - timestamp < REQUEST_WINDOW_MS,
  );

  if (recentRequests.length >= REQUEST_LIMIT) {
    requestTimesByUser.set(userId, recentRequests);
    return true;
  }

  recentRequests.push(now);
  requestTimesByUser.set(userId, recentRequests);

  if (requestTimesByUser.size > 2000) {
    for (const [id, timestamps] of requestTimesByUser) {
      if (timestamps.every((timestamp) => now - timestamp >= REQUEST_WINDOW_MS)) {
        requestTimesByUser.delete(id);
      }
    }
  }
  return false;
}

function truncate(text, maxLength) {
  return text.length > maxLength
    ? `${text.slice(0, maxLength - 1)}…`
    : text;
}

function buildRecommendationField(command, recommendation) {
  const userPermissions = truncate(command.userPermissions.join(", "), 100);
  const botPermissions = truncate(
    command.botPermissions.length > 0
      ? command.botPermissions.join(", ")
      : "Ek bot yetkisi belirtilmemiş",
    100,
  );
  const lines = [
    truncate(recommendation.explanation, 140),
    `Örnek: \`${truncate(command.example, 110)}\``,
    `Yetki — sen: ${userPermissions}; bot: ${botPermissions}.`,
  ];

  if (command.notes.length > 0) {
    lines.push(`Not: ${truncate(command.notes.join(" "), 100)}`);
  }

  return {
    name: `/${command.name}`,
    value: truncate(lines.join("\n"), 900),
  };
}

function splitIntoPages(items, pageSize) {
  const pages = [];
  for (let index = 0; index < items.length; index += pageSize) {
    pages.push(items.slice(index, index + pageSize));
  }
  return pages;
}

async function commandHandler(
  interaction,
  { ownerId, commandDefinitions, commandAssistantMetadata },
) {
  await deferEphemeralReply(interaction);

  if (isRateLimited(interaction.user.id)) {
    await replyEmbed(
      interaction,
      createEmbed(
        "Biraz bekleyin",
        "AI yardım isteği sınırına ulaştınız. Bir dakika sonra tekrar deneyin.",
      ),
    );
    return;
  }

  const catalog = buildCommandCatalog(
    commandDefinitions,
    commandAssistantMetadata,
    {
      ownerConfigured: Boolean(ownerId),
      callerIsOwner: Boolean(ownerId && interaction.user.id === ownerId),
    },
  );

  try {
    const result = await getCommandAssistance(
      interaction.options.getString("question", true),
      catalog,
    );
    const catalogByName = new Map(
      catalog.map((command) => [command.name, command]),
    );
    const recommendations = result.recommendations
      .map((recommendation) => ({
        recommendation,
        command: catalogByName.get(recommendation.commandName),
      }))
      .filter((item) => item.command);

    if (recommendations.length === 0) {
      const embed = createEmbed("hEmEttv2 • Komut Asistanı", result.answer)
        .addFields(
          {
            name: "Komut önerisi",
            value: "Bu istek için uygun bir kayıtlı komut bulamadım. İsteğinizi veya gördüğünüz hatayı biraz daha ayrıntılı yazın.",
          },
          {
            name: "Önemli",
            value: "Bu asistan komutları çalıştırmaz. Moderasyon işlemleri için önerilen slash komutunu kendiniz çalıştırmalısınız.",
          },
        );
      await replyEmbed(interaction, embed);
      return;
    }

    const recommendationPages = splitIntoPages(recommendations, 7);
    const firstEmbed = createEmbed("hEmEttv2 • Komut Asistanı", result.answer)
      .addFields(
        recommendationPages[0].map(({ recommendation, command }) =>
          buildRecommendationField(command, recommendation),
        ),
      )
      .addFields({
        name: "Önemli",
        value: "Bu asistan komutları çalıştırmaz. Moderasyon işlemleri için önerilen slash komutunu kendiniz çalıştırmalısınız.",
      });
    await replyEmbed(interaction, firstEmbed);

    for (const page of recommendationPages.slice(1)) {
      const nextEmbed = createEmbed(
        "hEmEttv2 • Komut Asistanı • Devam",
        "İsteğinizle eşleşen diğer kayıtlı komutlar:",
      ).addFields(
        page.map(({ recommendation, command }) =>
          buildRecommendationField(command, recommendation),
        ),
      );
      await interaction.followUp({
        embeds: [nextEmbed],
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
    }
  } catch (error) {
    console.error("AI command assistant request failed:", error.message);
    await replyEmbed(
      interaction,
      createEmbed(
        "AI yardımı şu anda kullanılamıyor",
        "AI yardımı şu anda kullanılamıyor. Bot sahibi xAI bağlantısını Replit Integrations bölümünden yeniledikten sonra tekrar deneyin.",
      ),
    );
  }
}

module.exports = {
  commandBuilder,
  commandHandler,
};
