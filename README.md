# SENSE dashboards

Automated monitoring for the SENSE study's KoboCollect forms. A GitHub Action pulls every
form on a schedule, computes aggregates, and publishes a static dashboard; the raw exports
(including contact details) are kept for the team but never put on the web page.

```
KoboToolbox (kf.kobotoolbox.org)
        │  API v2, token auth, every 2 h
        ▼
GitHub Actions runner
   ├─ scripts/kobo_pull.py   → raw/*.json (row-level, discarded after the run)
   │                          → exports/*.csv + Kobo's own .xlsx/.csv  (team copy; run artifact / Box)
   └─ scripts/summarize.py   → site/data/summary.json (aggregates only; committed)
        │
        ▼
GitHub Pages  ←  site/index.html + site/data/summary.json
```

## Repo layout

| Path | What it is |
|---|---|
| `config/forms.yml` | The forms to pull (Kobo asset UIDs), group-by fields, dedupe keys, targets, DQ thresholds |
| `scripts/kobo_pull.py` | Pulls form definitions + all submissions (paginated), downloads Kobo's saved export, writes flattened CSVs |
| `scripts/summarize.py` | Aggregates → `site/data/summary.json`. No row-level values, names or phone numbers |
| `site/index.html` | The dashboard. Plain HTML/JS, no build step, reads `data/summary.json` |
| `.github/workflows/refresh.yml` | 2-hourly refresh + Pages deploy |
| `.github/workflows/daily-digest.yml` | Daily export email (see below) |
| `scripts/send_digest.py` / `config/digest.yml` / `state/digest.json` | The email, its settings, and its pause state |
| `tests/mock_kobo.py` | Fake Kobo API for testing offline |

## One-time setup (≈10 minutes)

1. **Create a public GitHub repository** (private repos cannot use GitHub Pages on a free personal account) and push this folder to it.
2. **Add the Kobo token as a secret**: repo → Settings → Secrets and variables → Actions → New repository secret → name `KOBO_TOKEN`, value = the API token from Kobo (Account settings → Security). Nothing else in the repo should ever contain the token.
3. **Turn on GitHub Pages from Actions**: repo → Settings → Pages → Build and deployment → Source: **GitHub Actions**.
4. **Run it once by hand**: Actions tab → "Refresh SENSE dashboards" → Run workflow. The first run pulls everything, commits `site/data/summary.json`, and deploys. The page URL appears in the run's `deploy` job (normally `https://<owner>.github.io/sense-dashboards/`).
5. After that it refreshes itself every 2 hours (`cron` in the workflow; GitHub may delay scheduled runs by some minutes).

### Who can see what

- **The repository and the dashboard page are public.** GitHub Pages on a free personal account requires a public repo. The repo holds code, config and `site/data/summary.json`, which only ever contains counts, dates, enumerator usernames, district/school breakdowns and the question list. If a login wall is wanted later, the same `site/` folder can be deployed to Cloudflare Pages behind Cloudflare Access (team-only sign-in) with a 10-line change to the workflow.
- **The exports** (`exports/`, incl. Kobo's XLSX with contact fields) exist only inside the workflow run and are deleted with it. They are never committed and never attached as a run artifact (run artifacts on a public repo are downloadable). Once Box is configured they are copied into a Box folder every run — see below.
- **The token** grants full access to the Kobo account. Because it was shared over chat during setup, regenerate it in Kobo once it is stored as the GitHub secret, and update the secret.

## Daily export email (nurse / head-teacher contacts to the team)

`.github/workflows/daily-digest.yml` runs at 05:45 Kampala time. It pulls Kobo, zips the
exports (`config/digest.yml` → `attach`), and emails them to the addresses in
`config/digest.yml` → `to`. The body carries the headline numbers: recruited schools (distinct
schools with an Annex H record) vs the 165 target, schools with an assessment form, and the lag.

- **Stop rule.** It sends daily while recruited < `recruitment_target`. The day the target is
  reached it sends a final email saying so and sets `"paused": true` in `state/digest.json`.
  To resume, edit that file on GitHub (set `paused` to `false`), or run the workflow by hand
  (Actions → Daily export email → Run workflow) with **force** ticked.
- **Dry run.** Run the workflow by hand with **dry_run** ticked to see the email in the log
  without sending.
- **Into Box without any Box app.** A Box folder can accept uploads by email: open the folder
  → ⚙ (folder settings) → *Email uploads* → copy the `upload.…@u.box.com` address and add it
  to `to:` in `config/digest.yml`. The attachments then land in that folder every morning.

### Secrets and variables for the email

| Where | Name | Value |
|---|---|---|
| Secret | `SMTP_USER` | the sending mailbox, e.g. `sense-reports@pilgrimafrica.org` |
| Secret | `SMTP_PASSWORD` | for Google Workspace: an **App Password** for that mailbox (Google Account → Security → 2-Step Verification on → App passwords), not the normal password |
| Secret | `EXPORT_ZIP_PASSWORD` | optional. If set, the zip is AES-256 encrypted with it; share the password with the team out of band. Leave unset for a plain zip |
| Variable | `SMTP_HOST` / `SMTP_PORT` | optional; defaults `smtp.gmail.com` / `465`. For Microsoft 365 use `smtp.office365.com` / `587` |
| Variable | `SMTP_FROM` | optional display sender; defaults to `SMTP_USER` |

Gmail limits attachments to 25 MB per message; four forms of a few hundred rows are well under 1 MB.

## Sending the exports to Box via the API (optional alternative, needs the Box admin once)

Box has no scheduler and cannot run the pull itself, but it is a good home for the team's
copy of the data. Each run overwrites `<form>.kobo.xlsx`, `<form>.csv` etc. in one Box folder
(and, optionally, keeps dated copies under `archive/`).

1. In the Box Developer Console (`app.box.com/developers/console`) create a **Custom App** →
   **Server Authentication (Client Credentials Grant)**. On *Configuration*: App Access Level
   **App + Enterprise Access**, scope **Write all files and folders**. Save, then under
   *Authorization* submit for approval — a Box **admin** approves it in Admin Console → Apps.
2. Copy the **Client ID** and **Client Secret** (Configuration tab) and the **Enterprise ID**
   (General Settings tab).
3. Add the app's **service account email** (General Settings tab, looks like
   `AutomationUser_…@boxdevedition.com`) as an **Editor** collaborator on the SENSE Box folder.
