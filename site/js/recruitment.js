/* ------------------------------------------------------------ recruitment view */
let district = null;
function renderRecruit() {
  const el = $("#page-recruit");
  if (!ROSTER) { el.innerHTML = `<p class="empty">roster.json not available yet.</p>`; return; }
  const t = ROSTER.totals, target = t.recruitment_target;
  const pct = target ? Math.round(1000 * t.schools_recruited / target) / 10 : null;
  const openedTile = tile("Districts opened", num(t.districts_opened), `entry-meeting form submitted · ${num(t.districts_in_config)} study districts` +
      (t.districts_entered_without_meeting_form ? `<br><span class="flag"><span class="dot" style="background:var(--warning)"></span>${num(t.districts_entered_without_meeting_form)} more have schools but no meeting form</span>` : ""));
  const entered = ROSTER.districts.filter(d => d.entered);
  const known = entered.filter(d => d.target_schools !== null), unknown = entered.filter(d => d.target_schools === null);
  const eligKnown = known.reduce((a, d) => a + Math.max(d.target_schools, d.recruited), 0), recKnown = known.reduce((a, d) => a + d.recruited, 0), recUnknown = unknown.reduce((a, d) => a + d.recruited, 0);
  const headroomTile = tile("If all eligible schools in entered districts were recruited", `≥ ${num(eligKnown + recUnknown)}`,
      `${num(known.length)} entered districts with an eligible count: ${num(eligKnown)} eligible, ${num(recKnown)} recruited, ${num(eligKnown - recKnown)} remaining · ${num(unknown.length)} entered districts with no eligible count (${num(recUnknown)} recruited there) — true figure is higher if those have more eligible schools`, true);
  const pipelineTile = tile("Districts in pipeline", `${num(t.districts_prep + t.districts_pre_entry)}`, `${num(t.districts_prep)} preparation · ${num(t.districts_pre_entry)} pre-entry done · ${num(t.districts_scheduled)} with a meeting date set`);
  const elig = Object.entries(t.screening_outcomes || {}).map(([k, v]) => `${esc(titleCase(k))}: ${num(v)}`).join(" · ");
  el.innerHTML = `
    <div class="tiles">
      ${openedTile}
      ${tile("Districts entered", num(t.districts_entered), "≥1 school with Annex H")}
      ${pipelineTile}
      ${headroomTile}
      <div class="card tile"><div class="label">Schools recruited</div><div class="value">${num(t.schools_recruited)}<span class="meta"> / ${num(target)}</span></div>
        <div class="bar"><div style="width:${Math.min(100, pct)}%"></div></div><div class="note">${pct}% · +${num(t.recruited_last_7d)} in last 7 days${t.districts_with_target ? ` · eligible-school counts known for ${num(t.districts_with_target)} districts (${num(t.target_schools_known)} schools)` : ""}</div></div>
      ${tile("Assessment forms entered", num(t.schools_assessed), `${num(t.assessment_submissions)} forms, ${num(t.assessment_matched)} matched to a recruited school`)}
      ${flagTile("Awaiting assessment", t.awaiting_assessment, t.schools_recruited, "var(--warning)",
         t.median_open_lag_days !== null ? `median wait ${t.median_open_lag_days} d · longest ${t.max_open_lag_days} d` : "")}
      ${tile("Screened (Annex F)", num(t.screening_submissions), elig || "", !!elig)}
    </div>

    <h3>Recruitment by district <span class="meta">— click a district for its schools</span></h3>
    <div class="legend"><span class="dot" style="background:var(--series-1)"></span> recruited &nbsp; <span class="dot" style="background:var(--series-3)"></span> of which assessed &nbsp; · bar length vs the district's eligible schools (pre-entry form "target schools mobilized", or config/districts.csv) &nbsp; · stage from the district checklists: preparation → pre-entry → opened (entry meeting)</div>
    <div class="card scroll" id="districts"></div>

    <h3 id="schools-title">Schools</h3>
    <div class="card scroll" id="schools"></div>

    <h3>Data issues to fix in Kobo</h3>
    <div class="two" id="issues"></div>`;
  renderDistricts();
  renderSchools();
  renderIssues();
}

