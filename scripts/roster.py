#!/usr/bin/env python3
"""Build the school roster and district recruitment table from the raw Kobo pulls.

Reads  raw/<key>.json + raw/<key>.schema.json, config/roster.yml, config/districts.csv
Writes site/data/roster.json

Published fields per school: code, name, district, region, which forms have records and
when, eligibility status, assessment checklist, lag. No names of people, no phone numbers.
"""
from __future__ import annotations

import csv
import difflib
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "raw"
CFG = yaml.safe_load((ROOT / "config" / "roster.yml").read_text())
DIGEST_CFG = yaml.safe_load((ROOT / "config" / "digest.yml").read_text())
DISTRICTS_CSV = ROOT / "config" / "districts.csv"
OUT = ROOT / "site" / "data" / "roster.json"


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


# ----------------------------------------------------------------------------- helpers
def load_form(key: str) -> tuple[list[dict], list[dict], dict]:
    p, s = RAW / f"{key}.json", RAW / f"{key}.schema.json"
    if not p.exists() or not s.exists():
        return [], [], {}
    meta = json.loads(s.read_text())
    return json.loads(p.read_text()), meta["questions"], meta.get("choices", {})


def field(schema: list[dict], name: str) -> dict | None:
    n = name.lower()
    for q in schema:
        if q["xpath"].rsplit("/", 1)[-1].lower() == n or q["name"].lower() == n:
            return q
    return None


def val(sub: dict, q: dict | None):
    if not q:
        return None
    v = sub.get(q["xpath"])
    if v is None:
        v = sub.get(q["name"])
    if isinstance(v, str):
        v = v.strip()
    return v if v not in ("", None) else None


def label(q: dict | None, v, choices: dict):
    if q and v is not None and q.get("select_from"):
        return choices.get(q["select_from"], {}).get(str(v), v)
    return v


def parse_date(v) -> date | None:
    if not v:
        return None
    try:
        return datetime.fromisoformat(str(v).replace("Z", "+00:00")).date()
    except ValueError:
        return None


def norm_district(v) -> tuple[str | None, str | None]:
    """→ (district, region_if_it_was_actually_a_region)"""
    if not v:
        return None, None
    d = re.sub(r"\s+", " ", str(v).strip().upper())
    d = re.sub(r"\s+DISTRICT$", "", d)
    d = CFG.get("district_aliases", {}).get(d, d)
    if d in {r.upper() for r in CFG.get("regions_mistyped_as_district", [])}:
        return None, d
    return d, None


STRIP = [t.upper() for t in CFG["name_match"].get("strip_tokens", [])]
SCHOOL_TOKENS = {t.upper() for t in CFG.get("school_tokens", [])}


def looks_like_school(name) -> bool:
    """True if the text contains a school-type word. Guards against head-teacher names typed
    into the school-name field (which must not be published)."""
    toks = set(norm_name(name).split())
    return bool(toks & SCHOOL_TOKENS) or bool(re.search(r"\bH/S\b|\bS\.S\b|\bS\.S\.S\b", str(name).upper()))


def repeat_values(sub: dict, q: dict | None) -> list:
    """Values of a question that lives inside a repeat group (one per child record)."""
    if not q or not q.get("repeat"):
        return []
    out = []
    for child in sub.get(q["repeat"]) or []:
        if isinstance(child, dict):
            v = child.get(q["xpath"])
            if v not in (None, ""):
                out.append(v)
    return out


