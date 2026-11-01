let connectorsPromise;
let modelIdPromise;

const responseSchema = {
  type: "json_schema",
  json_schema: {
    name: "discord_command_assistance",
    strict: true,
    schema: {
      type: "object",
      properties: {
        answer: { type: "string" },
        recommendations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              commandName: { type: "string" },
              explanation: { type: "string" },
            },
            required: ["commandName", "explanation"],
            additionalProperties: false,
          },
        },
      },
      required: ["answer", "recommendations"],
      additionalProperties: false,
    },
  },
};

async function getConnectors() {
  if (!connectorsPromise) {
    connectorsPromise = import("@replit/connectors-sdk").then(
      ({ ReplitConnectors }) => new ReplitConnectors(),
    ).catch((error) => {
      connectorsPromise = null;
      throw error;
    });
  }
  return connectorsPromise;
}

async function requestJson(path, options = {}) {
  const connectors = await getConnectors();
  const response = await connectors.proxy("xai", path, {
    ...options,
    signal: options.signal ?? AbortSignal.timeout(25_000),
  });
  const responseText = await response.text();
  let body;

  try {
    body = responseText ? JSON.parse(responseText) : {};
  } catch {
    body = null;
  }

  if (!response.ok) {
    const providerMessage =
      body?.error?.message ??
      body?.error ??
      body?.message ??
      response.statusText;
    const error = new Error(`xAI request failed with status ${response.status}: ${providerMessage}`);
    error.status = response.status;
    throw error;
  }

  if (!body || typeof body !== "object") {
    throw new Error("xAI returned an invalid response.");
  }

  return body;
}

async function discoverModelId() {
  const result = await requestJson("/v1/models", { method: "GET" });
  const models = Array.isArray(result.data) ? result.data : [];
  const candidates = models
    .map((model) => ({
      id: typeof model.id === "string" ? model.id : "",
    }))
    .filter((model) => model.id && !/image|video|embedding/i.test(model.id));

  const selected =
    candidates.find((model) => /fast|mini/i.test(model.id)) ??
    candidates[0];

  if (!selected) {
    throw new Error("xAI did not report an available text model.");
  }
  return selected.id;
}

function getModelId() {
  if (!modelIdPromise) {
    modelIdPromise = discoverModelId().catch((error) => {
      modelIdPromise = null;
      throw error;
    });
  }
  return modelIdPromise;
}

function safeText(value, fallback, maxLength) {
  if (typeof value !== "string") return fallback;
  const text = value.trim();
  if (!text || /\/[a-z][a-z0-9-]*/i.test(text)) return fallback;
  return text.slice(0, maxLength);
}

function validateAssistantResponse(parsed, commandCatalog) {
  const catalogByName = new Map(
    commandCatalog.map((command) => [command.name, command]),
  );
  const seen = new Set();
  const recommendations = [];

  for (const item of Array.isArray(parsed?.recommendations)
    ? parsed.recommendations
    : []) {
    const commandName =
      typeof item?.commandName === "string" ? item.commandName : "";
    const command = catalogByName.get(commandName);
    if (
      !command ||
      !command.canRecommend ||
      seen.has(command.name)
    ) {
      continue;
    }

    seen.add(command.name);
    recommendations.push({
      commandName: command.name,
      explanation: safeText(
        item.explanation,
        "Bu komut isteğiniz için uygun olabilir.",
        180,
      ),
    });
  }

  return {
    answer: safeText(
      parsed?.answer,
      "İsteğinize uygun kayıtlı komutları aşağıda bulabilirsiniz.",
      900,
    ),
    recommendations,
  };
}

async function getCommandAssistance(question, commandCatalog) {
  const model = await getModelId();
  const prompt = [
    "Sen hEmEttv2 Discord botunun komut yardım asistanısın.",
    "Her yanıtı sade ve anlaşılır Türkçe yaz.",
    "Yalnızca aşağıdaki JSON komut kataloğundaki komutları tanı ve öner. Katalog dışındaki bir komutu asla uydurma.",
    "Komut adlarını veya slash sözdizimini answer ya da explanation alanlarına yazma; uygulama geçerli komut adını kendisi ekleyecek.",
    "Önerilen commandName alanı katalogdaki name ile harfiyen aynı olmalı. Uygun komut yoksa recommendations boş dizi olsun.",
    "Kullanıcı bir komutun ne yaptığını sorarsa kısa açıklama ver. Hata sorarsa olası nedeni katalogdaki seçenekler ve yetkilere göre açıkla; emin değilsen tam hata metnini sor.",
    "OWNER_ID ile sınırlı ownerOnly komutunu yalnızca callerIsOwner true ve ownerConfigured true ise öner. Gerçek OWNER_ID değerini isteme, açıklama veya yanıtta gösterme.",
    "Bu asistanın hiçbir Discord komutunu çalıştırma, moderasyon API'si çağırma veya işlemin yapıldığını iddia etme yeteneği yoktur. Kullanıcı moderasyon isterse sadece uygun komutu açıkla ve kendisinin çalıştırması gerektiğini belirt.",
    "Komut örneklerini kendin yazma; uygulama katalogdaki gerçek seçeneklerden üretecek.",
    "Yanıt şeması: answer alanında kullanıcının isteğine doğrudan Türkçe yanıt; recommendations alanında 1-3 uygun komut ve her biri için ne işe yaradığını anlatan kısa Türkçe explanation. Kullanıcı açıkça tüm komutları isterse mevcut komutların hepsini önerebilirsin.",
    `Güncel komut kataloğu: ${JSON.stringify(commandCatalog)}`,
  ].join("\n");

  const result = await requestJson("/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: question },
      ],
      temperature: 0.2,
      max_completion_tokens: 1200,
      response_format: responseSchema,
    }),
  });

  const content = result.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("xAI returned no assistant text.");
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("xAI returned an invalid structured response.");
  }

  return validateAssistantResponse(parsed, commandCatalog);
}

module.exports = {
  getCommandAssistance,
  validateAssistantResponse,
};
