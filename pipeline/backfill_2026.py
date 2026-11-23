#!/usr/bin/env python3
"""
Fast, rate-limited concurrent backfill for the 2026 MiLB (AAA + FSL) season.

Usage:
  python pipeline/backfill_2026.py
  python pipeline/backfill_2026.py --start 2026-03-27 --end 2026-09-28 --workers 10 --rps 12
"""

from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import json
import logging
import sys
import threading
import time
from collections import defaultdict
from pathlib import Path
from typing import Any

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# Ensure sibling imports work whether invoked from repo root or pipeline/
REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from pipeline.ingest import (  # noqa: E402
    SCHEDULE_URL,
    SPORT_LABELS,
    process_game,
    rebuild_aggregates,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("grumpire.backfill")

# 2026 MiLB regular season + postseason window (AAA opens late March; playoffs wrap late Sept)
DEFAULT_START = "2026-03-27"
DEFAULT_END = "2026-09-30"


class RateLimiter:
    """Thread-safe token interval limiter enforcing a global requests-per-second ceiling."""

    def __init__(self, rate_per_sec: float) -> None:
        self._interval = 1.0 / max(rate_per_sec, 0.5)
        self._lock = threading.Lock()
        self._next_slot = time.monotonic()

    def acquire(self) -> None:
        with self._lock:
            now = time.monotonic()
            if now < self._next_slot:
                wait_for = self._next_slot - now
                self._next_slot += self._interval
            else:
                wait_for = 0.0
                self._next_slot = now + self._interval
        if wait_for > 0.0:
            time.sleep(wait_for)


def build_pooled_session(pool_size: int) -> requests.Session:
    """Create a persistent HTTP keep-alive session with retry/backoff on 429 and 5xx."""
    session = requests.Session()
    session.headers.update({
        "User-Agent": "grumpire-milb-tracker/1.0",
        "Accept-Encoding": "gzip, deflate",
    })

    retry_strategy = Retry(
        total=5,
        connect=3,
        read=3,
        status=5,
        backoff_factor=0.8,  # 0.8s, 1.6s, 3.2s, 6.4s, 12.8s
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset(["GET"]),
        respect_retry_after_header=True,
    )
    adapter = HTTPAdapter(
        pool_connections=pool_size,
        pool_maxsize=pool_size * 2,
        max_retries=retry_strategy,
    )
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


def iter_date_chunks(start: dt.date, end: dt.date, chunk_days: int = 14) -> list[tuple[str, str]]:
    chunks: list[tuple[str, str]] = []
    cur = start
    while cur <= end:
        chunk_end = min(cur + dt.timedelta(days=chunk_days - 1), end)
        chunks.append((cur.isoformat(), chunk_end.isoformat()))
        cur = chunk_end + dt.timedelta(days=1)
    return chunks


def discover_season_games(
    session: requests.Session,
    limiter: RateLimiter,
    start_date: dt.date,
    end_date: dt.date,
) -> list[tuple[str, dict[str, Any]]]:
    """Fetch Final AAA (11) and FSL (14) games across 14-day schedule windows."""
    discovered: dict[int, tuple[str, dict[str, Any]]] = {}
    chunks = iter_date_chunks(start_date, end_date, chunk_days=14)
    log.info("Fetching 2026 schedule across %d date windows (%s -> %s)...", len(chunks), start_date, end_date)

    for s_str, e_str in chunks:
        limiter.acquire()
        resp = session.get(
            SCHEDULE_URL,
            params={
                "sportId": "11,14",
                "startDate": s_str,
                "endDate": e_str,
                "gameTypes": "R,F,D,L,W",
            },
            timeout=30,
        )
        resp.raise_for_status()
        payload = resp.json()

        for d_block in payload.get("dates", []):
            official_date = d_block.get("date")
            for g in d_block.get("games", []):
                state = g.get("status", {}).get("abstractGameState", "")
                if state != "Final":
                    continue
                game_pk = int(g["gamePk"])
                sport_id = (
                    g.get("sportId")
                    or g.get("teams", {}).get("home", {}).get("team", {}).get("sport", {}).get("id")
                )
                g["_level"] = SPORT_LABELS.get(sport_id, "MiLB")
                game_date = g.get("officialDate") or official_date
                # Keep the latest entry if a suspended/resumed game appears on two dates
                discovered[game_pk] = (game_date, g)

    ordered = sorted(discovered.values(), key=lambda item: (item[0], item[1]["gamePk"]))
    log.info("Discovered %d unique Final AAA/FSL games.", len(ordered))
    return ordered


def rebuild_all_date_slates(data_dir: Path) -> int:
    """Regenerate site/data/dates/YYYY-MM-DD.json cleanly from all stored game files."""
    games_dir = data_dir / "games"
    dates_dir = data_dir / "dates"
    dates_dir.mkdir(parents=True, exist_ok=True)

    by_date: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for g_file in games_dir.glob("*.json"):
        g = json.loads(g_file.read_text(encoding="utf-8"))
        card = {k: v for k, v in g.items() if k != "pitches"}
        by_date[g["date"]].append(card)

    for date_str, cards in by_date.items():
        cards.sort(key=lambda c: (c["level"], -c["missed"]))
        (dates_dir / f"{date_str}.json").write_text(
            json.dumps({"date": date_str, "games": cards}, indent=2),
            encoding="utf-8",
        )
    return len(by_date)


def main() -> None:
    parser = argparse.ArgumentParser(description="Concurrent 2026 MiLB Season Backfill for Grumpire")
    parser.add_argument("--start", default=DEFAULT_START, help=f"Start YYYY-MM-DD (default: {DEFAULT_START})")
    parser.add_argument("--end", default=DEFAULT_END, help=f"End YYYY-MM-DD (default: {DEFAULT_END})")
    parser.add_argument("--workers", type=int, default=10, help="Concurrent worker threads (default: 10)")
    parser.add_argument("--rps", type=float, default=12.0, help="Max global requests/sec (default: 12.0)")
    parser.add_argument("--data-dir", default="site/data", help="Output JSON directory (default: site/data)")
    parser.add_argument("--force", action="store_true", help="Re-fetch games even if JSON already exists")
    args = parser.parse_args()

    start_date = dt.date.fromisoformat(args.start)
    end_date = dt.date.fromisoformat(args.end)
    if end_date < start_date:
        raise SystemExit("--end must be on or after --start")

    data_dir = Path(args.data_dir)
    games_dir = data_dir / "games"
    skip_cache_file = data_dir / ".untracked_games.json"
    games_dir.mkdir(parents=True, exist_ok=True)

    # Track already-saved games AND previously-verified non-Hawk-Eye games (e.g., Daytona FSL)
    existing_pks = {int(p.stem) for p in games_dir.glob("*.json") if p.stem.isdigit()}
    untracked_pks: set[int] = set()
    if skip_cache_file.exists() and not args.force:
        untracked_pks = set(json.loads(skip_cache_file.read_text(encoding="utf-8")))

    limiter = RateLimiter(args.rps)
    session = build_pooled_session(pool_size=args.workers)

    all_games = discover_season_games(session, limiter, start_date, end_date)
    if args.force:
        todo = all_games
    else:
        todo = [
            (d_str, g)
            for d_str, g in all_games
            if int(g["gamePk"]) not in existing_pks and int(g["gamePk"]) not in untracked_pks
        ]

    log.info(
        "Queueing %d games to fetch (%d cached on disk, %d cached as untracked venues) at <= %.1f req/s...",
        len(todo),
        len(existing_pks),
        len(untracked_pks),
        args.rps,
    )

    saved_count = 0
    skipped_untracked = 0
    failed_count = 0
    untracked_lock = threading.Lock()
    t0 = time.monotonic()

    def fetch_and_grade(item: tuple[str, dict[str, Any]]) -> str:
        date_str, g_meta = item
        g_pk = int(g_meta["gamePk"])
        limiter.acquire()
        game_doc = process_game(session, g_meta, date_str)
        if game_doc is None:
            with untracked_lock:
                untracked_pks.add(g_pk)
            return "untracked"

        out_path = games_dir / f"{g_pk}.json"
        out_path.write_text(json.dumps(game_doc, separators=(",", ":")), encoding="utf-8")
        return "saved"

    if todo:
        # Silence verbose per-game skip logs from ingest.py during bulk runs
        logging.getLogger("grumpire").setLevel(logging.WARNING)

        with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
            futures = {pool.submit(fetch_and_grade, item): item for item in todo}
            done_total = 0

            for fut in concurrent.futures.as_completed(futures):
                done_total += 1
                _, g_meta = futures[fut]
                try:
                    status = fut.result()
                    if status == "saved":
                        saved_count += 1
                    else:
                        skipped_untracked += 1
                except Exception as exc:
                    failed_count += 1
                    log.warning("Game %s failed after retries: %s", g_meta.get("gamePk"), exc)

                if done_total % 100 == 0 or done_total == len(todo):
                    elapsed = max(time.monotonic() - t0, 0.001)
                    eff_rps = done_total / elapsed
                    eta_sec = (len(todo) - done_total) / max(eff_rps, 0.1)
                    log.info(
                        "Progress: %d/%d (%.1f%%) | saved=%d untracked=%d failed=%d | %.1f games/s | ETA %.0fs",
                        done_total,
                        len(todo),
                        (done_total / len(todo)) * 100.0,
                        saved_count,
                        skipped_untracked,
                        failed_count,
                        eff_rps,
                        eta_sec,
                    )

        skip_cache_file.write_text(json.dumps(sorted(untracked_pks)), encoding="utf-8")

    log.info("Rebuilding daily slate files and season umpire leaderboards...")
    logging.getLogger("grumpire").setLevel(logging.INFO)
    slate_days = rebuild_all_date_slates(data_dir)
    rebuild_aggregates(data_dir)

    total_sec = time.monotonic() - t0
    log.info(
        "2026 backfill complete in %.1fs — %d new games saved, %d slate dates built, %d failures.",
        total_sec,
        saved_count,
        slate_days,
        failed_count,
    )


if __name__ == "__main__":
    main()
