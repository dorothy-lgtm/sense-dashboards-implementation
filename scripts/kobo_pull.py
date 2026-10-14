#!/usr/bin/env python3
"""Pull SENSE form definitions and submissions from KoboToolbox.

Writes, for each form in config/forms.yml:
  raw/<key>.json            all submissions (row-level; git-ignored, never published)
  raw/<key>.schema.json     question list (name, xpath, type, label)
  exports/<key>.csv         flattened submissions for the team (Box)
  exports/<key>__<repeat>.csv   one file per repeat group, if any

Auth: KOBO_TOKEN environment variable (Kobo > Account settings > Security > API token).
Optional: KOBO_BASE_URL to override the base URL in the config (used by the test harness).
"""
from __future__ import annotations

import csv
import json
import os
import sys
import time
from pathlib import Path

import requests
import yaml

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "config" / "forms.yml"
RAW = ROOT / "raw"
EXPORTS = ROOT / "exports"

# Kobo metadata keys that are not form questions
META_SCALAR = {
    "_id", "_uuid", "_submission_time", "_submitted_by", "_status", "_version_",
    "__version__", "_xform_id_string", "formhub/uuid", "meta/instanceID",
    "meta/deprecatedID", "start", "end", "today", "deviceid", "phonenumber",
    "username", "simserial", "subscriberid",
}
META_DROP = {"_attachments", "_tags", "_notes", "_validation_status", "_geolocation",
             "_supplementalDetails"}


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


class Kobo:
    def __init__(self, base_url: str, token: str):
        self.base = base_url.rstrip("/")
        self.s = requests.Session()
        self.s.headers.update({"Authorization": f"Token {token}", "Accept": "application/json"})

    def get(self, url: str, **params) -> dict:
        """GET with retry on throttling / transient server errors."""
        for attempt in range(6):
            r = self.s.get(url, params=params or None, timeout=120)
            if r.status_code == 200:
                return r.json()
            if r.status_code in (429, 500, 502, 503, 504):
                wait = min(60, 2 ** attempt * 3)
                log(f"  {r.status_code} from {url} — retrying in {wait}s")
                time.sleep(wait)
                continue
            r.raise_for_status()
        raise RuntimeError(f"gave up on {url}")

    def asset(self, uid: str) -> dict:
        return self.get(f"{self.base}/api/v2/assets/{uid}/", format="json")

    def export_settings(self, uid: str) -> list[dict]:
        return self.get(f"{self.base}/api/v2/assets/{uid}/export-settings/", format="json").get("results", [])

    def download(self, url: str, dest: Path) -> int:
        """Stream an authenticated file (synchronous export) to disk; returns bytes written."""
        for attempt in range(4):
            r = self.s.get(url, timeout=300, stream=True)
            if r.status_code == 200:
                with dest.open("wb") as f:
                    for chunk in r.iter_content(1 << 16):
                        f.write(chunk)
                return dest.stat().st_size
            if r.status_code in (429, 500, 502, 503, 504):
                time.sleep(min(60, 2 ** attempt * 3))
                continue
            r.raise_for_status()
        raise RuntimeError(f"gave up on {url}")

    def submissions(self, uid: str, page_size: int) -> list[dict]:
        url = f"{self.base}/api/v2/assets/{uid}/data/"
        params = {"format": "json", "limit": page_size, "start": 0, "sort": json.dumps({"_id": 1})}
        rows: list[dict] = []
        while url:
            page = self.get(url, **params)
            batch = page.get("results", [])
            rows.extend(batch)
            total = page.get("count")
            log(f"  fetched {len(rows)}/{total if total is not None else '?'}")
            url = page.get("next")
            params = {}  # `next` already carries its own query string
        return rows


def schema_from_asset(asset: dict) -> list[dict]:
    """Flatten Kobo's survey definition into a list of questions with xpaths."""
    survey = asset.get("content", {}).get("survey", [])
    out = []
    repeat_stack: list[str] = []
    for q in survey:
        qtype = q.get("type", "")
        if qtype == "begin_repeat":
            repeat_stack.append(q.get("$xpath") or q.get("name", ""))
            continue
        if qtype == "end_repeat":
            if repeat_stack:
                repeat_stack.pop()
            continue
        if qtype in ("begin_group", "end_group", "note"):
            continue
        label = q.get("label")
        if isinstance(label, list):
            label = next((l for l in label if l), "")
        out.append({
            "name": q.get("name") or q.get("$autoname", ""),
            "xpath": q.get("$xpath") or q.get("name", ""),
            "type": qtype,
            "label": label or "",
            "select_from": q.get("select_from_list_name", ""),
            "repeat": repeat_stack[-1] if repeat_stack else "",   # non-empty = lives inside a repeat group
        })
    return out


def choices_from_asset(asset: dict) -> dict[str, dict[str, str]]:
    """{list_name: {choice_name: label}} so select_one codes can be labelled."""
    out: dict[str, dict[str, str]] = {}
    for c in asset.get("content", {}).get("choices", []):
        label = c.get("label")
        if isinstance(label, list):
            label = next((l for l in label if l), "")
        out.setdefault(c.get("list_name", ""), {})[str(c.get("name", ""))] = label or str(c.get("name", ""))
    return out


