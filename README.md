# Forever Winter Quest Tracker

A buildless, static quest-tree and stash tracker for *The Forever Winter*.

- Questline nodes unlock from explicit prerequisite edges.
- Campaign overview distinguishes questline gates from Innards build gates and mid-line milestones.
- Innards upgrades follow the in-game Terminal and Welfare columns, with related stages nested into upgrade families.
- Crafting recipes are grouped by station, with output, time, ingredient requirements, and shared inventory counts.
- “Can I sell it?” compares owned stock with unfinished quest, Innards, and crafting requirements and exposes only the surplus.
- Radiant jobs are labeled and deliberately have no dependency edges.
- Quest and item progress is stored in the browser with `localStorage`.
- Quest names link to their corresponding wiki pages.

Open `dist/standalone.html` directly for the self-contained tracker, or serve the `dist/` directory with any static HTTP server. Run `npm run build:standalone` to regenerate the single-file edition and `npm test` to validate the data graph and static app contract.

## Local wiki assets

Run `npm run scrape:wiki` from this directory to resolve and download every tracked item icon, crafting product, crafting ingredient, faction emblem, quest-giver portrait, and trader portrait. The Python scraper discovers the tracker material list from `data.js`, asks the MediaWiki API for original image URLs, writes those URLs to `dist/assets/wiki-source-urls.json`, and downloads with Firefox-like headers, same-origin referers, cookies, and redirects. Every API or image request is separated by a five-second delay. Its image `Accept` header prevents wiki.gg from silently converting requested PNGs to WebP; transformed responses are converted back to PNG locally.

Use `npm run scrape:items`, `npm run scrape:questgivers`, `npm run scrape:factions`, or `npm run scrape:traders` for one asset class. `npm run scrape:urls` resolves every class without downloading. `python3 scripts/scrape_wiki_assets.py --group items --only toy-dinosaur --force` refreshes one asset; `--delay 5` is the default and can be raised when needed.

Data snapshot: 2026-10-29. Sources: [Quests](https://theforeverwinter.wiki.gg/wiki/Quests), [crafting data guide](https://theforeverwinter.wiki.gg/wiki/Guides/Wiki/Working_with_Cargo), and [weapon repairs](https://theforeverwinter.wiki.gg/wiki/Weapon_Repairs), CC BY-SA 4.0.
