// Prospective: weekly school-level aggregates from the nurse and bursar logs (site/data/prospective.json).
// Rows are one per school per ISO week: n entries, sums of numeric questions, counts of choice answers.
(function () {
  const S = { form: null, period: "8", explore: "" };
  try { Object.assign(S, JSON.parse(localStorage.getItem("sense_prosp") || "{}")); } catch (e) {}
  const save = () => { try { localStorage.setItem("sense_prosp", JSON.stringify(S)); } catch (e) {} };
  const weekLabel = w => fmtD(w);
  const weeksAgo = (w, ref) => Math.round((new Date(ref) - new Date(w)) / 6048e5);

  /** Value of a resolved role in one school-week row (sum of a numeric field, or count of matching choice labels). */
  function roleValue(row, m) {
    if (!m) return null;
    const b = m.level === "top" ? row : row.rep?.[m.level.slice(4)];
    if (!b) return null;
    if (m.kind === "sum") return b.sum?.[m.field] ?? null;
    const rx = new RegExp(m.labels, "i");
    return Object.entries(b.cnt?.[m.field] || {}).reduce((a, [lab, n]) => a + (rx.test(lab) ? n : 0), 0);
  }
  const sumRole = (rows, m) => m ? sum(rows.map(r => roleValue(r, m) || 0)) : null;
  /** Combine school-weeks for a role: sum (flows) or mean per school-week (stocks such as head-counts). */
  const aggRole = (rows, m, how) => { if (!m) return null; if (how !== "mean") return sumRole(rows, m); const v = rows.map(r => roleValue(r, m)).filter(isNum); return v.length ? mean(v) : null; };
  /** Distinct answer labels that a count-role actually matched in these rows (for tile notes). */
  function matchedLabels(rows, m) {
    if (!m || m.kind !== "count") return [];
    const rx = new RegExp(m.labels, "i"), out = new Set();
    rows.forEach(r => { const b = m.level === "top" ? r : r.rep?.[m.level.slice(4)]; Object.keys(b?.cnt?.[m.field] || {}).forEach(l => { if (rx.test(l)) out.add(l); }); });
    return [...out];
  }
  const roleNote = (rows, m, how) => `<code>${esc(m.field)}</code>${m.kind === "count" ? ` = ${esc(matchedLabels(rows, m).join(", ") || m.labels)}` : how === "mean" ? " · average per school-week" : " (sum)"}`;
  const mondayOf = d => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x.toISOString().slice(0, 10); };

  function render() {
    const P = PROSPECTIVE;
    pageHeader("Prospective", filterSummary());
    const el = $("#page-prospective");
    if (!P || !Object.keys(P.forms || {}).length) {
      el.innerHTML = `<p class="empty">No prospective log data has been published yet. The nurse and bursar logs are pulled on the next refresh once they have submissions.</p>`;
      return;
    }
    const keys = Object.keys(P.forms);
    if (!keys.includes(S.form)) S.form = keys[0];
    const F = P.forms[S.form];
    const bySchool = new Map(METRICS.schools.map(s => [s.code, s]));
    const inFilter = new Set(filteredSchools().map(s => s.code));
    const recruited = filteredSchools().filter(s => s.H);

    // --- period: last N weeks up to the latest week with any entry
    const allWeeks = [...new Set(F.rows.map(r => r.w))].sort();
    const latestW = allWeeks[allWeeks.length - 1];
    const weeks = S.period === "all" ? allWeeks : allWeeks.filter(w => weeksAgo(w, latestW) < +S.period);
    const weekSet = new Set(weeks);
    const rows = F.rows.filter(r => inFilter.has(r.c) && weekSet.has(r.w));
    const roles = F.roles || {}, labels = F.labels || {}, stats = F.stats || {};
    const roleKeys = Object.keys(roles).filter(k => roles[k]);
    const tot = Object.fromEntries(roleKeys.map(k => [k, aggRole(rows, roles[k], stats[k])]));
    const entries = sum(rows.map(r => r.n));
    const reporting = new Set(rows.map(r => r.c));
    const lastWeekRows = rows.filter(r => r.w === latestW);
    const reportingLast = new Set(lastWeekRows.map(r => r.c));

    // --- tiles
    const ratioTile = (lab, n, d, note) => tile(lab, d ? pct(n, d) : "—", note);
    const roleTiles = roleKeys.map(k => tile(labels[k] || k, num(Math.round(tot[k])), roleNote(rows, roles[k], stats[k]))).join("");
    const inProgress = latestW === mondayOf(new Date());
    const positivity = roles.tested && roles.positive && tot.tested ? ratioTile("RDT positivity", tot.positive, tot.tested, "positive ÷ tested, this period") : "";

    // --- weekly series
    const wk = w => rows.filter(r => r.w === w);
    const weekLabels = weeks.map(w => weekLabel(w) + (inProgress && w === latestW ? "*" : ""));
    const perWeek = fn => weeks.map(w => fn(wk(w)));
    const keySeries = roleKeys.filter(k => !/expenditure/.test(k) && stats[k] !== "mean").slice(0, 4).map(k => ({ name: labels[k] || k, values: perWeek(rs => sumRole(rs, roles[k])) }));
    const posSeries = roles.tested && roles.positive ? perWeek(rs => { const t = sumRole(rs, roles.tested), p = sumRole(rs, roles.positive); return t ? Math.round(1000 * p / t) / 10 : null; }) : null;

    // --- by district
    const dist = byDistrict(recruited).map(([d, ss]) => {
      const codes = new Set(ss.map(s => s.code)), rs = rows.filter(r => codes.has(r.c));
      return { district: d, schools: ss.length, reporting: new Set(rs.map(r => r.c)).size, entries: sum(rs.map(r => r.n)),
               tested: sumRole(rs, roles.tested), positive: sumRole(rs, roles.positive), main: roleKeys.length ? aggRole(rs, roles[roleKeys[0]], stats[roleKeys[0]]) : null };
    });

    // --- explore any field
    const fieldOpts = [...(F.fields.top || []).map(f => ({ ...f, level: "top" })), ...Object.entries(F.fields.repeats || {}).flatMap(([r, fs]) => fs.map(f => ({ ...f, level: `rep:${r}` })))]
      .filter(f => /integer|decimal|calculate|range|select_one|select_multiple/.test(f.type) && !/school_code|school_name/.test(f.name));
    if (!fieldOpts.find(f => `${f.level}|${f.name}` === S.explore)) S.explore = fieldOpts[0] ? `${fieldOpts[0].level}|${fieldOpts[0].name}` : "";

    el.innerHTML = `
      <div class="card" style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
        ${toggles("pr-form", keys.map(k => ({ key: k, label: P.forms[k].title })), S.form)}
        ${toggles("pr-period", [{ key: "4", label: "Last 4 weeks" }, { key: "8", label: "Last 8 weeks" }, { key: "13", label: "Last 13 weeks" }, { key: "all", label: "All" }], S.period)}
        <span class="meta">${esc(F.title)}: ${num(F.n_submissions)} submissions in Kobo, ${num(F.n_matched)} matched to recruited schools · entries dated ${F.first_date ? fmtD(F.first_date) : "—"} – ${F.last_date ? fmtD(F.last_date) : "—"} · week = Monday-dated ISO week of <code>${esc(F.join.date_field)}</code></span>
      </div>
      <div class="tiles">
        ${tile("Schools reporting", `${num(reporting.size)}<span class="unit">of ${num(recruited.length)}</span>`, "at least one entry in this period · recruited schools in the selection")}
        ${ratioTile("Reporting in latest week", reportingLast.size, recruited.length, `week of ${weekLabel(latestW)}${inProgress ? " (in progress)" : ""}`)}
        ${tile("Entries", num(entries), `${num(rows.length)} school-weeks in this period`)}
        ${tile("Latest entry", F.last_date ? fmtD(F.last_date) : "—", "across all schools")}
        ${roleTiles}${positivity}
      </div>
      <div class="grid-2" style="margin-top:12px">
        <div class="card"><h3>Reporting by week <span class="sub">Schools with at least one entry, and entries logged${inProgress ? " · * current week, incomplete" : ""}</span></h3>
          ${lineChart(weekLabels, [{ name: "Schools reporting", values: perWeek(rs => new Set(rs.map(r => r.c)).size) }, { name: "Entries", values: perWeek(rs => sum(rs.map(r => r.n))) }])}</div>
        <div class="card"><h3>${keySeries.length ? "Key counts by week" : "Entries by week"} <span class="sub">${keySeries.length ? "Summed over the schools in the selection" : "No numeric roles resolved for this form"}</span></h3>
          ${lineChart(weekLabels, keySeries.length ? keySeries : [{ name: "Entries", values: perWeek(rs => sum(rs.map(r => r.n))) }])}</div>
      </div>
      <div class="grid-2" style="margin-top:12px">
        ${posSeries ? `<div class="card"><h3>RDT positivity by week <span class="sub">% of RDTs positive</span></h3>${lineChart(weekLabels, [{ name: "Positivity %", values: posSeries }], { fmt: v => isNum(v) ? v + "%" : "—" })}</div>` : ""}
        <div class="card"><h3>By district <span class="sub">${roleKeys.length ? esc(labels[roleKeys[0]] || roleKeys[0]) + (stats[roleKeys[0]] === "mean" ? " (average per school-week)" : "") : "Entries"} this period · schools reporting / recruited</span></h3>
          ${barList(dist.filter(d => d.schools).sort((a, b) => (b.main ?? b.entries) - (a.main ?? a.entries)).map(d => ({ label: d.district, value: roleKeys.length ? d.main : d.entries, note: `· ${d.reporting}/${d.schools} schools${isNum(d.tested) && d.tested ? ` · positivity ${pct(d.positive, d.tested)}` : ""}` })))}</div>
        ${posSeries ? "" : `<div class="card"><h3>Resolved questions <span class="sub">How each tile is read from the form (pin in config/prospective.yml if wrong)</span></h3>${table([{ t: "Role" }, { t: "Question" }, { t: "Counts" }], roleKeys.map(k => [esc(labels[k] || k), `<code>${esc(roles[k].field)}</code> ${esc(roles[k].label || "")}`, roles[k].kind === "sum" ? "sum" : `answers matching <code>${esc(roles[k].labels)}</code>`]))}</div>`}
      </div>
      <div class="card" style="margin-top:12px"><h3>Explore a question <span class="sub">Any numeric or choice question on the form · numeric = weekly total, choice = answers in this period</span></h3>
        <label class="meta">Question <select id="pr-explore">${fieldOpts.map(f => `<option value="${esc(f.level)}|${esc(f.name)}" ${`${f.level}|${f.name}` === S.explore ? "selected" : ""}>${esc(f.label || f.name)}${f.level !== "top" ? ` (${esc(f.level.slice(4))})` : ""}</option>`).join("")}</select></label>
        <div id="pr-explore-chart" style="margin-top:8px"></div></div>
      <div class="card" style="margin-top:12px"><h3>Schools <span class="sub">Recruited schools in the selection · click a column heading to sort</span></h3><div class="scroll" id="pr-table"></div></div>
      <div class="card" style="margin-top:12px"><h3>Data notes</h3>
        <ul class="meta">
          <li>${F.unmatched?.length ? `<b>${num(F.unmatched.reduce((a, u) => a + u.n, 0))} submissions</b> could not be matched to a recruited school: ${F.unmatched.slice(0, 8).map(u => `${esc(u.id)} (${u.n})`).join(", ")}${F.unmatched.length > 8 ? ", …" : ""}` : "Every submission matched a recruited school."}</li>
          <li>Schools recruited but with no entry in this period: <b>${num(recruited.length - reporting.size)}</b>${recruited.length - reporting.size ? " — see the Schools table (sort by “Last entry”)" : ""}.</li>
          ${posSeries ? `<li>Positive &gt; tested in a school-week: <b>${num(rows.filter(r => (roleValue(r, roles.positive) || 0) > (roleValue(r, roles.tested) || 0)).length)}</b>.</li>` : ""}
          <li>Roles were ${Object.values(roles).some(r => r && r.source === "config") ? "pinned in config/prospective.yml" : "auto-detected from question names"}: ${roleKeys.map(k => `${esc(labels[k] || k)} → ${roleNote(rows, roles[k], stats[k])}`).join("; ") || "none resolved"}${Object.keys(roles).filter(k => !roles[k]).length ? `; not found: ${Object.keys(roles).filter(k => !roles[k]).map(esc).join(", ")}` : ""}.</li>
        </ul></div>`;

    wireToggles("pr-form", k => { S.form = k; save(); render(); });
    wireToggles("pr-period", k => { S.period = k; save(); render(); });
    $("#pr-explore").onchange = e => { S.explore = e.target.value; save(); drawExplore(); };
    const drawExplore = () => {
      const [level, name] = S.explore.split("|");
      const f = fieldOpts.find(x => x.level === level && x.name === name);
      const box = $("#pr-explore-chart");
      if (!f) { box.innerHTML = `<p class="empty">No question selected</p>`; return; }
      const bucket = r => level === "top" ? r : r.rep?.[level.slice(4)];
      if (/select/.test(f.type)) {
        const c = new Map();
        rows.forEach(r => Object.entries(bucket(r)?.cnt?.[name] || {}).forEach(([lab, n]) => c.set(lab, (c.get(lab) || 0) + n)));
        const items = [...c].map(([label, value]) => ({ label: shortLabel(label), value })).sort((a, b) => b.value - a.value);
        box.innerHTML = `<div class="grid-2">${donut(items, { unit: "answers" })}${barList(items)}</div>`;
      } else {
        const m = { level, field: name, kind: "sum" };
        const nSeries = perWeek(rs => sum(rs.map(r => bucket(r)?.nn?.[name] ?? (bucket(r)?.sum?.[name] !== undefined ? bucket(r).n : 0))));
        box.innerHTML = lineChart(weekLabels, [{ name: `${f.label || name} (weekly total)`, values: perWeek(rs => sumRole(rs, m)) }, { name: "Entries answering", values: nSeries }]);
      }
    };
    drawExplore();

    const schoolRows = recruited.map(s => {
      const rs = rows.filter(r => r.c === s.code), all = F.rows.filter(r => r.c === s.code);
      const last = all.length ? all[all.length - 1].w : null;
      const o = { school: s.name, district: s.district, weeks: new Set(rs.map(r => r.w)).size, entries: sum(rs.map(r => r.n)), last, gap: last ? weeksAgo(last, latestW) : null };
      roleKeys.forEach(k => { o[k] = rs.length ? aggRole(rs, roles[k], stats[k]) : null; });
      if (roles.tested && roles.positive) o.positivity = o.tested ? o.positive / o.tested : null;
      return o;
    });
    sortableTable($("#pr-table"), [
      { key: "school", label: "School" }, { key: "district", label: "District" },
      { key: "weeks", label: "Weeks reported", num: true }, { key: "entries", label: "Entries", num: true },
      { key: "last", label: "Last entry (week of)", render: v => v ? fmtD(v) : '<span class="chip warning">never</span>' },
      { key: "gap", label: "Weeks since", num: true, render: v => v === null ? "—" : (v >= 2 ? `<span class="chip warning">${v}</span>` : String(v)) },
      ...roleKeys.map(k => ({ key: k, label: (labels[k] || k) + (stats[k] === "mean" ? " (avg/week)" : ""), num: true, render: v => isNum(v) ? num(Math.round(v)) : "—" })),
      ...(roles.tested && roles.positive ? [{ key: "positivity", label: "Positivity", num: true, render: v => isNum(v) ? pct(v, 1) : "—" }] : []),
    ], schoolRows, { sortKey: "entries", dir: -1 });
  }
  PAGES.prospective = { title: "Prospective", render, filters: true };
})();
