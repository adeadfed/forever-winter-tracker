import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist");
const context = vm.createContext({ window: {} });
vm.runInContext(fs.readFileSync(path.join(dist, "data.js"), "utf8"), context);

const {
  QUEST_LINES, RADIANT_QUESTS, KEEP_ITEMS, QUEST_GIVERS, ITEM_ICON_ALIASES, DATA_META,
  QUESTLINE_GATES, CAMPAIGN_MAP_NODES, QUESTLINE_ITEM_NAMES, HIDEOUT_UPGRADES, ASSET_PATHS,
  QUESTLINE_APPEARANCE_ORDER, INNARDS_FAMILIES,
  ITEM_NAME_ALIASES, CRAFTING_RECIPES, CRAFTING_STATIONS,
} = context.window;
const chainQuests = QUEST_LINES.flatMap((line) => line.quests);
const quests = [...chainQuests, ...RADIANT_QUESTS];
const ids = quests.map((quest) => quest.id);
const idSet = new Set(ids);

assert.equal(QUEST_LINES.length, 14, "expected every curated questline and both Lordoss parts");
assert.deepEqual(Array.from(QUEST_LINES, (line) => line.id), Array.from(QUESTLINE_APPEARANCE_ORDER), "questline selector must follow campaign appearance order");
assert.equal(chainQuests.length, 100, "unexpected chain quest count");
assert.equal(RADIANT_QUESTS.length, 87, "unexpected radiant quest count");
assert.equal(quests.length, 187, "expected all quest pages from the wiki category (excluding utility pages)");
assert.equal(KEEP_ITEMS.length, 62, "unexpected keep-item count");
assert.equal(HIDEOUT_UPGRADES.length, 36, "unexpected Innards upgrade count");
assert.equal(CRAFTING_RECIPES.length, 96, "unexpected crafting recipe count");
assert.equal(idSet.size, ids.length, "quest IDs must be unique");
assert.ok(DATA_META.source.startsWith("https://theforeverwinter.wiki.gg/wiki/"));

for (const quest of quests) {
  assert.ok(quest.wiki.startsWith("https://theforeverwinter.wiki.gg/wiki/"), `${quest.name} has an invalid wiki link`);
  assert.ok(quest.name && quest.faction && quest.location && quest.objective, `${quest.name || quest.id} lacks display data`);
  for (const requirement of quest.requires) {
    assert.ok(idSet.has(requirement), `${quest.name} requires missing quest ${requirement}`);
  }
}

for (const quest of RADIANT_QUESTS) {
  assert.equal(quest.radiant, true, `${quest.name} must be marked radiant`);
  assert.deepEqual(Array.from(quest.requires), [], `${quest.name} must not affect questline unlocks`);
  assert.equal(quest.lineId, "radiant");
  assert.ok(["Scavengers", "Europa", "Eurasia", "Euruska"].includes(quest.faction), `${quest.name} has no canonical reputation faction`);
  assert.ok(quest.provider && quest.provider !== "Rotating contract", `${quest.name} has no issuing faction or questgiver`);
}

const tutorial = QUEST_LINES.find((entry) => entry.id === "tutorial");
const tutorialById = new Map(tutorial.quests.map((entry) => [entry.id, entry]));
assert.deepEqual(Array.from(tutorialById.get("toyetic-action").requires), ["roll-deep"], "optional TV construction must not gate Toyetic Action");
assert.equal(tutorialById.get("cathode-hearth").optional, true, "Cathode Hearth must be an optional tutorial side quest");
const optionalTutorialIds = new Set(tutorial.quests.filter((entry) => entry.optional).map((entry) => entry.id));
for (const entry of tutorial.quests.filter((quest) => !quest.optional)) {
  assert.equal(entry.requires.some((id) => optionalTutorialIds.has(id)), false, `${entry.name} must not depend on an optional tutorial quest`);
}
const lordossCigarettes = QUEST_LINES.find((entry) => entry.id === "lordoss-cigarettes");
const lordossRestoration = QUEST_LINES.find((entry) => entry.id === "lordoss-restoration");
assert.equal(lordossCigarettes.quests.length, 10, "Lordoss I must contain the ten cigarette quests");
assert.equal(lordossRestoration.quests.length, 7, "Lordoss II must contain the seven restoration quests");
assert.deepEqual(Array.from(QUESTLINE_GATES["lordoss-cigarettes"].requiresUpgrades), [], "Lordoss I must not require the Bar");
assert.deepEqual(Array.from(QUESTLINE_GATES["lordoss-restoration"].requiresUpgrades), [], "Lordoss II must not require the Bar");
assert.deepEqual(Array.from(QUESTLINE_GATES["lordoss-restoration"].requiresLines), ["lordoss-cigarettes"], "Lordoss II must unlock after Lordoss I");
assert.deepEqual(Array.from(QUEST_LINES.find((entry) => entry.id === "transmission-tower").quests.find((entry) => entry.id === "transmission-tower-pt-3").requires), ["transmission-tower-pt-2", "giants-senses"], "Lordoss must rejoin the Bar/Tower story at Transmission Tower Pt. 3");

