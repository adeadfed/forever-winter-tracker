# Forever Winter Tracker

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

Run `npm run scrape:wiki` from this directory to download missing icons for the wiki's complete Items index, plus faction emblems, quest-giver portraits, and trader portraits. The Python scraper refreshes `dist/item-catalog.js` from the Items table, merges tracker-specific materials from `data.js`, writes original image URLs to `dist/assets/wiki-source-urls.json`, and skips existing PNGs before doing any per-item lookup. Every network request is separated by a five-second delay. Its image `Accept` header prevents wiki.gg from silently converting requested PNGs to WebP; transformed responses are converted back to PNG locally.

Use `npm run scrape:items`, `npm run scrape:questgivers`, `npm run scrape:factions`, or `npm run scrape:traders` for one asset class. `npm run scrape:fix-icons` compares existing item sources with the wiki's Items-table portraits and replaces only mismatches. `npm run scrape:refresh` deliberately replaces every file; normal scrape commands fill missing files and repair known mismatches. `npm run scrape:urls` resolves every class without downloading. `python3 scripts/scrape_wiki_assets.py --group items --only toy-dinosaur --force` refreshes one asset; `--delay 5` is the default and can be raised when needed.

Data snapshot: 2026-10-29. Sources: [Items](https://theforeverwinter.wiki.gg/wiki/Items), [Quests](https://theforeverwinter.wiki.gg/wiki/Quests), [crafting data guide](https://theforeverwinter.wiki.gg/wiki/Guides/Wiki/Working_with_Cargo), and [weapon repairs](https://theforeverwinter.wiki.gg/wiki/Weapon_Repairs), CC BY-SA 4.0.

## License

Original software in this repository is licensed under the [0BSD license](LICENSE). Wiki-derived data, images, and other third-party material are excluded from that grant; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
