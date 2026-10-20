#!/usr/bin/env python3
"""School-week aggregates from the prospective log forms (nurse log, bursar log).

Reads  raw/<key>.json + raw/<key>.schema.json for each form in config/prospective.yml,
       site/data/roster.json (school codes, names, districts)
Writes site/data/prospective.json

Privacy: individual log entries are never published. Each form is reduced to one row per
school per ISO week (Monday-dated): number of entries, the SUM of every numeric question
and the COUNT of each answer to every choice question — at the top level and inside each
repeat group separately. Free text, names, phone numbers and images never leave the runner.

Roles (which questions mean "tested", "positive", ...) come from config/prospective.yml,
auto-detected from question names when left blank. The resolved roles are published so a
wrong guess is visible on the page and can be pinned in the config.
"""
from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))
from metrics import EXPORT_TYPES, answers_from, field, load_form, split_questions, to_number  # noqa: E402
from roster import norm_name  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
CFG = yaml.safe_load((ROOT / "config" / "prospective.yml").read_text())
ROSTER_CFG = yaml.safe_load((ROOT / "config" / "roster.yml").read_text())
ROSTER = ROOT / "site" / "data" / "roster.json"
OUT = ROOT / "site" / "data" / "prospective.json"
NUMERIC = {"integer", "decimal", "calculate", "range"}
CHOICE = {"select_one", "select_multiple"}


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def short(q: dict) -> str:
    return q["xpath"].rsplit("/", 1)[-1].lower()


def parse_date(v) -> date | None:
    if not v:
        return None
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", str(v))
    if not m:
        return None
    try:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None


def week_of(d: date) -> str:
    return (d - timedelta(days=d.weekday())).isoformat()


# ---------------------------------------------------------------------------- role resolution
def level_of(q: dict) -> str:
    return f"rep:{q['repeat'].rsplit('/', 1)[-1]}" if q.get("repeat") else "top"


def find_fields(questions: list[dict], pattern: str, types: set[str]) -> list[dict]:
    rx = re.compile(pattern, re.I)
    exact = [q for q in questions if q["type"] in types and rx.fullmatch(short(q))]
    return exact or [q for q in questions if q["type"] in types and rx.search(short(q))]


def resolve_role(spec: str, questions: list[dict], source: str) -> dict | None:
    """'field_regex' → numeric sum; 'field_regex = label_regex' → choice count."""
    if not spec or not str(spec).strip():
        return None
    spec = str(spec).strip()
    if "=" in spec:
        fpat, lpat = (s.strip() for s in spec.split("=", 1))
        for q in find_fields(questions, fpat, CHOICE):
            return {"level": level_of(q), "field": q["name"], "kind": "count", "labels": lpat, "label": q["label"], "source": source, "spec": spec}
        return None
    for q in find_fields(questions, spec, NUMERIC):
        return {"level": level_of(q), "field": q["name"], "kind": "sum", "label": q["label"], "source": source, "spec": spec}
    return None


def resolve_roles(form_cfg: dict, questions: list[dict]) -> dict:
    roles: dict = {}
    for role, spec in (form_cfg.get("roles") or {}).items():
        if role in ("school_code", "school_name", "date"):
            continue
        r = resolve_role(spec, questions, "config")
        if not r:
            for pat in (form_cfg.get("auto") or {}).get(role, []):
                r = resolve_role(pat, questions, "auto")
                if r:
                    break
        roles[role] = r
    return roles


def pick_question(spec: str, questions: list[dict], fallback_patterns: list[str], types: set[str] | None = None) -> dict | None:
    if spec and str(spec).strip():
        q = field(questions, str(spec).strip())
        if q:
            return q
    for pat in fallback_patterns:
        for q in find_fields(questions, pat, types or set(q["type"] for q in questions)):
            return q
    return None


# ---------------------------------------------------------------------------- aggregation
def new_bucket() -> dict:
    return {"n": 0, "sum": defaultdict(float), "nn": defaultdict(int), "cnt": defaultdict(lambda: defaultdict(int)), "rep": {}}


def add_answers(b: dict, answers: dict, qtypes: dict[str, str], skip: set[str]) -> None:
    for k, v in answers.items():
        if k in skip:
            continue
        t = qtypes.get(k)
        if t in NUMERIC and isinstance(v, (int, float)):
            b["sum"][k] += v
            b["nn"][k] += 1                 # entries answering this numeric question (for averages)
        elif t in CHOICE:
            for lab in (v if isinstance(v, list) else [v]):
                b["cnt"][k][str(lab)] += 1


def finalize(b: dict) -> dict:
    out = {"n": b["n"], "sum": {k: round(v, 2) for k, v in b["sum"].items()}, "cnt": {k: dict(v) for k, v in b["cnt"].items()}}
    nn = {k: v for k, v in b["nn"].items() if v != b["n"]}     # only where it differs from the entry count
    if nn:
        out["nn"] = nn
    if b["rep"]:
        out["rep"] = {r: finalize(x) for r, x in b["rep"].items()}
    return out


