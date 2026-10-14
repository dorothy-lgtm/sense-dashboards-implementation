#!/usr/bin/env python3
"""Turn raw Kobo pulls into the aggregate JSON the dashboard reads.

Reads  raw/<key>.json, raw/<key>.schema.json, raw/manifest.json
Writes site/data/summary.json

Only aggregates leave this script: counts, dates, enumerator usernames, breakdowns by
the configured group-by fields (district / school), and the form's question list.
No row-level values, names or phone numbers are written, so the output is safe to
publish on a web page even when the raw exports are not.
"""
from __future__ import annotations

import json
import statistics
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import yaml

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "config" / "forms.yml"
RAW = ROOT / "raw"
OUT = ROOT / "site" / "data" / "summary.json"
EAT = ZoneInfo("Africa/Kampala")

NON_DATA_TYPES = {"calculate", "start", "end", "today", "deviceid", "username", "phonenumber",
                  "audit", "simserial", "subscriberid", "hidden"}


def parse_dt(s) -> datetime | None:
    if not s or not isinstance(s, str):
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:          # Kobo's _submission_time is UTC without an offset
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def last_segment(xpath: str) -> str:
    return xpath.rsplit("/", 1)[-1].lower()


def find_field(schema: list[dict], wanted: str) -> dict | None:
    w = wanted.lower()
    for q in schema:
        if last_segment(q["xpath"]) == w or q["name"].lower() == w:
            return q
    return None


def value_of(sub: dict, q: dict):
    v = sub.get(q["xpath"])
    if v is None:
        v = sub.get(q["name"])
    return v


def is_empty(v) -> bool:
    return v is None or v == "" or v == [] or v == {}


