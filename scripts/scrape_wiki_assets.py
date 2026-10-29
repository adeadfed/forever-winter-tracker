#!/usr/bin/env python3
"""Resolve and download real tracker PNGs from The Forever Winter wiki.

The script covers items, factions, quest givers, and traders. It asks MediaWiki
for original image URLs, waits five seconds between every network request,
downloads with browser-like headers and a same-origin referer, then converts any
CDN WebP/AVIF response back to PNG. Stable local filenames are used by the tracker.
"""

from __future__ import annotations

import argparse
from html.parser import HTMLParser
import http.cookiejar
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request


BASE = "https://theforeverwinter.wiki.gg"
API = f"{BASE}/api.php"
ASSET_ROOT = Path(__file__).resolve().parents[1] / "dist" / "assets"
DATA_JS = Path(__file__).resolve().parents[1] / "dist" / "data.js"
ITEM_CATALOG_JS = Path(__file__).resolve().parents[1] / "dist" / "item-catalog.js"
ITEMS_PAGE = f"{BASE}/wiki/Items"

QUEST_GIVERS = {
    "scavengers": ("Slade", "Quest Giver Scav Slade.png"),
    "europa": ("Luca", "Quest Giver Europa Western Embassy Luca.png"),
    "eurasia": ("Kane", "Quest Giver Eurasia Eastern Consulate Kane.png"),
    "bunco": ("Bunco", "BUNCO.png"),
    # The Lordoss page's lead image is a shoulder-inscription detail. The game
    # reuses this full portrait for Vladelets, so request that known file by name.
    "lordoss": ("Lordoss", "ВЛАДЕЛЕЦ Vladelets Euruska Quest Giver.png"),
    "vladelets": ("ВЛАДЕЛЕЦ (Vladelets)", "ВЛАДЕЛЕЦ Vladelets Euruska Quest Giver.png"),
    "velko": ("Velko", ""),
    "sura": ("Sura", ""),
    "octogirl": ("Octogirl", "UI transmissionroom portrait Octo1.png"),
    "doctor-morrow": ("Doctor Morrow", "UI transmissionroom portrait DrMorrow1.png"),
    "bartender": ("Bartender", ""),
    "arbeits": ("Arbeits", ""),
    "wahlkreise": ("Wahlkreise", ""),
}

FACTIONS = {
    "scavengers": ("Scavengers", ""),
    "europa": ("Europa", ""),
    "eurasia": ("Eurasia", ""),
    "euruska": ("Euruska", ""),
}

TRADERS = {
    "heisenburg": ("Heisenburg", ""),
    "slade": ("Slade", "Quest Giver Scav Slade.png"),
    "bunco": ("Bunco", "BUNCO.png"),
    "luca": ("Luca", "Quest Giver Europa Western Embassy Luca.png"),
    "kane": ("Kane", "Quest Giver Eurasia Eastern Consulate Kane.png"),
    "bundleton": ("Bundleton", ""),
    "auto-vendor": ("Auto-Vendor", ""),
}

# Display-name exceptions whose wiki page title differs from the tracker label.
ITEM_PAGE_OVERRIDES = {
    "Barrel of Water": "Water",
    "Dogboro Cigarettes (Basic)": "Dogboro Cigarettes",
    "Hinoko Cigarettes (Import)": "Hinoko Cigarettes",
    "Interface Core": "Interface Cores",
    "Memory Interface": "Memory Interfaces",
    "Mnemonic Index": "Mnemonic Indexes",
    "Nucky Gold Cigarettes (Premium)": "Nucky Gold Cigarettes",
}

