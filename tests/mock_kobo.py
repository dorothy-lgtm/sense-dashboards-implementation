#!/usr/bin/env python3
"""Fake KoboToolbox v2 API for testing offline. Mirrors the real SENSE form structures:
Annex F (screening + school_code), G, H (school_code) and the School Assessment form
(school_name only, no code), with the data quirks seen in the field (blank districts,
a region typed as a district, name spelling variants).

    python tests/mock_kobo.py 8765 &
    KOBO_TOKEN=test KOBO_BASE_URL=http://127.0.0.1:8765 python scripts/kobo_pull.py
    python scripts/summarize.py && python scripts/roster.py
"""
import json
import random
import sys
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

random.seed(11)
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
UIDS = {"F": "ak95trCoSBkM3aKqZysbdB", "G": "axDMBKEfMJYtZ5LiHqCMbb", "H": "aokEegtT2X8oyCDfQCWeZR", "A": "ajj7kZq2be5XDFSio3zJHu",
        "DM": "aGUvS64iEXZ6iANRKySPRT", "DE": "a7MfPjqYzU6MVRefeukEpF", "DP": "aUngKSUyshfP9f2ncmgpzF"}
DISTRICTS = {"LUWERO": "BUGANDA", "NAKASEKE": "BUGANDA", "HOIMA": "BUNYORO", "KAGADI": "BUNYORO", "KIBAALE": "BUNYORO",
             "KAKUMIRO": "BUNYORO", "KIKUUBE": "BUNYORO", "MASINDI": "BUNYORO", "KIRYANDONGO": "BUNYORO",
             "BULIISA": "BUNYORO", "BUKEDEA": "TESO", "GULU CITY": "ACHOLI", "KARENGA": "KARAMOJA"}
OFFICERS = ["TE", "BA", "JK", "RN", "PO"]
EAT = timezone(timedelta(hours=3))

# 90 schools with codes; names with realistic variants
SCHOOLS = []
for i in range(1, 91):
    d = random.choice(list(DISTRICTS))
    base = random.choice(["ST. MARY'S", "ST. JOSEPH'S", "KINGS", "BISHOP", "TRINITY", "HOLY CROSS", "VICTORIA", "SACRED HEART", "ST. PETER'S"]) + f" {random.choice(['SS', 'S.S.', 'SECONDARY SCHOOL', 'COLLEGE', 'HIGH SCHOOL'])} {d.title()}{'' if i % 7 else ' Annex'} {i}"
    SCHOOLS.append({"code": f"SCH{i:03d}", "name": base, "district": d, "region": DISTRICTS[d]})


def variant(name: str) -> str:
    """How the same school gets typed into the assessment form."""
    v = name
    r = random.random()
    if r < 0.4:
        v = v.replace("SECONDARY SCHOOL", "S.S").replace("S.S.", "SS").replace("HIGH SCHOOL", "H/S")
    elif r < 0.6:
        v = v.lower().replace("st. ", "st ").title()
    elif r < 0.7:
        v = v.replace("'", "")
    return v


def ts(d: datetime) -> str:
    return d.strftime("%Y-%m-%dT%H:%M:%S")