def process_form(form_cfg: dict, schools: dict, by_name: dict) -> dict:
    key = form_cfg["key"]
    subs, questions, choices = load_form(key)
    top, reps = split_questions(questions)
    qtypes = {q["name"]: q["type"] for q in questions}
    code_q = pick_question((form_cfg.get("roles") or {}).get("school_code"), questions, [ROSTER_CFG.get("code_field", "school_code"), r"school_?code", r"sch_?code|code"])
    name_q = pick_question((form_cfg.get("roles") or {}).get("school_name"), questions, [r"school_?name", r"name_of_school|school"])
    date_q = pick_question((form_cfg.get("roles") or {}).get("date"), questions, [r".*(week|log|entry|visit|record|report).*(date|day)|date.*(week|log|entry)", r"date|week|day"], {"date", "datetime"})
    if name_q and code_q and name_q["name"] == code_q["name"]:
        name_q = None
    roles = resolve_roles(form_cfg, questions)
    skip = {q["name"] for q in (code_q, name_q) if q}

    buckets: dict[tuple[str, str], dict] = {}
    unmatched: dict[str, dict] = {}
    n_sub = n_matched = 0
    first = last = None
    for s in subs:
        n_sub += 1
        code = str(s.get(code_q["xpath"]) or s.get(code_q["name"]) or "").strip() if code_q else ""
        if code not in schools:
            nm = str(s.get(name_q["xpath"]) or s.get(name_q["name"]) or "").strip() if name_q else ""
            code = by_name.get(norm_name(nm), "") if nm else ""
            if not code:
                k = code or nm or "(no school)"
                u = unmatched.setdefault(k, {"id": k, "n": 0})
                u["n"] += 1
                continue
        d = parse_date(s.get(date_q["xpath"]) or s.get(date_q["name"])) if date_q else None
        if not d:
            d = parse_date(s.get("_submission_time"))
        if not d:
            continue
        n_matched += 1
        first = min(first, d) if first else d
        last = max(last, d) if last else d
        b = buckets.setdefault((code, week_of(d)), new_bucket())
        b["n"] += 1
        add_answers(b, answers_from(s, top, choices), qtypes, skip)
        for rname, rqs in reps.items():
            rshort = rname.rsplit("/", 1)[-1]
            rb = b["rep"].setdefault(rshort, new_bucket())
            for child in (s.get(rname) or []):
                if isinstance(child, dict):
                    rb["n"] += 1
                    add_answers(rb, answers_from(child, rqs, choices), qtypes, skip)

    rows = [{"c": code, "w": week, **finalize(b)} for (code, week), b in sorted(buckets.items())]
    fields_doc = {
        "top": [{"name": q["name"], "type": q["type"], "label": q["label"]} for q in top if q["type"] in EXPORT_TYPES],
        "repeats": {r.rsplit("/", 1)[-1]: [{"name": q["name"], "type": q["type"], "label": q["label"]} for q in qs if q["type"] in EXPORT_TYPES] for r, qs in reps.items()},
    }
    log(f"{key}: {n_sub} submissions, {n_matched} matched to {len({c for c, _ in buckets})} schools, {len(rows)} school-weeks, "
        f"{sum(u['n'] for u in unmatched.values())} unmatched; roles: " + ", ".join(f"{r}={v['field'] if v else '—'}" for r, v in roles.items()))
    return {
        "title": form_cfg.get("title", key), "labels": form_cfg.get("labels", {}), "stats": form_cfg.get("stats", {}),
        "join": {"code_field": code_q["name"] if code_q else None, "name_field": name_q["name"] if name_q else None, "date_field": date_q["name"] if date_q else "_submission_time"},
        "roles": roles, "fields": fields_doc, "rows": rows,
        "n_submissions": n_sub, "n_matched": n_matched, "first_date": first.isoformat() if first else None, "last_date": last.isoformat() if last else None,
        "unmatched": sorted(unmatched.values(), key=lambda u: -u["n"])[:50],
    }


def main() -> int:
    if not ROSTER.exists():
        log("roster.json missing — run roster.py first")
        return 1
    roster = json.loads(ROSTER.read_text())
    schools = {s["code"]: s for s in roster["schools"]}
    by_name = {norm_name(s["name"]): s["code"] for s in roster["schools"] if s.get("name")}
    out = {"generated_at": datetime.now(timezone.utc).isoformat(), "forms": {}}
    for form_cfg in CFG.get("forms", []):
        out["forms"][form_cfg["key"]] = process_form(form_cfg, schools, by_name)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    log(f"prospective written -> {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
