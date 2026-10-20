#!/usr/bin/env python3
"""Publish the STRUCTURE of every pulled form (question names, types, labels — no data) to
state/forms_schema.json, so the form design can be inspected from the repository without
touching Kobo or the encrypted data files. Committed by the refresh workflow."""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "raw"
OUT = ROOT / "state" / "forms_schema.json"


def main() -> int:
    forms = yaml.safe_load((ROOT / "config" / "forms.yml").read_text())["forms"]
    out = {"generated_at": datetime.now(timezone.utc).isoformat(), "forms": {}}
    for f in forms:
        p = RAW / f"{f['key']}.schema.json"
        if not p.exists():
            continue
        meta = json.loads(p.read_text())
        out["forms"][f["key"]] = {
            "name": f.get("name"), "uid": f.get("uid"),
            "questions": [{"name": q["name"], "xpath": q["xpath"], "type": q["type"], "label": q.get("label"), "repeat": q.get("repeat") or ""} for q in meta["questions"]],
            "choices": {ln: list(labels.values())[:60] for ln, labels in (meta.get("choices") or {}).items()},
        }
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n")
    print(f"schema snapshot: {len(out['forms'])} forms -> {OUT.relative_to(ROOT)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
