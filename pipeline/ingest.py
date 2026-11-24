#!/usr/bin/env python3
"""Grumpire ETL: Fetch MiLB Hawk-Eye pitches (AAA + FSL) and Double-A (AA) outcome/heatmap data, emit static JSON."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import logging
import math
import time
from collections import defaultdict
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

# Sport IDs: 11 = Triple-A (Hawk-Eye), 12 = Double-A (Stringer pixel x/y + outcomes), 14 = Single-A FSL (Hawk-Eye)
SPORT_LABELS = {11: "AAA", 12: "AA", 14: "FSL"}
HAWKEYE_LEVELS = {"AAA", "FSL"}

# Linear run-value difference (Ball RE minus Strike RE) by pre-pitch (balls, strikes) count
COUNT_CALL_SWING_RE = {
    (0, 0): 0.072, (1, 0): 0.088, (2, 0): 0.140, (3, 0): 0.215,
    (0, 1): 0.089, (1, 1): 0.114, (2, 1): 0.168, (3, 1): 0.295,
    (0, 2): 0.148, (1, 2): 0.186, (2, 2): 0.264, (3, 2): 0.445,
}

TAKEN_CALL_CODES = {"C", "B", "*B"}  # Excludes swings, fouls, pitchouts, intentional balls
STRIKEOUT_EVENTS = {"strikeout", "strikeout_double_play", "strikeout_triple_play"}

# Double-A 6x6 heatmap grid covers normalized stringer coordinates in [-1.8, 1.8] standard deviations
HEATMAP_GRID_SIZE = 6
HEATMAP_SPAN = 1.8


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


def extract_hp_umpire(feed: dict[str, Any], game_meta: dict[str, Any] | None = None) -> tuple[str, str]:
    officials = feed.get("liveData", {}).get("boxscore", {}).get("officials", [])
    if not officials and game_meta:
        officials = game_meta.get("officials", [])
    for entry in officials:
        if entry.get("officialType") == "Home Plate":
            off = entry.get("official", {})
            return str(off.get("id", "unknown")), off.get("fullName", "Unknown Umpire")
    return "unknown", "Unknown Umpire"


def process_game(session: requests.Session, game_meta: dict[str, Any], date_str: str) -> dict[str, Any] | None:
    game_pk = game_meta["gamePk"]
    sport_id = (
        game_meta.get("sportId")
        or game_meta.get("teams", {}).get("home", {}).get("team", {}).get("sport", {}).get("id")
    )

    feed = fetch_json(session, LIVE_FEED_URL.format(game_pk=game_pk))
    if not sport_id:
        sport_id = feed.get("gameData", {}).get("teams", {}).get("home", {}).get("sport", {}).get("id")
    level = SPORT_LABELS.get(sport_id, game_meta.get("_level", "MiLB"))
    ump_id, ump_name = extract_hp_umpire(feed, game_meta)

    teams = feed.get("gameData", {}).get("teams", {})
    away_team = teams.get("away", {}).get("abbreviation") or teams.get("away", {}).get("name", "AWY")
    home_team = teams.get("home", {}).get("abbreviation") or teams.get("home", {}).get("name", "HME")
    venue_obj = feed.get("gameData", {}).get("venue", {}) or game_meta.get("venue", {}) or {}
    venue_name = venue_obj.get("name", "")
    venue_id = venue_obj.get("id")

    linescore = feed.get("liveData", {}).get("linescore", {}).get("teams", {})
    away_runs = int(linescore.get("away", {}).get("runs", 0) or 0)
    home_runs = int(linescore.get("home", {}).get("runs", 0) or 0)

    all_plays = feed.get("liveData", {}).get("plays", {}).get("allPlays", [])
    pitches_out: list[dict[str, Any]] = []

    total_pitches = 0
    taken_pitches = 0
    called_strikes = 0
    plate_appearances = 0
    strikeouts = 0
    walks = 0
    ejections = 0

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

    # Double-A stringer pixel coordinates for taken pitches
    aa_taken_raw: list[dict[str, Any]] = []

    for play in all_plays:
        pre_b, pre_s = 0, 0
        play_events = play.get("playEvents", [])
        play_review = play.get("reviewDetails") or {}
        batter_name = play.get("matchup", {}).get("batter", {}).get("fullName", "")
        pitcher_name = play.get("matchup", {}).get("pitcher", {}).get("fullName", "")
        inning = play.get("about", {}).get("inning", 1)
        half = "T" if play.get("about", {}).get("isTopInning", True) else "B"

        if play.get("about", {}).get("isComplete"):
            plate_appearances += 1
            res_event = play.get("result", {}).get("eventType", "")
            if res_event in STRIKEOUT_EVENTS:
                strikeouts += 1
            elif res_event == "walk":
                walks += 1
            elif res_event == "ejection":
                ejections += 1

        for idx, ev in enumerate(play_events):
            ev_type = ev.get("details", {}).get("eventType", "") or ev.get("type", "")
            if ev_type == "ejection" or "ejection" in str(ev.get("details", {}).get("description", "")).lower():
                ejections += 1

            if not ev.get("isPitch"):
                continue

            total_pitches += 1
            call_code = ev.get("details", {}).get("call", {}).get("code", "")
            pitch_data = ev.get("pitchData", {})
            coords = pitch_data.get("coordinates", {})
            px = coords.get("pX")
            pz = coords.get("pZ")
            sz_top = pitch_data.get("strikeZoneTop")
            sz_bot = pitch_data.get("strikeZoneBottom")

            if call_code in TAKEN_CALL_CODES:
                taken_pitches += 1
                if call_code == "C":
                    called_strikes += 1

            # 1. Hawk-Eye evaluation path (AAA & FSL)
            if (
                level != "AA"
                and call_code in TAKEN_CALL_CODES
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

            # 2. Double-A (sportId=12) stringer pixel coordinate path (NO fake pX/pZ or accuracy!)
            elif level == "AA" and call_code in TAKEN_CALL_CODES:
                gx = coords.get("x")
                gy = coords.get("y")
                init_call = "strike" if call_code == "C" else "ball"
                aa_taken_raw.append({
                    "inn": f"{half}{inning}",
                    "cnt": f"{pre_b}-{pre_s}",
                    "bat": batter_name,
                    "pit": pitcher_name,
                    "gx": round(float(gx), 2) if gx is not None else None,
                    "gy": round(float(gy), 2) if gy is not None else None,
                    "init": init_call,
                    "true": None,
                    "ok": None,
                    "err_in": None,
                    "margin_in": None,
                    "chal": False,
                    "ovt": False,
                    "re": None,
                })

            # Advance pre-pitch count using post-event count
            post_cnt = ev.get("count", {})
            pre_b = min(int(post_cnt.get("balls", pre_b)), 3)
            pre_s = min(int(post_cnt.get("strikes", pre_s)), 2)

    # Double-A game document: outcome-based metrics + stringer pixel coordinates (accuracy fields explicitly null)
    if level == "AA":
        if taken_pitches < 20:
            log.info("Skipping AA game %s (%s @ %s): insufficient taken pitches (%d)",
                     game_pk, away_team, home_team, taken_pitches)
            return None

        # Within-game preliminary normalization of (gx, gy) (venue-wide normalization is refined in rebuild_aggregates)
        valid_xy = [(p["gx"], p["gy"]) for p in aa_taken_raw if p["gx"] is not None and p["gy"] is not None]
        if len(valid_xy) >= 10:
            mean_x = sum(pt[0] for pt in valid_xy) / len(valid_xy)
            mean_y = sum(pt[1] for pt in valid_xy) / len(valid_xy)
            std_x = max(math.sqrt(sum((pt[0] - mean_x) ** 2 for pt in valid_xy) / len(valid_xy)), 15.0)
            std_y = max(math.sqrt(sum((pt[1] - mean_y) ** 2 for pt in valid_xy) / len(valid_xy)), 15.0)
            for p in aa_taken_raw:
                if p["gx"] is not None and p["gy"] is not None:
                    # Gameday x increases left-to-right; y increases top-to-bottom (invert y so high pitches have +norm_y)
                    p["nx"] = round((p["gx"] - mean_x) / std_x, 3)
                    p["ny"] = round((mean_y - p["gy"]) / std_y, 3)

        cs_pct = round((called_strikes / taken_pitches) * 100.0, 1) if taken_pitches else 0.0
        k_pct = round((strikeouts / plate_appearances) * 100.0, 1) if plate_appearances else 0.0
        bb_pct = round((walks / plate_appearances) * 100.0, 1) if plate_appearances else 0.0

        return {
            "game_pk": game_pk,
            "date": date_str,
            "level": "AA",
            "venue_id": venue_id,
            "venue": venue_name,
            "away": away_team,
            "home": home_team,
            "away_runs": away_runs,
            "home_runs": home_runs,
            "umpire_id": ump_id,
            "umpire_name": ump_name,
            "total_pitches": total_pitches,
            "taken": taken_pitches,
            "taken_pitches": taken_pitches,
            "called_strikes": called_strikes,
            "called_strike_pct": cs_pct,
            "plate_appearances": plate_appearances,
            "strikeouts": strikeouts,
            "walks": walks,
            "k_pct": k_pct,
            "bb_pct": bb_pct,
            "runs_scored": away_runs + home_runs,
            "ejections": ejections,
            # Coordinate-dependent fields explicitly null for Double-A
            "correct": None,
            "missed": None,
            "acc_pct": None,
            "accuracy_pct": None,
            "tol_acc_pct": None,
            "consistency_pct": None,
            "expected_accuracy_pct": None,
            "favor_runs": None,
            "cs_acc_pct": None,
            "cb_acc_pct": None,
            "mean_miss_in": None,
            "challenges": 0,
            "overturns": 0,
            "unchallenged_misses": None,
            "re_impact": None,
            "pitches": aa_taken_raw,
        }

    # Hawk-Eye game document (AAA & FSL)
    total_taken = len(pitches_out)
    if total_taken < 20:
        log.info("Skipping game %s (%s @ %s - %s): insufficient Hawk-Eye pitches (%d)",
                 game_pk, away_team, home_team, venue_name, total_taken)
        return None

    missed_total = total_taken - raw_correct
    cs_pct = round((cs_total / total_taken) * 100.0, 1) if total_taken else 0.0
    k_pct = round((strikeouts / plate_appearances) * 100.0, 1) if plate_appearances else 0.0
    bb_pct = round((walks / plate_appearances) * 100.0, 1) if plate_appearances else 0.0

    return {
        "game_pk": game_pk,
        "date": date_str,
        "level": level,
        "venue_id": venue_id,
        "venue": venue_name,
        "away": away_team,
        "home": home_team,
        "away_runs": away_runs,
        "home_runs": home_runs,
        "umpire_id": ump_id,
        "umpire_name": ump_name,
        "total_pitches": total_pitches,
        "taken": total_taken,
        "taken_pitches": total_taken,
        "called_strikes": cs_total,
        "called_strike_pct": cs_pct,
        "plate_appearances": plate_appearances,
        "strikeouts": strikeouts,
        "walks": walks,
        "k_pct": k_pct,
        "bb_pct": bb_pct,
        "runs_scored": away_runs + home_runs,
        "ejections": ejections,
        "correct": raw_correct,
        "missed": missed_total,
        "acc_pct": round((raw_correct / total_taken) * 100.0, 1),
        "tol_acc_pct": round((tol_correct / tol_eval_total) * 100.0, 1) if tol_eval_total else 100.0,
        "cs_acc_pct": round((cs_correct / cs_total) * 100.0, 1) if cs_total else 100.0,
        "cb_acc_pct": round((cb_correct / cb_total) * 100.0, 1) if cb_total else 100.0,
        "mean_miss_in": round(sum(miss_distances) / len(miss_distances), 2) if miss_distances else 0.0,
        "challenges": challenges,
        "overturns": overturns,
        "unchallenged_misses": unchallenged_misses,
        "re_impact": round(abs_re_swing, 2),
        "pitches": pitches_out,
    }


def ingest_date(session: requests.Session, date_str: str, data_dir: Path, sport_ids: str = "11,12,14") -> int:
    log.info("Fetching MiLB schedule (sportId=%s) for %s ...", sport_ids, date_str)
    sched = fetch_json(session, SCHEDULE_URL, params={
        "sportId": sport_ids,
        "date": date_str,
        "gameTypes": "R,F,D,L,W",
        "hydrate": "officials",
    })

    games_raw: list[dict[str, Any]] = []
    for d_block in sched.get("dates", []):
        for g in d_block.get("games", []):
            state = g.get("status", {}).get("abstractGameState", "")
            sport_id = g.get("sportId") or g.get("teams", {}).get("home", {}).get("team", {}).get("sport", {}).get("id")
            game_type = g.get("gameType", "R")
            # For Double-A (sportId=12), filter strictly for Regular Season ("R") and Final
            if sport_id == 12 and game_type != "R":
                continue
            if state == "Final":
                g["_level"] = SPORT_LABELS.get(sport_id, "MiLB")
                games_raw.append(g)

    log.info("Found %d Final MiLB games on %s", len(games_raw), date_str)
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

    daily_cards.sort(key=lambda c: (c["level"], -(c["missed"] or 0), -(c.get("taken") or 0)))
    if daily_cards:
        (dates_dir / f"{date_str}.json").write_text(
            json.dumps({"date": date_str, "games": daily_cards}, indent=2), encoding="utf-8"
        )
    return len(daily_cards)


def _new_ump_bucket(uid: str, name: str) -> dict[str, Any]:
    return {
        "umpire_id": uid,
        "umpire_name": name,
        "levels": set(),
        "games": 0,
        "hawkeye_games": 0,
        "aa_games": 0,
        "total_pitches": 0,
        "taken": 0,
        "hawkeye_taken": 0,
        "called_strikes": 0,
        "plate_appearances": 0,
        "strikeouts": 0,
        "walks": 0,
        "runs_scored": 0,
        "ejections": 0,
        "correct": 0,
        "missed": 0,
        "tol_weighted": 0.0,
        "miss_sum_in": 0.0,
        "challenges": 0,
        "overturns": 0,
        "re_impact": 0.0,
        "heatmap_cs": [[0] * HEATMAP_GRID_SIZE for _ in range(HEATMAP_GRID_SIZE)],
        "heatmap_tot": [[0] * HEATMAP_GRID_SIZE for _ in range(HEATMAP_GRID_SIZE)],
        "game_log": [],
    }


def _accumulate_game_into_bucket(
    rec: dict[str, Any],
    g: dict[str, Any],
    venue_stats: dict[str, tuple[float, float, float, float]],
) -> None:
    lvl = g["level"]
    rec["levels"].add(lvl)
    rec["games"] += 1

    taken = int(g.get("taken") or 0)
    pitches_list = g.get("pitches") or []

    # Backwards-compatible outcome fallbacks for older game JSONs created before outcome fields were added
    tot_pitches = int(g.get("total_pitches") or (taken * 2))
    if "called_strikes" in g and g["called_strikes"] is not None:
        cs_count = int(g["called_strikes"])
    else:
        cs_count = sum(1 for p in pitches_list if p.get("init") == "strike")

    pa_count = int(g.get("plate_appearances") or 0)
    k_count = int(g.get("strikeouts") or 0)
    bb_count = int(g.get("walks") or 0)
    runs_count = int(g.get("runs_scored") if g.get("runs_scored") is not None else (int(g.get("away_runs") or 0) + int(g.get("home_runs") or 0)))
    ej_count = int(g.get("ejections") or 0)

    rec["total_pitches"] += tot_pitches
    rec["taken"] += taken
    rec["called_strikes"] += cs_count
    rec["plate_appearances"] += pa_count
    rec["strikeouts"] += k_count
    rec["walks"] += bb_count
    rec["runs_scored"] += runs_count
    rec["ejections"] += ej_count

    if lvl == "AA" or g.get("acc_pct") is None:
        rec["aa_games"] += 1
        v_key = str(g.get("venue_id") or g.get("venue") or "default")
        mean_x, std_x, mean_y, std_y = venue_stats.get(v_key, (125.0, 28.0, 165.0, 28.0))
        for p in pitches_list:
            gx = p.get("gx")
            gy = p.get("gy")
            if gx is not None and gy is not None:
                nx = (float(gx) - mean_x) / std_x
                ny = (mean_y - float(gy)) / std_y
            else:
                nx = p.get("nx")
                ny = p.get("ny")
            if nx is None or ny is None:
                continue
            col = int(((nx + HEATMAP_SPAN) / (2.0 * HEATMAP_SPAN)) * HEATMAP_GRID_SIZE)
            row = int(((HEATMAP_SPAN - ny) / (2.0 * HEATMAP_SPAN)) * HEATMAP_GRID_SIZE)
            if 0 <= row < HEATMAP_GRID_SIZE and 0 <= col < HEATMAP_GRID_SIZE:
                rec["heatmap_tot"][row][col] += 1
                if p.get("init") == "strike":
                    rec["heatmap_cs"][row][col] += 1
    else:
        rec["hawkeye_games"] += 1
        rec["hawkeye_taken"] += taken
        rec["correct"] += int(g.get("correct") or 0)
        rec["missed"] += int(g.get("missed") or 0)
        rec["tol_weighted"] += float(g.get("tol_acc_pct") or 0.0) * taken
        rec["miss_sum_in"] += float(g.get("mean_miss_in") or 0.0) * int(g.get("missed") or 0)
        rec["challenges"] += int(g.get("challenges") or 0)
        rec["overturns"] += int(g.get("overturns") or 0)
        rec["re_impact"] += float(g.get("re_impact") or 0.0)

    cs_pct_game = g.get("called_strike_pct")
    if cs_pct_game is None:
        cs_pct_game = round((cs_count / taken) * 100.0, 1) if taken else 0.0

    rec["game_log"].append({
        "game_pk": g["game_pk"],
        "date": g["date"],
        "level": lvl,
        "matchup": f"{g['away']} @ {g['home']}",
        "taken": taken,
        "called_strikes": cs_count,
        "called_strike_pct": cs_pct_game,
        "k_pct": g.get("k_pct"),
        "bb_pct": g.get("bb_pct"),
        "runs_scored": runs_count,
        "ejections": ej_count,
        "missed": g.get("missed"),
        "acc_pct": g.get("acc_pct"),
        "tol_acc_pct": g.get("tol_acc_pct"),
        "overturns": g.get("overturns"),
        "re_impact": g.get("re_impact"),
    })


def _summarize_bucket(rec: dict[str, Any], include_heatmap: bool = False) -> dict[str, Any]:
    taken = rec["taken"]
    he_taken = rec["hawkeye_taken"]
    missed = rec["missed"]
    games = rec["games"]
    pa = rec["plate_appearances"]
    levels_sorted = sorted(rec["levels"])
    has_hawkeye = rec["hawkeye_games"] > 0 and he_taken > 0

    acc_pct = round((rec["correct"] / he_taken) * 100.0, 1) if has_hawkeye else None
    tol_acc_pct = round(rec["tol_weighted"] / he_taken, 1) if has_hawkeye else None
    mean_miss_in = round(rec["miss_sum_in"] / missed, 2) if (has_hawkeye and missed) else (0.0 if has_hawkeye else None)
    overturn_pct = round((rec["overturns"] / rec["challenges"]) * 100.0, 1) if (has_hawkeye and rec["challenges"]) else (0.0 if has_hawkeye else None)
    re_impact = round(rec["re_impact"], 2) if has_hawkeye else None

    cs_pct = round((rec["called_strikes"] / taken) * 100.0, 1) if taken else 0.0
    k_pct = round((rec["strikeouts"] / pa) * 100.0, 1) if pa else None
    bb_pct = round((rec["walks"] / pa) * 100.0, 1) if pa else None
    runs_per_game = round(rec["runs_scored"] / games, 2) if games else 0.0

    summary: dict[str, Any] = {
        "umpire_id": rec["umpire_id"],
        "umpire_name": rec["umpire_name"],
        "levels": levels_sorted,
        "games": games,
        "total_pitches": rec["total_pitches"],
        "taken": taken,
        "taken_pitches": taken,
        "called_strikes": rec["called_strikes"],
        "called_strike_pct": cs_pct,
        "plate_appearances": pa,
        "k_pct": k_pct,
        "bb_pct": bb_pct,
        "runs_per_game": runs_per_game,
        "ejections": rec["ejections"],
        "missed": missed if has_hawkeye else None,
        "acc_pct": acc_pct,
        "accuracy_pct": acc_pct,
        "tol_acc_pct": tol_acc_pct,
        "consistency_pct": tol_acc_pct,
        "expected_accuracy_pct": None,
        "favor_runs": re_impact,
        "mean_miss_in": mean_miss_in,
        "challenges": rec["challenges"] if has_hawkeye else None,
        "overturns": rec["overturns"] if has_hawkeye else None,
        "overturn_pct": overturn_pct,
        "re_impact": re_impact,
    }

    if include_heatmap and rec["aa_games"] > 0:
        grid_rates: list[list[dict[str, Any]]] = []
        for r in range(HEATMAP_GRID_SIZE):
            row_cells: list[dict[str, Any]] = []
            for c in range(HEATMAP_GRID_SIZE):
                tot_c = rec["heatmap_tot"][r][c]
                cs_c = rec["heatmap_cs"][r][c]
                row_cells.append({
                    "taken": tot_c,
                    "cs": cs_c,
                    "cs_pct": round((cs_c / tot_c) * 100.0, 1) if tot_c else None,
                })
            grid_rates.append(row_cells)
        summary["aa_heatmap"] = {
            "grid_size": HEATMAP_GRID_SIZE,
            "span_sd": HEATMAP_SPAN,
            "cells": grid_rates,
        }

    return summary


def rebuild_aggregates(data_dir: Path) -> None:
    games_dir = data_dir / "games"
    dates_dir = data_dir / "dates"
    umps_dir = data_dir / "umpires"
    umps_dir.mkdir(parents=True, exist_ok=True)

    game_files = sorted(games_dir.glob("*.json"))

    # Pass 1: Compute empirical mean and standard deviation of stringer (gx, gy) per Double-A venue
    venue_xy: dict[str, list[tuple[float, float]]] = defaultdict(list)
    for g_file in game_files:
        g = json.loads(g_file.read_text(encoding="utf-8"))
        if g.get("level") != "AA":
            continue
        v_key = str(g.get("venue_id") or g.get("venue") or "default")
        for p in g.get("pitches") or []:
            gx = p.get("gx")
            gy = p.get("gy")
            if gx is not None and gy is not None:
                venue_xy[v_key].append((float(gx), float(gy)))

    venue_stats: dict[str, tuple[float, float, float, float]] = {}
    for v_key, pts in venue_xy.items():
        if len(pts) >= 10:
            mx = sum(p[0] for p in pts) / len(pts)
            my = sum(p[1] for p in pts) / len(pts)
            sx = max(math.sqrt(sum((p[0] - mx) ** 2 for p in pts) / len(pts)), 15.0)
            sy = max(math.sqrt(sum((p[1] - my) ** 2 for p in pts) / len(pts)), 15.0)
            venue_stats[v_key] = (mx, sx, my, sy)

    # Pass 2: Accumulate per-season and multi-level split records so AA never contaminates AAA/FSL Hawk-Eye averages
    # Keys:
    # - Hawkeye + combined ump_by_year[year][uid] (where Hawk-Eye fields only average over AAA/FSL games)
    # - Per-level splits ump_by_year_level[year][level][uid] for level in ("AAA", "FSL", "AA", "HAWKEYE")
    ump_by_year: dict[str, dict[str, dict[str, Any]]] = {"ALL": {}}
    ump_by_year_level: dict[str, dict[str, dict[str, dict[str, Any]]]] = {"ALL": defaultdict(dict)}
    totals_by_year: dict[str, dict[str, int]] = {"ALL": {"games": 0, "pitches": 0}}
    years_found: set[str] = set()

    for g_file in game_files:
        g = json.loads(g_file.read_text(encoding="utf-8"))
        uid = str(g.get("umpire_id", "unknown"))
        if uid == "unknown":
            continue

        year = g["date"][:4]
        lvl = g["level"]
        years_found.add(year)
        ump_by_year.setdefault(year, {})
        ump_by_year_level.setdefault(year, defaultdict(dict))
        totals_by_year.setdefault(year, {"games": 0, "pitches": 0})

        for bucket_key in ("ALL", year):
            totals_by_year[bucket_key]["games"] += 1
            totals_by_year[bucket_key]["pitches"] += int(g.get("taken") or 0)

            # Overall record for this umpire in this season
            rec_all = ump_by_year[bucket_key].setdefault(uid, _new_ump_bucket(uid, g["umpire_name"]))
            _accumulate_game_into_bucket(rec_all, g, venue_stats)

            # Exact level split ("AAA", "AA", "FSL")
            rec_lvl = ump_by_year_level[bucket_key][lvl].setdefault(uid, _new_ump_bucket(uid, g["umpire_name"]))
            _accumulate_game_into_bucket(rec_lvl, g, venue_stats)

            # Combined Hawk-Eye-only split ("HAWKEYE" = AAA + FSL)
            if lvl in HAWKEYE_LEVELS:
                rec_he = ump_by_year_level[bucket_key]["HAWKEYE"].setdefault(uid, _new_ump_bucket(uid, g["umpire_name"]))
                _accumulate_game_into_bucket(rec_he, g, venue_stats)

    def _lb_sort_key(u: dict[str, Any]) -> tuple[Any, ...]:
        # Place Hawk-Eye graded umpires ordered by lowest tol_acc_pct first, followed by AA-only ordered by called_strike_pct desc
        if u.get("tol_acc_pct") is not None:
            return (0, u["tol_acc_pct"], u["acc_pct"], -(u["missed"] or 0))
        return (1, -(u.get("called_strike_pct") or 0.0), -(u.get("games") or 0))

    leaderboards_by_year: dict[str, list[dict[str, Any]]] = {}
    for bucket_key, ump_map in ump_by_year.items():
        lb: list[dict[str, Any]] = []
        for uid, rec in ump_map.items():
            summary = _summarize_bucket(rec, include_heatmap=False)
            # Attach per-level splits ("AAA", "AA", "FSL", "HAWKEYE") right on the leaderboard entry & profile JSON!
            level_splits: dict[str, dict[str, Any]] = {}
            for lvl_key, lvl_map in ump_by_year_level[bucket_key].items():
                if uid in lvl_map:
                    level_splits[lvl_key] = _summarize_bucket(
                        lvl_map[uid],
                        include_heatmap=(lvl_key == "AA" and bucket_key == "ALL"),
                    )
            summary["level_splits"] = level_splits
            lb.append(summary)

            if bucket_key == "ALL":
                rec["game_log"].sort(key=lambda x: x["date"], reverse=True)
                # Build per-year + per-level splits for the umpire profile modal
                season_splits: dict[str, dict[str, Any]] = {}
                for yr_key in ["ALL", *sorted(years_found, reverse=True)]:
                    yr_levels: dict[str, Any] = {}
                    if uid in ump_by_year.get(yr_key, {}):
                        yr_levels["ALL"] = _summarize_bucket(ump_by_year[yr_key][uid], include_heatmap=True)
                    for lk, lmap in ump_by_year_level.get(yr_key, {}).items():
                        if uid in lmap:
                            yr_levels[lk] = _summarize_bucket(lmap[uid], include_heatmap=(lk == "AA"))
                    if yr_levels:
                        season_splits[yr_key] = yr_levels

                profile_doc = {
                    **summary,
                    "aa_heatmap": level_splits.get("AA", {}).get("aa_heatmap"),
                    "season_splits": season_splits,
                    "game_log": rec["game_log"],
                }
                (umps_dir / f"{uid}.json").write_text(
                    json.dumps(profile_doc, indent=2), encoding="utf-8"
                )

        lb.sort(key=_lb_sort_key)
        leaderboards_by_year[bucket_key] = lb
        if bucket_key == "ALL":
            (umps_dir / "leaderboard.json").write_text(json.dumps(lb, indent=2), encoding="utf-8")
        else:
            (umps_dir / f"leaderboard_{bucket_key}.json").write_text(json.dumps(lb, indent=2), encoding="utf-8")

    available_dates = sorted([p.stem for p in dates_dir.glob("*.json")], reverse=True)
    available_years = sorted(years_found, reverse=True)
    year_totals = {
        yr: {
            "games": totals_by_year[yr]["games"],
            "pitches": totals_by_year[yr]["pitches"],
            "umpires": len(leaderboards_by_year.get(yr, [])),
        }
        for yr in ["ALL", *available_years]
    }
    manifest = {
        "updated_utc": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "available_years": available_years,
        "available_dates": available_dates,
        "latest_date": available_dates[0] if available_dates else None,
        "totals": year_totals["ALL"],
        "totals_by_year": year_totals,
    }
    (data_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    log.info(
        "Aggregates rebuilt: %d games, %d umpires, %d dates across years %s.",
        year_totals["ALL"]["games"],
        year_totals["ALL"]["umpires"],
        len(available_dates),
        available_years,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Grumpire MiLB Umpire & ABS Pipeline")
    parser.add_argument("--date", help="Target YYYY-MM-DD (defaults to yesterday US Eastern)")
    parser.add_argument("--days-back", type=int, default=1, help="Number of days ending on --date to ingest")
    parser.add_argument("--sport-ids", default="11,12,14", help="Comma-separated MLB sportIds (default: 11,12,14)")
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
        ingest_date(session, d_str, data_dir, sport_ids=args.sport_ids)

    rebuild_aggregates(data_dir)


if __name__ == "__main__":
    main()