def norm_name(v) -> str:
    if not v:
        return ""
    s = str(v).upper().replace("&", " AND ")
    s = re.sub(r"[^A-Z0-9 ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def stem(t: str) -> str:
    return t[:-1] if len(t) > 3 and t.endswith("S") else t


def core_tokens(v) -> set[str]:
    return {stem(t) for t in core_name(v).split()}


def token_match(a: str, b: str) -> float | None:
    """Similarity of two school names by words: 1.0 if one is a subset of the other (≥2 shared
    words), else the Jaccard overlap; None if fewer than 2 words are shared."""
    ta, tb = core_tokens(a), core_tokens(b)
    shared = ta & tb
    if len(shared) < 2:
        return None
    if ta <= tb or tb <= ta:
        return 1.0
    return len(shared) / len(ta | tb)


def core_name(v) -> str:
    # drop filler words and 1-letter fragments left by "S.S", "H/S", "St. Mary's" etc.
    toks = [t for t in norm_name(v).split() if t not in STRIP and (len(t) > 1 or t.isdigit())]
    return " ".join(toks)


# ----------------------------------------------------------------------------- build
def main() -> int:
    now = datetime.now(timezone.utc)
    today = now.date()
    fk = CFG["forms"]
    F_subs, F_q, F_ch = load_form(fk["screening"])
    G_subs, G_q, G_ch = load_form(fk["structure"])
    H_subs, H_q, H_ch = load_form(fk["recruitment"])
    A_subs, A_q, A_ch = load_form(fk["assessment"])
    code_f, name_f, dist_f, reg_f = CFG["code_field"], CFG["name_field"], CFG["district_field"], CFG["region_field"]
    DP_subs, DP_q, DP_ch = load_form(fk.get("district_prep", "district_entry_prep"))
    DE_subs, DE_q, DE_ch = load_form(fk.get("district_pre_entry", "district_pre_entry"))
    DM_subs, DM_q, DM_ch = load_form(fk.get("district_meeting", "district_meeting"))
    DF = CFG.get("district_fields", {})

    def district_rows(subs, q, ch, fields: dict) -> dict[str, list[dict]]:
        """{DISTRICT: [ {field: value, ...}, ... ]} from a district-level form (labels resolved)."""
        out: dict[str, list[dict]] = defaultdict(list)
        dq, cq = field(q, dist_f), field(q, "district_code")
        for sub in subs:
            d, _ = norm_district(label(dq, val(sub, dq), ch))
            if not d:
                continue
            row = {"id": sub.get("_id"), "submitted": sub.get("_submission_time"), "district_code": val(sub, cq)}
            for key, fname in fields.items():
                fq = field(q, fname)
                v = label(fq, val(sub, fq), ch)
                row[key] = v
            out[d].append(row)
        return out

    prep = district_rows(DP_subs, DP_q, DP_ch, {"meeting_date": DF.get("prep_meeting_date", "entry_meeting_date"),
                                                 "list_obtained": DF.get("prep_list_obtained", "list_schools_obtained"),
                                                 "completion_date": "completion_date"})
    pre_entry = district_rows(DE_subs, DE_q, DE_ch, {"target": DF.get("pre_entry_target", "num_schools_mobilized"),
                                                      "confirmed": DF.get("pre_entry_confirmed", "num_conf_attendance"),
                                                      "rescheduled_date": "resched_meeting_date", "completion_date": "completion_date"})
    meeting = district_rows(DM_subs, DM_q, DM_ch, {"meeting_date": DF.get("meeting_date", "meeting_entry_date"),
                                                    "mou_signed": DF.get("meeting_mou_signed", "mous_signed"),
                                                    "schools_attended": DF.get("meeting_schools_attended", "num_schools_attended"),
                                                    "microplan": DF.get("meeting_microplan", "microplan_done"),
                                                    "completion_date": "completion_date"})

    schools: dict[str, dict] = {}
    code_labels: dict[str, str] = {}
    notes: list[str] = []

    def school(code: str) -> dict:
        return schools.setdefault(code, {
            "code": code, "names": Counter(), "districts": Counter(), "regions": Counter(),
            "F": [], "G": [], "H": [], "A": [], "suspect_names": [],
        })

    prefix_len = int(CFG.get("code_district_prefix_len", 7))
    prefix_districts: dict[str, Counter] = defaultdict(Counter)

    # --- F, G, H keyed on school_code ------------------------------------------------
    for tag, subs, q, ch in (("F", F_subs, F_q, F_ch), ("G", G_subs, G_q, G_ch), ("H", H_subs, H_q, H_ch)):
        cq, nq, dq, rq = field(q, code_f), field(q, name_f), field(q, dist_f), field(q, reg_f)
        if cq and cq.get("select_from"):
            code_labels.update(ch.get(cq["select_from"], {}))
        no_code = 0
        for s in subs:
            code = val(s, cq)
            if not code:
                no_code += 1
                continue
            sc = school(str(code))
            n = val(s, nq)
            if n:
                if looks_like_school(n):
                    sc["names"][str(n).strip()] += 1
                else:
                    sc["suspect_names"].append(tag)      # text kept out of the published roster
            d, r_from_d = norm_district(val(s, dq))
            if d:
                sc["districts"][d] += 1
                prefix_districts[str(code)[:prefix_len]][d] += 1
            r = val(s, rq) or r_from_d
            if r:
                sc["regions"][str(r).strip().upper()] += 1
            rec = {"id": s.get("_id"), "submitted": s.get("_submission_time"),
                   "date": (parse_date(val(s, field(q, "enrollment_date"))) or parse_date(val(s, field(q, "completion_date")))
                            or parse_date(s.get("_submission_time")))}
            rec["date"] = rec["date"].isoformat() if rec["date"] else None
            if tag == "F":
                eq = field(q, CFG.get("eligibility_field", "overall_status"))
                rec["eligibility"] = label(eq, val(s, eq), ch)
            if tag == "H":
                yq, tq = field(q, "year"), field(q, "term")
                years = repeat_values(s, yq) or ([val(s, yq)] if val(s, yq) else [])
                terms = repeat_values(s, tq) or ([val(s, tq)] if val(s, tq) else [])
                rec["terms"] = [f"{label(yq, y, ch)} {label(tq, t, ch)}".strip() for y, t in zip(years, terms)] if years and terms \
                    else [str(label(yq, y, ch)) for y in years] or [str(label(tq, t, ch)) for t in terms]
                rec["term_records"] = max(len(years), len(terms), 1 if (years or terms) else 0)
            sc[tag].append(rec)
        if no_code:
            notes.append(f"{tag}: {no_code} submission(s) have no school code (screened-out or incomplete) and are not on the roster")

    # The school_code pick-list = every pre-registered school (the sampling frame), by district prefix
    study_list = {code: (lab if lab and lab != code else None) for code, lab in code_labels.items()}
    listed_by_prefix: Counter = Counter(code[:prefix_len] for code in study_list)

    # F rows without a code: count screening outcomes anyway
    eq = field(F_q, CFG.get("eligibility_field", "overall_status"))
    screening_outcomes = Counter(str(label(eq, val(s, eq), F_ch) or "(blank)") for s in F_subs)

    # --- resolve one name / district / region per school ------------------------------
    for sc in schools.values():
        sc["name"] = sc["names"].most_common(1)[0][0] if sc["names"] else None
        sc["name_variants"] = [n for n, _ in sc["names"].most_common()][1:]
        typed = sc["districts"].most_common(1)[0][0] if sc["districts"] else None
        pref = prefix_districts.get(sc["code"][:prefix_len])
        by_code = pref.most_common(1)[0][0] if pref else None
        sc["district"] = by_code or typed
        sc["district_typed"] = typed
        sc["district_conflict"] = bool(typed and by_code and typed != by_code) or len(sc["districts"]) > 1
        sc["region"] = sc["regions"].most_common(1)[0][0] if sc["regions"] else None
        del sc["names"], sc["districts"], sc["regions"]
    # same (cleaned) school name under more than one code → probable duplicate code
    name_codes: dict[str, list[str]] = defaultdict(list)
    for sc in schools.values():
        for n in ([sc["name"]] if sc["name"] else []) + sc["name_variants"]:
            key = " ".join(sorted(core_tokens(n)))
            if sc["code"] not in name_codes[key]:
                name_codes[key].append(sc["code"])
    duplicate_codes = sorted({tuple(sorted(v)) for v in name_codes.values() if len(v) > 1})

    # --- assessment: match by name (+district) -------------------------------------
    nq, dq, rq = field(A_q, name_f), field(A_q, dist_f), field(A_q, reg_f)
    items = CFG.get("assessment_items", {})
    item_qs = {k: field(A_q, k) for k in items}
    by_core: dict[str, list[dict]] = defaultdict(list)
    by_norm: dict[str, list[dict]] = defaultdict(list)
    for sc in schools.values():
        for n in ([sc["name"]] if sc["name"] else []) + sc["name_variants"]:
            by_norm[norm_name(n)].append(sc)
            by_core[core_name(n)].append(sc)
    min_sim = float(CFG["name_match"].get("min_similarity", 0.86))
    unmatched, ambiguous = [], []
    match_methods = Counter()

    for s in A_subs:
        a_name = val(s, nq)
        a_dist, _ = norm_district(label(dq, val(s, dq), A_ch))
        rec = {
            "id": s.get("_id"), "submitted": s.get("_submission_time"),
            "date": (parse_date(val(s, field(A_q, "visit_date"))) or parse_date(s.get("_submission_time"))),
            "items": {items[k]: label(q, val(s, q), A_ch) for k, q in item_qs.items() if q},
        }
        rec["date"] = rec["date"].isoformat() if rec["date"] else None
        if not a_name:
            unmatched.append({"id": rec["id"], "name": None, "district": a_dist, "reason": "no school name"})
            continue
        cands = by_norm.get(norm_name(a_name)) or by_core.get(core_name(a_name)) or []
        method = "exact" if by_norm.get(norm_name(a_name)) else ("core" if cands else None)
        if a_dist and len(cands) > 1:
            same = [c for c in cands if c["district"] == a_dist]
            cands = same or cands
        if not cands:
            pool = [c for c in schools.values() if not a_dist or c["district"] == a_dist or c["district"] is None]
            scored = []
            min_tok = float(CFG["name_match"].get("min_token_similarity", 0.6))
            for c in pool:
                best_c = 0.0
                for n in ([c["name"]] if c["name"] else []) + c["name_variants"]:
                    r = difflib.SequenceMatcher(None, core_name(a_name), core_name(n)).ratio()
                    tm = token_match(a_name, n)
                    if tm is not None and tm >= min_tok:
                        r = max(r, tm)
                    best_c = max(best_c, r)
                if best_c >= min(min_sim, min_tok):
                    scored.append((best_c, c))
            scored.sort(key=lambda x: -x[0])
            if scored:
                best = scored[0][1]
                if len(scored) > 1 and scored[1][1] is not best and scored[1][0] >= scored[0][0] - 0.02:
                    cands, method = [c for _, c in scored[:3]], "fuzzy"
                else:
                    cands, method = [best], f"fuzzy {scored[0][0]:.2f}"
        uniq = {c["code"]: c for c in cands}
        if len(uniq) > 1:   # duplicate-code pairs: prefer the code that carries the Annex H record
            recruited_c = [c for c in uniq.values() if c["H"]]
            if len(recruited_c) == 1:
                uniq = {recruited_c[0]["code"]: recruited_c[0]}
                method = (method or "exact") + " → recruited code"
        if len(uniq) == 1:
            sc = next(iter(uniq.values()))
            rec["match"] = method
            sc["A"].append(rec)
            match_methods[method.split()[0]] += 1
        elif len(uniq) > 1:
            ambiguous.append({"id": rec["id"], "name": a_name, "district": a_dist,
                              "candidates": [f"{c['code']} {c['name'] or ''}".strip() for c in uniq.values()][:5]})
        else:
            unmatched.append({"id": rec["id"], "name": a_name, "district": a_dist, "reason": "no similar school on roster"})

    # --- per-school status ------------------------------------------------------------
    rows = []
    for sc in schools.values():
        h_dates = sorted(d for d in (r["date"] for r in sc["H"]) if d)
        a_dates = sorted(d for d in (r["date"] for r in sc["A"]) if d)
        f_elig = [r.get("eligibility") for r in sc["F"]]
        recruited = bool(sc["H"])
        assessed = bool(sc["A"])
        lag = None
        if recruited and h_dates:
            h0 = date.fromisoformat(h_dates[0])
            lag = ((date.fromisoformat(a_dates[-1]) if assessed and a_dates else today) - h0).days
        latest_a = sc["A"][-1]["items"] if sc["A"] else {}
        all_terms = sorted({t for r in sc["H"] for t in r.get("terms", []) if t and t != "None"})
        rows.append({
            "code": sc["code"], "name": sc["name"] or f"(no school name — code {sc['code']})", "name_variants": sc["name_variants"],
            "name_missing": sc["name"] is None, "suspect_name_forms": sorted(set(sc["suspect_names"])),
            "district": sc["district"], "district_typed": sc["district_typed"], "region": sc["region"], "district_conflict": sc["district_conflict"],
            "screened": bool(sc["F"]), "eligibility": f_elig[-1] if f_elig else None,
            "structure_form": bool(sc["G"]), "structure_records": len(sc["G"]),
            "recruited": recruited, "recruited_date": h_dates[0] if h_dates else None,
            "retro_records": len(sc["H"]), "retro_terms": all_terms,
            "retro_term_records": sum(r.get("term_records", 0) for r in sc["H"]),
            "assessed": assessed, "assessed_date": a_dates[-1] if a_dates else None,
            "assessment": latest_a, "assessment_match": sc["A"][-1].get("match") if sc["A"] else None,
            "lag_days": lag,
            "forms": {"F": len(sc["F"]), "G": len(sc["G"]), "H": len(sc["H"]), "A": len(sc["A"])},
        })
    rows.sort(key=lambda r: ((r["district"] or "~"), r["name"]))

    # --- districts ---------------------------------------------------------------------
    cfg_d: dict[str, dict] = {}
    if DISTRICTS_CSV.exists():
        with DISTRICTS_CSV.open(newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                d, _ = norm_district(r.get("district"))
                if d:
                    cfg_d[d] = {"sub_region": (r.get("sub_region") or "").strip() or None,
                                "target_schools": int(r["target_schools"]) if (r.get("target_schools") or "").strip().isdigit() else None,
                                "date_opened": (r.get("date_opened") or "").strip() or None,
                                "notes": (r.get("notes") or "").strip() or None}
    observed = {r["district"] for r in rows if r["district"]} | set(prep) | set(pre_entry) | set(meeting)
    # prefix → district (from submissions); prefixes with no submissions yet stay unnamed
    prefix_to_district = {pfx: cnt.most_common(1)[0][0] for pfx, cnt in prefix_districts.items()}
    district_to_prefix = {d: pfx for pfx, d in prefix_to_district.items()}
    unnamed_prefixes = {pfx: n for pfx, n in listed_by_prefix.items() if pfx not in prefix_to_district}
    districts = []
    for d in sorted(cfg_d.keys() | observed):
        c = cfg_d.get(d, {})
        rs = [r for r in rows if r["district"] == d]
        pfx = district_to_prefix.get(d)
        rec = [r for r in rs if r["recruited"]]
        asd = [r for r in rec if r["assessed"]]
        lags = [r["lag_days"] for r in rec if not r["assessed"] and r["lag_days"] is not None]

        def last(rows_: list[dict], key: str):
            vals = [r[key] for r in rows_ if r.get(key) not in (None, "")]
            return vals[-1] if vals else None

        def as_int(v):
            try:
                return int(float(v)) if v not in (None, "") else None
            except (TypeError, ValueError):
                return None

        m_rows, e_rows, p_rows = meeting.get(d, []), pre_entry.get(d, []), prep.get(d, [])
        meeting_date = last(m_rows, "meeting_date") or c.get("date_opened")
        target_form = as_int(last(e_rows, "target"))
        target = c.get("target_schools") if c.get("target_schools") is not None else target_form
        target_source = ("districts.csv" if c.get("target_schools") is not None else ("pre-entry form" if target_form is not None else None))
        scheduled = last(e_rows, "rescheduled_date") or last(p_rows, "meeting_date")
        if meeting_date:
            stage, stage_rank = "opened", 3
        elif e_rows:
            stage, stage_rank = "pre-entry done", 2
        elif p_rows:
            stage, stage_rank = "preparation", 1
        else:
            stage, stage_rank = "not started", 0
        if rec and not meeting_date:
            stage = "entered (no meeting form)"
        districts.append({
            "district": d, "sub_region": c.get("sub_region"), "in_config": d in cfg_d,
            "target_schools": target, "target_source": target_source, "date_opened": meeting_date, "notes": c.get("notes"),
            "code_prefix": pfx,
            "stage": stage, "stage_rank": stage_rank,
            "district_code": last(m_rows, "district_code") or last(e_rows, "district_code") or last(p_rows, "district_code"),
            "prep": {"n": len(p_rows), "scheduled_meeting": last(p_rows, "meeting_date"), "list_obtained": last(p_rows, "list_obtained")} if p_rows else None,
            "pre_entry": {"n": len(e_rows), "target": target_form, "confirmed": as_int(last(e_rows, "confirmed")), "rescheduled": last(e_rows, "rescheduled_date")} if e_rows else None,
            "meeting": {"n": len(m_rows), "date": last(m_rows, "meeting_date"), "mou_signed": last(m_rows, "mou_signed"),
                        "schools_attended": as_int(last(m_rows, "schools_attended")), "microplan": last(m_rows, "microplan")} if m_rows else None,
            "scheduled_meeting": scheduled,
            "opened": bool(meeting_date), "entered": bool(rec),
            "screened": sum(1 for r in rs if r["screened"]),
            "recruited": len(rec), "assessed": len(asd), "awaiting_assessment": len(rec) - len(asd),
            "max_open_lag_days": max(lags) if lags else None,
            "first_recruited": min((r["recruited_date"] for r in rec if r["recruited_date"]), default=None),
            "last_recruited": max((r["recruited_date"] for r in rec if r["recruited_date"]), default=None),
        })
    no_district = [r for r in rows if not r["district"]]
    assessed_not_recruited = [{"code": r["code"], "name": r["name"], "district": r["district"], "assessed_date": r["assessed_date"]}
                              for r in rows if r["assessed"] and not r["recruited"]]
    recruited_not_screened = [{"code": r["code"], "name": r["name"], "district": r["district"]} for r in rows if r["recruited"] and not r["screened"]]
    suspect_names = [{"code": r["code"], "district": r["district"], "forms": r["suspect_name_forms"], "name_known": not r["name_missing"]}
                     for r in rows if r["suspect_name_forms"]]
    by_code = {r["code"]: r for r in rows}
    dup_code_rows = [{"codes": list(codes), "name": by_code[codes[0]]["name"],
                      "districts": sorted({str(by_code[c]["district"]) for c in codes}),
                      "forms": {c: "".join(k for k, v in by_code[c]["forms"].items() if v) for c in codes}} for codes in duplicate_codes]

    rec_rows = [r for r in rows if r["recruited"]]
    asd_rows = [r for r in rec_rows if r["assessed"]]
    open_lags = [r["lag_days"] for r in rec_rows if not r["assessed"] and r["lag_days"] is not None]
    totals = {
        "districts_in_config": len(cfg_d),
        "districts_opened": sum(1 for d in districts if d["opened"]),
        "districts_entered": sum(1 for d in districts if d["entered"]),
        "districts_entered_without_meeting_form": sum(1 for d in districts if d["entered"] and not d["opened"]),
        "districts_pre_entry": sum(1 for d in districts if d["pre_entry"]),
        "districts_prep": sum(1 for d in districts if d["prep"]),
        "districts_scheduled": sum(1 for d in districts if d["scheduled_meeting"] and not d["opened"]),
        "districts_with_target": sum(1 for d in districts if d["target_schools"] is not None),
        "target_schools_known": sum(d["target_schools"] for d in districts if d["target_schools"] is not None),
        "district_form_submissions": {"prep": len(DP_subs), "pre_entry": len(DE_subs), "meeting": len(DM_subs)},
        "schools_on_roster": len(rows),
        "code_slots_per_district": sorted(set(listed_by_prefix.values())),   # pick-list is a fixed block of codes, not a target list
        "district_prefixes_total": len(listed_by_prefix),
        "district_prefixes_without_submissions": sorted(unnamed_prefixes),
        "schools_screened": sum(1 for r in rows if r["screened"]),
        "screening_submissions": len(F_subs),
        "screening_outcomes": dict(screening_outcomes),
        "schools_recruited": len(rec_rows),
        "recruitment_target": int(DIGEST_CFG.get("recruitment_target") or 165),
        "schools_assessed": len(asd_rows),
        "assessment_submissions": len(A_subs),
        "assessment_matched": sum(match_methods.values()),
        "assessment_match_methods": dict(match_methods),
        "assessment_unmatched": len(unmatched), "assessment_ambiguous": len(ambiguous),
        "awaiting_assessment": len(rec_rows) - len(asd_rows),
        "median_open_lag_days": sorted(open_lags)[len(open_lags) // 2] if open_lags else None,
        "max_open_lag_days": max(open_lags) if open_lags else None,
        "recruited_last_7d": sum(1 for r in rec_rows if r["recruited_date"] and (today - date.fromisoformat(r["recruited_date"])).days < 7),
        "issues": len(unmatched) + len(ambiguous) + len(assessed_not_recruited) + len(recruited_not_screened) + len(suspect_names) + len(dup_code_rows)
                  + sum(1 for r in rows if r["district_conflict"]) + len(no_district),
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "generated_at": now.isoformat(),
        "totals": totals,
        "districts": districts,
        "schools": rows,

        "schools_without_district": [r["code"] for r in no_district],
        "assessment_unmatched": unmatched,
        "assessment_ambiguous": ambiguous,
        "assessed_not_recruited": assessed_not_recruited,
        "recruited_not_screened": recruited_not_screened,
        "suspect_school_names": suspect_names,
        "duplicate_codes": dup_code_rows,
        "notes": notes,
    }, ensure_ascii=False, indent=1))
    log(f"roster: {len(rows)} schools, {totals['schools_recruited']} recruited, {totals['schools_assessed']} assessed "
        f"({len(unmatched)} unmatched, {len(ambiguous)} ambiguous assessment forms); {len(districts)} districts")
    return 0


if __name__ == "__main__":
    sys.exit(main())
