#!/usr/bin/env python3
"""Upload the exports/ folder to a Box folder, replacing files of the same name.

Auth: Box "Custom App" with Server Authentication (Client Credentials Grant).
  BOX_CLIENT_ID, BOX_CLIENT_SECRET     from the app's Configuration tab
  BOX_SUBJECT_TYPE                     "enterprise" (app's service account) or "user"
  BOX_SUBJECT_ID                       the enterprise ID, or the user ID to act as
  BOX_FOLDER_ID                        target folder (the number in the Box folder URL)

If acting as the service account, that account must be added as a collaborator
(Editor) on the target folder — its email is shown on the app's General Settings tab.
Optional: BOX_SUBFOLDER_BY_DATE=1 keeps dated copies under YYYY-MM-DD/ as well as
overwriting the "latest" files in the folder root.
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
EXPORTS = ROOT / "exports"
API = "https://api.box.com/2.0"
UPLOAD = "https://upload.box.com/api/2.0"


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def token() -> str:
    r = requests.post("https://api.box.com/oauth2/token", data={
        "grant_type": "client_credentials",
        "client_id": os.environ["BOX_CLIENT_ID"],
        "client_secret": os.environ["BOX_CLIENT_SECRET"],
        "box_subject_type": os.environ.get("BOX_SUBJECT_TYPE", "enterprise"),
        "box_subject_id": os.environ["BOX_SUBJECT_ID"],
    }, timeout=60)
    r.raise_for_status()
    return r.json()["access_token"]


class Box:
    def __init__(self, tok: str):
        self.s = requests.Session()
        self.s.headers["Authorization"] = f"Bearer {tok}"

    def items(self, folder_id: str) -> dict[str, dict]:
        out, offset = {}, 0
        while True:
            r = self.s.get(f"{API}/folders/{folder_id}/items",
                           params={"fields": "id,name,type", "limit": 1000, "offset": offset}, timeout=60)
            r.raise_for_status()
            j = r.json()
            for e in j["entries"]:
                out[e["name"]] = e
            offset += len(j["entries"])
            if offset >= j["total_count"] or not j["entries"]:
                return out

    def ensure_folder(self, parent_id: str, name: str) -> str:
        existing = self.items(parent_id).get(name)
        if existing and existing["type"] == "folder":
            return existing["id"]
        r = self.s.post(f"{API}/folders", json={"name": name, "parent": {"id": parent_id}}, timeout=60)
        r.raise_for_status()
        return r.json()["id"]

    def upload(self, folder_id: str, path: Path, existing: dict[str, dict]) -> str:
        attrs = json.dumps({"name": path.name, "parent": {"id": folder_id}})
        with path.open("rb") as f:
            files = {"attributes": (None, attrs, "application/json"), "file": (path.name, f)}
            prev = existing.get(path.name)
            if prev and prev["type"] == "file":
                r = self.s.post(f"{UPLOAD}/files/{prev['id']}/content", files=files, timeout=600)
            else:
                r = self.s.post(f"{UPLOAD}/files/content", files=files, timeout=600)
        if r.status_code == 409:  # name clash from a concurrent run — retry as a new version
            fid = r.json().get("context_info", {}).get("conflicts", {}).get("id")
            if fid:
                with path.open("rb") as f:
                    r = self.s.post(f"{UPLOAD}/files/{fid}/content",
                                    files={"attributes": (None, attrs, "application/json"), "file": (path.name, f)},
                                    timeout=600)
        r.raise_for_status()
        return r.json()["entries"][0]["id"]


def main() -> int:
    missing = [k for k in ("BOX_CLIENT_ID", "BOX_CLIENT_SECRET", "BOX_SUBJECT_ID", "BOX_FOLDER_ID") if not os.environ.get(k)]
    if missing:
        log(f"Box upload skipped — not configured ({', '.join(missing)})")
        return 0
    files = sorted(p for p in EXPORTS.glob("*") if p.is_file() and p.stat().st_size > 0)
    if not files:
        log("Box upload skipped — nothing in exports/")
        return 0
    box = Box(token())
    root = os.environ["BOX_FOLDER_ID"]
    existing = box.items(root)
    for p in files:
        box.upload(root, p, existing)
        log(f"  uploaded {p.name} ({p.stat().st_size:,} bytes)")
    if os.environ.get("BOX_SUBFOLDER_BY_DATE") == "1":
        day = time.strftime("%Y-%m-%d", time.gmtime())
        archive = box.ensure_folder(box.ensure_folder(root, "archive"), day)
        existing = box.items(archive)
        for p in files:
            box.upload(archive, p, existing)
        log(f"  archived copies under archive/{day}/")
    log(f"Box: {len(files)} file(s) uploaded to folder {root}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
