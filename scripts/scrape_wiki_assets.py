#!/usr/bin/env python3
"""Resolve and download real tracker PNGs from The Forever Winter wiki.

The script covers items, factions, quest givers, and traders. It asks MediaWiki
for original image URLs, waits five seconds between every network request,
downloads with browser-like headers and a same-origin referer, then converts any
CDN WebP/AVIF response back to PNG. Stable local filenames are used by the tracker.
"""

from __future__ import annotations

import argparse
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


def slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value).lower().replace("’", "").replace("'", "")
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", normalized))


def js_string(value: str) -> str:
    return json.loads(f'"{value}"')


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
    return {
        slugify(name): (ITEM_PAGE_OVERRIDES.get(name, name), "")
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
    if group != "factions":
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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--group", action="append", choices=sorted(set(GROUPS) | set(GROUP_ALIASES)), help="asset group; repeatable (default: all); portraits is an alias for questgivers")
    parser.add_argument("--only", action="append", help="asset slug or group:slug; repeatable")
    parser.add_argument("--output", type=Path, default=ASSET_ROOT, help="asset root containing items/, portraits/, factions/, and traders/")
    parser.add_argument("--delay", type=float, default=5.0, help="seconds between every network request (default: 5)")
    parser.add_argument("--force", action="store_true", help="replace existing PNG files")
    parser.add_argument("--urls-only", action="store_true", help="resolve source URLs and write the manifest without downloading")
    parser.add_argument("--print-plan", action="store_true", help="print page targets without using the network")
    return parser.parse_args()


def main() -> int:
    global REQUEST_DELAY_SECONDS
    args = parse_args()
    REQUEST_DELAY_SECONDS = max(0.0, args.delay)
    requested_groups = args.group or list(GROUPS)
    groups = list(dict.fromkeys(GROUP_ALIASES.get(group, group) for group in requested_groups))
    targets = selected_targets(groups, args.only)
    if args.print_plan:
        for group, directory, slug, page, preferred in targets:
            print(f"{directory}/{slug}.png\t{group}\t{page}\t{preferred or 'ranked page image'}")
        return 0

    opener = make_opener()
    manifest_path = args.output / "wiki-source-urls.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    except (OSError, json.JSONDecodeError):
        manifest = {}
    resolved_count = 0
    failures = []
    for group, directory, slug, page, preferred in targets:
        destination = args.output / directory / f"{slug}.png"
        asset_key = f"{directory}/{slug}.png"
        try:
            source_url, referer = resolve_image(opener, page, preferred, group)
            manifest[asset_key] = {"group": group, "page": page, "url": source_url}
            resolved_count += 1
            print(f"url   {asset_key}\t{source_url}")
            if args.urls_only:
                continue
            if destination.exists() and not args.force:
                print(f"skip  {destination} (already exists)")
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
