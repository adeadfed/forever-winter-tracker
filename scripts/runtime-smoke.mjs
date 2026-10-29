import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...values) { values.forEach((value) => this.values.add(value)); }
  remove(...values) { values.forEach((value) => this.values.delete(value)); }
  contains(value) { return this.values.has(value); }
  toggle(value, force) {
    const enabled = force === undefined ? !this.values.has(value) : Boolean(force);
    enabled ? this.values.add(value) : this.values.delete(value);
    return enabled;
  }
}

class FakeElement {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.classList = new FakeClassList();
    this.dataset = {};
    this.children = [];
    this.listeners = new Map();
    this.options = [];
    this.attributes = {};
    this.style = {
      setProperty: (name, value) => { this.style[name] = value; },
    };
    this.value = "";
    this.textContent = "";
    this.innerHTML = "";
    this.placeholder = "";
    this.className = "";
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  add(option) { this.options.push(option); }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) ?? [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }
  dispatch(type, event = {}) {
    for (const handler of this.listeners.get(type) ?? []) handler({ target: this, ...event });
  }
  closest() { return null; }
}

class FakeDocument {
  constructor() {
    this.body = new FakeElement("body");
    this.ids = new Map();
    this.groups = new Map();
    this.listeners = new Map();
  }
  register(id, element = new FakeElement()) { this.ids.set(id, element); return element; }
  setGroup(selector, elements) { this.groups.set(selector, elements); }
  querySelector(selector) { return selector.startsWith("#") ? this.ids.get(selector.slice(1)) ?? null : null; }
  querySelectorAll(selector) { return this.groups.get(selector) ?? []; }
  createElement(tagName) { return new FakeElement(tagName); }
  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) ?? [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }
  dispatch(type, target, event = {}) {
    for (const handler of this.listeners.get(type) ?? []) handler({ target, ...event });
  }
}

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist");
const document = new FakeDocument();
const ids = [
  "questLines", "radiantGrid", "itemsGrid", "craftingGrid", "searchInput", "lineFilter", "itemGroupFilter", "statusFilters",
  "linesEmpty", "radiantEmpty", "itemsEmpty", "toast", "resetProgress", "itemsReady", "itemsMissing",
  "itemsProgressText", "itemsProgressBar", "questCount", "lineCount", "itemCount", "overallPercent",
  "snapshotDate", "lineSelectWrap", "itemSelectWrap", "giverList", "lineTitle", "lineUnlock", "lineProgress",
  "lineProgressBar", "radiantProgress", "zoomLabel", "graphViewport", "hideoutGroupFilter", "hideoutSelectWrap",
  "hideoutEmpty", "hideoutProgress", "hideoutGrid", "upgradeCount", "campaignMap", "lineItems", "lineState",
  "manualLineUnlock", "collapseCampaign", "clearItemFocus",
  "radiantFactionWrap", "radiantFactionFilter", "radiantSortWrap", "radiantSort",
  "craftingEmpty", "craftingCount", "craftingStationWrap", "craftingStationFilter", "recipeCount",
  "controls", "sellSearchInput", "sellItemOptions", "sellResult",
];
ids.forEach((id) => document.register(id));

const tabs = ["lines", "hideout", "crafting", "radiant", "sell", "items"].map((view) => {
  const tab = new FakeElement("button");
  tab.dataset.view = view;
  return tab;
});
const views = ["lines", "hideout", "crafting", "radiant", "sell", "items"].map((view) => {
  const panel = new FakeElement("section");
  panel.id = `${view}View`;
  return panel;
});
const filters = ["all", "available", "locked", "complete"].map((status) => {
  const button = new FakeElement("button");
  button.dataset.status = status;
  return button;
});
document.setGroup(".tab", tabs);
document.setGroup(".view", views);
document.setGroup(".filter", filters);