for (const quest of chainQuests) assert.equal(quest.radiant, false, `${quest.name} must be a questline node`);
for (const line of QUEST_LINES) {
  assert.ok(QUEST_GIVERS[line.id]?.length, `${line.name} must display at least one questgiver icon`);
  assert.ok(QUESTLINE_GATES[line.id], `${line.name} must have a line gate`);
}
assert.ok(Object.keys(ITEM_ICON_ALIASES).length >= 10, "item icon aliases are unexpectedly sparse");
assert.ok(Object.keys(ITEM_NAME_ALIASES).length >= 8, "inventory canonical-name aliases are incomplete");
assert.ok(Object.keys(QUESTLINE_ITEM_NAMES).length >= 8, "questline item shelves are unexpectedly sparse");

const partNumbers = (specification) => {
  const numbers = new Set();
  specification.split(/\s*,\s*/).forEach((token) => {
    const range = token.match(/^(\d+)\s*[–—-]\s*(\d+)$/);
    if (range) for (let number = Number(range[1]); number <= Number(range[2]); number += 1) numbers.add(number);
    else {
      const single = token.match(/\d+/);
      if (single) numbers.add(Number(single[0]));
    }
  });
  return numbers;
};
const requirementMatchesQuest = (requirement, questName) => {
  if (requirement === questName) return true;
  const requirementParts = requirement.match(/^(.*?)\s+Pt\.\s+(.+)$/);
  const questParts = questName.match(/^(.*?)\s+Pt\.\s+(\d+)$/);
  return Boolean(requirementParts && questParts && requirementParts[1] === questParts[1]
    && partNumbers(requirementParts[2]).has(Number(questParts[2])));
};
for (const line of QUEST_LINES) {
  for (const itemName of QUESTLINE_ITEM_NAMES[line.id] ?? []) {
    const item = KEEP_ITEMS.find((entry) => entry.name === itemName);
    assert.ok(item, `${line.name} references missing tracked item ${itemName}`);
    assert.ok(line.quests.some((quest) => item.quests.some((requirement) => requirementMatchesQuest(requirement, quest.name))), `${itemName} has no matching node in ${line.name}`);
  }
}

const canonicalItem = (name) => ITEM_NAME_ALIASES[name] ?? name;
assert.equal(new Set(KEEP_ITEMS.map((item) => canonicalItem(item.name))).size, KEEP_ITEMS.length, "quest inventory contains duplicate canonical items");
const clampQuestNeed = KEEP_ITEMS.find((item) => item.name === "Clamp")?.needed ?? 0;
const clampUpgradeNeed = HIDEOUT_UPGRADES.flatMap((entry) => entry.items).filter((item) => canonicalItem(item.name) === "Clamp").reduce((sum, item) => sum + item.needed, 0);
assert.equal(clampQuestNeed + clampUpgradeNeed, 11, "Clamp requirements must merge into one plan total");

assert.deepEqual(Array.from(CRAFTING_STATIONS), ["Munitions Printer", "Workshop", "Repair Bench", "Special Projects"], "crafting stations must follow the in-game terminal order");
assert.equal(new Set(CRAFTING_RECIPES.map((recipe) => recipe.id)).size, CRAFTING_RECIPES.length, "crafting recipe IDs must be unique");
for (const recipe of CRAFTING_RECIPES) {
  assert.ok(CRAFTING_STATIONS.includes(recipe.station), `${recipe.product} has an unknown crafting station`);
  assert.ok(recipe.product && Number.isInteger(recipe.output) && recipe.output > 0 && recipe.time, `${recipe.id} lacks recipe output data`);
  assert.ok(recipe.wiki.startsWith("https://theforeverwinter.wiki.gg/wiki/"), `${recipe.product} has an invalid wiki link`);
  assert.ok(recipe.ingredients.length, `${recipe.product} has no ingredients`);
  for (const ingredient of recipe.ingredients) {
    assert.ok(ingredient.name && Number.isInteger(ingredient.needed) && ingredient.needed > 0, `${recipe.product} has an invalid ingredient`);
  }
}

