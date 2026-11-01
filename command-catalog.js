const {
  ApplicationCommandOptionType,
  PermissionsBitField,
} = require("discord.js");

const permissionTranslations = {
  Administrator: "Yönetici",
  "Ban Members": "Üyeleri Yasakla",
  "Kick Members": "Üyeleri At",
  "Manage Messages": "Mesajları Yönet",
  "Moderate Members": "Üyelere Zaman Aşımı Uygula",
  "View Channel": "Kanalı Görüntüle",
  "Send Messages": "Mesaj Gönder",
  "Embed Links": "Bağlantı Yerleştir",
  BanMembers: "Üyeleri Yasakla",
  KickMembers: "Üyeleri At",
  ManageGuild: "Sunucuyu Yönet",
  ManageMessages: "Mesajları Yönet",
  ModerateMembers: "Üyelere Zaman Aşımı Uygula",
};

function translatePermission(permission) {
  return (
    permissionTranslations[permission] ??
    permission.replace(/([a-z])([A-Z])/g, "$1 $2")
  );
}

function getUserPermissions(definition) {
  if (definition.default_member_permissions == null) {
    return [];
  }

  try {
    return new PermissionsBitField(
      BigInt(definition.default_member_permissions),
    )
      .toArray()
      .map(translatePermission);
  } catch {
    return [];
  }
}

function exampleValue(option) {
  if (Array.isArray(option.choices) && option.choices.length > 0) {
    return String(option.choices[0].value);
  }

  if (
    option.type === ApplicationCommandOptionType.User ||
    option.name === "user"
  ) {
    return "@kullanıcı";
  }
  if (option.type === ApplicationCommandOptionType.Channel) {
    return "#moderasyon";
  }
  if (option.name === "question") {
    return '"Bir komut nasıl kullanılır?"';
  }
  if (option.name === "message") {
    return '"Örnek mesaj"';
  }
  if (option.name === "reason") {
    return '"Kural ihlali"';
  }
  if (option.name === "duration") {
    return "10m";
  }
  if (option.type === ApplicationCommandOptionType.Integer) {
    if (option.name.includes("spam-limit")) return "7";
    if (option.name.includes("raid-join-limit")) return "8";
    if (option.name.includes("timeout-minutes")) return "5";
    return String(option.min_value ?? 1);
  }
  if (option.type === ApplicationCommandOptionType.String) {
    return '"örnek"';
  }
  return `<${option.name}>`;
}

function buildExample(definition) {
  const options = Array.isArray(definition.options) ? definition.options : [];
  const required = options.filter((option) => option.required);
  const optional = options.filter((option) => !option.required);
  const selected = [...required, ...optional.slice(0, Math.max(0, 3 - required.length))]
    .slice(0, 3);
  const argumentsText = selected
    .map((option) => `${option.name}:${exampleValue(option)}`)
    .join(" ");

  return argumentsText
    ? `/${definition.name} ${argumentsText}`
    : `/${definition.name}`;
}

function buildCommandCatalog(
  commandDefinitions,
  commandAssistantMetadata,
  { ownerConfigured, callerIsOwner },
) {
  return commandDefinitions.map((definition) => {
    const metadata =
      commandAssistantMetadata.get(definition.name) ?? {};
    const ownerOnly = metadata.ownerOnly === true;
    const userPermissions = getUserPermissions(definition);
    const options = (definition.options ?? []).map((option) => ({
      name: option.name,
      description: option.description,
      required: option.required === true,
      type: option.type,
      choices: option.choices?.map((choice) => choice.value),
      min: option.min_value,
      max: option.max_value,
    }));

    return {
      name: definition.name,
      description: definition.description,
      options,
      example: buildExample(definition),
      userPermissions: ownerOnly
        ? [
            ownerConfigured
              ? "Yalnızca OWNER_ID ile tanımlı bot sahibi"
              : "OWNER_ID ayarlanana kadar kullanılamaz",
          ]
        : userPermissions.length > 0
          ? userPermissions
          : ["Ek kullanıcı yetkisi gerekmiyor"],
      botPermissions: (metadata.botPermissions ?? []).map(translatePermission),
      notes: metadata.notes ?? [],
      ownerOnly,
      ownerConfigured: ownerOnly ? ownerConfigured : null,
      callerIsOwner: ownerOnly ? callerIsOwner : null,
      canRecommend:
        !ownerOnly || (ownerConfigured && callerIsOwner),
    };
  });
}

module.exports = {
  buildCommandCatalog,
};
