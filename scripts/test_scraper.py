#!/usr/bin/env python3

from pathlib import Path
import tempfile

from scrape_wiki_assets import WikiItemsParser, missing_targets, original_wiki_image_url, repair_targets


fixture = """
<table>
  <tr><th>Image</th><th>Item</th><th>Type</th><th>Weight</th></tr>
  <tr>
    <td><img src="/images/thumb/a/ab/ItemPortrait_Demo_Barrel.png/60px-ItemPortrait_Demo_Barrel.png"></td>
    <td><a href="/wiki/Water">Water</a></td><td>Large item</td><td>40</td>
  </tr>
  <tr>
    <td><a href="/wiki/Soap"><img src="//theforeverwinter.wiki.gg/images/1/12/T_Soap.png">Soap</a></td>
    <td>Junk</td><td>Small item</td><td>1</td>
  </tr>
</table>
"""

parser = WikiItemsParser()
parser.feed(fixture)

assert parser.items == [
    {
        "name": "Barrel of Water",
        "page": "Water",
        "icon_url": "https://theforeverwinter.wiki.gg/images/a/ab/ItemPortrait_Demo_Barrel.png",
    },
    {
        "name": "Soap",
        "page": "Soap",
        "icon_url": "https://theforeverwinter.wiki.gg/images/1/12/T_Soap.png",
    },
]
assert original_wiki_image_url("https://theforeverwinter.wiki.gg/images/f/foo.png") == "https://theforeverwinter.wiki.gg/images/f/foo.png"

with tempfile.TemporaryDirectory() as directory:
    output = Path(directory)
    (output / "items").mkdir()
    (output / "items" / "existing.png").write_bytes(b"png")
    targets = [
        ("items", "items", "existing", "Existing", "Correct.png"),
        ("items", "items", "missing", "Missing", ""),
    ]
    assert missing_targets(targets, output) == [targets[1]]
    manifest = {"items/existing.png": {"url": "https://example.test/images/Wrong.png"}}
    assert repair_targets(targets, output, manifest, {}) == [targets[0]]

print(f"Validated {len(parser.items)} scraper fixture rows, missing selection, and incorrect-icon repair selection.")