const upgradeIds = new Set(HIDEOUT_UPGRADES.map((upgrade) => upgrade.id));
assert.equal(upgradeIds.size, HIDEOUT_UPGRADES.length, "Innards upgrade IDs must be unique");
assert.deepEqual(new Set(HIDEOUT_UPGRADES.map((upgrade) => upgrade.category)), new Set(["Terminal", "Welfare"]), "Innards must match the two in-game columns");
assert.equal(INNARDS_FAMILIES.length, 16, "unexpected Innards family count");
assert.equal(INNARDS_FAMILIES[0].category, "Terminal", "Terminal families must be ordered first");
assert.equal(INNARDS_FAMILIES.find((family) => family.category === "Welfare")?.name, "TV Screens", "TV Screens must open the Welfare column");
assert.deepEqual(new Set(INNARDS_FAMILIES.flatMap((family) => family.ids)), upgradeIds, "every Innards upgrade must belong to one family");
for (const upgrade of HIDEOUT_UPGRADES) {
  assert.ok(upgrade.name && upgrade.group && upgrade.effect && upgrade.family, `${upgrade.id} lacks display data`);
  assert.ok(Number.isInteger(upgrade.tier) && upgrade.tier >= 1, `${upgrade.name} has an invalid tier`);
  if (upgrade.prerequisite) {
    assert.ok(upgradeIds.has(upgrade.prerequisite), `${upgrade.name} has a missing prerequisite`);
    const previous = HIDEOUT_UPGRADES.find((candidate) => candidate.id === upgrade.prerequisite);
    if (previous.family === upgrade.family) assert.equal(previous.tier, upgrade.tier - 1, `${upgrade.name} must follow the immediately previous family tier`);
  }
  if (upgrade.tiered && upgrade.tier > 1) {
    const previous = HIDEOUT_UPGRADES.find((candidate) => candidate.id === upgrade.prerequisite);
    assert.equal(previous?.family, upgrade.family, `${upgrade.name} tier ${upgrade.tier} must be gated by its previous family tier`);
  }
}
for (const quest of quests) {
  for (const requirement of quest.requiresUpgrades ?? []) {
    assert.ok(upgradeIds.has(requirement), `${quest.name} requires missing Innards upgrade ${requirement}`);
  }
}
for (const asset of Object.values(ASSET_PATHS.giver)) {
  const fallback = asset.replace(/\.png$/i, ".svg");
  assert.ok(fs.existsSync(path.join(dist, asset)) || fs.existsSync(path.join(dist, fallback)), `missing local questgiver asset or fallback ${asset}`);
}
assert.equal(Object.keys(ASSET_PATHS.faction).length, 4, "all major faction icon paths must be declared");
assert.equal(ASSET_PATHS.giver.Lordoss, "assets/portraits/vladelets.png", "Lordoss must render the full portrait, not the shoulder-detail page image");
assert.ok(Object.keys(ASSET_PATHS.questgiver).length >= 13, "questgiver portrait paths are incomplete");
assert.equal(Object.keys(ASSET_PATHS.trader).length, 7, "current trader portrait paths are incomplete");
for (const asset of Object.values(ASSET_PATHS.item)) {
  assert.ok(fs.existsSync(path.join(dist, asset)), `missing local item asset ${asset}`);
}
for (const asset of Object.values(ASSET_PATHS.upgrade)) {
  assert.ok(fs.existsSync(path.join(dist, asset)), `missing local Innards asset ${asset}`);
}

