#!/usr/bin/env python3
"""Email the day's Kobo exports to the team, until recruitment reaches its target.

Reads  config/digest.yml, site/data/summary.json, exports/, state/digest.json
Sends  one email with the exports zipped (AES-encrypted if EXPORT_ZIP_PASSWORD is set)
Writes state/digest.json (last_sent, paused) — committed by the workflow

Env (GitHub secrets / variables):
  SMTP_USER, SMTP_PASSWORD   sending mailbox (Google Workspace: an App Password)
  SMTP_HOST, SMTP_PORT       default smtp.gmail.com : 465 (SSL)
  EXPORT_ZIP_PASSWORD        optional; if set the zip is AES-256 encrypted
  DIGEST_FORCE=1             send even if paused / target reached
  DIGEST_DRY_RUN=1           build everything, print the email, don't send
"""
from __future__ import annotations

import json
import os
import smtplib
import sys
import time
from email.message import EmailMessage
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
CFG = ROOT / "config" / "digest.yml"
SUMMARY = ROOT / "site" / "data" / "summary.json"
EXPORTS = ROOT / "exports"
STATE = ROOT / "state" / "digest.json"


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def load_state() -> dict:
    if STATE.exists():
        try:
            return json.loads(STATE.read_text())
        except json.JSONDecodeError:
            pass
    return {"paused": False, "paused_reason": None, "paused_at": None, "last_sent": None, "sent_count": 0}


def save_state(state: dict) -> None:
    STATE.parent.mkdir(exist_ok=True)
    STATE.write_text(json.dumps(state, indent=1) + "\n")


def make_zip(files: list[Path], dest: Path, password: str | None) -> None:
    if password:
        try:
            import pyzipper
        except ImportError:
            pyzipper = None
        if pyzipper:
            with pyzipper.AESZipFile(dest, "w", compression=pyzipper.ZIP_DEFLATED, encryption=pyzipper.WZ_AES) as z:
                z.setpassword(password.encode())
                for f in files:
                    z.write(f, f.name)
        else:  # 7-Zip is preinstalled on GitHub's ubuntu runners
            import shutil
            import subprocess
            exe = shutil.which("7z") or shutil.which("7zz") or shutil.which("7za")
            if not exe:
                raise RuntimeError("EXPORT_ZIP_PASSWORD set but neither pyzipper nor 7z is available")
            dest.unlink(missing_ok=True)
            subprocess.run([exe, "a", "-tzip", "-mem=AES256", f"-p{password}", str(dest), *[str(f) for f in files]],
                           check=True, capture_output=True)
    else:
        import zipfile
        with zipfile.ZipFile(dest, "w", compression=zipfile.ZIP_DEFLATED) as z:
            for f in files:
                z.write(f, f.name)


def form_line(f: dict) -> str:
    if "error" in f:
        return f"- {f['name']}: ERROR — {f['error']}"
    t = f["totals"]
    units = t.get("distinct_units")
    unit_txt = f", {units} distinct {'/'.join(f.get('dedupe_fields') or ['unit'])}" if units is not None else ""
    return f"- {f['name']}: {t['submissions']} submissions{unit_txt}, +{t['last_24h']} in last 24 h"