def flatten(sub: dict) -> tuple[dict, dict[str, list[dict]]]:
    """Return (flat_row, {repeat_name: [child_rows]}) for one submission."""
    row: dict = {}
    repeats: dict[str, list[dict]] = {}
    for k, v in sub.items():
        if k in META_DROP:
            continue
        if isinstance(v, list):
            # In Kobo's JSON, a list-valued question is a repeat group (select_multiple comes
            # as a space-separated string). Children go to their own CSV; the parent keeps a count.
            children = []
            for i, child in enumerate(v):
                if not isinstance(child, dict):
                    child = {k: child}
                c = {"_parent_id": sub.get("_id"), "_parent_uuid": sub.get("_uuid"), "_index": i + 1}
                for ck, cv in child.items():
                    c[ck] = json.dumps(cv, ensure_ascii=False) if isinstance(cv, (list, dict)) else cv
                children.append(c)
            repeats[k] = children
            row[f"{k}_count"] = len(v)
        elif isinstance(v, dict):
            row[k] = json.dumps(v, ensure_ascii=False)
        else:
            row[k] = v
    geo = sub.get("_geolocation") or [None, None]
    row["_latitude"], row["_longitude"] = (geo + [None, None])[:2]
    vs = sub.get("_validation_status") or {}
    row["_validation_status"] = vs.get("label") or vs.get("uid") or ""
    row["_attachments_count"] = len(sub.get("_attachments") or [])
    return row, repeats


def write_csv(path: Path, rows: list[dict]) -> None:
    if not rows:
        path.write_text("")
        return
    cols: list[str] = []
    seen = set()
    for r in rows:
        for k in r:
            if k not in seen:
                seen.add(k)
                cols.append(k)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


def main() -> int:
    token = os.environ.get("KOBO_TOKEN")
    if not token:
        log("KOBO_TOKEN is not set")
        return 2
    cfg = yaml.safe_load(CONFIG.read_text())
    base = os.environ.get("KOBO_BASE_URL") or cfg["kobo"]["base_url"]
    page_size = int(os.environ.get("KOBO_PAGE_SIZE") or cfg["kobo"].get("page_size", 5000))
    kobo = Kobo(base, token)

    RAW.mkdir(exist_ok=True)
    EXPORTS.mkdir(exist_ok=True)
    manifest = {"pulled_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "forms": {}}

    failures = 0
    for form in cfg["forms"]:
        key, uid = form["key"], form["uid"]
        log(f"[{key}] {form.get('name', '')} ({uid})")
        try:
            asset = kobo.asset(uid)
            schema = schema_from_asset(asset)
            rows = kobo.submissions(uid, page_size)
        except Exception as e:  # keep going so one broken form doesn't blank the whole dashboard
            log(f"  FAILED: {e}")
            failures += 1
            manifest["forms"][key] = {"error": str(e)}
            continue

        (RAW / f"{key}.json").write_text(json.dumps(rows, ensure_ascii=False))
        (RAW / f"{key}.schema.json").write_text(json.dumps({
            "uid": uid,
            "kobo_name": asset.get("name"),
            "deployment_active": asset.get("deployment__active"),
            "deployment_submission_count": asset.get("deployment__submission_count"),
            "version_id": asset.get("version_id"),
            "date_modified": asset.get("date_modified"),
            "questions": schema,
            "choices": choices_from_asset(asset),
        }, ensure_ascii=False, indent=1))

        flat, repeat_rows = [], {}
        for sub in rows:
            r, reps = flatten(sub)
            flat.append(r)
            for name, children in reps.items():
                repeat_rows.setdefault(name, []).extend(children)
        write_csv(EXPORTS / f"{key}.csv", flat)
        for name, children in repeat_rows.items():
            safe = name.replace("/", "__")
            write_csv(EXPORTS / f"{key}__{safe}.csv", children)

        # Kobo's own formatted export (labels, repeat sheets) via the saved export settings —
        # the "data_url_xlsx" / "data_url_csv" links on /api/v2/assets/<uid>/export-settings/.
        kobo_exports = {}
        try:
            settings = kobo.export_settings(uid)
            wanted = form.get("export_setting_uid")
            chosen = next((s for s in settings if s.get("uid") == wanted), None) if wanted else None
            chosen = chosen or (settings[0] if settings else None)
            if chosen:
                for fmt in ("xlsx", "csv"):
                    url = chosen.get(f"data_url_{fmt}")
                    if url:
                        dest = EXPORTS / f"{key}.kobo.{fmt}"
                        size = kobo.download(url, dest)
                        kobo_exports[fmt] = {"export_setting": chosen.get("uid"), "bytes": size}
                        log(f"  downloaded Kobo {fmt} export ({size:,} bytes, setting {chosen.get('uid')})")
            else:
                log("  no saved export settings on this form — create one in Kobo > Data > Downloads")
        except Exception as e:
            log(f"  export download failed (continuing): {e}")

        manifest["forms"][key] = {
            "uid": uid,
            "kobo_name": asset.get("name"),
            "submissions": len(rows),
            "kobo_reported_count": asset.get("deployment__submission_count"),
            "questions": len(schema),
            "repeat_groups": sorted(repeat_rows),
            "kobo_exports": kobo_exports,
        }
        log(f"  {len(rows)} submissions, {len(schema)} questions, {len(repeat_rows)} repeat group(s)")

    (RAW / "manifest.json").write_text(json.dumps(manifest, indent=1))
    log(f"done — {len(cfg['forms']) - failures}/{len(cfg['forms'])} forms pulled")
    return 1 if failures == len(cfg["forms"]) else 0


if __name__ == "__main__":
    sys.exit(main())
