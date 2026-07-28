#!/usr/bin/env python3
"""Stamp web/js/collector.js with the deployed sync URL and emit web/bookmarklet.txt
as a single `javascript:` line (percent-encoded, so no newline/minify fragility)."""
import re, sys, pathlib, urllib.parse

ROOT = pathlib.Path(__file__).resolve().parent.parent
src = (ROOT / "web/js/collector.js").read_text()
cfg = (ROOT / "web/config.js").read_text()

sync_url = re.search(r'syncUrl:\s*"([^"]+)"', cfg)
if not sync_url:
    print("Could not find syncUrl in web/config.js"); sys.exit(1)
sync_url = sync_url.group(1)
p = urllib.parse.urlparse(sync_url)
sync_origin = f"{p.scheme}://{p.netloc}"

src = src.replace("__SYNC_URL__", sync_url).replace("__SYNC_ORIGIN__", sync_origin)
bookmarklet = "javascript:" + urllib.parse.quote(src, safe="")
(ROOT / "web/bookmarklet.txt").write_text(bookmarklet)
print(f"Wrote web/bookmarklet.txt ({len(bookmarklet)} chars)")
print(f"  syncUrl    = {sync_url}")
print(f"  syncOrigin = {sync_origin}")
