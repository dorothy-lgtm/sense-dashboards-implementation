#!/usr/bin/env python3
"""Build the head-teacher contact list for the team: one row per school.

Reads  raw/<key>.json + schema (Annex F and H), site/data/roster.json (canonical school
       name / district / region / recruited), config/roster.yml, config/digest.yml
Writes exports/<contacts.filename>  (default SENSE_head_teachers.xlsx)

The file holds names and phone numbers, so it lives only in exports/ (git-ignored, never
published, never a run artifact). It reaches the team inside the daily export email and,
when Box is configured, in the Box folder. This script logs counts only.

Run after roster.py.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import yaml
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from roster import CFG, field, load_form, val

ROOT = Path(__file__).resolve().parents[1]
ROSTER = ROOT / "site" / "data" / "roster.json"
EXPORTS = ROOT / "exports"
DIGEST_CFG = yaml.safe_load((ROOT / "config" / "digest.yml").read_text()) or {}
C_CFG = DIGEST_CFG.get("contacts") or {}
OUT = EXPORTS / C_CFG.get("filename", "SENSE_head_teachers.xlsx")

# column header → (form tag, question name). F = Annex F (enrolment), H = Annex H (retrospective)
DEFAULT_COLUMNS = [
    ["Head teacher", "H", "head_master"],
    ["Head teacher phone", "H", "hm_contact"],
    ["School phone", "F", "school_contact"],
    ["Nurse", "F", "nurse_name"],
    ["Nurse phone", "F", "nurse_contact"],
    ["BOG chair", "H", "bog_chairman"],
    ["BOG chair phone", "H", "bog_chairman_contact"],
]
COLUMNS = C_CFG.get("columns") or DEFAULT_COLUMNS


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def clean(v) -> str:
    """Kobo text → one-line string. Phone numbers stay exactly as typed (leading zeros kept)."""
    if v is None:
        return ""
    return " ".join(str(v).split())


def main() -> int:
    if not ROSTER.exists():
        log("contacts: no roster.json — run roster.py first")
        return 1
    roster = json.loads(ROSTER.read_text())
    fk = CFG["forms"]
    forms = {"F": load_form(fk["screening"]), "H": load_form(fk["recruitment"])}
    code_f = CFG["code_field"]

    # latest non-empty answer per school code, per column
    latest: dict[str, dict[str, str]] = {}
    updated: dict[str, str] = {}
    missing_fields = []
    for header, tag, qname in COLUMNS:
        subs, schema, _ = forms.get(tag, ([], [], {}))
        q, cq = field(schema, qname), field(schema, code_f)
        if schema and not q:
            missing_fields.append(f"{tag}.{qname}")
            continue
        for s in sorted(subs, key=lambda x: str(x.get("_submission_time") or "")):
            code, v = val(s, cq), clean(val(s, q))
            if not code or not v:
                continue
            latest.setdefault(str(code), {})[header] = v          # later submissions overwrite earlier ones
            t = str(s.get("_submission_time") or "")[:10]
            if t > updated.get(str(code), ""):
                updated[str(code)] = t

    only_recruited = bool(C_CFG.get("recruited_only", False))
    headers = ["School code", "School", "District", "Region", "Recruited"] + [c[0] for c in COLUMNS] + ["Contacts last entered"]
    rows = []
    for sc in roster["schools"]:
        if only_recruited and not sc.get("recruited"):
            continue
        got = latest.get(sc["code"], {})
        if not got and not sc.get("recruited"):
            continue                                              # screened-out school with no contact on file
        rows.append([sc["code"], sc["name"], sc.get("district") or "", sc.get("region") or "",
                     "Yes" if sc.get("recruited") else "No"] + [got.get(c[0], "") for c in COLUMNS] + [updated.get(sc["code"], "")])
    rows.sort(key=lambda r: (r[2] or "~", r[1]))

    # ---- workbook: every cell is text so Excel never drops a leading 0 from a phone number
    wb = Workbook()
    ws = wb.active
    ws.title = "Head teachers"
    ws.append(headers)
    for r in rows:
        ws.append(r)
    head_fill = PatternFill("solid", fgColor="1F3864")
    for c in ws[1]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = head_fill
        c.alignment = Alignment(vertical="center", wrap_text=True)
    for row in ws.iter_rows(min_row=2):
        for c in row:
            c.number_format = "@"
            c.data_type = "s"
    for i, h in enumerate(headers, start=1):
        longest = max([len(h)] + [len(str(r[i - 1])) for r in rows] or [len(h)])
        ws.column_dimensions[get_column_letter(i)].width = min(max(12, longest + 2), 48)
    ws.freeze_panes = "C2"
    ws.auto_filter.ref = ws.dimensions

    info = wb.create_sheet("About")
    pulled = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    for line in [
        ["SENSE head-teacher contact list"],
        [f"Generated {pulled} from KoboCollect (Annex F and Annex H)."],
        ["One row per school code. Where a school has several submissions, the most recent non-empty answer is used."],
        ["Recruited = the school has an Annex H (retrospective) record."],
        ["Contains names and phone numbers: keep within the study team; do not forward or post."],
    ]:
        info.append(line)
    info["A1"].font = Font(bold=True, size=13)
    info.column_dimensions["A"].width = 110

    EXPORTS.mkdir(exist_ok=True)
    wb.save(OUT)

    ht_i, htp_i = headers.index(COLUMNS[0][0]), headers.index(COLUMNS[1][0])
    stats = {"schools": len(rows), "recruited": sum(1 for r in rows if r[4] == "Yes"),
             "with_head_teacher": sum(1 for r in rows if r[ht_i]), "with_head_teacher_phone": sum(1 for r in rows if r[htp_i]),
             "filename": OUT.name, "missing_fields": missing_fields}
    (ROOT / "raw" / "contacts_stats.json").write_text(json.dumps(stats))
    log(f"contacts: {OUT.name} written — {stats['schools']} schools, {stats['with_head_teacher']} with a head teacher named, "
        f"{stats['with_head_teacher_phone']} with a head-teacher phone number"
        + (f"; fields not found on the forms: {', '.join(missing_fields)}" if missing_fields else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
