#!/usr/bin/env python3
"""Encrypt the dashboard data files with the team passphrase so the public site holds only ciphertext.

  SITE_PASSPHRASE   the passphrase (GitHub secret). The browser derives the same key and decrypts.

For each site/data/<name>.json writes site/data/<name>.json.enc and deletes the plaintext.
Format (JSON): {"v":1,"kdf":"PBKDF2-SHA256","iter":N,"salt":b64,"iv":b64,"data":b64(AES-256-GCM ciphertext+tag)}

Exit code 3 when SITE_PASSPHRASE is unset: the workflow then publishes the site WITHOUT data files.
"""
from __future__ import annotations

import base64
import json
import os
import sys
from pathlib import Path

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "site" / "data"
ITER = 200_000


def main() -> int:
    pw = os.environ.get("SITE_PASSPHRASE", "")
    files = sorted(DATA.glob("*.json"))
    if not pw:
        print("SITE_PASSPHRASE is not set — removing plaintext data so nothing school-level is published", file=sys.stderr)
        for f in files:
            f.unlink()
        for f in DATA.glob("*.json.enc"):
            f.unlink()
        return 3
    for f in files:
        salt, iv = os.urandom(16), os.urandom(12)
        key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=ITER).derive(pw.encode("utf-8"))
        ct = AESGCM(key).encrypt(iv, f.read_bytes(), None)
        out = f.with_suffix(".json.enc")
        out.write_text(json.dumps({"v": 1, "kdf": "PBKDF2-SHA256", "iter": ITER,
                                   "salt": base64.b64encode(salt).decode(), "iv": base64.b64encode(iv).decode(),
                                   "data": base64.b64encode(ct).decode()}))
        f.unlink()
        print(f"encrypted {f.name} -> {out.name} ({out.stat().st_size // 1024} KB)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