4. In GitHub: Settings → Secrets and variables → Actions:
   - Secrets: `BOX_CLIENT_ID`, `BOX_CLIENT_SECRET`
   - Variables: `BOX_SUBJECT_TYPE` = `enterprise`, `BOX_SUBJECT_ID` = the Enterprise ID,
     `BOX_FOLDER_ID` = the number at the end of the Box folder's URL,
     `BOX_SUBFOLDER_BY_DATE` = `1` if dated archive copies are wanted.

If none of these are set the step just logs "skipped" and the run still succeeds.

## How the recruitment view is computed (`scripts/roster.py`, `config/roster.yml`)

- **School key** = `school_code` (Annex F, G, H). The School Assessment form has no code, so it is
  matched by school name + district (exact → cleaned → word-overlap → fuzzy); unmatched and
  ambiguous forms are listed on the page.
- **District** of a school = the first 7 characters of its code (SCHrrdd…), which is more reliable
  than the free-text district field; disagreements are flagged.
- **Recruited** = ≥1 Annex H record. **Assessed** = ≥1 matched assessment form. **Lag** = days
  from first Annex H to the assessment (or to today).
- **District stage** from the three district checklists: preparation (entry-prep form) →
  pre-entry (pre-entry form; its `num_schools_mobilized` is the eligible-school count) → opened
  (district meeting form; `meeting_entry_date`, MOU, attendance). A district with schools but no
  meeting form shows as "entered (no meeting form)".
- `config/districts.csv` holds the 34 study districts with sub-region; `target_schools` there
  overrides the pre-entry form, `date_opened` fills in when no meeting form exists.
- School-name values that contain no school-type word (e.g. a head teacher's name typed in the
  wrong field) are kept off the page and flagged by code; DEO/DIS/DHO/mobiliser contacts from the
  district forms are never published.

## Configuring forms (`config/forms.yml`)

```yaml
forms:
  - key: enrolment                     # slug used in file names and the dashboard
    name: "Annex F — School Enrolment CRF (Form A)"
    uid: ak95trCoSBkM3aKqZysbdB        # Kobo asset UID
    group_by: [district, school_name]  # question names to break down by (case-insensitive,
                                       # matched on the last part of the xpath)
    dedupe_key: [school_id]            # should be unique per submission; repeats are flagged
    target: 165                        # optional, for the progress tile
    export_setting_uid: es…            # optional: which saved Kobo export to download
```

After the first real run, open the dashboard's "Questions in this form" panel to see the
actual question names in each form and adjust `group_by` / `dedupe_key` to match. Fields
that are not found are listed on the page rather than failing the run.

Data-quality thresholds (`quality:`) — minimum/maximum plausible duration and working hours
in Kampala time — are at the bottom of the same file.

## Running locally

```bash
pip install -r requirements.txt
export KOBO_TOKEN=…            # never commit this
python scripts/kobo_pull.py    # writes raw/ and exports/
python scripts/summarize.py    # writes site/data/summary.json
python -m http.server --directory site 8000   # then open http://localhost:8000
```

Offline test with fake data:

```bash
python tests/mock_kobo.py 8765 &
KOBO_TOKEN=test KOBO_BASE_URL=http://127.0.0.1:8765 python scripts/kobo_pull.py
python scripts/summarize.py
```

## Troubleshooting

- **"KOBO_TOKEN is not set"** — the secret is missing or misnamed.
- **401 from Kobo** — token revoked/regenerated; update the secret.
- **A form shows an error card** — its UID changed or the account lost access; the other forms still refresh.
- **Dashboard says data is N hours old** — the scheduled run failed; open the Actions tab for the log.
- **"no saved export settings on this form"** — in Kobo open the form → Data → Downloads, create an export (XLSX, labels, "include groups" as preferred) and save it; the pipeline picks it up on the next run.