const html = fs.readFileSync(path.join(dist, "index.html"), "utf8");
const css = fs.readFileSync(path.join(dist, "styles.css"), "utf8");
const app = fs.readFileSync(path.join(dist, "app.js"), "utf8");
const standalone = fs.readFileSync(path.join(dist, "standalone.html"), "utf8");
for (const id of ["questLines", "campaignMap", "lineItems", "clearItemFocus", "hideoutGrid", "craftingGrid", "craftingStationFilter", "radiantGrid", "radiantFactionFilter", "radiantSort", "itemsGrid", "searchInput", "resetProgress"]) {
  assert.ok(html.includes(`id="${id}"`), `missing required UI target #${id}`);
}
assert.ok(html.indexOf('src="data.js"') < html.indexOf('src="app.js"'), "quest data must load before app logic");
assert.match(css, /@media \(max-width: \d+px\)/, "mobile layout is missing");
assert.ok(css.includes(":focus-visible"), "keyboard focus treatment is missing");
assert.ok(app.includes("localStorage"), "local persistence is missing");
assert.ok(app.includes("pruneInvalidCompletions"), "dependency reset protection is missing");
assert.ok(app.includes("computeGraph"), "dependency graph layout is missing");
assert.ok(app.includes("graph-edge"), "SVG dependency arrows are missing");
assert.ok(app.includes("giver-portrait"), "questgiver portraits are missing");
assert.ok(app.includes("item-icon"), "item icons are missing");
assert.ok(app.includes("isLineUnlocked"), "questline locking is missing");
assert.ok(app.includes("renderCampaignMap"), "cross-questline overview is missing");
assert.ok(app.includes("renderHideout"), "Innards upgrade cards are missing");
assert.ok(app.includes("renderCrafting"), "crafting recipe cards are missing");
assert.ok(app.includes("fitGraph"), "responsive quest-tree fitting is missing");
assert.ok(app.includes("radiant-faction-icon"), "radiant faction icons are missing");
assert.equal(CAMPAIGN_MAP_NODES.filter((node) => node.kind === "line").length, QUEST_LINES.length, "campaign overview must contain every questline");
assert.ok(CAMPAIGN_MAP_NODES.some((node) => node.ref === "bar-v3"), "campaign overview must expose the Bar V3 gate");
assert.ok(CAMPAIGN_MAP_NODES.some((node) => node.ref === "transmission-tower-build"), "campaign overview must expose the Transmission Tower build gate");
assert.equal(CAMPAIGN_MAP_NODES.find((node) => node.ref === "tutorial")?.column, 0, "the tutorial must be the opening campaign column");
assert.equal(CAMPAIGN_MAP_NODES.find((node) => node.ref === "tutorial")?.starting, true, "The Long Road In must be visually marked as the starting questline");
assert.ok(CAMPAIGN_MAP_NODES.some((node) => node.ref === "lordoss-cigarettes"), "campaign overview must show Lordoss I");
assert.ok(CAMPAIGN_MAP_NODES.some((node) => node.ref === "lordoss-restoration"), "campaign overview must show Lordoss II");
const campaignSlots = new Set(CAMPAIGN_MAP_NODES.map((node) => `${node.column}:${node.row}`));
assert.equal(campaignSlots.size, CAMPAIGN_MAP_NODES.length, "campaign cards must not share a layout slot");
assert.ok(CAMPAIGN_MAP_NODES.find((node) => node.ref === "railgun")?.column > 0, "Railgun must not appear in the opening campaign column");
const scraper = fs.readFileSync(path.join(root, "scripts", "scrape_wiki_assets.py"), "utf8");
assert.ok(scraper.includes("Mozilla/5.0") && scraper.includes("MediaWiki"), "local wiki scraper must use browser headers and the MediaWiki API");
assert.ok(scraper.includes("image/png,image/jpeg"), "local wiki scraper must request original PNG/JPEG responses");
assert.ok(scraper.includes("discover_item_targets") && scraper.includes("wiki-source-urls.json"), "wiki scraper must discover tracked items and retain resolved source URLs");
assert.ok(scraper.includes("window.CRAFTING_RECIPES") && scraper.includes("craftingRecipe"), "wiki scraper must discover crafting products and ingredients");
assert.ok(scraper.includes("default=5.0") && scraper.includes("time.sleep"), "wiki scraper must wait five seconds between network requests by default");
assert.ok(scraper.includes("ВЛАДЕЛЕЦ Vladelets Euruska Quest Giver.png"), "Lordoss must use the full questgiver portrait instead of the shoulder detail");
for (const group of ["items", "factions", "questgivers", "traders"]) assert.ok(scraper.includes(`"${group}"`), `wiki scraper is missing the ${group} group`);
assert.ok(!app.includes("resolveWikiItemIcon") && !app.includes("fetch(`https://theforeverwinter.wiki.gg"), "the app must use reproducible local scraped icons instead of browser-side wiki requests");
assert.ok(!app.includes("const glyphs"), "generic item glyph fallback must not return");
assert.ok(standalone.includes("<style>"), "standalone edition must inline its styles");
assert.ok(standalone.includes("window.QUEST_LINES"), "standalone edition must inline quest data");
assert.ok(standalone.includes("fwQuestTracker.v3"), "standalone edition must inline app behavior");
assert.ok(!standalone.includes('src="app.js"'), "standalone edition must not depend on app.js");
assert.ok(!standalone.includes('href="styles.css"'), "standalone edition must not depend on styles.css");

const hosting = JSON.parse(fs.readFileSync(path.join(root, ".openai", "hosting.json"), "utf8"));
assert.ok(hosting.project_id, "Sites project ID is missing");
assert.equal(hosting.static.directory, "dist");

console.log(`Validated ${quests.length} quests, ${QUEST_LINES.length} questlines, ${HIDEOUT_UPGRADES.length} Innards upgrades, ${CRAFTING_RECIPES.length} recipes, and ${KEEP_ITEMS.length} quest items.`);
