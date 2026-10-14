#!/usr/bin/env python3
"""Tiny fake of the KoboToolbox v2 API, for testing the pipeline without network access.

    python tests/mock_kobo.py 8765 &
    KOBO_TOKEN=test KOBO_BASE_URL=http://127.0.0.1:8765 python scripts/kobo_pull.py
    python scripts/summarize.py

Serves /api/v2/assets/<uid>/, /data/ (paginated), /export-settings/ and a dummy export file.
"""
import json
import random
import sys
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

random.seed(7)
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
UIDS = {"ak95trCoSBkM3aKqZysbdB": 180, "axDMBKEfMJYtZ5LiHqCMbb": 120,
        "aokEegtT2X8oyCDfQCWeZR": 60, "ajj7kZq2be5XDFSio3zJHu": 0}
DISTRICTS = ["Soroti", "Kumi", "Serere", "Ngora", "Katakwi", "Amuria", "Lira", "Apac"]
USERS = ["de_team01", "de_team02", "de_team03", "de_team04", "de_team05"]

SURVEY = [
    {"type": "start", "name": "start", "$xpath": "start"},
    {"type": "end", "name": "end", "$xpath": "end"},
    {"type": "begin_group", "name": "ident", "$xpath": "ident", "label": ["Identification"]},
    {"type": "select_one", "name": "district", "$xpath": "ident/district", "label": ["District"], "select_from_list_name": "districts"},
    {"type": "text", "name": "school_name", "$xpath": "ident/school_name", "label": ["School name"]},
    {"type": "text", "name": "school_id", "$xpath": "ident/school_id", "label": ["School ID"]},
    {"type": "end_group", "name": "ident"},
    {"type": "integer", "name": "n_boarders", "$xpath": "n_boarders", "label": ["Number of boarders"]},
    {"type": "text", "name": "nurse_phone", "$xpath": "nurse_phone", "label": ["Nurse phone"]},
    {"type": "begin_repeat", "name": "contacts", "$xpath": "contacts", "label": ["Contacts"]},
    {"type": "text", "name": "contact_name", "$xpath": "contacts/contact_name", "label": ["Contact name"]},
    {"type": "end_repeat", "name": "contacts"},
    {"type": "geopoint", "name": "gps", "$xpath": "gps", "label": ["GPS"]},
]
CHOICES = [{"list_name": "districts", "name": d.lower(), "label": [d]} for d in DISTRICTS]


def make_subs(uid: str, n: int) -> list[dict]:
    subs = []
    base = datetime(2026, 9, 22, tzinfo=timezone.utc)
    for i in range(n):
        day = base + timedelta(days=random.randint(0, 22))
        st = day.replace(hour=random.choice([5, 8, 9, 10, 11, 14, 15, 21]), minute=random.randint(0, 59))
        dur = random.choice([2, 12, 25, 31, 40, 55, 300])
        en = st + timedelta(minutes=dur)
        sid = 1000 + i
        school_id = f"S{random.randint(1, 160):03d}" if random.random() > 0.03 else "S042"  # some dupes
        subs.append({
            "_id": sid, "_uuid": f"uuid-{uid[:4]}-{i}",
            "_submission_time": (en + timedelta(minutes=5)).strftime("%Y-%m-%dT%H:%M:%S"),
            "_submitted_by": random.choice(USERS), "_status": "submitted_via_web",
            "_validation_status": random.choice([{}, {}, {"label": "Approved", "uid": "validation_status_approved"}]),
            "start": st.astimezone(timezone(timedelta(hours=3))).isoformat(timespec="milliseconds"),
            "end": en.astimezone(timezone(timedelta(hours=3))).isoformat(timespec="milliseconds"),
            "ident/district": random.choice(DISTRICTS).lower(),
            "ident/school_name": f"School {school_id}",
            "ident/school_id": school_id,
            "n_boarders": random.randint(80, 900) if random.random() > 0.15 else None,
            "nurse_phone": f"07{random.randint(10000000, 99999999)}",
            "contacts": [{"contacts/contact_name": f"Person {j}"} for j in range(random.randint(0, 3))],
            "gps": "1.71 33.61 1100 5" if random.random() > 0.1 else None,
            "_geolocation": [1.71, 33.61] if random.random() > 0.1 else [None, None],
            "_attachments": [], "_tags": [], "_notes": [],
        })
    subs.sort(key=lambda s: s["_id"])
    return subs


DATA = {uid: make_subs(uid, n) for uid, n in UIDS.items()}


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):  # quiet
        pass

    def send_json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.headers.get("Authorization") != "Token test":
            return self.send_json({"detail": "Invalid token."}, 401)
        u = urlparse(self.path)
        qs = parse_qs(u.query)
        parts = [p for p in u.path.split("/") if p]
        if len(parts) < 4 or parts[:3] != ["api", "v2", "assets"]:
            return self.send_json({"detail": "not found"}, 404)
        uid = parts[3]
        if uid not in DATA:
            return self.send_json({"detail": "not found"}, 404)
        rest = parts[4:]
        if not rest:
            return self.send_json({"uid": uid, "name": f"Mock form {uid[:6]}", "asset_type": "survey",
                                   "deployment__active": True, "deployment__submission_count": len(DATA[uid]),
                                   "version_id": "v1", "date_modified": "2026-10-01T00:00:00Z",
                                   "content": {"survey": SURVEY, "choices": CHOICES}})
        if rest == ["data"]:
            limit = int(qs.get("limit", [100])[0]); start = int(qs.get("start", [0])[0])
            rows = DATA[uid]
            nxt = None
            if start + limit < len(rows):
                nxt = f"http://127.0.0.1:{PORT}/api/v2/assets/{uid}/data/?format=json&limit={limit}&start={start + limit}"
            return self.send_json({"count": len(rows), "next": nxt, "previous": None, "results": rows[start:start + limit]})
        if rest == ["export-settings"]:
            es = "esMOCK123"
            return self.send_json({"count": 1, "results": [{"uid": es, "name": "Default",
                "data_url_xlsx": f"http://127.0.0.1:{PORT}/api/v2/assets/{uid}/export-settings/{es}/data.xlsx",
                "data_url_csv": f"http://127.0.0.1:{PORT}/api/v2/assets/{uid}/export-settings/{es}/data.csv"}]})
        if len(rest) == 3 and rest[0] == "export-settings":
            body = b"PK\x03\x04 mock export " + uid.encode()
            self.send_response(200); self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
            return
        self.send_json({"detail": "not found"}, 404)


if __name__ == "__main__":
    print(f"mock Kobo on http://127.0.0.1:{PORT}", file=sys.stderr)
    HTTPServer(("127.0.0.1", PORT), H).serve_forever()