def summarize_form(form: dict, cfg: dict, now: datetime) -> dict:
    key = form["key"]
    raw_path, schema_path = RAW / f"{key}.json", RAW / f"{key}.schema.json"
    if not raw_path.exists() or not schema_path.exists():
        return {"key": key, "name": form.get("name", key), "uid": form["uid"], "error": "no data pulled"}

    subs: list[dict] = json.loads(raw_path.read_text())
    meta = json.loads(schema_path.read_text())
    schema: list[dict] = meta["questions"]
    choices: dict = meta.get("choices", {})
    q_cfg = cfg.get("quality", {})
    lookback = int(cfg["kobo"].get("lookback_days", 60))

    # --- timestamps -------------------------------------------------------------
    sub_times = [parse_dt(s.get("_submission_time")) for s in subs]
    starts = [parse_dt(s.get("start")) for s in subs]
    ends = [parse_dt(s.get("end")) for s in subs]
    local_starts = [st.astimezone(EAT) if st else (t.astimezone(EAT) if t else None)
                    for st, t in zip(starts, sub_times)]

    n = len(subs)
    valid_times = [t for t in sub_times if t]
    first = min(valid_times) if valid_times else None
    last = max(valid_times) if valid_times else None
    last_24h = sum(1 for t in valid_times if t >= now - timedelta(hours=24))
    last_7d = sum(1 for t in valid_times if t >= now - timedelta(days=7))

    # per-day (local date), zero-filled over the lookback window
    day_counts = Counter(ls.date().isoformat() for ls in local_starts if ls)
    by_day = []
    d = (now.astimezone(EAT) - timedelta(days=lookback - 1)).date()
    today = now.astimezone(EAT).date()
    # devices with a wrong clock can stamp future dates; show them rather than silently drop them
    end = max([today] + [ls.date() for ls in local_starts if ls])
    while d <= end:
        by_day.append({"date": d.isoformat(), "n": day_counts.get(d.isoformat(), 0)})
        d += timedelta(days=1)

    # --- durations --------------------------------------------------------------
    durations = []
    for st, en in zip(starts, ends):
        if st and en:
            durations.append((en - st).total_seconds() / 60)
    dur = {"n": len(durations)}
    if durations:
        srt = sorted(durations)
        dur.update({
            "median_min": round(statistics.median(srt), 1),
            "p10_min": round(srt[int(len(srt) * 0.10)], 1),
            "p90_min": round(srt[min(len(srt) - 1, int(len(srt) * 0.90))], 1),
        })

    # --- enumerators ------------------------------------------------------------
    enum_rows: dict[str, dict] = {}
    for s, t, st, en in zip(subs, sub_times, starts, ends):
        user = s.get("_submitted_by") or s.get("username") or "(unknown)"
        r = enum_rows.setdefault(user, {"user": user, "n": 0, "last": None, "durations": []})
        r["n"] += 1
        if t and (r["last"] is None or t > r["last"]):
            r["last"] = t
        if st and en:
            r["durations"].append((en - st).total_seconds() / 60)
    by_enumerator = []
    for r in sorted(enum_rows.values(), key=lambda x: -x["n"]):
        by_enumerator.append({
            "user": r["user"], "n": r["n"],
            "last_submission": r["last"].isoformat() if r["last"] else None,
            "median_min": round(statistics.median(r["durations"]), 1) if r["durations"] else None,
        })

    # --- group-by breakdowns ----------------------------------------------------
    by_group: dict[str, list] = {}
    group_found: dict[str, str] = {}
    group_missing: list[str] = []
    for g in form.get("group_by", []):
        q = find_field(schema, g)
        if not q:
            group_missing.append(g)
            continue
        group_found[g] = q["xpath"]
        labels = choices.get(q.get("select_from", ""), {})
        c = Counter()
        for s in subs:
            v = value_of(s, q)
            if is_empty(v):
                c["(blank)"] += 1
            else:
                c[labels.get(str(v), str(v))] += 1
        by_group[g] = [{"value": k, "n": v} for k, v in c.most_common(80)]

    # --- data quality -----------------------------------------------------------
    min_dur = float(q_cfg.get("min_duration_minutes", 5))
    max_dur = float(q_cfg.get("max_duration_minutes", 240))
    wh_start, wh_end = q_cfg.get("working_hours", [6, 20])
    too_fast, too_slow, out_of_hours, missing_gps = [], [], [], []
    for s, st, en, ls in zip(subs, starts, ends, local_starts):
        sid = s.get("_id")
        if st and en:
            m = (en - st).total_seconds() / 60
            if m < min_dur:
                too_fast.append(sid)
            elif m > max_dur:
                too_slow.append(sid)
        if ls and not (wh_start <= ls.hour < wh_end):
            out_of_hours.append(sid)
        geo = s.get("_geolocation")
        if not geo or geo[0] is None:
            missing_gps.append(sid)

    dedupe_qs = [q for q in (find_field(schema, k) for k in form.get("dedupe_key", [])) if q]
    duplicates = []
    if dedupe_qs:
        groups = defaultdict(list)
        for s in subs:
            kv = tuple(str(value_of(s, q)) for q in dedupe_qs)
            if all(x not in ("None", "") for x in kv):
                groups[kv].append(s.get("_id"))
        for kv, ids in groups.items():
            if len(ids) > 1:
                duplicates.append({"key": dict(zip([q["name"] for q in dedupe_qs], kv)), "n": len(ids), "ids": ids})
        duplicates.sort(key=lambda x: -x["n"])

    validation = Counter((s.get("_validation_status") or {}).get("label") or "not reviewed" for s in subs)

    # question completeness (share of submissions with a non-empty answer)
    completeness = []
    # questions inside repeat groups live in child records, so they are scored separately (not yet)
    data_qs = [q for q in schema if q["type"] not in NON_DATA_TYPES and not q.get("repeat")]
    if n:
        for q in data_qs:
            filled = sum(1 for s in subs if not is_empty(value_of(s, q)))
            completeness.append({"name": q["name"], "label": q["label"][:80], "type": q["type"],
                                 "pct": round(100 * filled / n, 1)})
        completeness.sort(key=lambda x: x["pct"])

    target = form.get("target")
    return {
        "key": key,
        "name": form.get("name", key),
        "uid": form["uid"],
        "kobo_name": meta.get("kobo_name"),
        "deployment_active": meta.get("deployment_active"),
        "totals": {
            "submissions": n,
            "kobo_reported_count": meta.get("deployment_submission_count"),
            "target": target,
            "pct_of_target": round(100 * n / target, 1) if target else None,
            "last_24h": last_24h,
            "last_7d": last_7d,
            "first_submission": first.isoformat() if first else None,
            "last_submission": last.isoformat() if last else None,
        },
        "by_day": by_day,
        "duration_minutes": dur,
        "by_enumerator": by_enumerator,
        "by_group": by_group,
        "group_fields_found": group_found,
        "group_fields_missing": group_missing,
        "dedupe_fields": [q["name"] for q in dedupe_qs],
        "validation": dict(validation),
        "quality": {
            "too_fast": {"n": len(too_fast), "ids": too_fast[:200], "threshold_min": min_dur},
            "too_slow": {"n": len(too_slow), "ids": too_slow[:200], "threshold_min": max_dur},
            "out_of_hours": {"n": len(out_of_hours), "ids": out_of_hours[:200], "hours": [wh_start, wh_end]},
            "missing_gps": {"n": len(missing_gps), "ids": missing_gps[:200]},
            "duplicates": {"n": sum(d["n"] - 1 for d in duplicates), "groups": duplicates[:100]},
        },
        "completeness_lowest": completeness[:25],
        "schema": [{"name": q["name"], "xpath": q["xpath"], "type": q["type"], "label": q["label"]} for q in schema],
    }


def main() -> int:
    cfg = yaml.safe_load(CONFIG.read_text())
    now = datetime.now(timezone.utc)
    manifest = json.loads((RAW / "manifest.json").read_text()) if (RAW / "manifest.json").exists() else {}
    forms = [summarize_form(f, cfg, now) for f in cfg["forms"]]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "generated_at": now.isoformat(),
        "pulled_at": manifest.get("pulled_at"),
        "timezone": "Africa/Kampala",
        "forms": forms,
    }, ensure_ascii=False, indent=1))
    ok = sum(1 for f in forms if "error" not in f)
    print(f"summary written for {ok}/{len(forms)} forms -> {OUT.relative_to(ROOT)}", file=sys.stderr)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
