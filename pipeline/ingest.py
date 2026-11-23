#!/usr/bin/env python3
"""Grumpire ETL: Fetch MiLB Hawk-Eye pitches, grade initial umpire calls, emit static JSON."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import logging
import math
import time
from pathlib import Path
from typing import Any

import requests

logging.basicConfig(level=logging.INFO, format="%(levelname)s | %(message)s")
log = logging.getLogger("grumpire")

SCHEDULE_URL = "https://statsapi.mlb.com/api/v1/schedule"
LIVE_FEED_URL = "https://statsapi.mlb.com/api/v1.1/game/{game_pk}/feed/live"

# Geometry constants (feet / inches)
HALF_PLATE_FT = (17.0 / 2.0) / 12.0       # 0.708333 ft (8.5 in)
BALL_RADIUS_FT = (2.94 / 2.0) / 12.0      # 0.122500 ft (1.47 in)
MOE_TOLERANCE_IN = 0.20                   # +/- 0.20 in Hawk-Eye tolerance band

# Sport IDs with public Hawk-Eye tracking
SPORT_LABELS = {11: "AAA", 14: "FSL"}

# Linear run-value difference (Ball RE minus Strike RE) by pre-pitch (balls, strikes) count
COUNT_CALL_SWING_RE = {
    (0, 0): 0.072, (1, 0): 0.088, (2, 0): 0.140, (3, 0): 0.215,
    (0, 1): 0.089, (1, 1): 0.114, (2, 1): 0.168, (3, 1): 0.295,
    (0, 2): 0.148, (1, 2): 0.186, (2, 2): 0.264, (3, 2): 0.445,
}

TAKEN_CALL_CODES = {"C", "B", "*B"}  # Excludes swings, fouls, pitchouts, intentional balls


def signed_margin_inches(px: float, pz: float, sz_top: float, sz_bot: float) -> float:
    """
    Signed distance in inches from the outer edge of the baseball to the 2D strike zone.
      <= 0.0 : True Strike (ball overlaps or touches zone boundary)
      >  0.0 : True Ball   (gap in inches between ball edge and zone boundary)
    """
    out_x = abs(px) - HALF_PLATE_FT
    out_z = max(pz - sz_top, sz_bot - pz)
    if out_x > 0.0 or out_z > 0.0:
        dist_to_rect_ft = math.hypot(max(out_x, 0.0), max(out_z, 0.0))
    else:
        dist_to_rect_ft = -min(-out_x, -out_z)
    return (dist_to_rect_ft - BALL_RADIUS_FT) * 12.0


def fetch_json(session: requests.Session, url: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    resp = session.get(url, params=params, timeout=25)
    resp.raise_for_status()
    return resp.json()


def extract_hp_umpire(feed: dict[str, Any]) -> tuple[str, str]:
    officials = feed.get("liveData", {}).get("boxscore", {}).get("officials", [])
    for entry in officials:
        if entry.get("officialType") == "Home Plate":
            off = entry.get("official", {})
            return str(off.get("id", "unknown")), off.get("fullName", "Unknown Umpire")
    return "unknown", "Unknown Umpire"


def process_game(session: requests.Session, game_meta: dict[str, Any], date_str: str) -> dict[str, Any] | None:
    game_pk = game_meta["gamePk"]
    sport_id = game_meta.get("teams", {}).get("home", {}).get("team", {}).get("sport", {}).get("id")
    level = SPORT_LABELS.get(sport_id, game_meta.get("_level", "MiLB"))

    feed = fetch_json(session, LIVE_FEED_URL.format(game_pk=game_pk))
    ump_id, ump_name = extract_hp_umpire(feed)

    teams = feed.get("gameData", {}).get("teams", {})
    away_team = teams.get("away", {}).get("abbreviation") or teams.get("away", {}).get("name", "AWY")
    home_team = teams.get("home", {}).get("abbreviation") or teams.get("home", {}).get("name", "HME")
    venue_name = feed.get("gameData", {}).get("venue", {}).get("name", "")

    linescore = feed.get("liveData", {}).get("linescore", {}).get("teams", {})
    away_runs = linescore.get("away", {}).get("runs", 0)
    home_runs = linescore.get("home", {}).get("runs", 0)

    all_plays = feed.get("liveData", {}).get("plays", {}).get("allPlays", [])
    pitches_out: list[dict[str, Any]] = []

    raw_correct = 0
    tol_eval_total = 0
    tol_correct = 0
    cs_total = 0
    cs_correct = 0
    cb_total = 0
    cb_correct = 0
    challenges = 0
    overturns = 0
    unchallenged_misses = 0
    miss_distances: list[float] = []
    abs_re_swing = 0.0

    for play in all_plays:
        pre_b, pre_s = 0, 0
        play_events = play.get("playEvents", [])
        play_review = play.get("reviewDetails") or {}
        batter_name = play.get("matchup", {}).get("batter", {}).get("fullName", "")
        pitcher_name = play.get("matchup", {}).get("pitcher", {}).get("fullName", "")
        inning = play.get("about", {}).get("inning", 1)
        half = "T" if play.get("about", {}).get("isTopInning", True) else "B"

        for idx, ev in enumerate(play_events):
            if not ev.get("isPitch"):
                continue

            call_code = ev.get("details", {}).get("call", {}).get("code", "")
            pitch_data = ev.get("pitchData", {})
            coords = pitch_data.get("coordinates", {})
            px = coords.get("pX")
            pz = coords.get("pZ")
            sz_top = pitch_data.get("strikeZoneTop")
            sz_bot = pitch_data.get("strikeZoneBottom")

            # Evaluate taken pitches with valid Hawk-Eye coordinates
            if (
                call_code in TAKEN_CALL_CODES
                and px is not None
                and pz is not None
                and sz_top is not None
                and sz_bot is not None
                and sz_top > sz_bot
            ):
                ev_review = ev.get("reviewDetails")
                if not ev_review and ev.get("hasReview") and idx == len(play_events) - 1:
                    ev_review = play_review

                challenged = bool(ev.get("hasReview") or ev_review)
                overturned = bool((ev_review or {}).get("isOverturned", False)) if challenged else False

                final_call = "strike" if call_code == "C" else "ball"
                init_call = ("ball" if final_call == "strike" else "strike") if overturned else final_call

                margin_in = signed_margin_inches(float(px), float(pz), float(sz_top), float(sz_bot))
                true_call = "strike" if margin_in <= 0.0 else "ball"
                is_correct = init_call == true_call
                outside_moe = abs(margin_in) > MOE_TOLERANCE_IN

                if is_correct:
                    raw_correct += 1
                else:
                    miss_distances.append(abs(margin_in))
                    if not challenged:
                        unchallenged_misses += 1

                if outside_moe:
                    tol_eval_total += 1
                    if is_correct:
                        tol_correct += 1

                if init_call == "strike":
                    cs_total += 1
                    if is_correct:
                        cs_correct += 1
                else:
                    cb_total += 1
                    if is_correct:
                        cb_correct += 1

                if challenged:
                    challenges += 1
                    if overturned:
                        overturns += 1

                re_delta = 0.0
                if not is_correct:
                    re_delta = COUNT_CALL_SWING_RE.get((min(pre_b, 3), min(pre_s, 2)), 0.10)
                    abs_re_swing += re_delta

                pz_norm = (float(pz) - float(sz_bot)) / (float(sz_top) - float(sz_bot))

                pitches_out.append({
                    "inn": f"{half}{inning}",
                    "cnt": f"{pre_b}-{pre_s}",
                    "bat": batter_name,
                    "pit": pitcher_name,
                    "px": round(float(px), 3),
                    "pz": round(float(pz), 3),
                    "pzn": round(pz_norm, 3),
                    "szt": round(float(sz_top), 3),
                    "szb": round(float(sz_bot), 3),
                    "init": init_call,
                    "true": true_call,
                    "ok": is_correct,
                    "err_in": round(abs(margin_in), 2) if not is_correct else 0.0,
                    "margin_in": round(margin_in, 2),
                    "chal": challenged,
                    "ovt": overturned,
                    "re": round(re_delta, 3),
                })

            # Advance pre-pitch count using post-event count
            post_cnt = ev.get("count", {})
            pre_b = min(int(post_cnt.get("balls", pre_b)), 3)
            pre_s = min(int(post_cnt.get("strikes", pre_s)), 2)

    total_taken = len(pitches_out)
    if total_taken < 20:
        log.info("Skipping game %s (%s @ %s - %s): insufficient Hawk-Eye pitches (%d)",
                 game_pk, away_team, home_team, venue_name, total_taken)
        return None

    missed_total = total_taken - raw_correct
    return {
        "game_pk": game_pk,
        "date": date_str,
        "level": level,
        "venue": venue_name,
        "away": away_team,
        "home": home_team,
        "away_runs": away_runs,
        "home_runs": home_runs,
        "umpire_id": ump_id,
        "umpire_name": ump_name,
        "taken": total_taken,
        "correct": raw_correct,
        "missed": missed_total,
        "acc_pct": round((raw_correct / total_taken) * 100.0, 2),
        "tol_acc_pct": round((tol_correct / tol_eval_total) * 100.0, 2) if tol_eval_total else 100.0,
        "cs_acc_pct": round((cs_correct / cs_total) * 100.0, 2) if cs_total else 100.0,
        "cb_acc_pct": round((cb_correct / cb_total) * 100.0, 2) if cb_total else 100.0,
        "mean_miss_in": round(sum(miss_distances) / len(miss_distances), 2) if miss_distances else 0.0,
        "challenges": challenges,
        "overturns": overturns,
        "unchallenged_misses": unchallenged_misses,
        "re_impact": round(abs_re_swing, 2),
        "pitches": pitches_out,
    }


def ingest_date(session: requests.Session, date_str: str, data_dir: Path) -> int:
    log.info("Fetching MiLB schedule for %s ...", date_str)
    sched = fetch_json(session, SCHEDULE_URL, params={
        "sportId": "11,14",
        "date": date_str,
        "gameTypes": "R,F,D,L,W",
    })

    games_raw: list[dict[str, Any]] = []
    for d_block in sched.get("dates", []):
        for g in d_block.get("games", []):
            state = g.get("status", {}).get("abstractGameState", "")
            sport_id = g.get("sportId") or g.get("teams", {}).get("home", {}).get("team", {}).get("sport", {}).get("id")
            if state == "Final":
                g["_level"] = SPORT_LABELS.get(sport_id, "MiLB")
                games_raw.append(g)

    log.info("Found %d Final AAA/FSL games on %s", len(games_raw), date_str)
    daily_cards: list[dict[str, Any]] = []

    games_dir = data_dir / "games"
    dates_dir = data_dir / "dates"
    games_dir.mkdir(parents=True, exist_ok=True)
    dates_dir.mkdir(parents=True, exist_ok=True)

    for g in games_raw:
        try:
            game_doc = process_game(session, g, date_str)
            time.sleep(0.15)
        except Exception as exc:
            log.warning("Failed game %s: %s", g.get("gamePk"), exc)
            continue

        if not game_doc:
            continue

        (games_dir / f"{game_doc['game_pk']}.json").write_text(
            json.dumps(game_doc, separators=(",", ":")), encoding="utf-8"
        )
        card = {k: v for k, v in game_doc.items() if k != "pitches"}
        daily_cards.append(card)

    daily_cards.sort(key=lambda c: (c["level"], -c["missed"]))
    if daily_cards:
        (dates_dir / f"{date_str}.json").write_text(
            json.dumps({"date": date_str, "games": daily_cards}, indent=2), encoding="utf-8"
        )
    return len(daily_cards)


def rebuild_aggregates(data_dir: Path) -> None:
    games_dir = data_dir / "games"
    dates_dir = data_dir / "dates"
    umps_dir = data_dir / "umpires"
    umps_dir.mkdir(parents=True, exist_ok=True)

    ump_map: dict[str, dict[str, Any]] = {}
    total_games = 0
    total_pitches = 0

    for g_file in sorted(games_dir.glob("*.json")):
        g = json.loads(g_file.read_text(encoding="utf-8"))
        uid = g["umpire_id"]
        if uid == "unknown":
            continue

        total_games += 1
        total_pitches += g["taken"]

        rec = ump_map.setdefault(uid, {
            "umpire_id": uid,
            "umpire_name": g["umpire_name"],
            "levels": set(),
            "games": 0,
            "taken": 0,
            "correct": 0,
            "missed": 0,
            "tol_weighted": 0.0,
            "miss_sum_in": 0.0,
            "challenges": 0,
            "overturns": 0,
            "re_impact": 0.0,
            "game_log": [],
        })

        rec["levels"].add(g["level"])
        rec["games"] += 1
        rec["taken"] += g["taken"]
        rec["correct"] += g["correct"]
        rec["missed"] += g["missed"]
        rec["tol_weighted"] += g["tol_acc_pct"] * g["taken"]
        rec["miss_sum_in"] += g["mean_miss_in"] * g["missed"]
        rec["challenges"] += g["challenges"]
        rec["overturns"] += g["overturns"]
        rec["re_impact"] += g["re_impact"]
        rec["game_log"].append({
            "game_pk": g["game_pk"],
            "date": g["date"],
            "level": g["level"],
            "matchup": f"{g['away']} @ {g['home']}",
            "taken": g["taken"],
            "missed": g["missed"],
            "acc_pct": g["acc_pct"],
            "overturns": g["overturns"],
            "re_impact": g["re_impact"],
        })

    leaderboard: list[dict[str, Any]] = []
    for uid, rec in ump_map.items():
        taken = rec["taken"]
        missed = rec["missed"]
        levels_sorted = sorted(rec["levels"])
        summary = {
            "umpire_id": uid,
            "umpire_name": rec["umpire_name"],
            "levels": levels_sorted,
            "games": rec["games"],
            "taken": taken,
            "missed": missed,
            "acc_pct": round((rec["correct"] / taken) * 100.0, 2) if taken else 0.0,
            "tol_acc_pct": round(rec["tol_weighted"] / taken, 2) if taken else 0.0,
            "mean_miss_in": round(rec["miss_sum_in"] / missed, 2) if missed else 0.0,
            "challenges": rec["challenges"],
            "overturns": rec["overturns"],
            "overturn_pct": round((rec["overturns"] / rec["challenges"]) * 100.0, 1) if rec["challenges"] else 0.0,
            "re_impact": round(rec["re_impact"], 2),
        }
        leaderboard.append(summary)

        rec["game_log"].sort(key=lambda x: x["date"], reverse=True)
        (umps_dir / f"{uid}.json").write_text(
            json.dumps({**summary, "game_log": rec["game_log"]}, indent=2), encoding="utf-8"
        )

    leaderboard.sort(key=lambda u: (-u["acc_pct"], u["missed"]))
    (umps_dir / "leaderboard.json").write_text(json.dumps(leaderboard, indent=2), encoding="utf-8")

    available_dates = sorted([p.stem for p in dates_dir.glob("*.json")], reverse=True)
    manifest = {
        "updated_utc": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "available_dates": available_dates,
        "latest_date": available_dates[0] if available_dates else None,
        "totals": {
            "games": total_games,
            "pitches": total_pitches,
            "umpires": len(leaderboard),
        },
    }
    (data_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    log.info("Aggregates rebuilt: %d games, %d umpires, %d dates.", total_games, len(leaderboard), len(available_dates))


def main() -> None:
    parser = argparse.ArgumentParser(description="Grumpire MiLB Umpire & ABS Pipeline")
    parser.add_argument("--date", help="Target YYYY-MM-DD (defaults to yesterday US Eastern)")
    parser.add_argument("--days-back", type=int, default=1, help="Number of days ending on --date to ingest")
    parser.add_argument("--data-dir", default="site/data", help="Output static JSON directory")
    args = parser.parse_args()

    if args.date:
        end_date = dt.date.fromisoformat(args.date)
    else:
        eastern_now = dt.datetime.now(dt.timezone(dt.timedelta(hours=-5)))
        end_date = (eastern_now - dt.timedelta(days=1)).date()

    data_dir = Path(args.data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)

    session = requests.Session()
    session.headers.update({"User-Agent": "grumpire-milb-tracker/1.0"})

    for offset in range(args.days_back - 1, -1, -1):
        d_str = (end_date - dt.timedelta(days=offset)).isoformat()
        ingest_date(session, d_str, data_dir)

    rebuild_aggregates(data_dir)


if __name__ == "__main__":
    main()
