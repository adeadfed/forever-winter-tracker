(() => {
  "use strict";

  const STORAGE_KEY = "fwQuestTracker.v3";
  const NODE_WIDTH = 202;
  const NODE_HEIGHT = 70;
  const LEVEL_GAP = 248;
  const ROW_GAP = 112;
  const ROOT_X = 24;
  const FIRST_NODE_X = 212;
  const allChainQuests = QUEST_LINES.flatMap((line) => line.quests);
  const allQuests = [...allChainQuests, ...RADIANT_QUESTS];
  const questById = new Map(allQuests.map((quest) => [quest.id, quest]));
  const lineById = new Map(QUEST_LINES.map((line) => [line.id, line]));
  const upgradeById = new Map(HIDEOUT_UPGRADES.map((upgrade) => [upgrade.id, upgrade]));

  const defaultState = {
    completed: {},
    items: {},
    upgrades: {},
    unlockedLines: {},
    view: "lines",
    selectedLine: QUEST_LINES[0].id,
    campaignCollapsed: false,
  };

  let state = loadState();
  let search = "";
  let statusFilter = "all";
  let selectedItemGroup = "all";
  let selectedHideoutGroup = "all";
  let selectedRadiantFaction = "all";
  let radiantSort = "faction";
  let highlightedQuestIds = new Set();
  let highlightedItemNames = new Set();
  let zoom = 1;
  let toastTimer;

  const els = Object.fromEntries([
    "questLines", "radiantGrid", "itemsGrid", "searchInput", "lineFilter", "itemGroupFilter",
    "hideoutGroupFilter", "statusFilters", "linesEmpty", "radiantEmpty", "itemsEmpty", "hideoutEmpty",
    "toast", "lineSelectWrap", "itemSelectWrap", "hideoutSelectWrap", "giverList", "lineTitle",
    "lineUnlock", "lineState", "lineProgress", "lineProgressBar", "radiantProgress", "hideoutProgress",
    "zoomLabel", "graphViewport", "campaignMap", "lineItems", "hideoutGrid", "manualLineUnlock",
    "collapseCampaign", "clearItemFocus", "radiantFactionWrap", "radiantFactionFilter",
    "radiantSortWrap", "radiantSort",
  ].map((id) => [id.replace(/(?:^|[-_])(\w)/g, (_, c, i) => i ? c.toUpperCase() : c.toLowerCase()), document.querySelector(`#${id}`)]));

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY))
        ?? JSON.parse(localStorage.getItem("fwQuestTracker.v2"))
        ?? JSON.parse(localStorage.getItem("fwQuestTracker.v1"));
      if (!parsed || typeof parsed !== "object") return structuredClone(defaultState);
      const items = { ...(parsed.items ?? {}) };
      Object.entries(ITEM_NAME_ALIASES ?? {}).forEach(([oldName, canonicalName]) => {
        const oldId = `item-${slugLocal(oldName)}`;
        const canonicalId = inventoryId(canonicalName);
        if (items[oldId] !== undefined) items[canonicalId] = Math.max(Number(items[canonicalId]) || 0, Number(items[oldId]) || 0);
        if (oldId !== canonicalId) delete items[oldId];
      });
      const migratedSelectedLine = parsed.selectedLine === "lordoss" ? "lordoss-cigarettes" : parsed.selectedLine;
      const unlockedLines = { ...(parsed.unlockedLines ?? {}) };
      if (unlockedLines.lordoss) {
        unlockedLines["lordoss-cigarettes"] = true;
        delete unlockedLines.lordoss;
      }
      return {
        ...defaultState,
        ...parsed,
        completed: parsed.completed ?? {},
        items,
        upgrades: parsed.upgrades ?? {},
        unlockedLines,
        selectedLine: lineById.has(migratedSelectedLine) ? migratedSelectedLine : defaultState.selectedLine,
      };
    } catch {
      return structuredClone(defaultState);
    }
  }

  function saveState(message = "") {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch { showToast("Browser storage is unavailable"); return; }
    if (message) showToast(message);
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add("is-visible");
    toastTimer = setTimeout(() => els.toast.classList.remove("is-visible"), 1500);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
    })[char]);
  }

  function slugLocal(value) {
    return value.toLowerCase().normalize("NFKD").replace(/[’']/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  function canonicalItemName(name) { return ITEM_NAME_ALIASES?.[name] ?? name; }

  function questPartNumbers(specification) {
    const numbers = new Set();
    specification.split(/\s*,\s*/).forEach((token) => {
      const range = token.match(/^(\d+)\s*[–—-]\s*(\d+)$/);
      if (range) {
        for (let number = Number(range[1]); number <= Number(range[2]); number += 1) numbers.add(number);
        return;
      }
      const single = token.match(/\d+/);
      if (single) numbers.add(Number(single[0]));
    });
    return numbers;
  }

  function requirementMatchesQuest(requirement, questName) {
    if (requirement === questName) return true;
    const requirementParts = requirement.match(/^(.*?)\s+Pt\.\s+(.+)$/);
    const questParts = questName.match(/^(.*?)\s+Pt\.\s+(\d+)$/);
    return Boolean(requirementParts && questParts
      && requirementParts[1] === questParts[1]
      && questPartNumbers(requirementParts[2]).has(Number(questParts[2])));
  }

  function questIdsForItem(line, itemName) {
    const canonicalName = canonicalItemName(itemName);
    const item = KEEP_ITEMS.find((entry) => canonicalItemName(entry.name) === canonicalName);
    if (!item) return [];
    return line.quests
      .filter((quest) => item.quests.some((requirement) => requirementMatchesQuest(requirement, quest.name)))
      .map((quest) => quest.id);
  }

  function itemNamesForQuest(line, quest) {
    return (QUESTLINE_ITEM_NAMES[line.id] ?? []).filter((name) => questIdsForItem(line, name).includes(quest.id));
  }

  function clearCrossReference() {
    highlightedQuestIds = new Set();
    highlightedItemNames = new Set();
  }

  function sameSet(left, right) {
    return left.size === right.size && [...left].every((value) => right.has(value));
  }

  function clearCrossReferenceFocus() {
    if (!highlightedQuestIds.size && !highlightedItemNames.size) return;
    clearCrossReference();
    renderLines();
    showToast("Item focus cleared");
  }

  function wikiPageUrl(title) {
    return `https://theforeverwinter.wiki.gg/wiki/${encodeURIComponent(title.replaceAll(" ", "_"))}`;
  }

  function initials(value) {
    return value.replace(/\([^)]*\)/g, "").trim().split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase();
  }

  function isComplete(id) { return Boolean(state.completed[id]); }
  function isUpgradeComplete(id) { return Boolean(state.upgrades[id]); }
  function isLineComplete(id) {
    const line = lineById.get(id);
    return Boolean(line?.quests.length) && line.quests.every((quest) => isComplete(quest.id));
  }

  function gateSatisfied(lineId) {
    const gate = QUESTLINE_GATES[lineId] ?? {};
    const requiredLines = gate.requiresLines ?? [];
    const requiredUpgrades = gate.requiresUpgrades ?? [];
    const hasGate = requiredLines.length + requiredUpgrades.length > 0;
    return hasGate
      && requiredLines.every(isLineComplete)
      && requiredUpgrades.every(isUpgradeComplete);
  }

  function isLineUnlocked(lineId) {
    const gate = QUESTLINE_GATES[lineId] ?? {};
    return Boolean(gate.defaultUnlocked || state.unlockedLines[lineId] || gateSatisfied(lineId));
  }

  function questStatus(quest) {
    if (quest.radiant) return isComplete(quest.id) ? "complete" : "available";
    if (!isLineUnlocked(quest.lineId)) return "locked";
    if (isComplete(quest.id)) return "complete";
    const questsReady = quest.requires.every((id) => isComplete(id));
    const upgradesReady = (quest.requiresUpgrades ?? []).every((id) => isUpgradeComplete(id));
    return questsReady && upgradesReady ? "available" : "locked";
  }

  function upgradeStatus(upgrade) {
    if (isUpgradeComplete(upgrade.id)) return "complete";
    const upgradeReady = !upgrade.prerequisite || isUpgradeComplete(upgrade.prerequisite);
    const questReady = !upgrade.requiresQuest || isComplete(upgrade.requiresQuest);
    return upgradeReady && questReady ? "available" : "locked";
  }

  function matchesQuest(quest) {
    const statusMatches = statusFilter === "all" || questStatus(quest) === statusFilter;
    const searchMatches = !search || `${quest.name} ${quest.faction} ${quest.provider ?? ""} ${quest.location} ${quest.objective}`.toLowerCase().includes(search);
    return statusMatches && searchMatches;
  }

  function giverMarkup(giver, className) {
    const local = ASSET_PATHS.questgiver?.[giver.name] ?? ASSET_PATHS.giver[giver.name] ?? ASSET_PATHS.giver.Scavengers;
    const fallback = local.replace(/\.png$/i, ".svg");
    const display = ASSET_PATHS.portraitDisplay?.[giver.name] ?? { fit: "contain", position: "center" };
    return `<a class="${className}" href="${wikiPageUrl(giver.page)}" target="_blank" rel="noopener" title="${escapeHtml(giver.name)}" style="--portrait-fit:${display.fit};--portrait-position:${display.position}">
      <img src="${local}" data-fallback="${fallback}" onerror="this.onerror=null;this.src=this.dataset.fallback" alt="${escapeHtml(giver.name)}" loading="lazy">
      <span>${escapeHtml(giver.name)}</span><b>${escapeHtml(initials(giver.name))}</b>
    </a>`;
  }

  function computeGraph(line) {
    const ownIds = new Set(line.quests.map((quest) => quest.id));
    const levels = new Map();
    function levelOf(quest, trail = new Set()) {
      if (levels.has(quest.id)) return levels.get(quest.id);
      if (trail.has(quest.id)) return 0;
      const dependencies = quest.requires.filter((id) => ownIds.has(id)).map((id) => questById.get(id)).filter(Boolean);
      const level = dependencies.length ? Math.max(...dependencies.map((dependency) => levelOf(dependency, new Set(trail).add(quest.id)))) + 1 : 0;
      levels.set(quest.id, level);
      return level;
    }
    line.quests.forEach((quest) => levelOf(quest));
    const columns = new Map();
    line.quests.forEach((quest) => {
      const level = levels.get(quest.id);
      columns.set(level, [...(columns.get(level) ?? []), quest]);
    });
    const maxLevel = Math.max(...levels.values(), 0);
    const maxRows = Math.max(...[...columns.values()].map((column) => column.length), 1);
    const height = Math.max(480, maxRows * ROW_GAP + 150);
    const width = FIRST_NODE_X + maxLevel * LEVEL_GAP + NODE_WIDTH + 80;
    const positions = new Map();
    for (const [level, column] of columns) {
      column.forEach((quest, row) => {
        const y = height / 2 + (row - (column.length - 1) / 2) * ROW_GAP - NODE_HEIGHT / 2;
        positions.set(quest.id, { x: FIRST_NODE_X + level * LEVEL_GAP, y });
      });
    }
    return { ownIds, positions, width, height };
  }

  function edgePath(from, to) {
    const startX = from.x + (from.width ?? NODE_WIDTH);
    const startY = from.y + (from.height ?? NODE_HEIGHT) / 2;
    const endX = to.x;
    const endY = to.y + (to.height ?? NODE_HEIGHT) / 2;
    const bend = Math.max(48, (endX - startX) * .48);
    return `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`;
  }

  function edgeState(sourceId, targetQuest) {
    if (isComplete(sourceId) && isComplete(targetQuest.id)) return "is-complete";
    if (questStatus(targetQuest) !== "locked") return "is-live";
    return "";
  }

  function renderCampaignMap() {
    const cardWidth = 210;
    const cardHeight = 72;
    const columnGap = 260;
    const rowGap = 88;
    const offsetX = 28;
    const offsetY = 28;
    const positions = new Map(CAMPAIGN_MAP_NODES.map((node) => [node.id, {
      x: offsetX + node.column * columnGap,
      y: offsetY + node.row * rowGap,
      width: cardWidth,
      height: cardHeight,
    }]));
    const nodeById = new Map(CAMPAIGN_MAP_NODES.map((node) => [node.id, node]));
    const worldWidth = offsetX * 2 + (Math.max(...CAMPAIGN_MAP_NODES.map((node) => node.column)) + 1) * columnGap;
    const worldHeight = offsetY * 2 + (Math.max(...CAMPAIGN_MAP_NODES.map((node) => node.row)) + 1) * rowGap;
    const dependencyDone = (source) => source.kind === "line" ? isLineComplete(source.ref) : isUpgradeComplete(source.ref);

    const edgeParts = [];
    CAMPAIGN_MAP_NODES.forEach((target) => (target.depends ?? []).forEach((dependency) => {
      const source = nodeById.get(dependency.id);
      const from = positions.get(dependency.id);
      const to = positions.get(target.id);
      if (!source || !from || !to) return;
      const live = dependencyDone(source) ? "is-live" : "";
      const soft = dependency.hard ? "" : "is-milestone";
      const labelX = (from.x + from.width + to.x) / 2;
      const labelY = (from.y + from.height / 2 + to.y + to.height / 2) / 2 - 7;
      edgeParts.push(`<path class="campaign-edge ${live} ${soft}" d="${edgePath(from,to)}" marker-end="url(#campaign-arrow)"/><text class="campaign-edge-label" x="${labelX}" y="${labelY}">${escapeHtml(dependency.label)}</text>`);
    }));

    const cards = CAMPAIGN_MAP_NODES.map((node) => {
      const position = positions.get(node.id);
      if (node.kind === "upgrade") {
        const upgrade = upgradeById.get(node.ref);
        const status = upgradeStatus(upgrade);
        const icon = ASSET_PATHS.upgrade?.[upgrade.id];
        return `<article class="campaign-card campaign-gate ${status === "complete" ? "is-complete" : status === "locked" ? "is-locked" : "is-unlocked"}" style="left:${position.x}px;top:${position.y}px;--line-accent:#f23822">
          ${icon ? `<img class="campaign-gate-icon" src="${icon}" alt="" loading="lazy">` : ""}
          <button type="button" class="campaign-select" data-select-upgrade="${upgrade.id}">
            <span class="campaign-status">INNARDS · TIER ${upgrade.tier}</span>
            <strong>${escapeHtml(node.label ?? upgrade.name)}</strong>
            <small>${status === "complete" ? "Built" : status === "locked" ? "Locked" : "Ready to build"} · ${escapeHtml(node.detail ?? upgrade.effect)}</small>
          </button>
        </article>`;
      }
      const line = lineById.get(node.ref);
      const unlocked = isLineUnlocked(line.id);
      const complete = isLineComplete(line.id);
      const count = line.quests.filter((quest) => isComplete(quest.id)).length;
      const gate = QUESTLINE_GATES[line.id];
      const detail = node.starting ? "" : node.note ?? gate?.label ?? line.unlock;
      const detailMarkup = detail ? ` · ${escapeHtml(detail)}` : "";
      return `<article class="campaign-card ${node.starting ? "is-starting" : ""} ${unlocked ? "is-unlocked" : "is-locked"} ${complete ? "is-complete" : ""} ${state.selectedLine === line.id ? "is-selected" : ""}" style="left:${position.x}px;top:${position.y}px;--line-accent:${line.accent}">
        <button type="button" class="campaign-select" data-select-line="${line.id}">
          <span class="campaign-status">${node.starting ? "STARTING LINE" : complete ? "COMPLETE" : unlocked ? "OPEN" : "LOCKED"}</span>
          <strong>${escapeHtml(line.name)}</strong>
          <small class="${node.note ? "campaign-note" : ""}">${count}/${line.quests.length}${detailMarkup}</small>
        </button>
        ${!unlocked ? `<button class="mini-unlock" type="button" data-unlock-line="${line.id}">Override</button>` : ""}
      </article>`;
    }).join("");
    const laneDividerY = offsetY + 5.22 * rowGap;
    els.campaignMap.innerHTML = `<div class="campaign-world" style="width:${worldWidth}px;height:${worldHeight}px">
      <div class="campaign-lane-divider" style="top:${laneDividerY}px"></div>
      <svg width="${worldWidth}" height="${worldHeight}" viewBox="0 0 ${worldWidth} ${worldHeight}" aria-hidden="true"><defs><marker id="campaign-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 8 4 0 8z"/></marker></defs>${edgeParts.join("")}</svg>${cards}</div>`;
    document.querySelector(".campaign-panel")?.classList.toggle("is-collapsed", state.campaignCollapsed);
    els.collapseCampaign.textContent = state.campaignCollapsed ? "Expand" : "Collapse";
    els.collapseCampaign.setAttribute("aria-expanded", String(!state.campaignCollapsed));
  }

  function renderLines({ center = false } = {}) {
    const line = lineById.get(state.selectedLine) ?? QUEST_LINES[0];
    state.selectedLine = line.id;
    els.lineFilter.value = line.id;
    els.lineTitle.textContent = line.name;
    els.lineUnlock.textContent = line.unlock;
    const unlocked = isLineUnlocked(line.id);
    els.lineState.textContent = isLineComplete(line.id) ? "LINE COMPLETE" : unlocked ? "LINE OPEN" : `LOCKED · ${QUESTLINE_GATES[line.id]?.label ?? "Manual unlock"}`;
    els.manualLineUnlock.classList.toggle("is-hidden", unlocked);

    const completed = line.quests.filter((quest) => isComplete(quest.id)).length;
    const progress = Math.round((completed / line.quests.length) * 100);
    els.lineProgress.textContent = `${completed} / ${line.quests.length}`;
    els.lineProgressBar.style.width = `${progress}%`;
    const givers = QUEST_GIVERS[line.id] ?? [{ name: line.giver, page: "Quests" }];
    els.giverList.innerHTML = givers.map((giver) => giverMarkup(giver, "giver-chip")).join("");

    const layout = computeGraph(line);
    const roots = line.quests.filter((quest) => !quest.requires.some((id) => layout.ownIds.has(id)));
    const giverY = layout.height / 2;
    const edgeParts = [`<defs><marker id="arrow-default" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 8 4 0 8z"/></marker><marker id="arrow-live" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 8 4 0 8z"/></marker></defs>`];
    roots.forEach((quest) => {
      const status = questStatus(quest);
      edgeParts.push(`<path class="graph-edge ${status !== "locked" ? "is-live" : ""}" d="${edgePath({x:ROOT_X,y:giverY-41,width:118,height:82},layout.positions.get(quest.id))}" marker-end="url(#${status !== "locked" ? "arrow-live" : "arrow-default"})"/>`);
    });
    line.quests.forEach((quest) => {
      quest.requires.filter((id) => layout.ownIds.has(id)).forEach((id) => {
        const stateClass = edgeState(id, quest);
        edgeParts.push(`<path class="graph-edge ${stateClass}" d="${edgePath(layout.positions.get(id),layout.positions.get(quest.id))}" marker-end="url(#${stateClass ? "arrow-live" : "arrow-default"})"/>`);
      });
    });
    const nodes = line.quests.map((quest) => {
      const position = layout.positions.get(quest.id);
      const status = questStatus(quest);
      const requiredItems = itemNamesForQuest(line, quest);
      const crossClass = highlightedQuestIds.size
        ? highlightedQuestIds.has(quest.id) ? " is-cross-highlight" : " is-cross-dimmed"
        : "";
      return `<article class="graph-node${matchesQuest(quest) ? "" : " is-filtered"}${crossClass}" data-status="${status}" style="left:${position.x}px;top:${position.y}px;--line-accent:${line.accent}">
        ${quest.optional ? '<span class="node-flag is-optional">OPTIONAL</span>' : quest.phase ? `<span class="node-flag">${escapeHtml(quest.phase)}</span>` : ""}
        <button class="node-check" type="button" data-quest-id="${quest.id}" ${status === "locked" ? "disabled" : ""} aria-label="${status === "complete" ? "Mark incomplete" : "Mark complete"}: ${escapeHtml(quest.name)}"></button>
        <a class="node-link" href="${quest.wiki}" target="_blank" rel="noopener">${escapeHtml(quest.name)}</a>
        <span class="node-meta">${escapeHtml(quest.location)}</span>
        ${requiredItems.length ? `<button class="node-items" type="button" data-focus-quest-items="${quest.id}" title="${escapeHtml(requiredItems.join(" · "))}" aria-label="Show ${requiredItems.length} required item${requiredItems.length === 1 ? "" : "s"} for ${escapeHtml(quest.name)}">ITEMS <b>${requiredItems.length}</b></button>` : ""}
      </article>`;
    }).join("");
    const portraits = givers.map((giver) => giverMarkup(giver, "giver-portrait")).join("");
    const world = `<div class="graph-world" style="width:${layout.width}px;height:${layout.height}px;transform:scale(${zoom});--line-accent:${line.accent}">
      <svg class="graph-edges" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" aria-hidden="true">${edgeParts.join("")}</svg>
      <div class="giver-root" style="left:${ROOT_X}px;top:${giverY}px"><div class="giver-stack">${portraits}</div><strong>${escapeHtml(givers.map((giver)=>giver.name).join(" · "))}</strong></div>
      ${nodes}</div>`;
    els.questLines.style.width = `${layout.width * zoom}px`;
    els.questLines.style.height = `${layout.height * zoom}px`;
    els.questLines.classList.toggle("has-cross-highlight", highlightedQuestIds.size > 0);
    els.questLines.innerHTML = world;
    els.linesEmpty.classList.toggle("is-hidden", line.quests.some(matchesQuest));
    els.zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
    renderLineItems(line);
    if (center) {
      els.graphViewport.scrollLeft = 0;
      els.graphViewport.scrollTop = Math.max(0, (layout.height * zoom - els.graphViewport.clientHeight) / 2);
    }
  }

  function inventoryId(name) { return `item-${slugLocal(canonicalItemName(name))}`; }
  function itemPageName(name) { const canonical = canonicalItemName(name); return ITEM_ICON_ALIASES[canonical] ?? canonical; }
  function owned(name) { return Math.max(0, Number(state.items[inventoryId(canonicalItemName(name))]) || 0); }

  function iconKind(name, group = "") {
    const value = `${name} ${group}`.toLowerCase();
    if (/water|drink|vodka|rum|tequila|alcohol/.test(value)) return "drop";
    if (/medical|scanner|medicine|lung|spine|joint|nervous|wetware|trauma|organoid/.test(value)) return "medical";
    if (/tool|hammer|drill|pliers|clamp|wrench|screwdriver|tape/.test(value)) return "tool";
    if (/board|processor|circuit|battery|relay|software|hard drive|electronics/.test(value)) return "circuit";
    if (/cigarette|food|tin|mre|goodies/.test(value)) return "supply";
    return "component";
  }

  function itemIcon(name, group = "") {
    const canonicalName = canonicalItemName(name);
    const kind = iconKind(canonicalName, group);
    const localImage = ASSET_PATHS.item?.[canonicalName] ?? `assets/items/${slugLocal(canonicalName)}.png`;
    const content = `<img src="${localImage}" onerror="this.classList.add('is-missing')" alt="" loading="lazy">`;
    return `<a class="item-icon kind-${kind}" href="${wikiPageUrl(itemPageName(canonicalName))}" target="_blank" rel="noopener" title="${escapeHtml(canonicalName)}">${content}</a>`;
  }

  function compactItemMarkup(name, needed, note = "", questIds = []) {
    const count = owned(name);
    const ready = count >= needed;
    const id = inventoryId(name);
    const crossClass = questIds.length && highlightedItemNames.size
      ? highlightedItemNames.has(name) ? " is-cross-highlight" : " is-cross-dimmed"
      : "";
    return `<article class="compact-item ${ready ? "is-ready" : ""}${crossClass}">${itemIcon(name)}
      <div><strong>${escapeHtml(name)}</strong><small>${escapeHtml(note || `Need ${needed}`)}</small>${questIds.length ? `<button class="item-quest-link" type="button" data-focus-item="${escapeHtml(name)}" aria-label="Highlight ${questIds.length} quest${questIds.length === 1 ? "" : "s"} requiring ${escapeHtml(name)}">QUESTS <b>${questIds.length}</b></button>` : ""}</div>
      <div class="mini-count"><button type="button" data-item-action="minus" data-item-id="${id}" aria-label="Remove one ${escapeHtml(name)}">−</button><input type="number" min="0" value="${count}" data-item-input="${id}" aria-label="${escapeHtml(name)} owned"><button type="button" data-item-action="plus" data-item-id="${id}" aria-label="Add one ${escapeHtml(name)}">+</button><em>${count}/${needed}</em></div>
    </article>`;
  }

  function renderLineItems(line) {
    const names = QUESTLINE_ITEM_NAMES[line.id] ?? [];
    els.clearItemFocus.classList.toggle("is-hidden", !highlightedQuestIds.size && !highlightedItemNames.size);
    if (!names.length) {
      els.lineItems.classList.remove("has-cross-highlight");
      els.lineItems.innerHTML = `<p class="no-materials">No fixed hand-in items recorded for this line.</p>`;
      return;
    }
    els.lineItems.classList.toggle("has-cross-highlight", highlightedItemNames.size > 0);
    els.lineItems.innerHTML = names.map((name) => {
      const item = KEEP_ITEMS.find((entry) => entry.name === name);
      const questIds = questIdsForItem(line, name);
      const questNames = questIds.map((id) => questById.get(id)?.name).filter(Boolean);
      return compactItemMarkup(name, item?.needed ?? 1, questNames.join(" · ") || "Quest hand-in", questIds);
    }).join("");
  }

  function scrollQuestReferenceIntoView(questId) {
    const button = els.questLines.querySelector?.(`[data-quest-id="${questId}"]`);
    button?.closest(".graph-node")?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
  }

  function scrollItemReferenceIntoView(itemName) {
    const buttons = Array.from(els.lineItems.querySelectorAll?.("[data-focus-item]") ?? []);
    buttons.find((button) => button.dataset.focusItem === itemName)
      ?.closest(".compact-item")?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
  }

  function focusItemInGraph(itemName) {
    const line = lineById.get(state.selectedLine);
    const questIds = questIdsForItem(line, itemName);
    if (!questIds.length) return;
    const nextQuestIds = new Set(questIds);
    if (highlightedItemNames.size === 1 && highlightedItemNames.has(itemName) && sameSet(highlightedQuestIds, nextQuestIds)) {
      clearCrossReferenceFocus();
      return;
    }
    highlightedItemNames = new Set([itemName]);
    highlightedQuestIds = nextQuestIds;
    renderLines();
    scrollQuestReferenceIntoView(questIds[0]);
    showToast(`${itemName} · ${questIds.length} quest${questIds.length === 1 ? "" : "s"}`);
  }

  function focusQuestItems(questId) {
    const line = lineById.get(state.selectedLine);
    const quest = questById.get(questId);
    const itemNames = quest ? itemNamesForQuest(line, quest) : [];
    if (!quest || !itemNames.length) return;
    const nextQuestIds = new Set([questId]);
    const nextItemNames = new Set(itemNames);
    if (sameSet(highlightedQuestIds, nextQuestIds) && sameSet(highlightedItemNames, nextItemNames)) {
      clearCrossReferenceFocus();
      return;
    }
    highlightedQuestIds = nextQuestIds;
    highlightedItemNames = nextItemNames;
    renderLines();
    scrollItemReferenceIntoView(itemNames[0]);
    showToast(`${quest.name} · ${itemNames.length} required item${itemNames.length === 1 ? "" : "s"}`);
  }

  function buildTrackedItems() {
    const map = new Map();
    KEEP_ITEMS.forEach((item) => {
      const name = canonicalItemName(item.name);
      map.set(name, {
      name, needed: item.needed, group: item.group, questNeeded: item.needed,
      sources: [...item.quests], contexts: ["Quest"],
      });
    });
    HIDEOUT_UPGRADES.forEach((upgrade) => upgrade.items.forEach((requirement) => {
      const name = canonicalItemName(requirement.name);
      const current = map.get(name) ?? { name, needed: 0, group: "Innards", questNeeded: 0, sources: [], contexts: [] };
      current.needed += requirement.needed;
      current.sources.push(upgrade.name);
      if (!current.contexts.includes("Innards")) current.contexts.push("Innards");
      map.set(name, current);
    }));
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  function matchesItem(item) {
    const groupMatches = selectedItemGroup === "all" || item.group === selectedItemGroup || item.contexts.includes(selectedItemGroup);
    return groupMatches && (!search || `${item.name} ${item.group} ${item.sources.join(" ")}`.toLowerCase().includes(search));
  }

  function renderItems() {
    const tracked = buildTrackedItems();
    const visible = tracked.filter(matchesItem);
    els.itemsGrid.innerHTML = visible.map((item) => {
      const count = owned(item.name);
      const ready = count >= item.needed;
      const id = inventoryId(item.name);
      return `<article class="item-row ${ready ? "is-ready" : ""}">${itemIcon(item.name, item.group)}
        <div class="item-name"><strong>${escapeHtml(item.name)}</strong><small>Plan total ${item.needed}</small></div>
        <span class="item-group">${escapeHtml(item.contexts.join(" + "))}</span>
        <span class="item-quests">${escapeHtml(item.sources.join(" · "))}</span>
        <div class="item-count"><button type="button" data-item-action="minus" data-item-id="${id}">−</button><input type="number" min="0" value="${count}" data-item-input="${id}" aria-label="${escapeHtml(item.name)} owned"><button type="button" data-item-action="plus" data-item-id="${id}">+</button><small>${ready ? "Ready" : `${count} / ${item.needed}`}</small></div>
      </article>`;
    }).join("");
    els.itemsEmpty.classList.toggle("is-hidden", visible.length !== 0);
    let ready = 0, missing = 0, target = 0, toward = 0;
    tracked.forEach((item) => {
      const count = owned(item.name);
      if (count >= item.needed) ready += 1;
      missing += Math.max(0, item.needed - count);
      target += item.needed; toward += Math.min(count, item.needed);
    });
    const percent = target ? Math.round(toward / target * 100) : 0;
    document.querySelector("#itemsReady").textContent = ready;
    document.querySelector("#itemsMissing").textContent = missing;
    document.querySelector("#itemsProgressText").textContent = `${percent}% stocked`;
    document.querySelector("#itemsProgressBar").style.width = `${percent}%`;
  }

  function renderHideout() {
    const visible = HIDEOUT_UPGRADES.filter((upgrade) => {
      const groupMatch = selectedHideoutGroup === "all" || upgrade.category === selectedHideoutGroup;
      const statusMatch = statusFilter === "all" || upgradeStatus(upgrade) === statusFilter;
      const searchMatch = !search || `${upgrade.name} ${upgrade.group} ${upgrade.effect} ${upgrade.items.map((item)=>item.name).join(" ")}`.toLowerCase().includes(search);
      return groupMatch && statusMatch && searchMatch;
    });
    const cardMarkup = (upgrade) => {
      const status = upgradeStatus(upgrade);
      const prereqs = [
        upgrade.prerequisite ? upgradeById.get(upgrade.prerequisite)?.name : null,
        upgrade.requiresQuest ? questById.get(upgrade.requiresQuest)?.name : null,
      ].filter(Boolean);
      const prereq = prereqs.length ? prereqs.join(" + ") : "None";
      const stageLabel = upgrade.tiered ? `TIER ${upgrade.tier}` : "MODULE";
      return `<article class="upgrade-card" data-status="${status}">
        <header><div><span>${escapeHtml(upgrade.group)}</span><h2>${escapeHtml(upgrade.name)}</h2></div><b class="upgrade-tier">${stageLabel}</b><button class="upgrade-check" type="button" data-upgrade-id="${upgrade.id}" ${status === "locked" ? "disabled" : ""} aria-label="Toggle ${escapeHtml(upgrade.name)}">${status === "complete" ? "Built" : status === "locked" ? "Locked" : "Mark built"}</button></header>
        <p>${escapeHtml(upgrade.effect)}</p>
        <div class="upgrade-stats"><span><b>${upgrade.water}</b> water</span><span><b>${upgrade.credits.toLocaleString()}</b> CR</span><span><b>${upgrade.time}</b> build</span><span><b>${escapeHtml(prereq)}</b> prerequisite</span></div>
        <div class="upgrade-items">${upgrade.items.length ? upgrade.items.map((item) => compactItemMarkup(item.name, item.needed)).join("") : '<p class="no-materials">No material items.</p>'}</div>
      </article>`;
    };
    els.hideoutGrid.innerHTML = `<div class="upgrade-columns">${["Terminal", "Welfare"].map((category, categoryIndex) => {
      const upgrades = visible.filter((upgrade) => upgrade.category === category);
      if (!upgrades.length) return "";
      const built = upgrades.filter((upgrade) => isUpgradeComplete(upgrade.id)).length;
      const families = INNARDS_FAMILIES.filter((family) => family.category === category).map((family) => {
        const stages = family.ids.map((id) => upgradeById.get(id)).filter((upgrade) => upgrades.includes(upgrade));
        if (!stages.length) return "";
        const allFamilyUpgrades = family.ids.map((id) => upgradeById.get(id)).filter(Boolean);
        const familyBuilt = allFamilyUpgrades.filter((upgrade) => isUpgradeComplete(upgrade.id)).length;
        const familyIcon = ASSET_PATHS.upgrade?.[allFamilyUpgrades[0]?.id];
        return `<article class="upgrade-family"><header>${familyIcon ? `<img class="upgrade-family-icon" src="${familyIcon}" alt="" loading="lazy">` : ""}<div><span>${escapeHtml(category)}</span><h3>${escapeHtml(family.name)}</h3></div><strong>${familyBuilt}/${allFamilyUpgrades.length}</strong></header><div class="upgrade-family-tiers">${stages.map(cardMarkup).join("")}</div></article>`;
      }).join("");
      return `<section class="upgrade-category" data-category="${category.toLowerCase()}"><header><div><span>0${categoryIndex + 1}</span><div><h2>${category}</h2></div></div><strong>${built}/${upgrades.length} BUILT</strong></header><div class="upgrade-family-list">${families}</div></section>`;
    }).join("")}</div>`;
    const complete = HIDEOUT_UPGRADES.filter((upgrade) => isUpgradeComplete(upgrade.id)).length;
    els.hideoutProgress.textContent = `${complete} / ${HIDEOUT_UPGRADES.length}`;
    els.hideoutEmpty.classList.toggle("is-hidden", visible.length !== 0);
  }

  function renderRadiants() {
    const factionRank = { Scavengers: 0, Europa: 1, Eurasia: 2, Euruska: 3 };
    const visible = RADIANT_QUESTS
      .filter((quest) => matchesQuest(quest) && (selectedRadiantFaction === "all" || quest.faction === selectedRadiantFaction))
      .sort((left, right) => {
        if (radiantSort === "name") return left.name.localeCompare(right.name);
        if (radiantSort === "location") return left.location.localeCompare(right.location) || left.name.localeCompare(right.name);
        if (radiantSort === "status") return Number(isComplete(left.id)) - Number(isComplete(right.id)) || left.name.localeCompare(right.name);
        return (factionRank[left.faction] ?? 99) - (factionRank[right.faction] ?? 99) || left.name.localeCompare(right.name);
      });
    els.radiantGrid.innerHTML = visible.map((quest) => `<article class="radiant-row ${isComplete(quest.id) ? "is-complete" : ""}">
      <button class="radiant-check" type="button" data-quest-id="${quest.id}" aria-label="Toggle ${escapeHtml(quest.name)}"></button>
      <img class="radiant-faction-icon" src="${ASSET_PATHS.faction[quest.faction]}" alt="" loading="lazy" onerror="this.hidden=true">
      <a class="radiant-name" href="${quest.wiki}" target="_blank" rel="noopener">${escapeHtml(quest.name)}<small>${escapeHtml(quest.objective)}</small></a>
      <span class="radiant-cell radiant-faction"><b>${escapeHtml(quest.faction)}</b><small>${escapeHtml(quest.provider)}</small></span>
      <span class="radiant-cell">${escapeHtml(quest.location)}</span><span class="radiant-badge">Radiant</span>
    </article>`).join("");
    els.radiantProgress.textContent = `${RADIANT_QUESTS.filter((quest)=>isComplete(quest.id)).length} / ${RADIANT_QUESTS.length}`;
    els.radiantEmpty.classList.toggle("is-hidden", visible.length !== 0);
  }

  function pruneInvalidCompletions() {
    let removed = 0, changed = true;
    while (changed) {
      changed = false;
      allChainQuests.forEach((quest) => {
        if (!isComplete(quest.id)) return;
        const missingUpgrade = (quest.requiresUpgrades ?? []).some((id) => !isUpgradeComplete(id));
        if (!isLineUnlocked(quest.lineId) || quest.requires.some((id) => !isComplete(id)) || missingUpgrade) {
          delete state.completed[quest.id]; removed += 1; changed = true;
        }
      });
    }
    return removed;
  }

  function pruneInvalidUpgrades() {
    let removed = 0, changed = true;
    while (changed) {
      changed = false;
      HIDEOUT_UPGRADES.forEach((upgrade) => {
        if (!isUpgradeComplete(upgrade.id)) return;
        const missingUpgrade = upgrade.prerequisite && !isUpgradeComplete(upgrade.prerequisite);
        const missingQuest = upgrade.requiresQuest && !isComplete(upgrade.requiresQuest);
        if (missingUpgrade || missingQuest) {
          delete state.upgrades[upgrade.id]; removed += 1; changed = true;
        }
      });
    }
    return removed;
  }

  function toggleQuest(id) {
    const quest = questById.get(id);
    if (!quest || questStatus(quest) === "locked") return;
    state.completed[id] = !isComplete(id);
    let invalidated = 0;
    if (!state.completed[id]) {
      delete state.completed[id];
      invalidated = pruneInvalidCompletions();
      pruneInvalidUpgrades();
    }
    saveState(state.completed[id] ? `${quest.name} complete` : `${quest.name} reopened${invalidated ? ` · ${invalidated} dependent reset` : ""}`);
    renderAll();
  }

  function toggleUpgrade(id) {
    const upgrade = upgradeById.get(id);
    if (!upgrade || upgradeStatus(upgrade) === "locked") return;
    if (isUpgradeComplete(id)) {
      delete state.upgrades[id];
      pruneInvalidUpgrades();
      pruneInvalidCompletions();
    } else state.upgrades[id] = true;
    saveState(isUpgradeComplete(id) ? `${upgrade.name} built` : `${upgrade.name} reopened`);
    renderAll();
  }

  function setItem(id, value) {
    state.items[id] = Math.max(0, Math.floor(Number(value) || 0));
    saveState("");
    renderItems(); renderLineItems(lineById.get(state.selectedLine)); renderHideout();
  }

  function unlockLine(id) {
    if (!lineById.has(id)) return;
    state.unlockedLines[id] = true;
    saveState(`${lineById.get(id).name} unlocked`);
    renderAll();
  }

  function renderStats() {
    const complete = allChainQuests.filter((quest) => isComplete(quest.id)).length;
    document.querySelector("#questCount").textContent = allQuests.length;
    document.querySelector("#lineCount").textContent = QUEST_LINES.length;
    document.querySelector("#upgradeCount").textContent = HIDEOUT_UPGRADES.length;
    document.querySelector("#itemCount").textContent = buildTrackedItems().length;
    document.querySelector("#overallPercent").textContent = `${Math.round(complete / allChainQuests.length * 100)}%`;
  }

  function renderAll() {
    renderCampaignMap(); renderLines(); renderHideout(); renderRadiants(); renderItems(); renderStats();
  }

  function switchView(view) {
    state.view = view;
    document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("is-active", tab.dataset.view === view));
    document.querySelectorAll(".view").forEach((panel) => panel.classList.toggle("is-active", panel.id === `${view}View`));
    els.lineSelectWrap.classList.toggle("is-hidden", view !== "lines");
    els.itemSelectWrap.classList.toggle("is-hidden", view !== "items");
    els.hideoutSelectWrap.classList.toggle("is-hidden", view !== "hideout");
    els.radiantFactionWrap.classList.toggle("is-hidden", view !== "radiant");
    els.radiantSortWrap.classList.toggle("is-hidden", view !== "radiant");
    els.statusFilters.classList.toggle("is-hidden", view === "items");
    els.searchInput.placeholder = view === "items" ? "Search inventory" : view === "hideout" ? "Search upgrades" : view === "radiant" ? "Search radiant contracts" : "Search quests";
    saveState("");
  }

  function setZoom(nextZoom) {
    zoom = Math.min(1.35, Math.max(.5, Math.round(nextZoom * 20) / 20));
    renderLines();
  }

  function fitGraph() {
    const line = lineById.get(state.selectedLine) ?? QUEST_LINES[0];
    const availableWidth = Math.max(320, (els.graphViewport.clientWidth || 1000) - 32);
    setZoom(Math.min(1, availableWidth / computeGraph(line).width));
  }

  function populateFilters() {
    els.lineFilter.replaceChildren();
    QUEST_LINES.forEach((line) => els.lineFilter.add(new Option(line.name, line.id)));
    els.lineFilter.value = state.selectedLine;
    els.itemGroupFilter.replaceChildren(new Option("All groups", "all"), new Option("Quest", "Quest"), new Option("Innards", "Innards"));
    [...new Set(KEEP_ITEMS.map((item) => item.group))].sort().forEach((group) => els.itemGroupFilter.add(new Option(group, group)));
    els.hideoutGroupFilter.replaceChildren(new Option("All categories", "all"), new Option("Terminal", "Terminal"), new Option("Welfare", "Welfare"));
    els.radiantFactionFilter.replaceChildren(new Option("All factions", "all"), ...["Scavengers", "Europa", "Eurasia", "Euruska"].map((faction) => new Option(faction, faction)));
    els.radiantSort.replaceChildren(new Option("Faction", "faction"), new Option("Quest name", "name"), new Option("Location", "location"), new Option("Incomplete first", "status"));
  }

  document.addEventListener("click", (event) => {
    const itemReference = event.target.closest("[data-focus-item]");
    if (itemReference) focusItemInGraph(itemReference.dataset.focusItem);
    const questItemReference = event.target.closest("[data-focus-quest-items]");
    if (questItemReference) focusQuestItems(questItemReference.dataset.focusQuestItems);
    const questButton = event.target.closest("[data-quest-id]");
    if (questButton) toggleQuest(questButton.dataset.questId);
    const upgradeButton = event.target.closest("[data-upgrade-id]");
    if (upgradeButton) toggleUpgrade(upgradeButton.dataset.upgradeId);
    const itemButton = event.target.closest("[data-item-action]");
    if (itemButton) {
      const id = itemButton.dataset.itemId;
      setItem(id, (Number(state.items[id]) || 0) + (itemButton.dataset.itemAction === "plus" ? 1 : -1));
    }
    const unlockButton = event.target.closest("[data-unlock-line]");
    if (unlockButton) unlockLine(unlockButton.dataset.unlockLine);
    const selectButton = event.target.closest("[data-select-line]");
    if (selectButton) {
      clearCrossReference();
      state.selectedLine = selectButton.dataset.selectLine; els.lineFilter.value = state.selectedLine; zoom = 1; saveState("");
      renderCampaignMap(); renderLines({ center: true });
      document.querySelector(".line-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    const upgradeSelect = event.target.closest("[data-select-upgrade]");
    if (upgradeSelect) {
      const upgrade = upgradeById.get(upgradeSelect.dataset.selectUpgrade);
      selectedHideoutGroup = upgrade?.category ?? "all";
      els.hideoutGroupFilter.value = selectedHideoutGroup;
      switchView("hideout");
      renderHideout();
    }
    const tab = event.target.closest(".tab");
    if (tab) switchView(tab.dataset.view);
    const filter = event.target.closest(".filter");
    if (filter) {
      clearCrossReference();
      statusFilter = filter.dataset.status;
      document.querySelectorAll(".filter").forEach((item) => item.classList.toggle("is-active", item === filter));
      renderAll();
    }
    const zoomButton = event.target.closest("[data-zoom]");
    if (zoomButton) zoomButton.dataset.zoom === "fit" ? fitGraph() : setZoom(zoomButton.dataset.zoom === "in" ? zoom + .1 : zoom - .1);
  });

  document.addEventListener("change", (event) => {
    if (event.target.matches("[data-item-input]")) setItem(event.target.dataset.itemInput, event.target.value);
  });
  els.searchInput.addEventListener("input", (event) => { clearCrossReference(); search = event.target.value.trim().toLowerCase(); renderAll(); });
  els.lineFilter.addEventListener("change", (event) => { clearCrossReference(); state.selectedLine = event.target.value; zoom = 1; saveState(""); renderCampaignMap(); renderLines({ center: true }); });
  els.itemGroupFilter.addEventListener("change", (event) => { selectedItemGroup = event.target.value; renderItems(); });
  els.hideoutGroupFilter.addEventListener("change", (event) => { selectedHideoutGroup = event.target.value; renderHideout(); });
  els.radiantFactionFilter.addEventListener("change", (event) => { selectedRadiantFaction = event.target.value; renderRadiants(); });
  els.radiantSort.addEventListener("change", (event) => { radiantSort = event.target.value; renderRadiants(); });
  els.manualLineUnlock.addEventListener("click", () => unlockLine(state.selectedLine));
  els.collapseCampaign.addEventListener("click", () => { state.campaignCollapsed = !state.campaignCollapsed; saveState(""); renderCampaignMap(); });
  els.clearItemFocus.addEventListener("click", clearCrossReferenceFocus);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") clearCrossReferenceFocus();
  });

  document.querySelector("#resetProgress").addEventListener("click", () => {
    if (!confirm("Reset all quest, Innards, unlock, and inventory progress?")) return;
    state = structuredClone(defaultState);
    try { ["fwQuestTracker.v1","fwQuestTracker.v2",STORAGE_KEY].forEach((key) => localStorage.removeItem(key)); } catch {}
    zoom = 1; search = ""; statusFilter = "all"; els.searchInput.value = "";
    populateFilters(); renderAll(); switchView("lines"); showToast("Progress reset");
  });

  let drag = null;
  els.graphViewport.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest("a,button")) return;
    drag = { x:event.clientX, y:event.clientY, left:els.graphViewport.scrollLeft, top:els.graphViewport.scrollTop };
    els.graphViewport.classList.add("is-dragging");
  });
  els.graphViewport.addEventListener("pointermove", (event) => {
    if (!drag) return;
    els.graphViewport.scrollLeft = drag.left - (event.clientX - drag.x);
    els.graphViewport.scrollTop = drag.top - (event.clientY - drag.y);
  });
  const endDrag = () => { drag = null; els.graphViewport.classList.remove("is-dragging"); };
  ["pointerup","pointercancel","pointerleave"].forEach((type) => els.graphViewport.addEventListener(type, endDrag));

  populateFilters();
  document.querySelector("#snapshotDate").textContent = DATA_META.scraped;
  switchView(["lines","hideout","radiant","items"].includes(state.view) ? state.view : "lines");
  renderAll();
})();