const storage = new Map();
storage.set("fwQuestTracker.v3", JSON.stringify({ items: { "item-clamps": 7, "item-old-toolset": 2 } }));
const localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
};

const context = vm.createContext({
  window: {}, document, localStorage, structuredClone,
  confirm: () => true,
  setTimeout: () => 1,
  clearTimeout: () => {},
  Option: class Option { constructor(text, value) { this.text = text; this.value = value; } },
  console,
});
vm.runInContext(fs.readFileSync(path.join(dist, "data.js"), "utf8"), context);
Object.assign(context, context.window);
vm.runInContext(fs.readFileSync(path.join(dist, "app.js"), "utf8"), context);

const graphMarkup = document.ids.get("questLines").innerHTML;
assert.equal((graphMarkup.match(/class="graph-node/g) ?? []).length, 28, "selected tutorial line should render every quest node");
assert.ok((graphMarkup.match(/class="graph-edge/g) ?? []).length >= 28, "quest dependencies should render as arrow edges");
assert.ok(graphMarkup.includes("giver-root"), "questgiver root should render on the graph");
assert.ok(graphMarkup.includes('data-focus-quest-items="blue-gold"'), "quest nodes with requirements should backlink to item rows");
assert.ok(document.ids.get("lineItems").innerHTML.includes('data-focus-item="Barrel of Water"'), "questline item rows should link to graph nodes");
assert.ok(document.ids.get("lineItems").innerHTML.includes('assets/items/barrel-of-water.png'), "unmapped item art should use the stable scraper destination");
assert.ok(!document.ids.get("lineItems").innerHTML.includes("◇"), "questline items must not render generic category glyphs");
assert.equal((document.ids.get("campaignMap").innerHTML.match(/class="campaign-card/g) ?? []).length, 18, "campaign overview should render questlines and Innards gates");
assert.equal((document.ids.get("campaignMap").innerHTML.match(/class="campaign-card campaign-gate /g) ?? []).length, 4, "campaign overview should render four Innards gate nodes");
assert.ok(document.ids.get("campaignMap").innerHTML.includes("STARTING LINE"), "The Long Road In should be visibly identified as the starting line");
assert.ok(document.ids.get("campaignMap").innerHTML.includes("Lordoss I · Cigarettes"), "campaign overview should render Lordoss I");
assert.ok(document.ids.get("campaignMap").innerHTML.includes("Lordoss II · Restoration"), "campaign overview should render Lordoss II");
assert.equal((document.ids.get("radiantGrid").innerHTML.match(/class="radiant-row/g) ?? []).length, 87, "all radiant rows should render");
assert.equal((document.ids.get("radiantGrid").innerHTML.match(/class="radiant-faction-icon/g) ?? []).length, 87, "radiants should render faction icons");
assert.ok(document.ids.get("radiantGrid").innerHTML.includes("Western Embassy"), "radiants should distinguish the issuing desk from the reputation faction");
const radiantFactionFilter = document.ids.get("radiantFactionFilter");
radiantFactionFilter.value = "Euruska";
radiantFactionFilter.dispatch("change");
assert.equal((document.ids.get("radiantGrid").innerHTML.match(/class="radiant-row/g) ?? []).length, 19, "radiant faction filter should isolate the selected faction");
radiantFactionFilter.value = "all";
radiantFactionFilter.dispatch("change");
assert.ok((document.ids.get("itemsGrid").innerHTML.match(/class="item-row/g) ?? []).length > 62, "global inventory should include quests and Innards materials");
assert.equal((document.ids.get("itemsGrid").innerHTML.match(/<strong>Clamp<\/strong>/g) ?? []).length, 1, "Clamp and Clamps must render as one inventory row");
assert.ok(document.ids.get("itemsGrid").innerHTML.match(/<strong>Clamp<\/strong><small>Plan total 11<\/small>/), "Clamp total must combine quest and Innards requirements");
assert.equal((document.ids.get("hideoutGrid").innerHTML.match(/class="upgrade-card/g) ?? []).length, 36, "every Innards upgrade should render");
assert.equal((document.ids.get("hideoutGrid").innerHTML.match(/class="upgrade-category/g) ?? []).length, 2, "Innards upgrades should render in two categories");
assert.equal((document.ids.get("hideoutGrid").innerHTML.match(/class="upgrade-family"/g) ?? []).length, 16, "Innards upgrades should render as in-game families");
assert.ok(document.ids.get("hideoutGrid").innerHTML.indexOf(">Terminal<") < document.ids.get("hideoutGrid").innerHTML.indexOf(">Welfare<"), "Terminal must be the first Innards column");
assert.equal((document.ids.get("craftingGrid").innerHTML.match(/class="recipe-card/g) ?? []).length, 96, "every crafting recipe should render");
assert.ok(document.ids.get("craftingGrid").innerHTML.indexOf("Munitions Printer") < document.ids.get("craftingGrid").innerHTML.indexOf("Workshop"), "Munitions Printer must precede Workshop");
assert.ok(document.ids.get("craftingGrid").innerHTML.indexOf("Workshop") < document.ids.get("craftingGrid").innerHTML.indexOf("Repair Bench"), "Workshop must precede Repair Bench");
assert.ok(document.ids.get("craftingGrid").innerHTML.includes("Ingredient"), "recipe materials must be marked as crafting ingredients");
assert.ok(document.ids.get("itemsGrid").innerHTML.includes("Crafting ingredient"), "inventory rows must mark crafting ingredients");
const craftingStationFilter = document.ids.get("craftingStationFilter");
craftingStationFilter.value = "Repair Bench";
craftingStationFilter.dispatch("change");
assert.equal((document.ids.get("craftingGrid").innerHTML.match(/class="recipe-card/g) ?? []).length, 41, "crafting station filter should isolate Repair Bench recipes");
craftingStationFilter.value = "all";
craftingStationFilter.dispatch("change");
assert.equal(document.ids.get("questCount").textContent, 187);
assert.equal(document.ids.get("recipeCount").textContent, 96);
assert.ok(document.ids.get("sellResult").innerHTML.includes('data-sell-state="keep"'), "default sell lookup should protect a required item");
assert.ok(document.ids.get("sellResult").innerHTML.includes("Barrel of Water"), "sell lookup should render the selected item");
let saved = JSON.parse(storage.get("fwQuestTracker.v3"));
assert.equal(saved.items["item-clamp"], 7, "legacy plural item counts should migrate to the canonical inventory key");
assert.equal(saved.items["item-old-tool-set"], 2, "legacy spacing variants should migrate to the canonical inventory key");
assert.equal(saved.items["item-clamps"], undefined, "legacy duplicate inventory keys should be removed");

const clickTarget = (selector, element) => ({ closest: (query) => query === selector ? element : null });
const questButton = (id) => {
  const button = new FakeElement("button");
  button.dataset.questId = id;
  return clickTarget("[data-quest-id]", button);
};
const upgradeButton = (id) => {
  const button = new FakeElement("button");
  button.dataset.upgradeId = id;
  return clickTarget("[data-upgrade-id]", button);
};
const assertQuestStatus = (id, status) => {
  const markup = document.ids.get("questLines").innerHTML;
  const buttonIndex = markup.indexOf(`data-quest-id="${id}"`);
  assert.notEqual(buttonIndex, -1, `${id} should render in the active graph`);
  const articleIndex = markup.lastIndexOf('<article class="graph-node', buttonIndex);
  const article = markup.slice(articleIndex, buttonIndex);
  assert.ok(article.includes(`data-status="${status}"`), `${id} should be ${status}`);
};
const focusItemButton = (name) => {
  const button = new FakeElement("button");
  button.dataset.focusItem = name;
  return clickTarget("[data-focus-item]", button);
};
const focusQuestItemsButton = (id) => {
  const button = new FakeElement("button");
  button.dataset.focusQuestItems = id;
  return clickTarget("[data-focus-quest-items]", button);
};
const graphNodeFragment = (id) => {
  const markup = document.ids.get("questLines").innerHTML;
  const buttonIndex = markup.indexOf(`data-quest-id="${id}"`);
  const articleIndex = markup.lastIndexOf('<article class="graph-node', buttonIndex);
  return markup.slice(articleIndex, buttonIndex);
};

const sellSearch = document.ids.get("sellSearchInput");
sellSearch.value = "Rig Light";
sellSearch.dispatch("input");
assert.ok(document.ids.get("sellResult").innerHTML.includes('data-sell-state="sell"'), "items without tracked uses should be sellable");
assert.ok(document.ids.get("sellResult").innerHTML.includes("No tracked use"), "sellable items should identify the absence of tracked uses");
sellSearch.value = "Military Cables";
sellSearch.dispatch("input");
assert.ok(document.ids.get("sellResult").innerHTML.includes("Exo Stamina Equipment"), "sell lookup should list crafting uses");
assert.ok(document.ids.get("sellResult").innerHTML.includes("A Cost Will Be Paid Pt. 3"), "sell lookup should list quest uses");
sellSearch.value = "Clamp";
sellSearch.dispatch("input");
assert.ok(document.ids.get("sellResult").innerHTML.includes('data-sell-state="keep"'), "required stock should not be sellable");
assert.ok(document.ids.get("sellResult").innerHTML.includes(">11</strong>"), "sell lookup should reserve combined quest and Innards needs");
for (let index = 0; index < 5; index += 1) {
  const sellPlus = new FakeElement("button");
  sellPlus.dataset.itemAction = "plus";
  sellPlus.dataset.itemId = "item-clamp";
  document.dispatch("click", clickTarget("[data-item-action]", sellPlus));
}
assert.ok(document.ids.get("sellResult").innerHTML.includes('data-sell-state="sell"'), "inventory surplus should turn the item sellable");
assert.ok(document.ids.get("sellResult").innerHTML.includes("Sell 1"), "sell lookup should show the sellable surplus");
assert.ok(document.ids.get("itemsGrid").innerHTML.includes('value="12" data-item-input="item-clamp"'), "sell lookup counts must stay synced with global inventory");

document.dispatch("click", focusItemButton("Barrel of Water"));
assert.ok(graphNodeFragment("blue-gold").includes("is-cross-highlight"), "item links should highlight the first matching quest");
assert.ok(graphNodeFragment("surface-tension").includes("is-cross-highlight"), "shared items should highlight every matching quest");
assert.ok(graphNodeFragment("training").includes("is-cross-dimmed"), "unrelated quests should dim during item cross-reference");
assert.equal(document.ids.get("clearItemFocus").classList.contains("is-hidden"), false, "clear focus must appear while a cross-reference is active");

document.ids.get("clearItemFocus").dispatch("click");
assert.ok(!graphNodeFragment("blue-gold").includes("is-cross-highlight"), "clear focus should restore highlighted quests");
assert.ok(!graphNodeFragment("training").includes("is-cross-dimmed"), "clear focus should restore unrelated quests");
assert.equal(document.ids.get("clearItemFocus").classList.contains("is-hidden"), true, "clear focus should hide after clearing");

document.dispatch("click", focusItemButton("Barrel of Water"));
document.dispatch("click", focusItemButton("Barrel of Water"));
assert.ok(!graphNodeFragment("blue-gold").includes("is-cross-highlight"), "selecting the active item again should toggle focus off");

document.dispatch("click", focusQuestItemsButton("toyetic-action"));
assert.ok(document.ids.get("lineItems").innerHTML.match(/class="compact-item[^"]*is-cross-highlight[^>]*>[\s\S]*?data-focus-item="Toy Dinosaur"/), "quest backlinks should highlight their required item rows");
document.dispatch("keydown", document, { key: "Escape" });
assert.ok(!document.ids.get("lineItems").innerHTML.includes("is-cross-highlight"), "Escape should clear quest-to-item focus");

document.dispatch("click", questButton("training"));
saved = JSON.parse(storage.get("fwQuestTracker.v3"));
assert.equal(saved.completed.training, true, "quest completion should persist");

document.dispatch("click", questButton("guts-and-all"));
saved = JSON.parse(storage.get("fwQuestTracker.v3"));
assert.equal(saved.completed["guts-and-all"], true, "unlocked child should be completable");

document.dispatch("click", questButton("training"));
saved = JSON.parse(storage.get("fwQuestTracker.v3"));
assert.equal(saved.completed.training, undefined, "reopened parent should clear itself");
assert.equal(saved.completed["guts-and-all"], undefined, "reopened parent should clear dependent chain progress");

document.dispatch("click", questButton("rust-in-peace"));
saved = JSON.parse(storage.get("fwQuestTracker.v3"));
assert.deepEqual(Object.keys(saved.completed), ["rust-in-peace"], "radiant progress must remain independent of chains");

for (const id of ["bar", "bar-v1", "bar-v2", "bar-v3"]) document.dispatch("click", upgradeButton(id));
saved = JSON.parse(storage.get("fwQuestTracker.v3"));
assert.equal(saved.upgrades["bar-v3"], true, "Bar tiers should unlock in sequence");

const lineFilter = document.ids.get("lineFilter");
lineFilter.value = "transmission-tower";
lineFilter.dispatch("change");
assertQuestStatus("transmission-tower-pt-1", "available");
document.dispatch("click", questButton("transmission-tower-pt-1"));
assertQuestStatus("transmission-tower-pt-2", "locked");
document.dispatch("click", questButton("transmission-tower-pt-2"));
saved = JSON.parse(storage.get("fwQuestTracker.v3"));
assert.equal(saved.completed["transmission-tower-pt-2"], undefined, "Pt. 2 must not complete before the tower is built");

document.dispatch("click", upgradeButton("transmission-tower-build"));
assertQuestStatus("transmission-tower-pt-2", "available");
document.dispatch("click", questButton("transmission-tower-pt-2"));
saved = JSON.parse(storage.get("fwQuestTracker.v3"));
assert.equal(saved.completed["transmission-tower-pt-2"], true, "Pt. 2 should unlock after tower construction");

document.dispatch("click", upgradeButton("bar-v3"));
saved = JSON.parse(storage.get("fwQuestTracker.v3"));
assert.equal(saved.upgrades["transmission-tower-build"], undefined, "reopening Bar V3 should reset tower construction");
assert.equal(saved.completed["transmission-tower-pt-1"], undefined, "reopening Bar V3 should reset the locked campaign line");
assert.equal(saved.completed["transmission-tower-pt-2"], undefined, "reopening Bar V3 should reset downstream quest progress");

const plus = new FakeElement("button");
plus.dataset.itemAction = "plus";
plus.dataset.itemId = "item-barrel-of-water";
document.dispatch("click", clickTarget("[data-item-action]", plus));
saved = JSON.parse(storage.get("fwQuestTracker.v3"));
assert.equal(saved.items["item-barrel-of-water"], 1, "item counts should persist locally");

lineFilter.value = "trophy-room";
lineFilter.dispatch("change");
assert.equal(document.ids.get("lineTitle").textContent, "Trophy Room", "questline selector should replace the graph");
assert.equal((document.ids.get("questLines").innerHTML.match(/class="graph-node/g) ?? []).length, 9, "selected trophy line should render nine nodes");

console.log("Runtime smoke test passed: graph arrows, sell lookup and inventory sync, local wiki icons, crafting recipes, nested Innards families, tier gates, campaign locks, radiant isolation, cascade reset, and persistence.");