const STAGE_COLOR = { 0: "var(--axis)", 1: "var(--warning)", 2: "var(--warning)", 3: "var(--good)" };
function stageCell(d) {
  const col = d.entered && !d.opened ? "var(--serious)" : STAGE_COLOR[d.stage_rank];
  let detail = "";
  if (d.opened) detail = `${fmtD(d.date_opened)}${d.meeting ? ` · ${d.meeting.schools_attended ?? "?"} schools attended${String(d.meeting.mou_signed).toLowerCase() === "yes" ? " · MOU" : ""}` : ""}`;
  else if (d.scheduled_meeting) detail = `meeting ${fmtD(d.scheduled_meeting)}`;
  else if (d.pre_entry) detail = `${d.pre_entry.confirmed ?? "?"} schools confirmed`;
  else if (d.entered) detail = `first school ${fmtD(d.first_recruited)}`;
  return `<span class="flag"><span class="dot" style="background:${col}"></span>${esc(d.stage)}</span>${detail ? `<br><span class="meta">${detail}</span>` : ""}`;
}
function renderDistricts() {
  const ds = [...ROSTER.districts].sort((a, b) => (b.entered - a.entered) || (b.stage_rank - a.stage_rank) || a.district.localeCompare(b.district));
  const maxRef = Math.max(1, ...ds.map(d => d.target_schools || d.recruited));
  const rows = ds.map(d => {
    const ref = d.target_schools || maxRef;
    const bar = `<div class="cellbar"><div class="track"><div style="width:${Math.min(100, 100 * d.recruited / ref)}%"></div><div class="asd" style="width:${Math.min(100, 100 * d.assessed / ref)}%"></div></div><span>${num(d.recruited)}${ref !== maxRef ? `<span class="meta"> / ${ref}${d.target_schools !== null && d.target_schools > d.recruited ? ` · ${num(d.target_schools - d.recruited)} to go` : ""}</span>` : ""}</span></div>`;
    const lag = d.awaiting_assessment ? `${d.awaiting_assessment}${d.max_open_lag_days !== null ? ` <span class="meta">(up to ${d.max_open_lag_days} d)</span>` : ""}` : `<span class="meta">${d.recruited ? 0 : "—"}</span>`;
    const formT = d.pre_entry ? d.pre_entry.target : null;
    const disagree = d.target_schools !== null && formT !== null && formT !== d.target_schools;
    const target = d.target_schools !== null
      ? `${num(d.target_schools)}<br><span class="meta">${esc(d.target_source || "")}${disagree ? ` · <span class="chip no">pre-entry form says ${num(formT)}</span>` : ""}</span>`
      : `<span class="meta">—</span>`;
    return [esc(d.district) + (d.in_config ? "" : ` <span class="chip">not in districts.csv</span>`), esc(d.sub_region || ""), stageCell(d), target, num(d.screened), bar, num(d.assessed), lag];
  });
  $("#districts").innerHTML = table(
    [{t:"District"},{t:"Sub-region"},{t:"Stage"},{t:"Eligible schools",num:true},{t:"Screened",num:true},{t:"Recruited"},{t:"Assessed",num:true},{t:"Awaiting assessment",num:true}],
    rows, "No districts yet", (r, i) => `class="row" data-d="${esc(ds[i].district)}" aria-selected="${ds[i].district === district}"`);
  $("#districts").querySelectorAll("tr.row").forEach(tr => tr.onclick = () => selectDistrict(tr.dataset.d === district ? null : tr.dataset.d));
}

function selectDistrict(d) {
  district = d;
  setHash("recruit", d || "");
  $("#districts").querySelectorAll("tr.row").forEach(tr => tr.setAttribute("aria-selected", tr.dataset.d === d));
  renderSchools();
  $("#schools-title").scrollIntoView({ behavior: "smooth", block: "start" });
}

function statusCell(s) {
  const f = s.forms;
  return `<span class="status" title="F enrolment · G structure · H retrospective · A assessment">
    <span class="F ${f.F ? "on" : ""}">F</span><span class="G ${f.G ? "on" : ""}">G</span><span class="H ${f.H ? "on" : ""}">H</span><span class="A ${f.A ? "on" : ""}">A</span></span>`;
}
function checklist(a) {
  return Object.entries(a || {}).map(([k, v]) => `<span class="chip ${String(v).toLowerCase() === "no" ? "no" : ""}">${esc(k)}: ${esc(v ?? "—")}</span>`).join("");
}
function renderSchools() {
  const all = ROSTER.schools.filter(s => !district || s.district === district);
  const rec = all.filter(s => s.recruited);
  $("#schools-title").innerHTML = district
    ? `${esc(district)} — ${rec.length} recruited school${rec.length === 1 ? "" : "s"} <span class="meta">(${all.length} on roster) · <a href="#" id="clear">show all districts</a></span>`
    : `All schools — ${rec.length} recruited <span class="meta">(${all.length} on roster)</span>`;
  const clear = $("#clear"); if (clear) clear.onclick = e => { e.preventDefault(); selectDistrict(null); };
  const rows = all.map(s => [
    `<b>${esc(s.name)}</b>${s.suspect_name_forms.length ? ` <span class="chip no" title="The school-name field in this form does not look like a school name (possibly a person's name)">check name in ${esc(s.suspect_name_forms.join("/"))}</span>` : ""}<br><span class="meta">${esc(s.code)}${s.name_variants.length ? ` · also entered as: ${esc(s.name_variants.join("; "))}` : ""}</span>`,
    district ? "" : esc(s.district || "?") + (s.district_conflict ? ` <span class="chip no">district differs across forms</span>` : ""),
    statusCell(s),
    s.eligibility ? esc(titleCase(s.eligibility)) : "<span class='meta'>—</span>",
    s.recruited ? `${fmtD(s.recruited_date)}${s.retro_terms.length ? `<br><span class="meta">${esc(s.retro_terms.join(", "))}</span>` : `<br><span class="chip no">no term recorded</span>`}` : "<span class='meta'>not yet</span>",
    s.assessed ? `${fmtD(s.assessed_date)}<br>${checklist(s.assessment)}` : (s.recruited ? `<span class="flag"><span class="dot" style="background:${s.lag_days > 14 ? "var(--serious)" : "var(--warning)"}"></span>waiting ${s.lag_days} d</span>` : "<span class='meta'>—</span>"),
  ]);
  const headers = [{t:"School"},{t:"District"},{t:"Forms"},{t:"Screening"},{t:"Recruited (Annex H) · terms entered"},{t:"Assessment"}];
  if (district) headers.splice(1, 1), rows.forEach(r => r.splice(1, 1));
  $("#schools").innerHTML = table(headers, rows, "No schools on the roster for this selection");
}