def main() -> int:
    cfg = yaml.safe_load(CFG.read_text())
    force = os.environ.get("DIGEST_FORCE") == "1"
    dry = os.environ.get("DIGEST_DRY_RUN") == "1"
    state = load_state()

    if not cfg.get("enabled", True) and not force:
        log("digest disabled in config/digest.yml")
        return 0
    if state.get("paused") and not force:
        log(f"digest paused ({state.get('paused_reason')}) — set paused:false in state/digest.json to resume")
        return 0
    if not SUMMARY.exists():
        log("no summary.json — run summarize.py first")
        return 1

    summary = json.loads(SUMMARY.read_text())
    forms = {f["key"]: f for f in summary["forms"]}
    rec = forms.get(cfg["recruitment_form"], {})
    asm = forms.get(cfg["assessment_form"], {})
    target = int(cfg.get("recruitment_target", 0) or 0)

    def units_or_subs(f: dict) -> tuple[int | None, str]:
        if not f or "error" in f:
            return None, "no data"
        t = f["totals"]
        if t.get("distinct_units") is not None:
            return t["distinct_units"], "distinct schools"
        return t["submissions"], "submissions (no school key matched yet)"

    recruited, rec_basis = units_or_subs(rec)
    assessed, asm_basis = units_or_subs(asm)
    reached = target and recruited is not None and recruited >= target

    # --- attachments ------------------------------------------------------------
    files: list[Path] = []
    for pat in cfg.get("attach", ["*"]):
        files += [p for p in EXPORTS.glob(pat) if p.is_file() and p.stat().st_size > 0]
    files = sorted(set(files))
    stamp = time.strftime("%Y-%m-%d")
    zip_path = ROOT / f"SENSE_exports_{stamp}.zip"
    pw = os.environ.get("EXPORT_ZIP_PASSWORD") or None
    make_zip(files, zip_path, pw)
    size_mb = zip_path.stat().st_size / 1e6

    # --- body ---------------------------------------------------------------------
    pulled = summary.get("pulled_at") or summary.get("generated_at")
    lines = [f"SENSE KoboCollect exports — {stamp} (data pulled {pulled} UTC)", ""]
    if target:
        lines.append(f"Recruited schools (Annex H entered): {recruited if recruited is not None else '?'} / {target}  [{rec_basis}]")
        lines.append(f"Schools with assessment form entered: {assessed if assessed is not None else '?'}  [{asm_basis}]")
        if recruited is not None and assessed is not None:
            lines.append(f"Assessment lag: {max(0, recruited - assessed)} recruited schools without an assessment form")
        lines.append("")
    lines.append("Per form:")
    lines += [form_line(f) for f in summary["forms"]]
    lines += ["", f"Attached: {zip_path.name} ({size_mb:.1f} MB, {len(files)} files)"
              + (" — AES-256 encrypted; password as agreed with the data team." if pw else "")]
    if reached:
        lines += ["", f"*** Recruitment target reached ({recruited}/{target}). ***",
                  "This is the last automatic daily email. To keep receiving it, set \"paused\": false in "
                  "state/digest.json on GitHub, or run the 'Daily export email' workflow by hand with force=true."]
    lines += ["", "Dashboard: see the GitHub Pages URL in the repository README.",
              "This message was generated automatically by the sense-dashboards workflow."]
    body = "\n".join(lines)

    subject = f"{cfg.get('subject_prefix', '[SENSE]')} {stamp}"
    if target and recruited is not None:
        subject += f" — {recruited}/{target} schools recruited"
    if reached:
        subject += " — TARGET REACHED, daily emails pausing"

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = os.environ.get("SMTP_FROM") or os.environ.get("SMTP_USER", "")
    msg["To"] = ", ".join(cfg.get("to", []))
    if cfg.get("cc"):
        msg["Cc"] = ", ".join(cfg["cc"])
    msg.set_content(body)
    msg.add_attachment(zip_path.read_bytes(), maintype="application", subtype="zip", filename=zip_path.name)

    recipients = list(cfg.get("to", [])) + list(cfg.get("cc", []))
    if dry:
        print(f"--- DRY RUN: would send to {recipients}\nSubject: {subject}\n\n{body}")
    else:
        user, password = os.environ.get("SMTP_USER"), os.environ.get("SMTP_PASSWORD")
        if not user or not password:
            log("SMTP_USER / SMTP_PASSWORD not set — email skipped")
            zip_path.unlink(missing_ok=True)
            return 2
        host = os.environ.get("SMTP_HOST", "smtp.gmail.com")
        port = int(os.environ.get("SMTP_PORT", "465"))
        if port == 465:
            with smtplib.SMTP_SSL(host, port, timeout=60) as s:
                s.login(user, password)
                s.send_message(msg, to_addrs=recipients)
        else:
            with smtplib.SMTP(host, port, timeout=60) as s:
                s.starttls()
                s.login(user, password)
                s.send_message(msg, to_addrs=recipients)
        log(f"sent to {recipients}: {subject}")

    state["last_sent"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    state["sent_count"] = int(state.get("sent_count", 0)) + 1
    if reached and cfg.get("stop_at_target", True) and not force:
        state.update({"paused": True, "paused_reason": f"recruitment target reached ({recruited}/{target})",
                      "paused_at": state["last_sent"]})
    if not dry:
        save_state(state)
    zip_path.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