# Use the actual item portrait when a page's lead image depicts a character,
# location, ingredient, or other unrelated subject.
ITEM_FILE_OVERRIDES = {
    '"Beef" Flavor Packet': "T_JunkEcon_105_Soidum.png",
    "12-Gauge Buckshot": "ItemPortrait_Demo_Ammo_12x76.png",
    "5.45x39mm Cryo Ammo": "ItemPortrait_Demo_Ammo_545x39_CRYO.png",
    "9x19mm Ammo": "ItemPortrait_Demo_Ammo_9x19.png",
    "Barrel of Water": "ItemPortrait_Demo_Barrel.png",
    "Battery Charger": "T_JunkEcon_92_RechargeableBatteryCharger.png",
    "Car Battery": "T_CarBattery.png",
    "Construction Drone": "T_Drone_Construction.png",
    "Eurasian IFF Chip LVL1": "T_Portrait_IFFCard_Eurasia1.png",
    "Eurasian IFF Chip LVL2": "T_Portrait_IFFCard_Eurasia2.png",
    "Eurasian IFF Chip LVL3": "T_Portrait_IFFCard_Eurasia3.png",
    "Europan IFF Chip LVL1": "T_Portrait_IFFCard_Europa1.png",
    "Europan IFF Chip LVL2": "T_Portrait_IFFCard_Europa2.png",
    "Europan IFF Chip LVL3": "T_Portrait_IFFCard_Europa3.png",
    "Euruskan IFF Chip LVL1": "T_Portrait_IFFCard_Euruska1.png",
    "Euruskan IFF Chip LVL2": "T_Portrait_IFFCard_Euruska2.png",
    "Euruskan IFF Chip LVL3": "T_Portrait_IFFCard_Euruska3.png",
    "Fast Travel Drone": "T_Drone_FastTravel.png",
    "Gunpowder": "T_Portrait_GRN_ingredient_Gunpowder.png",
    "Hard Drive": "T_HardDrive.png",
    "Light Bulb": "T_Lightbulb.png",
    "Machine Parts": "T_MachineParts.png",
    "Medical Tools": "T_MedicalTools.png",
    "Metal Fragments": "T_Portrait_GRN_ingredient_MetalFragments.png",
    "Metal Pipe": "T_Portrait_GRN_ingredient_MetalPipe.png",
    "Military Battery": "T_MilitaryBattery.png",
    "Military Cables": "T_Portrait_JunkEcon_43_MilitaryCables.png",
    "Pneumatic Jump": "ItemPneumaticJump.png",
    "Power Cell": "T_JunkEcon_11_PowerCell.png",
    "Power Drill": "T_PowerDrill.png",
    "Printed Circuit Board": "T_GPU_Caps.png",
    "Processor Board": "T_ProcessorBoard.png",
    "Rare Metals": "T_RareMetals.png",
    "Recovery Drone": "T_Drone_Recovery.png",
    "Tactical Camera": "T_item_RIGEQUIPMENT_TacCam_v1.png",
    "Uplink": "T_Item_Quest_NeuroUplink.png",
    "Wires": "T_Portrait_JunkEcon_25_Wires.png",
}

# Canonical tracker labels for wiki rows whose visible names differ.
WIKI_ITEM_NAME_ALIASES = {
    "Water": "Barrel of Water",
    "Dogboro Cigarettes": "Dogboro Cigarettes (Basic)",
    "Hinoko Cigarettes": "Hinoko Cigarettes (Import)",
    "Nucky Gold Cigarettes": "Nucky Gold Cigarettes (Premium)",
    "Comms Device": "Communication Device",
    "Cyborg's Head": "Cyborg Component",
    "Dog Tags": "Dog Tag",
    "Eurasian Brawler Components": "Brawler Component",
    "Neuro Uplink Board": "Uplink",
    "T-90 Suspension Component": "T90 Component",
}


def slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value).lower().replace("’", "").replace("'", "")
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", normalized))


def js_string(value: str) -> str:
    return json.loads(f'"{value}"')


def absolute_wiki_url(value: str) -> str:
    if value.startswith("//"):
        return f"https:{value}"
    if value.startswith("/"):
        return f"{BASE}{value}"
    return value