def when(i: int) -> datetime:
    return datetime(2026, 9, 23, tzinfo=timezone.utc) + timedelta(days=min(21, i // 4), hours=random.randint(6, 15))


def choices_schools():
    return [{"list_name": "schools", "name": s["code"], "label": [f"{s['code']}"]} for s in SCHOOLS]


SURVEYS = {
    "F": [
        {"type": "start", "name": "start", "$xpath": "start"}, {"type": "end", "name": "end", "$xpath": "end"},
        {"type": "select_one", "name": "atleast_300_boarders", "$xpath": "School_screening_grp/atleast_300_boarders", "label": ["≥300 boarders"], "select_from_list_name": "yn"},
        {"type": "calculate", "name": "overall_status", "$xpath": "School_screening_grp/overall_status"},
        {"type": "select_one", "name": "school_code", "$xpath": "School_Identification_grp/school_code", "label": ["School code"], "select_from_list_name": "schools"},
        {"type": "text", "name": "school_name", "$xpath": "School_Identification_grp/school_name", "label": ["Name of the school"]},
        {"type": "text", "name": "district", "$xpath": "School_Identification_grp/district", "label": ["District"]},
        {"type": "text", "name": "region", "$xpath": "School_Identification_grp/region", "label": ["Region"]},
        {"type": "date", "name": "enrollment_date", "$xpath": "School_Identification_grp/enrollment_date", "label": ["Date of enrolment visit"]},
        {"type": "geopoint", "name": "geo_location", "$xpath": "School_Identification_grp/geo_location", "label": ["GPS"]},
        {"type": "text", "name": "nurse_name", "$xpath": "school_health_personnel_grp/nurse_name", "label": ["Nurse"]},
        {"type": "text", "name": "nurse_contact", "$xpath": "school_health_personnel_grp/nurse_contact", "label": ["Nurse phone"]},
        {"type": "select_one", "name": "data_officer", "$xpath": "Respondent_signature_grp/data_officer", "label": ["Data officer"], "select_from_list_name": "officers"},
    ],
    "G": [
        {"type": "start", "name": "start", "$xpath": "start"}, {"type": "end", "name": "end", "$xpath": "end"},
        {"type": "select_one", "name": "school_code", "$xpath": "School_Identification_grp/school_code", "label": ["School code"], "select_from_list_name": "schools"},
        {"type": "text", "name": "school_name", "$xpath": "School_Identification_grp/school_name", "label": ["Name"]},
        {"type": "text", "name": "district", "$xpath": "School_Identification_grp/district", "label": ["District"]},
        {"type": "text", "name": "region", "$xpath": "School_Identification_grp/region", "label": ["Region"]},
        {"type": "integer", "name": "total_dormitories", "$xpath": "physical_infrastructure_grp/total_dormitories", "label": ["Dorms"]},
        {"type": "select_one", "name": "data_officer", "$xpath": "Respondent_signature_grp/data_officer", "label": ["Data officer"], "select_from_list_name": "officers"},
    ],
    "H": [
        {"type": "start", "name": "start", "$xpath": "start"}, {"type": "end", "name": "end", "$xpath": "end"},
        {"type": "select_one", "name": "school_code", "$xpath": "School_location_info_grp/school_code", "label": ["School code"], "select_from_list_name": "schools"},
        {"type": "text", "name": "school_name", "$xpath": "School_location_info_grp/school_name", "label": ["Name"]},
        {"type": "text", "name": "district", "$xpath": "School_location_info_grp/district", "label": ["District"]},
        {"type": "text", "name": "region", "$xpath": "School_location_info_grp/region", "label": ["Region"]},
        {"type": "text", "name": "head_master", "$xpath": "School_location_info_grp/head_master", "label": ["Head teacher"]},
        {"type": "text", "name": "hm_contact", "$xpath": "School_location_info_grp/hm_contact", "label": ["HT contact"]},
        {"type": "date", "name": "completion_date", "$xpath": "School_location_info_grp/completion_date", "label": ["Completion date"]},
        {"type": "begin_repeat", "name": "Enrollment_data_grp", "$xpath": "Enrollment_data_grp", "label": ["Enrolment data"]},
        {"type": "select_one", "name": "year", "$xpath": "Enrollment_data_grp/year", "label": ["Year"], "select_from_list_name": "years"},
        {"type": "select_one", "name": "term", "$xpath": "Enrollment_data_grp/term", "label": ["Term"], "select_from_list_name": "terms"},
        {"type": "integer", "name": "total_malaria_cases", "$xpath": "Enrollment_data_grp/total_malaria_cases", "label": ["Cases"]},
        {"type": "end_repeat", "name": "Enrollment_data_grp"},
        {"type": "select_one", "name": "data_officer", "$xpath": "data_officer", "label": ["Data officer"], "select_from_list_name": "officers"},
    ],
    "A": [
        {"type": "start", "name": "start", "$xpath": "start"}, {"type": "end", "name": "end", "$xpath": "end"},
        {"type": "select_one", "name": "region", "$xpath": "School_assessment_grp/region", "label": ["Region"], "select_from_list_name": "regions"},
        {"type": "select_one", "name": "district", "$xpath": "School_assessment_grp/district", "label": ["District"], "select_from_list_name": "districts"},
        {"type": "text", "name": "school_name", "$xpath": "School_assessment_grp/school_name", "label": ["School Name"]},
        {"type": "date", "name": "visit_date", "$xpath": "School_assessment_grp/visit_date", "label": ["Visit date"]},
        {"type": "select_one", "name": "springfiles_received", "$xpath": "School_assessment_grp/springfiles_received", "label": ["Spring file"], "select_from_list_name": "yn"},
        {"type": "select_one", "name": "consent_signed", "$xpath": "School_assessment_grp/consent_signed", "label": ["Consent"], "select_from_list_name": "yn"},
        {"type": "select_one", "name": "training_conducted", "$xpath": "School_assessment_grp/training_conducted", "label": ["Training"], "select_from_list_name": "yn"},
        {"type": "select_one", "name": "retros_data_collected", "$xpath": "School_assessment_grp/retros_data_collected", "label": ["Retro data"], "select_from_list_name": "yn"},
        {"type": "select_one", "name": "data_officer", "$xpath": "School_assessment_grp/data_officer", "label": ["Data officer"], "select_from_list_name": "officers"},
    ],
}
SURVEYS["DM"] = [
    {"type": "start", "name": "start", "$xpath": "start"}, {"type": "end", "name": "end", "$xpath": "end"},
    {"type": "select_one", "name": "district", "$xpath": "School_location_info_grp/district", "label": ["District"], "select_from_list_name": "districts"},
    {"type": "text", "name": "district_code", "$xpath": "School_location_info_grp/district_code", "label": ["District Code"]},
    {"type": "date", "name": "meeting_entry_date", "$xpath": "School_location_info_grp/meeting_entry_date", "label": ["Entry meeting date"]},
    {"type": "select_one", "name": "mous_signed", "$xpath": "School_location_info_grp/mous_signed", "label": ["MOU signed"], "select_from_list_name": "yn"},
    {"type": "integer", "name": "num_schools_attended", "$xpath": "School_location_info_grp/num_schools_attended", "label": ["Schools attended"]},
    {"type": "select_one", "name": "Entrant_Initials", "$xpath": "School_location_info_grp/Entrant_Initials", "label": ["Initials"], "select_from_list_name": "officers"},
]
SURVEYS["DE"] = [
    {"type": "start", "name": "start", "$xpath": "start"}, {"type": "end", "name": "end", "$xpath": "end"},
    {"type": "select_one", "name": "district", "$xpath": "meeting_info_grp/district", "label": ["District"], "select_from_list_name": "districts"},
    {"type": "text", "name": "district_code", "$xpath": "meeting_info_grp/district_code", "label": ["District Code"]},
    {"type": "integer", "name": "num_schools_mobilized", "$xpath": "meeting_info_grp/num_schools_mobilized", "label": ["Target schools mobilized"]},
    {"type": "integer", "name": "num_conf_attendance", "$xpath": "meeting_info_grp/num_conf_attendance", "label": ["Confirmed"]},
    {"type": "date", "name": "resched_meeting_date", "$xpath": "meeting_info_grp/resched_meeting_date", "label": ["New date"]},
]
SURVEYS["DP"] = [
    {"type": "start", "name": "start", "$xpath": "start"}, {"type": "end", "name": "end", "$xpath": "end"},
    {"type": "select_one", "name": "district", "$xpath": "meeting_info_grp/district", "label": ["District"], "select_from_list_name": "districts"},
    {"type": "text", "name": "district_code", "$xpath": "meeting_info_grp/district_code", "label": ["District Code"]},
    {"type": "select_one", "name": "list_schools_obtained", "$xpath": "meeting_info_grp/list_schools_obtained", "label": ["List obtained"], "select_from_list_name": "yn"},
    {"type": "date", "name": "entry_meeting_date", "$xpath": "meeting_info_grp/entry_meeting_date", "label": ["Entry meeting date"]},
    {"type": "text", "name": "deo_name", "$xpath": "meeting_info_grp/deo_name", "label": ["DEO name"]},
    {"type": "text", "name": "deo_contact", "$xpath": "meeting_info_grp/deo_contact", "label": ["DEO phone"]},
]
CHOICES = (choices_schools()
           + [{"list_name": "yn", "name": "yes", "label": ["Yes"]}, {"list_name": "yn", "name": "no", "label": ["No"]}]
           + [{"list_name": "officers", "name": o.lower(), "label": [o]} for o in OFFICERS]
           + [{"list_name": "years", "name": "2026", "label": ["2026"]}, {"list_name": "terms", "name": "t1", "label": ["Term 1"]}, {"list_name": "terms", "name": "t2", "label": ["Term 2"]}]
           + [{"list_name": "districts", "name": d.lower().replace(" ", "_"), "label": [d]} for d in DISTRICTS]
           + [{"list_name": "regions", "name": r.lower(), "label": [r]} for r in set(DISTRICTS.values())])


def build():
    data = {k: [] for k in UIDS}
    sid = 1000
    recruited = SCHOOLS[:74]
    # F: 74 recruited + 14 screened-out (no code)
    for i, s in enumerate(recruited + [None] * 14):
        t = when(i); sid += 1
        rec = {"_id": sid, "_uuid": f"f-{sid}", "_submission_time": ts(t + timedelta(hours=5)), "_submitted_by": "pa_sense",
               "start": (t).astimezone(EAT).isoformat(timespec="milliseconds"), "end": (t + timedelta(hours=random.choice([1, 5, 9]))).astimezone(EAT).isoformat(timespec="milliseconds"),
               "School_screening_grp/atleast_300_boarders": "yes" if s else "no",
               "School_screening_grp/overall_status": "ELIGIBLE" if s else "NOT ELIGIBLE",
               "Respondent_signature_grp/data_officer": random.choice(OFFICERS).lower(), "_attachments": [], "_geolocation": [1.7, 32.3] if s and random.random() > 0.2 else [None, None]}
        if s:
            rec.update({"School_Identification_grp/school_code": s["code"], "School_Identification_grp/school_name": "OKELLO JAMES" if i in (5, 9) else s["name"],
                        "School_Identification_grp/district": s["district"] if random.random() > 0.25 else "",   # blanks
                        "School_Identification_grp/region": s["region"], "School_Identification_grp/enrollment_date": t.date().isoformat(),
                        "school_health_personnel_grp/nurse_name": "Nurse X", "school_health_personnel_grp/nurse_contact": f"07{random.randint(10000000, 99999999)}"})
        data["F"].append(rec)
    # G: 74 schools, 10 with a second submission
    for i, s in enumerate(recruited + random.sample(recruited, 10)):
        t = when(i); sid += 1
        data["G"].append({"_id": sid, "_uuid": f"g-{sid}", "_submission_time": ts(t + timedelta(hours=5)), "_submitted_by": "pa_sense",
                          "start": t.astimezone(EAT).isoformat(timespec="milliseconds"), "end": (t + timedelta(hours=6)).astimezone(EAT).isoformat(timespec="milliseconds"),
                          "School_Identification_grp/school_code": "SCH089" if i == 3 else s["code"], "School_Identification_grp/school_name": s["name"],
                          "School_Identification_grp/district": s["district"], "School_Identification_grp/region": s["region"],
                          "physical_infrastructure_grp/total_dormitories": random.randint(2, 12),
                          "Respondent_signature_grp/data_officer": random.choice(OFFICERS).lower(), "_attachments": [], "_geolocation": [None, None]})
    # H: 74 recruited (3 with region typed as district)
    for i, s in enumerate(recruited):
        t = when(i); sid += 1
        data["H"].append({"_id": sid, "_uuid": f"h-{sid}", "_submission_time": ts(t + timedelta(hours=5)), "_submitted_by": "pa_sense",
                          "start": t.astimezone(EAT).isoformat(timespec="milliseconds"), "end": (t + timedelta(minutes=random.choice([3, 40, 400]))).astimezone(EAT).isoformat(timespec="milliseconds"),
                          "School_location_info_grp/school_code": s["code"], "School_location_info_grp/school_name": s["name"],
                          "School_location_info_grp/district": s["region"] if i % 25 == 0 else s["district"],
                          "School_location_info_grp/region": s["region"], "School_location_info_grp/head_master": "HT Y",
                          "School_location_info_grp/hm_contact": f"07{random.randint(10000000, 99999999)}",
                          "School_location_info_grp/completion_date": t.date().isoformat(),
                          "Enrollment_data_grp": [{"Enrollment_data_grp/year": "2026", "Enrollment_data_grp/term": tm, "Enrollment_data_grp/total_malaria_cases": random.randint(0, 80)} for tm in (["t1", "t2"] if i % 3 else ["t1"])],
                          "data_officer": random.choice(OFFICERS).lower(), "_attachments": [], "_geolocation": [None, None]})
    # A: 48 assessments — 44 of recruited schools (name variants), 2 of unrecruited, 2 with blank district
    pool = random.sample(recruited, 44) + SCHOOLS[80:82]
    for i, s in enumerate(pool + [recruited[0], recruited[1]]):
        t = when(i) + timedelta(days=random.randint(1, 12)); sid += 1
        data["A"].append({"_id": sid, "_uuid": f"a-{sid}", "_submission_time": ts(t + timedelta(hours=3)), "_submitted_by": "pa_sense",
                          "start": t.astimezone(EAT).isoformat(timespec="milliseconds"), "end": (t + timedelta(minutes=3)).astimezone(EAT).isoformat(timespec="milliseconds"),
                          "School_assessment_grp/region": s["region"].lower(),
                          "School_assessment_grp/district": "" if i >= 46 else s["district"].lower().replace(" ", "_"),
                          "School_assessment_grp/school_name": variant(s["name"]), "School_assessment_grp/visit_date": t.date().isoformat(),
                          "School_assessment_grp/springfiles_received": "yes", "School_assessment_grp/consent_signed": random.choice(["yes", "no"]),
                          "School_assessment_grp/training_conducted": random.choice(["yes", "no"]), "School_assessment_grp/retros_data_collected": "yes",
                          "School_assessment_grp/data_officer": random.choice(OFFICERS).lower(), "_attachments": [], "_geolocation": [None, None]})
    base = {"_submitted_by": "pa_sense", "_attachments": [], "_geolocation": [None, None]}
    for i, d in enumerate(["hoima", "kiryandongo", "kikuube"]):
        sid += 1; t = datetime(2026, 10, 5, 6, 30, tzinfo=timezone.utc)
        data["DM"].append({**base, "_id": sid, "_uuid": f"dm-{sid}", "_submission_time": ts(t), "start": t.isoformat(), "end": (t + timedelta(minutes=9)).isoformat(),
                           "School_location_info_grp/district": d, "School_location_info_grp/district_code": "02", "School_location_info_grp/meeting_entry_date": "2026-09-29",
                           "School_location_info_grp/mous_signed": "yes", "School_location_info_grp/num_schools_attended": 7 + i, "School_location_info_grp/Entrant_Initials": "te"})
    for i, (d, n) in enumerate([("bukedea", 9), ("luwero", 20), ("karenga", 4)]):
        sid += 1; t = datetime(2026, 10, 2, 4, 0, tzinfo=timezone.utc)
        data["DE"].append({**base, "_id": sid, "_uuid": f"de-{sid}", "_submission_time": ts(t), "start": t.isoformat(), "end": (t + timedelta(minutes=5)).isoformat(),
                           "meeting_info_grp/district": d, "meeting_info_grp/district_code": "07", "meeting_info_grp/num_schools_mobilized": n, "meeting_info_grp/num_conf_attendance": n - 1})
    for d in ["gulu_city", "karenga"]:
        sid += 1; t = datetime(2026, 10, 3, 13, 0, tzinfo=timezone.utc)
        data["DP"].append({**base, "_id": sid, "_uuid": f"dp-{sid}", "_submission_time": ts(t), "start": t.isoformat(), "end": (t + timedelta(minutes=5)).isoformat(),
                           "meeting_info_grp/district": d, "meeting_info_grp/district_code": "01", "meeting_info_grp/list_schools_obtained": "yes",
                           "meeting_info_grp/entry_meeting_date": "2026-10-20", "meeting_info_grp/deo_name": "DEO PERSON", "meeting_info_grp/deo_contact": "0788000000"})
    for k in data:
        data[k].sort(key=lambda s: s["_id"])
    return data


DATA = build()
BY_UID = {uid: k for k, uid in UIDS.items()}


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send_json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)

    def do_GET(self):
        if self.headers.get("Authorization") != "Token test":
            return self.send_json({"detail": "Invalid token."}, 401)
        u = urlparse(self.path); qs = parse_qs(u.query)
        parts = [p for p in u.path.split("/") if p]
        if len(parts) < 4 or parts[:3] != ["api", "v2", "assets"] or parts[3] not in BY_UID:
            return self.send_json({"detail": "not found"}, 404)
        uid, k, rest = parts[3], BY_UID[parts[3]], parts[4:]
        rows = DATA[k]
        if not rest:
            return self.send_json({"uid": uid, "name": f"SENSE mock form {k}", "deployment__active": True,
                                   "deployment__submission_count": len(rows), "version_id": "v1", "date_modified": "2026-10-01T00:00:00Z",
                                   "content": {"survey": SURVEYS[k], "choices": CHOICES}})
        if rest == ["data"]:
            limit = int(qs.get("limit", [100])[0]); start = int(qs.get("start", [0])[0])
            nxt = f"http://127.0.0.1:{PORT}/api/v2/assets/{uid}/data/?format=json&limit={limit}&start={start + limit}" if start + limit < len(rows) else None
            return self.send_json({"count": len(rows), "next": nxt, "previous": None, "results": rows[start:start + limit]})
        if rest == ["export-settings"]:
            return self.send_json({"count": 1, "results": [{"uid": "esMOCK", "name": "Default",
                "data_url_xlsx": f"http://127.0.0.1:{PORT}/api/v2/assets/{uid}/export-settings/esMOCK/data.xlsx",
                "data_url_csv": f"http://127.0.0.1:{PORT}/api/v2/assets/{uid}/export-settings/esMOCK/data.csv"}]})
        if len(rest) == 3 and rest[0] == "export-settings":
            body = b"PK\x03\x04 mock export " + uid.encode()
            self.send_response(200); self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body); return
        self.send_json({"detail": "not found"}, 404)


if __name__ == "__main__":
    print(f"mock Kobo on http://127.0.0.1:{PORT}", file=sys.stderr)
    HTTPServer(("127.0.0.1", PORT), H).serve_forever()
