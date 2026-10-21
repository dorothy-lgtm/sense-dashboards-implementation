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
ROSTER = ROOT / "site" / "data" / "roster.json"
EXPORTS = ROOT / "exports"
STATE = ROOT / "state" / "digest.json"


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def report(msg: str, level: str = "notice") -> None:
    """Log, write to the GitHub run summary, and raise a run annotation (notice / warning / error) so the
    outcome is readable from the Actions page and the API without opening logs. Never include secrets."""
    log(msg)
    p = os.environ.get("GITHUB_STEP_SUMMARY")
    if p:
        with open(p, "a", encoding="utf-8") as f:
            f.write(f"**Daily export email:** {msg}\n\n")
    if os.environ.get("GITHUB_ACTIONS"):
        print(f"::{level} title=Daily export email::{msg.replace(chr(10), ' ')}", flush=True)


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
    roster_tot = None
    if ROSTER.exists():   # preferred: the joined school roster (assessments matched by name)
        roster_tot = json.loads(ROSTER.read_text())["totals"]
        recruited, rec_basis = roster_tot["schools_recruited"], "distinct school codes in Annex H"
        assessed, asm_basis = roster_tot["schools_assessed"], f"{roster_tot['assessment_submissions']} assessment forms, {roster_tot['assessment_matched']} matched to a recruited school"
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
            lines.append(f"Awaiting assessment: {max(0, recruited - assessed)} recruited schools without an assessment form"
                         + (f" (median wait {roster_tot['median_open_lag_days']} days, longest {roster_tot['max_open_lag_days']})"
                            if roster_tot and roster_tot.get("median_open_lag_days") is not None else ""))
        if roster_tot:
            lines.append(f"Districts entered: {roster_tot['districts_entered']}"
                         + (f" · opened: {roster_tot['districts_opened']}" if roster_tot.get("districts_opened") is not None else "")
                         + f" · recruited in last 7 days: {roster_tot['recruited_last_7d']}")
            if roster_tot.get("assessment_unmatched") or roster_tot.get("assessment_ambiguous"):
                lines.append(f"Assessment forms not matched to a school: {roster_tot['assessment_unmatched']} unmatched, "
                             f"{roster_tot['assessment_ambiguous']} ambiguous — see the dashboard's data-issues panel")
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
    msg["From"] = (os.environ.get("SMTP_FROM") or os.environ.get("SMTP_USER") or "").strip()
    msg["To"] = ", ".join(cfg.get("to", []))
    if cfg.get("cc"):
        msg["Cc"] = ", ".join(cfg["cc"])
    msg.set_content(body)
    msg.add_attachment(zip_path.read_bytes(), maintype="application", subtype="zip", filename=zip_path.name)

    recipients = list(cfg.get("to", [])) + list(cfg.get("cc", []))
    if dry:
        print(f"--- DRY RUN: would send to {recipients}\nSubject: {subject}\n\n{body}")
    else:
        # GitHub passes unset variables as EMPTY strings, so use `or` for every default.
        user = (os.environ.get("SMTP_USER") or "").strip()
        password = (os.environ.get("SMTP_PASSWORD") or "").replace(" ", "")   # Google app passwords are shown with spaces
        if not user or not password:
            report("Email skipped: SMTP_USER / SMTP_PASSWORD secrets are not set (see README → Daily export email).", "warning")
            zip_path.unlink(missing_ok=True)
            return 0
        host = (os.environ.get("SMTP_HOST") or "smtp.gmail.com").strip()
        try:
            port = int((os.environ.get("SMTP_PORT") or "465").strip())
        except ValueError:
            port = 465
        masked = user[:2] + "…@" + user.split("@")[-1] if "@" in user else "(user, no @ in SMTP_USER)"
        log(f"sending as {masked} via {host}:{port} ({'SSL' if port == 465 else 'STARTTLS'}); password length {len(password)}; attachment {size_mb:.1f} MB")

        def attempt(h: str, p: int) -> str | None:
            """Connect → login → send; returns None on success or 'stage: error' on failure."""
            stage, ehlo = "connect", ""
            try:
                if p == 465:
                    s = smtplib.SMTP_SSL(h, p, timeout=60)
                else:
                    s = smtplib.SMTP(h, p, timeout=60)
                    s.ehlo()
                    s.starttls()
                with s:
                    code, resp = s.ehlo()
                    ehlo = f"{code} " + (resp.decode(errors="replace") if isinstance(resp, bytes) else str(resp)).replace("\n", " | ")
                    stage = "login"
                    s.login(user, password)
                    stage = "send"
                    s.send_message(msg, to_addrs=recipients)
                return None
            except smtplib.SMTPAuthenticationError as e:
                err = e.smtp_error.decode(errors="replace") if isinstance(e.smtp_error, bytes) else e.smtp_error
                return f"login rejected: {e.smtp_code} {err}"
            except (smtplib.SMTPException, OSError) as e:
                return f"{stage} failed: {type(e).__name__}: {e}" + (f" (server greeted with: {ehlo})" if ehlo else "")

        err = attempt(host, port)
        if err and port == 465 and "login rejected" not in err:
            log(f"465/SSL attempt failed ({err}); retrying on 587/STARTTLS")
            err2 = attempt(host, 587)
            err = None if err2 is None else f"465 → {err}; 587 → {err2}"
            if err is None:
                log("sent via 587/STARTTLS — set the SMTP_PORT variable to 587 to skip the failing 465 attempt")
        if err:
            app_pw = "yes" if (len(password) == 16 and password.isalpha()) else "no"
            err += f". SMTP_PASSWORD looks like a 16-letter Google App Password: {app_pw}; SMTP_USER has an @: {'yes' if '@' in user else 'no'}"
            hint = (" For Google Workspace the SMTP_PASSWORD must be a 16-character App Password (Google Account → Security → 2-Step Verification → App passwords), not the account password."
                    if "login rejected" in err else
                    f" Attachment is {size_mb:.1f} MB (Gmail's limit is 25 MB); 'connection unexpectedly closed' at the send stage usually means the server dropped the message, at connect/login that the account or host is blocking SMTP.")
            report(f"Email NOT sent as {masked} via {host}: {err}.{hint}", "error")
            zip_path.unlink(missing_ok=True)
            return 1
        log(f"sent to {recipients}: {subject}")
        report(f"Email sent to {', '.join(recipients)} — {subject}")

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
