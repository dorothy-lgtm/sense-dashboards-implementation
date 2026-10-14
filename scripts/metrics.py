#!/usr/bin/env python3
"""Per-school metrics for the analytic dashboard pages.

Reads  raw/<key>.json + raw/<key>.schema.json (F, G, H), site/data/roster.json
Writes site/data/metrics.json

For every school on the roster: the answers from its latest Annex F and Annex G submission,
every Annex H term record, and every repeat-group child record (e.g. one row per structure).

Publication rule: only questions of these types are exported —
  integer, decimal, select_one, select_multiple, date, time, calculate, range
Free-text questions (names, phone numbers, notes), images and geopoints are never exported.
"""
from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "raw"
ROSTER = ROOT / "site" / "data" / "roster.json"
OUT = ROOT / "site" / "data" / "metrics.json"
CFG = yaml.safe_load((ROOT / "config" / "roster.yml").read_text())
DERIVED = yaml.safe_load((ROOT / "config" / "derived.yml").read_text()) if (ROOT / "config" / "derived.yml").exists() else {}

EXPORT_TYPES = {"integer", "decimal", "select_one", "select_multiple", "date", "time", "calculate", "range", "datetime"}
META_TIME = ("start", "end")


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def load_form(key: str):
    p, s = RAW / f"{key}.json", RAW / f"{key}.schema.json"
    if not p.exists() or not s.exists():
        return [], [], {}
    meta = json.loads(s.read_text())
    return json.loads(p.read_text()), meta["questions"], meta.get("choices", {})


def to_number(v):
    if isinstance(v, (int, float)):
        return v
    if isinstance(v, str):
        t = v.strip()
        if re.fullmatch(r"-?\d+", t):
            return int(t)
        if re.fullmatch(r"-?\d*\.\d+", t):
            return float(t)
    return None


def convert(q: dict, v, choices: dict):
    """Raw Kobo value → publishable value (labels for choices, numbers for numerics)."""
    if v is None or v == "":
        return None
    t = q["type"]
    if t in ("integer", "decimal", "range"):
        return to_number(v)
    if t == "calculate":
        n = to_number(v)
        return n if n is not None else (str(v)[:40] if len(str(v)) <= 40 else None)
    if t == "select_one":
        return choices.get(q.get("select_from", ""), {}).get(str(v), str(v))
    if t == "select_multiple":
        labels = choices.get(q.get("select_from", ""), {})
        items = v if isinstance(v, list) else str(v).split()
        return [labels.get(str(x), str(x)) for x in items]
    return str(v)


def answers_from(record: dict, questions: list[dict], choices: dict) -> dict:
    out = {}
    for q in questions:
        if q["type"] not in EXPORT_TYPES:
            continue
        v = record.get(q["xpath"])
        if v is None:
            v = record.get(q["name"])
        cv = convert(q, v, choices)
        if cv is not None:
            out[q["name"]] = cv
    return out


def split_questions(questions: list[dict]):
    top = [q for q in questions if not q.get("repeat")]
    reps: dict[str, list[dict]] = defaultdict(list)
    for q in questions:
        if q.get("repeat"):
            reps[q["repeat"]].append(q)
    return top, reps


def field(questions: list[dict], name: str) -> dict | None:
    n = name.lower()
    for q in questions:
        if q["xpath"].rsplit("/", 1)[-1].lower() == n or q["name"].lower() == n:
            return q
    return None


def sub_date(sub: dict, questions: list[dict]) -> str:
    for cand in ("enrollment_date", "completion_date", "visit_date"):
        q = field(questions, cand)
        if q:
            v = sub.get(q["xpath"]) or sub.get(q["name"])
            if v:
                return str(v)[:10]
    return str(sub.get("_submission_time", ""))[:10]


def derive_from_text(sub: dict, questions: list[dict]) -> dict:
    """Keyword flags from Annex F free-text fields (text is read here, never exported)."""
    texts = []
    for fname in DERIVED.get("text_fields", []):
        q = field(questions, fname)
        if q:
            v = sub.get(q["xpath"]) or sub.get(q["name"])
            if v:
                texts.append(str(v).lower())
    blob = " ".join(texts)
    out = {"has_notes": bool(blob.strip())}
    for group in ("practices", "cover"):
        for key, spec in DERIVED.get(group, {}).items():
            out[key] = any(str(k).lower() in blob for k in spec.get("keywords", [])) if blob else False
    return out


