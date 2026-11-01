const test = require("node:test");
const assert = require("node:assert/strict");
const {
  commandAssistantMetadata,
  commandDefinitions,
  commandHandlers,
} = require("../src/commands");
const { buildCommandCatalog } = require("../src/ai/command-catalog");
const { validateAssistantResponse } = require("../src/ai/xai-assistant");

function makeCatalog({ ownerConfigured = true, callerIsOwner = false } = {}) {
  return buildCommandCatalog(
    commandDefinitions,
    commandAssistantMetadata,
    { ownerConfigured, callerIsOwner },
  );
}

test("AI catalog is derived from all registered slash command definitions", () => {
  const catalog = makeCatalog();
  const commandNames = commandDefinitions.map(({ name }) => name);

  assert.equal(new Set(commandNames).size, commandNames.length);
  assert.equal(commandHandlers.size, commandNames.length);
  assert.deepEqual(
    catalog.map(({ name }) => name),
    commandNames,
  );
  assert.ok(catalog.some(({ name }) => name === "ping"));
  assert.ok(catalog.some(({ name }) => name === "helpai"));
});

test("usage examples include the live required options", () => {
  const catalog = makeCatalog();
  const timeout = catalog.find(({ name }) => name === "timeout");
  const helpai = catalog.find(({ name }) => name === "helpai");

  assert.match(timeout.example, /^\/timeout user:@kullanıcı duration:10m/);
  assert.equal(
    helpai.example,
    '/helpai question:"Bir komut nasıl kullanılır?"',
  );
});

test("assistant output cannot recommend unregistered or owner-only commands", () => {
  const catalog = makeCatalog({ callerIsOwner: false });
  const result = validateAssistantResponse(
    {
      answer: "Yardım burada.",
      recommendations: [
        { commandName: "helpai", explanation: "Komutları açıklar." },
        { commandName: "owner", explanation: "Sahip komutu." },
        { commandName: "invented", explanation: "Uydurma komut." },
      ],
    },
    catalog,
  );

  assert.deepEqual(
    result.recommendations.map(({ commandName }) => commandName),
    ["helpai"],
  );
});

test("owner command is only recommendable to configured owner", () => {
  const ownerCommand = (catalog) => catalog.find(({ name }) => name === "owner");

  assert.equal(ownerCommand(makeCatalog({ ownerConfigured: false })).canRecommend, false);
  assert.equal(ownerCommand(makeCatalog({ callerIsOwner: false })).canRecommend, false);
  assert.equal(
    ownerCommand(makeCatalog({ callerIsOwner: true })).canRecommend,
    true,
  );
});

test("slash command references in generated prose are replaced with a safe answer", () => {
  const result = validateAssistantResponse(
    {
      answer: "Bu işlemi /not-a-real-command ile yap.",
      recommendations: [
        { commandName: "not-a-real-command", explanation: "Uydurma." },
      ],
    },
    makeCatalog(),
  );

  assert.equal(
    result.answer,
    "İsteğinize uygun kayıtlı komutları aşağıda bulabilirsiniz.",
  );
  assert.equal(result.recommendations.length, 0);
});