def original_wiki_image_url(value: str) -> str:
    """Turn a MediaWiki thumbnail URL into the corresponding original file URL."""
    absolute = absolute_wiki_url(value)
    parsed = urllib.parse.urlsplit(absolute)
    marker = "/images/thumb/"
    if marker not in parsed.path:
        return absolute
    original_path = parsed.path.replace(marker, "/images/", 1).rsplit("/", 1)[0]
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, original_path, parsed.query, parsed.fragment))


class WikiItemsParser(HTMLParser):
    """Extract the item name, wiki page, and icon from the Items table."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.in_row = False
        self.cell_index = -1
        self.cell_count = 0
        self.cell_parts: list[list[str]] = []
        self.page_links: list[tuple[int, str]] = []
        self.icon_url = ""
        self.items: list[dict[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag == "tr":
            self.in_row = True
            self.cell_index = -1
            self.cell_count = 0
            self.cell_parts = []
            self.page_links = []
            self.icon_url = ""
            return
        if not self.in_row:
            return
        if tag in ("td", "th"):
            self.cell_index += 1
            self.cell_count += 1
            self.cell_parts.append([])
        if tag == "a":
            href = attributes.get("href") or ""
            if href.startswith("/wiki/") and not href.startswith("/wiki/File:"):
                page = urllib.parse.unquote(href.removeprefix("/wiki/")).replace("_", " ")
                self.page_links.append((self.cell_index, page))
        if tag == "img" and not self.icon_url and self.cell_index <= 1:
            source = attributes.get("data-src") or attributes.get("src") or ""
            if source and not source.endswith(("sort_asc.png", "sort_desc.png", "sort_both.png")):
                self.icon_url = original_wiki_image_url(source)

    def handle_data(self, data: str) -> None:
        if self.in_row and 0 <= self.cell_index < len(self.cell_parts):
            self.cell_parts[self.cell_index].append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag != "tr" or not self.in_row:
            return
        self.in_row = False
        if self.cell_count < 4 or not self.page_links:
            return
        link_cell, page = next(((cell, target) for cell, target in self.page_links if cell <= 2), self.page_links[0])
        raw_name = " ".join(" ".join(self.cell_parts[link_cell]).split()).strip()
        if not raw_name or raw_name.lower() in ("item", "name", "image"):
            raw_name = page
        if page.startswith(("Category:", "Special:")):
            return
        name = WIKI_ITEM_NAME_ALIASES.get(raw_name, raw_name)
        self.items.append({"name": name, "page": page, "icon_url": self.icon_url})


def load_local_item_catalog() -> list[dict[str, str]]:
    if not ITEM_CATALOG_JS.exists():
        return []
    try:
        payload = ITEM_CATALOG_JS.read_text(encoding="utf-8").partition("=")[2].rsplit(";", 1)[0]
        entries = json.loads(payload)
    except (OSError, json.JSONDecodeError):
        return []
    return [
        {"name": entry if isinstance(entry, str) else entry["name"],
         "page": entry if isinstance(entry, str) else entry.get("page", entry["name"]),
         "icon_url": "" if isinstance(entry, str) else entry.get("source_url", "")}
        for entry in entries
    ]


def write_item_catalog(entries: list[dict[str, str]]) -> None:
    unique: dict[str, dict[str, str]] = {}
    for entry in entries:
        name = WIKI_ITEM_NAME_ALIASES.get(entry["name"], entry["name"])
        unique[name] = {
            "name": name,
            "page": entry.get("page") or name,
            "icon": f"assets/items/{slugify(name)}.png",
        }
    ordered = sorted(unique.values(), key=lambda entry: entry["name"].casefold())
    ITEM_CATALOG_JS.write_text(
        "window.ALL_ITEMS = " + json.dumps(ordered, ensure_ascii=False, indent=2) + ";\n",
        encoding="utf-8",
    )


def merge_item_catalogs(*catalogs: list[dict[str, str]]) -> list[dict[str, str]]:
    merged: dict[str, dict[str, str]] = {}
    for catalog in catalogs:
        for entry in catalog:
            name = WIKI_ITEM_NAME_ALIASES.get(entry["name"], entry["name"])
            previous = merged.get(name, {})
            merged[name] = {
                "name": name,
                "page": entry.get("page") or previous.get("page") or name,
                "icon_url": entry.get("icon_url") or previous.get("icon_url", ""),
            }
    return sorted(merged.values(), key=lambda entry: entry["name"].casefold())


def fetch_wiki_item_catalog(opener: urllib.request.OpenerDirector) -> list[dict[str, str]]:
    payload, _ = request_bytes(opener, ITEMS_PAGE, {**PAGE_HEADERS, "Referer": f"{BASE}/wiki/Main_Page"})
    parser = WikiItemsParser()
    parser.feed(payload.decode("utf-8", errors="replace"))
    if len(parser.items) < 100:
        raise RuntimeError(f"Items table yielded only {len(parser.items)} rows")
    return parser.items


def discover_item_targets() -> dict[str, tuple[str, str]]:
    """Read every quest, Innards, crafting product, and ingredient from data.js."""
    source = DATA_JS.read_text(encoding="utf-8")
    names = {
        js_string(match.group(1))
        for match in re.finditer(r'\{ name: "((?:[^"\\]|\\.)+)", needed:', source)
    }
    hideout = source.partition("window.HIDEOUT_UPGRADES = [")[2].partition("];")[0]
    names.update(
        js_string(match.group(1))
        for match in re.finditer(r'\["((?:[^"\\]|\\.)+)",\s*\d+\]', hideout)
    )
    crafting = source.partition("window.CRAFTING_RECIPES = [")[2].partition("];")[0]
    names.update(
        js_string(match.group(1))
        for match in re.finditer(
            r'craftingRecipe\(\s*"(?:[^"\\]|\\.)+"\s*,\s*"(?:[^"\\]|\\.)+"\s*,\s*"((?:[^"\\]|\\.)+)"',
            crafting,
        )
    )
    names.update(
        js_string(match.group(1))
        for match in re.finditer(r'\["((?:[^"\\]|\\.)+)",\s*\d+\]', crafting)
    )
    for entry in load_local_item_catalog():
        names.add(entry["name"])
    pages = {entry["name"]: entry["page"] for entry in load_local_item_catalog()}
    return {
        slugify(name): (
            ITEM_PAGE_OVERRIDES.get(name, pages.get(name, name)),
            ITEM_FILE_OVERRIDES.get(name, ""),
        )
        for name in sorted(names)
    }


GROUPS = {
    "items": discover_item_targets(),
    "factions": FACTIONS,
    "questgivers": QUEST_GIVERS,
    "traders": TRADERS,
}
OUTPUT_DIRECTORIES = {
    "items": "items",
    "factions": "factions",
    "questgivers": "portraits",
    "traders": "traders",
}
GROUP_ALIASES = {"portraits": "questgivers"}
REQUEST_DELAY_SECONDS = 5.0
LAST_REQUEST_STARTED_AT: float | None = None

PAGE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:144.0) Gecko/20100101 Firefox/144.0",
    "Accept": "application/json,text/html;q=0.9,*/*;q=0.7",
    "Accept-Language": "en-US,en;q=0.8",
    "Accept-Encoding": "identity",
    "DNT": "1",
    "Sec-GPC": "1",
    "Connection": "keep-alive",
}

IMAGE_HEADERS = {
    **PAGE_HEADERS,
    # Do not advertise WebP/AVIF: wiki.gg otherwise transforms .png responses.
    "Accept": "image/png,image/jpeg;q=0.9,image/*;q=0.6,*/*;q=0.1",
    "Sec-Fetch-Dest": "image",
    "Sec-Fetch-Mode": "no-cors",
    "Sec-Fetch-Site": "same-origin",
}


def make_opener() -> urllib.request.OpenerDirector:
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(jar),
        urllib.request.HTTPRedirectHandler(),
        urllib.request.HTTPSHandler(),
    )


def throttle_request() -> None:
    """Keep request starts at least REQUEST_DELAY_SECONDS apart."""
    global LAST_REQUEST_STARTED_AT
    now = time.monotonic()
    if LAST_REQUEST_STARTED_AT is not None:
        remaining = REQUEST_DELAY_SECONDS - (now - LAST_REQUEST_STARTED_AT)
        if remaining > 0:
            time.sleep(remaining)
    LAST_REQUEST_STARTED_AT = time.monotonic()


def request_bytes(opener: urllib.request.OpenerDirector, url: str, headers: dict[str, str]) -> tuple[bytes, str]:
    throttle_request()
    request = urllib.request.Request(url, headers=headers)
    with opener.open(request, timeout=35) as response:
        return response.read(), response.headers.get_content_type()


def api_query(opener: urllib.request.OpenerDirector, params: dict[str, str], referer: str) -> dict:
    query = urllib.parse.urlencode({"format": "json", "formatversion": "2", "redirects": "1", **params})
    payload, _ = request_bytes(opener, f"{API}?{query}", {**PAGE_HEADERS, "Referer": referer})
    return json.loads(payload.decode("utf-8"))


def image_info(opener: urllib.request.OpenerDirector, filename: str, referer: str) -> str | None:
    result = api_query(opener, {
        "action": "query", "prop": "imageinfo", "iiprop": "url|mime", "titles": f"File:{filename}",
    }, referer)
    pages = result.get("query", {}).get("pages", [])
    info = pages[0].get("imageinfo", []) if pages else []
    return info[0].get("url") if info else None


def page_image(opener: urllib.request.OpenerDirector, page: str, referer: str) -> str | None:
    result = api_query(opener, {
        "action": "query", "prop": "pageimages", "piprop": "original", "titles": page,
    }, referer)
    pages = result.get("query", {}).get("pages", [])
    return pages[0].get("original", {}).get("source") if pages else None


def page_images(opener: urllib.request.OpenerDirector, page: str, referer: str) -> list[str]:
    result = api_query(opener, {
        "action": "query", "prop": "images", "imlimit": "max", "titles": page,
    }, referer)
    pages = result.get("query", {}).get("pages", [])
    return [entry["title"].removeprefix("File:") for entry in (pages[0].get("images", []) if pages else [])]


def resolve_image(opener: urllib.request.OpenerDirector, page: str, preferred: str, group: str) -> tuple[str, str]:
    referer = f"{BASE}/wiki/{urllib.parse.quote(page.replace(' ', '_'))}"
    if preferred:
        url = image_info(opener, preferred, referer)
        if url:
            return url, referer
    # A page lead is often a character or location image. Item pages must rank
    # their actual file list before considering that lead image.
    if group not in ("factions", "items"):
        url = page_image(opener, page, referer)
        if url:
            return url, referer
    preferred_tokens = {
        "factions": ("flag", "faction", "emblem", "logo"),
        "questgivers": ("portrait", "quest giver", page.lower()),
        "traders": ("portrait", "vendor", "quest giver", page.lower()),
        "items": ("item", page.lower()),
    }[group]
    ranked = sorted(
        page_images(opener, page, referer),
        key=lambda name: (
            not any(token in name.lower() for token in preferred_tokens),
            "map" in name.lower() or "banner" in name.lower(),
            len(name),
        ),
    )
    for filename in ranked:
        url = image_info(opener, filename, referer)
        if url:
            return url, referer
    url = page_image(opener, page, referer)
    if url:
        return url, referer
    raise RuntimeError(f"No usable image was exposed by wiki page {page!r}")


def image_kind(payload: bytes, content_type: str) -> str:
    if payload.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if payload.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if payload.startswith(b"RIFF") and payload[8:12] == b"WEBP":
        return "webp"
    if payload[4:12] in (b"ftypavif", b"ftypavis"):
        return "avif"
    raise RuntimeError(f"Unexpected response ({content_type}, {len(payload)} bytes); not an image")


def convert_to_png(source: Path, destination: Path) -> None:
    converter = shutil.which("sips") or shutil.which("magick")
    if not converter:
        raise RuntimeError("Install ImageMagick, or run on macOS with sips, to convert transformed wiki images")
    command = ([converter, "-s", "format", "png", str(source), "--out", str(destination)]
               if Path(converter).name == "sips" else [converter, str(source), str(destination)])
    subprocess.run(command, check=True, stdout=subprocess.DEVNULL)


def save_png(payload: bytes, content_type: str, destination: Path) -> None:
    kind = image_kind(payload, content_type)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if kind == "png":
        temporary = destination.with_suffix(".png.part")
        temporary.write_bytes(payload)
        os.replace(temporary, destination)
        return
    with tempfile.TemporaryDirectory(prefix="fw-wiki-") as directory:
        source = Path(directory) / f"source.{kind}"
        converted = Path(directory) / "converted.png"
        source.write_bytes(payload)
        convert_to_png(source, converted)
        os.replace(converted, destination)


def selected_targets(groups: list[str], only: list[str] | None) -> list[tuple[str, str, str, str, str]]:
    wanted = set(only or [])
    targets = []
    for group in groups:
        directory = OUTPUT_DIRECTORIES[group]
        for slug, (page, preferred) in GROUPS[group].items():
            if wanted and slug not in wanted and f"{group}:{slug}" not in wanted:
                continue
            targets.append((group, directory, slug, page, preferred))
    known = {slug for _, _, slug, _, _ in targets} | {f"{group}:{slug}" for group, _, slug, _, _ in targets}
    if wanted - known:
        raise SystemExit(f"Unknown --only target(s): {', '.join(sorted(wanted - known))}")
    return targets


def missing_targets(targets: list[tuple[str, str, str, str, str]], output: Path) -> list[tuple[str, str, str, str, str]]:
    """Return only assets whose stable local PNG does not exist yet."""
    return [
        target for target in targets
        if not (output / target[1] / f"{target[2]}.png").exists()
    ]


def normalized_image_name(value: str) -> str:
    path = urllib.parse.urlsplit(value).path if "://" in value else value
    return urllib.parse.unquote(path.rsplit("/", 1)[-1]).replace(" ", "_").casefold()


def repair_targets(
    targets: list[tuple[str, str, str, str, str]],
    output: Path,
    manifest: dict,
    direct_item_urls: dict[str, str],
) -> list[tuple[str, str, str, str, str]]:
    """Find existing item PNGs whose recorded source is not the expected portrait."""
    repairs = []
    for target in targets:
        group, directory, slug, _page, preferred = target
        destination = output / directory / f"{slug}.png"
        if group != "items" or not destination.exists():
            continue
        asset_key = f"{directory}/{slug}.png"
        expected = preferred or direct_item_urls.get(slug, "")
        recorded = manifest.get(asset_key, {}).get("url", "")
        if expected and normalized_image_name(expected) != normalized_image_name(recorded):
            repairs.append(target)
    return repairs


def merge_targets(*target_groups: list[tuple[str, str, str, str, str]]) -> list[tuple[str, str, str, str, str]]:
    merged = {}
    for targets in target_groups:
        for target in targets:
            merged[(target[0], target[1], target[2])] = target
    return list(merged.values())


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--group", action="append", choices=sorted(set(GROUPS) | set(GROUP_ALIASES)), help="asset group; repeatable (default: all); portraits is an alias for questgivers")
    parser.add_argument("--only", action="append", help="asset slug or group:slug; repeatable")
    parser.add_argument("--output", type=Path, default=ASSET_ROOT, help="asset root containing items/, portraits/, factions/, and traders/")
    parser.add_argument("--delay", type=float, default=5.0, help="seconds between every network request (default: 5)")
    parser.add_argument("--force", action="store_true", help="replace existing PNG files")
    parser.add_argument("--repair-only", action="store_true", help="replace only existing item PNGs whose recorded source does not match the expected portrait")
    parser.add_argument("--tracked-only", action="store_true", help="skip the wiki Items index and only use items already known locally")
    parser.add_argument("--urls-only", action="store_true", help="resolve source URLs and write the manifest without downloading")
    parser.add_argument("--print-plan", action="store_true", help="print page targets without using the network")
    return parser.parse_args()


def main() -> int:
    global REQUEST_DELAY_SECONDS
    args = parse_args()
    REQUEST_DELAY_SECONDS = max(0.0, args.delay)
    requested_groups = args.group or list(GROUPS)
    groups = list(dict.fromkeys(GROUP_ALIASES.get(group, group) for group in requested_groups))
    manifest_path = args.output / "wiki-source-urls.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    except (OSError, json.JSONDecodeError):
        manifest = {}
    direct_item_urls: dict[str, str] = {}
    if "items" in groups and not args.tracked_only and not args.print_plan:
        opener = make_opener()
        try:
            live_catalog = fetch_wiki_item_catalog(opener)
            catalog = merge_item_catalogs(load_local_item_catalog(), live_catalog)
            write_item_catalog(catalog)
            for entry in catalog:
                slug = slugify(entry["name"])
                GROUPS["items"][slug] = (
                    ITEM_PAGE_OVERRIDES.get(entry["name"], entry["page"]),
                    ITEM_FILE_OVERRIDES.get(entry["name"], ""),
                )
                if entry.get("icon_url"):
                    direct_item_urls[slug] = entry["icon_url"]
            print(f"catalog {len(catalog)} item(s) from {ITEMS_PAGE}")
        except (OSError, RuntimeError, urllib.error.URLError, json.JSONDecodeError) as error:
            print(f"warning: could not refresh the Items index: {error}", file=sys.stderr)
    else:
        opener = make_opener()

    selected = selected_targets(groups, args.only)
    missing = missing_targets(selected, args.output)
    repairs = repair_targets(selected, args.output, manifest, direct_item_urls)
    if args.repair_only:
        targets = repairs
    elif args.force or args.urls_only:
        targets = selected
    else:
        targets = merge_targets(missing, repairs)
    if not args.force and not args.urls_only:
        print(f"missing {len(missing)}; incorrect existing icons {len(repairs)}; selected targets {len(targets)}")
    if args.print_plan:
        for group, directory, slug, page, preferred in targets:
            print(f"{directory}/{slug}.png\t{group}\t{page}\t{preferred or 'ranked page image'}")
        return 0

    resolved_count = 0
    failures = []
    for group, directory, slug, page, preferred in targets:
        destination = args.output / directory / f"{slug}.png"
        asset_key = f"{directory}/{slug}.png"
        try:
            source_url = ""
            referer = ""
            if preferred:
                source_url, referer = resolve_image(opener, page, preferred, group)
            elif group == "items":
                source_url = direct_item_urls.get(slug, "")
                referer = ITEMS_PAGE if source_url else ""
            if not source_url and not args.force:
                source_url = manifest.get(asset_key, {}).get("url", "")
                referer = f"{BASE}/wiki/{urllib.parse.quote(page.replace(' ', '_'))}" if source_url else ""
            if not source_url:
                source_url, referer = resolve_image(opener, page, preferred, group)
            manifest[asset_key] = {"group": group, "page": page, "url": source_url}
            resolved_count += 1
            print(f"url   {asset_key}\t{source_url}")
            if args.urls_only:
                continue
            payload, content_type = request_bytes(opener, source_url, {**IMAGE_HEADERS, "Referer": referer})
            save_png(payload, content_type, destination)
            print(f"saved {destination} ({len(payload):,} source bytes)")
        except (OSError, RuntimeError, urllib.error.URLError, json.JSONDecodeError, subprocess.CalledProcessError) as error:
            failures.append((asset_key, str(error)))
            print(f"error {asset_key}: {error}", file=sys.stderr)

    if resolved_count:
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"wrote {manifest_path}")
    if failures:
        print(f"\n{len(failures)} asset(s) failed; successful files were kept.", file=sys.stderr)
        return 1
    print(f"\nResolved {resolved_count} wiki asset URL(s){' without downloading' if args.urls_only else ' and saved PNGs'}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
