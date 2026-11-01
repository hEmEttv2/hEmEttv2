const utility = require("./utility");
const moderation = require("./moderation");
const protectionSettings = require("./protection-settings");
const owner = require("./owner");
const helpai = require("./helpai");

const builders = [
  ...utility.commandBuilders,
  ...moderation.commandBuilders,
  protectionSettings.commandBuilder,
  owner.commandBuilder,
  helpai.commandBuilder,
];

const commandDefinitions = builders.map((builder) => builder.toJSON());
const commandHandlers = new Map([
  ...utility.commandHandlers,
  ...moderation.commandHandlers,
  ["protection-settings", protectionSettings.commandHandler],
  ["owner", owner.commandHandler],
  ["helpai", helpai.commandHandler],
]);

const commandAssistantMetadata = new Map([
  [
    "ping",
    {
      botPermissions: ["Komut yanıtı için kanal erişimi"],
      notes: ["Botu kontrol eder ve 'Pong! Bot aktif.' yanıtını verir."],
    },
  ],
  ["help", { botPermissions: ["Komut yanıtı için kanal erişimi"] }],
  [
    "helpai",
    {
      botPermissions: ["Komut yanıtı için kanal erişimi"],
      notes: ["Kayıtlı komutları açıklar; hiçbir komutu çalıştırmaz."],
    },
  ],
  [
    "say",
    {
      botPermissions: ["View Channel", "Send Messages"],
      notes: ["Gönderilen içerikte kullanıcı etiketleri bildirim oluşturmaz."],
    },
  ],
  [
    "announce",
    {
      botPermissions: ["View Channel", "Send Messages", "Embed Links"],
      notes: ["Gönderilen içerikte kullanıcı etiketleri bildirim oluşturmaz."],
    },
  ],
  ["serverinfo", { botPermissions: ["Komut yanıtı için kanal erişimi"] }],
  ["userinfo", { botPermissions: ["Komut yanıtı için kanal erişimi"] }],
  [
    "ban",
    {
      botPermissions: ["Ban Members"],
      notes: ["Botun rolü hedef üyenin rolünden yüksek olmalı."],
    },
  ],
  [
    "kick",
    {
      botPermissions: ["Kick Members"],
      notes: ["Botun rolü hedef üyenin rolünden yüksek olmalı."],
    },
  ],
  [
    "timeout",
    {
      botPermissions: ["Moderate Members"],
      notes: [
        "Botun rolü hedef üyenin rolünden yüksek olmalı.",
        "Süre en fazla 28 gündür; s, m, h veya d kullanılır.",
      ],
    },
  ],
  [
    "clear",
    {
      botPermissions: ["Manage Messages"],
      notes: ["Discord 14 günden eski mesajları toplu silmez."],
    },
  ],
  [
    "setlogchannel",
    { botPermissions: ["View Channel", "Send Messages", "Embed Links"] },
  ],
  [
    "protection-settings",
    { botPermissions: ["Komut yanıtı için kanal erişimi"] },
  ],
  [
    "owner",
    {
      ownerOnly: true,
      botPermissions: ["Komut yanıtı için kanal erişimi"],
      notes: [
        "OWNER_ID ayarlanmış olmalı.",
        "Bot etiketini, sunucu sayısını, ağ geçidi gecikmesini ve çalışma süresini gösterir.",
      ],
    },
  ],
]);

module.exports = {
  commandAssistantMetadata,
  commandDefinitions,
  commandHandlers,
};