def resolve_qualification(answers: dict, sub: dict, questions: list[dict]) -> dict:
    """Nurse qualification with 'Other' resolved from the specify text; plus a qualified flag."""
    label = answers.get("nurse_qualification")
    resolved = label
    if label and "other" in str(label).lower():
        q = field(questions, "nurse_qualification_other")
        txt = str((sub.get(q["xpath"]) if q else "") or "").lower()
        for cat, kws in DERIVED.get("qualification_other_map", {}).items():
            if any(re.search(rf"\b{re.escape(k.lower())}\b", txt) for k in kws):
                resolved = cat
                break
    qualified = bool(resolved) and any(c in str(resolved).lower() for c in DERIVED.get("qualified_categories", []))
    return {"nurse_qualification_resolved": resolved, "nurse_qualified": qualified if resolved else None}


def duty_hours(answers: dict) -> float | None:
    """End minus start time in hours; equal times count as 24 h."""
    st, en = answers.get("nurse_start_time"), answers.get("nurse_endtime_time")
    if not st or not en:
        return None
    def mins(t):
        m = re.match(r"(\d{1,2}):(\d{2})", str(t))
        return int(m.group(1)) * 60 + int(m.group(2)) if m else None
    a, b = mins(st), mins(en)
    if a is None or b is None:
        return None
    d = (b - a) % 1440
    return 24.0 if d == 0 else round(d / 60, 1)


def main() -> int:
    if not ROSTER.exists():
        log("roster.json missing — run roster.py first")
        return 1
    roster = json.loads(ROSTER.read_text())
    schools = {s["code"]: {"code": s["code"], "name": s["name"], "district": s["district"], "region": s["region"],
                           "recruited": s["recruited"], "assessed": s["assessed"]} for s in roster["schools"]}
    fk = CFG["forms"]
    code_f = CFG["code_field"]
    fields_doc = {}

    for tag, key in (("F", fk["screening"]), ("G", fk["structure"]), ("H", fk["recruitment"])):
        subs, questions, choices = load_form(key)
        top, reps = split_questions(questions)
        cq = field(questions, code_f)
        fields_doc[tag] = {
            "top": [{"name": q["name"], "type": q["type"], "label": q["label"]} for q in top if q["type"] in EXPORT_TYPES],
            "repeats": {r: [{"name": q["name"], "type": q["type"], "label": q["label"]} for q in qs if q["type"] in EXPORT_TYPES] for r, qs in reps.items()},
        }
        per_school: dict[str, list[dict]] = defaultdict(list)
        for s in subs:
            code = s.get(cq["xpath"]) if cq else None
            if not code or str(code) not in schools:
                continue
            rec = {"id": s.get("_id"), "date": sub_date(s, questions), "submitted": s.get("_submission_time"),
                   "answers": answers_from(s, top, choices), "repeats": {}}
            if tag == "F":
                rec["answers"].update(derive_from_text(s, questions))
                rec["answers"].update(resolve_qualification(rec["answers"], s, questions))
                rec["answers"]["duty_hours"] = duty_hours(rec["answers"])
                days = rec["answers"].get("nurse_working_days")
                if isinstance(days, list):
                    rec["answers"]["working_days_n"] = len(days)
                    rec["answers"]["weekend_cover"] = any(str(d).lower().startswith(("sat", "sun")) for d in days)
            for rname, rqs in reps.items():
                children = s.get(rname) or []
                rec["repeats"][rname.rsplit("/", 1)[-1]] = [answers_from(c, rqs, choices) for c in children if isinstance(c, dict)]
            per_school[str(code)].append(rec)
        for code, recs in per_school.items():
            recs.sort(key=lambda r: (r["date"] or "", r["submitted"] or ""))
            latest = recs[-1]
            entry = {"n_submissions": len(recs), "latest_date": latest["date"], "answers": latest["answers"]}
            # repeat children from ALL submissions (e.g. every structure, every term) — de-duplicated
            merged: dict[str, list[dict]] = defaultdict(list)
            seen = set()
            for r in recs:
                for rname, rows in r["repeats"].items():
                    for row in rows:
                        k = json.dumps(row, sort_keys=True)
                        if k not in seen:
                            seen.add(k)
                            merged[rname].append(row)
            entry["repeats"] = dict(merged)
            schools[code][tag] = entry
        log(f"{tag}: {sum(len(v) for v in per_school.values())} submissions on {len(per_school)} schools; "
            f"repeats: {list(reps)}")

    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "fields": fields_doc,
        "derived_labels": {k: v["label"] for g in ("practices", "cover") for k, v in DERIVED.get(g, {}).items()},
        "derived_groups": {g: list(DERIVED.get(g, {}).keys()) for g in ("practices", "cover")},
        "schools": sorted(schools.values(), key=lambda s: ((s["district"] or "~"), s["name"])),
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    log(f"metrics written for {len(schools)} schools -> {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
