#!/usr/bin/env python3
"""
Download verified baseball umpire photos from Wikipedia / Wikimedia Commons,
use macOS Vision face detection (/tmp/face_crop) to crop directly around the umpire's face
(or upper-head portrait region if Vision misses a cap-shaded face) into square 160x160
circular-ready PNG avatars under site/data/avatars/{umpire_id}.png, and emit site/data/avatars/index.json.
"""

from __future__ import annotations

import json
import logging
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("grumpire.avatars")

WIKI_API = "https://en.wikipedia.org/w/api.php"
FACE_CROP_BIN = Path("/tmp/face_crop")


def ensure_face_crop_binary() -> None:
    swift_src = Path(__file__).resolve().parent / "face_crop.swift"
    log.info("Compiling Swift Vision face-detection binary %s ...", FACE_CROP_BIN)
    subprocess.run(
        ["swiftc", "-module-cache-path", "/tmp/swift-cache", "-O", str(swift_src), "-o", str(FACE_CROP_BIN)],
        check=True,
    )


def crop_face_png(src_bytes: bytes, out_path: Path, size: int = 160) -> str | None:
    """Run macOS Vision face detector (/tmp/face_crop) to crop around the umpire's face/head."""
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
        tmp.write(src_bytes)
        tmp_path = Path(tmp.name)

    try:
        res = subprocess.run(
            [str(FACE_CROP_BIN), str(tmp_path), str(out_path), str(size)],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if res.returncode != 0 or not out_path.exists():
            return None
        return res.stdout.strip()
    except Exception:
        out_path.unlink(missing_ok=True)
        return None
    finally:
        tmp_path.unlink(missing_ok=True)


def main() -> None:
    ensure_face_crop_binary()

    data_dir = Path("site/data")
    lb_path = data_dir / "umpires" / "leaderboard.json"
    if not lb_path.exists():
        raise SystemExit("Run pipeline/ingest.py first.")

    umpires: list[dict[str, Any]] = json.loads(lb_path.read_text(encoding="utf-8"))
    avatars_dir = data_dir / "avatars"
    avatars_dir.mkdir(parents=True, exist_ok=True)

    # Clear any unverified web images
    for old_png in avatars_dir.glob("*.png"):
        old_png.unlink()

    session = requests.Session()
    session.headers.update({"User-Agent": "grumpire-milb-tracker/1.0 (https://github.com/csucg78/grumpire)"})

    by_name: dict[str, dict[str, Any]] = {}
    titles_to_check: list[str] = []
    for u in umpires:
        name = u["umpire_name"].strip()
        by_name[name.lower()] = u
        titles_to_check.append(name)
        titles_to_check.append(f"{name} (umpire)")

    avatar_index: dict[str, dict[str, str]] = {}

    log.info("Checking Wikipedia for %d umpires...", len(umpires))
    for i in range(0, len(titles_to_check), 40):
        batch = titles_to_check[i : i + 40]
        time.sleep(0.4)
        resp = session.get(
            WIKI_API,
            params={
                "action": "query",
                "redirects": 1,
                "titles": "|".join(batch),
                "prop": "pageimages|info|extracts",
                "exintro": 1,
                "explaintext": 1,
                "inprop": "url",
                "pithumbsize": 800,
                "format": "json",
            },
            timeout=20,
        )
        resp.raise_for_status()
        pages = resp.json().get("query", {}).get("pages", {})

        for page in pages.values():
            if "missing" in page:
                continue
            title = page.get("title", "")
            extract = (page.get("extract") or "").lower()
            if "umpire" not in extract:
                continue

            clean_name = title.replace(" (umpire)", "").strip().lower()
            u = by_name.get(clean_name)
            if not u:
                continue

            uid = str(u["umpire_id"])
            entry = avatar_index.setdefault(uid, {})
            entry["wiki_url"] = page.get("fullurl", "")
            thumb_url = page.get("thumbnail", {}).get("source")
            out_png = avatars_dir / f"{uid}.png"
            if thumb_url:
                time.sleep(0.15)
                img_resp = session.get(thumb_url, timeout=15)
                if img_resp.ok:
                    mode = crop_face_png(img_resp.content, out_png, size=160)
                    if mode:
                        entry["photo"] = f"./data/avatars/{uid}.png"
                        log.info("[Wiki+%s] Saved head-cropped PNG for %s (%s)", mode, u["umpire_name"], uid)

    index_file = avatars_dir / "index.json"
    index_file.write_text(json.dumps(avatar_index, indent=2), encoding="utf-8")
    total_photos = sum(1 for v in avatar_index.values() if "photo" in v)
    log.info("Done! %d verified Wikipedia umpire bios, %d head-cropped circular PNGs saved in site/data/avatars/.", len(avatar_index), total_photos)


if __name__ == "__main__":
    main()