function renderIssues() {
  const un = ROSTER.assessment_unmatched, am = ROSTER.assessment_ambiguous;
  const noD = ROSTER.schools_without_district;
  const conflicts = ROSTER.schools.filter(s => s.district_conflict);
  const dupeNames = ROSTER.schools.filter(s => s.name_variants.length);
  const sus = ROSTER.suspect_school_names || [], dupC = ROSTER.duplicate_codes || [];
  const anr = ROSTER.assessed_not_recruited || [], rns = ROSTER.recruited_not_screened || [];
  const li = arr => arr.map(x => `<li>${x}</li>`).join("");
  $("#issues").innerHTML = `
    <div class="card"><h3>Assessment forms not matched to a recruited school (${un.length + am.length})</h3>
      <p class="meta">The assessment form has no school code, so it is matched by school name + district. Fix the name in Kobo, or add the school-code question to the form.</p>
      ${table([{t:"Kobo _id"},{t:"School name as typed"},{t:"District"},{t:"Problem"}],
        un.map(u => [u.id, esc(u.name || "(blank)"), esc(u.district || "—"), esc(u.reason)])
          .concat(am.map(a => [a.id, esc(a.name), esc(a.district || "—"), "ambiguous — could be: " + esc(a.candidates.join(" | "))])), "All assessment forms matched")}</div>
    <div class="card"><h3>Roster inconsistencies (${sus.length + dupC.length + anr.length + rns.length + conflicts.length + noD.length})</h3>
      ${dupC.length ? `<p><b>Same school under two codes</b> — one form used a different code; the school is split in two:<ul>${li(dupC.map(d => `${esc(d.name)} — ${d.codes.map(c => `${esc(c)} (forms ${esc(d.forms[c] || "–")})`).join(" and ")}${d.districts.length > 1 ? ` — codes belong to different districts: ${esc(d.districts.join(" / "))}` : ` (${esc(d.districts[0])})`}`))}</ul></p>` : ""}
      ${sus.length ? `<p><b>School-name field doesn't look like a school name</b> — probably a person's name typed in the wrong box (text withheld here; open the record in Kobo):<ul>${li(sus.map(x => `${esc(x.code)} in Annex ${esc(x.forms.join("/"))} (${esc(x.district || "?")})${x.name_known ? "" : " — no valid school name in any form"}`))}</ul></p>` : ""}
      ${anr.length ? `<p><b>Assessment entered but no Annex H</b> (not counted as recruited):<ul>${li(anr.map(x => `${esc(x.code)} ${esc(x.name)} (${esc(x.district || "?")}), assessed ${fmtD(x.assessed_date)}`))}</ul></p>` : ""}
      ${rns.length ? `<p><b>Annex H entered but no Annex F screening form</b>:<ul>${li(rns.map(x => `${esc(x.code)} ${esc(x.name)} (${esc(x.district || "?")})`))}</ul></p>` : ""}
      ${conflicts.length ? `<p><b>District typed differently from the code's district</b>: ${conflicts.map(s => esc(`${s.code} (typed ${s.district_typed || "blank"}, code says ${s.district})`)).join("; ")}</p>` : ""}
      ${noD.length ? `<p><b>${noD.length}</b> school(s) with no district: ${esc(noD.join(", "))}</p>` : ""}
      ${dupeNames.length ? `<p class="meta">${dupeNames.length} school code(s) entered with more than one spelling of the name (harmless; shown under each school).</p>` : ""}
      ${ROSTER.notes.map(n => `<p class="meta">${esc(n)}</p>`).join("")}
      ${!sus.length && !dupC.length && !anr.length && !rns.length && !conflicts.length && !noD.length ? `<p class="empty">None</p>` : ""}
    </div>`;
}


PAGES.recruit = { title: "Recruitment", render(arg) { pageHeader("Recruitment", "districts opened and entered · schools recruited (Annex H) · assessment lag"); renderRecruit(); if (arg) selectDistrict(decodeURIComponent(arg)); }, filters: false };
