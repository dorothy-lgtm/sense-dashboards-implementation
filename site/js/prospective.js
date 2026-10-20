// Prospective: school-level aggregates from the nurse log (weekly) and bursar log (termly) — site/data/prospective.json.
// Rows are one per school per period: n entries, d duplicate submissions dropped, sums of numeric questions
// (and of configured expressions, keyed "@…"), counts of choice answers, and t = the term a week belongs to.
(function () {
  const S = { form: null, period: "8", explore: {} };
  try { Object.assign(S, JSON.parse(localStorage.getItem("sense_prosp") || "{}")); } catch (e) {}
  if (typeof S.explore !== "object" || !S.explore) S.explore = {};
  const save = () => { try { localStorage.setItem("sense_prosp", JSON.stringify(S)); } catch (e) {} };
  const weeksAgo = (w, ref) => Math.round((new Date(ref) - new Date(w)) / 6048e5);
  const mondayOf = d => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x.toISOString().slice(0, 10); };
  const ugx = v => isNum(v) ? Math.round(v).toLocaleString("en-GB") : "—";
  const bigTile = (label, value, note) => tile(label, value, note, String(value).replace(/<[^>]+>/g, "").length > 9);
  const toM = vals => vals.map(v => isNum(v) ? Math.round(v / 1e4) / 100 : v);   // UGX → millions, 2 dp
  let PER = "week";

  /** Value of a resolved role in one row (sum of a numeric field / expression, or count of matching choice labels). */
  function roleValue(row, m) {
    if (!m) return null;
    const b = m.level === "top" ? row : row.rep?.[m.level.slice(4)];
    if (!b) return null;
    if (m.kind === "sum") return b.sum?.[m.field] ?? null;
    const rx = new RegExp(m.labels, "i");
    return Object.entries(b.cnt?.[m.field] || {}).reduce((a, [lab, n]) => a + (rx.test(lab) ? n : 0), 0);
  }
  const sumRole = (rows, m) => m ? sum(rows.map(r => roleValue(r, m) || 0)) : null;
  /** Combine rows for a role: sum (flows) or mean per school-period (stocks such as head-counts). */
  const aggRole = (rows, m, how) => { if (!m) return null; if (how !== "mean") return sumRole(rows, m); const v = rows.map(r => roleValue(r, m)).filter(isNum); return v.length ? mean(v) : null; };
  function matchedLabels(rows, m) {
    if (!m || m.kind !== "count") return [];
    const rx = new RegExp(m.labels, "i"), out = new Set();
    rows.forEach(r => { const b = m.level === "top" ? r : r.rep?.[m.level.slice(4)]; Object.keys(b?.cnt?.[m.field] || {}).forEach(l => { if (rx.test(l)) out.add(l); }); });
    return [...out];
  }
  const roleNote = (rows, m, how) => m.expr ? `<span title="${esc(m.spec)}">${m.expr.length === 1 ? esc(m.spec) : `sum of ${m.expr.length} questions`}</span>` : `<code>${esc(m.field)}</code>${m.kind === "count" ? ` = ${esc(matchedLabels(rows, m).join(", ") || m.labels)}` : how === "mean" ? ` · average per school-${PER}` : ""}`;

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
    PER = F.period === "term" ? "term" : "week";
    const byTerm = PER === "term";
    const inFilter = new Set(filteredSchools().map(s => s.code));
    const recruited = filteredSchools().filter(s => s.H);
    const roles = F.roles || {}, labels = F.labels || {}, stats = F.stats || {}, ratios = F.ratios || {};
    const roleKeys = Object.keys(roles).filter(k => roles[k]);
    const label = k => labels[k] || k;
    const money = k => /cost|spend|ugx/i.test(k + label(k));

    // --- periods shown: weeks (last N up to the latest week with entries) or terms (all)
    const termOK = r => !FILTER.term || (byTerm ? r.w === FILTER.term : r.t === FILTER.term);
    const base = F.rows.filter(r => inFilter.has(r.c) && termOK(r));
    const allPeriods = [...new Set(base.map(r => r.w))].sort();
    const latest = allPeriods[allPeriods.length - 1];
    const periods = byTerm || S.period === "all" ? allPeriods : allPeriods.filter(w => weeksAgo(w, latest) < +S.period);
    const pset = new Set(periods);
    const rows = base.filter(r => pset.has(r.w));
    const inProgress = !byTerm && latest === mondayOf(new Date());
    const plabel = w => byTerm ? w : fmtD(w) + (inProgress && w === latest ? "*" : "");
    const entries = sum(rows.map(r => r.n)), dups = sum(rows.map(r => r.d || 0));
    const reporting = new Set(rows.map(r => r.c)), reportingLast = new Set(rows.filter(r => r.w === latest).map(r => r.c));
    const tot = Object.fromEntries(roleKeys.map(k => [k, aggRole(rows, roles[k], stats[k])]));
    const ratioOf = (rs, rt) => { const n = sumRole(rs, roles[rt.num]), d = sumRole(rs, roles[rt.den]); return isNum(n) && d ? n / d : null; };
    const fmtRatio = (v, rt) => !isNum(v) ? "—" : rt.fmt === "pct" ? pct(v, 1) : ugx(v);
    const ratioKeys = Object.keys(ratios).filter(k => roles[ratios[k].num] && roles[ratios[k].den]);
    const r0 = ratioKeys[0] ? ratios[ratioKeys[0]] : null;
    // incidence per 1,000 using each school's latest Annex H head-count (enrolment or boarders) × periods reported
    const rates = F.per_1000 || {};
    const headcount = new Map(METRICS.schools.map(s => { const h = s.H?.repeats?.Enrollment_data_grp || []; const t = h[h.length - 1]; return [s.code, { enrol: t?.total_school_enroll, boarders: t?.total_boarders }]; }));
    const rateKeys = Object.keys(rates).filter(k => roles[rates[k].num]);
    const denomOf = (rs, rt) => rs.filter(r => isNum(headcount.get(r.c)?.[rt.den])).length;
    const rateOf = (rs, rt) => { let n = 0, d = 0; rs.forEach(r => { const h = headcount.get(r.c)?.[rt.den]; if (isNum(h) && h > 0) { n += roleValue(r, roles[rt.num]) || 0; d += h; } }); return d ? 1000 * n / d : null; };

    // --- series by period
    const at = w => rows.filter(r => r.w === w);
    const perPeriod = fn => periods.map(w => fn(at(w)));
    const chartRoles = (F.chart || []).filter(k => roles[k] && stats[k] !== "mean");
    const seriesRoles = chartRoles.length ? chartRoles : roleKeys.filter(k => roles[k].kind === "sum" && stats[k] !== "mean").slice(0, 4);
    const big = seriesRoles.some(k => money(k));
    const keySeries = seriesRoles.map(k => ({ name: label(k) + (big ? " (millions)" : ""), values: big ? toM(perPeriod(rs => sumRole(rs, roles[k]))) : perPeriod(rs => sumRole(rs, roles[k])) }));

    // --- by district
    const lead = seriesRoles[0] || roleKeys[0];
    const dist = byDistrict(recruited).map(([d, ss]) => {
      const codes = new Set(ss.map(s => s.code)), rs = rows.filter(r => codes.has(r.c));
      return { district: d, schools: ss.length, reporting: new Set(rs.map(r => r.c)).size, entries: sum(rs.map(r => r.n)),
               main: lead ? aggRole(rs, roles[lead], stats[lead]) : null, ratio: r0 ? ratioOf(rs, r0) : null };
    });

    // --- explore any question
    const fieldOpts = [...(F.fields.top || []).map(f => ({ ...f, level: "top" })), ...Object.entries(F.fields.repeats || {}).flatMap(([r, fs]) => fs.map(f => ({ ...f, level: `rep:${r}` })))]
      .filter(f => /integer|decimal|calculate|range|select_one|select_multiple/.test(f.type) && !/school_code|school_name|^year$|^term$|data_officer/.test(f.name));
    if (!fieldOpts.find(f => `${f.level}|${f.name}` === S.explore[S.form])) S.explore[S.form] = fieldOpts[0] ? `${fieldOpts[0].level}|${fieldOpts[0].name}` : "";

    el.innerHTML = `
      <div class="card" style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
        ${toggles("pr-form", keys.map(k => ({ key: k, label: P.forms[k].title })), S.form)}
        ${byTerm ? "" : toggles("pr-period", [{ key: "4", label: "Last 4 weeks" }, { key: "8", label: "Last 8 weeks" }, { key: "13", label: "Last 13 weeks" }, { key: "all", label: "All" }], S.period)}
        <span class="meta">${esc(F.title)}: ${num(F.n_submissions)} submissions in Kobo, ${num(F.n_matched)} matched to recruited schools · entries dated ${F.first_date ? fmtD(F.first_date) : "—"} – ${F.last_date ? fmtD(F.last_date) : "—"} · one row per school per ${byTerm ? `term (<code>${esc(F.join.year_field)}</code> + <code>${esc(F.join.term_field)}</code>)` : `Monday-dated ISO week of <code>${esc(F.join.date_field)}</code>`}</span>
      </div>
      <div class="tiles">
        ${tile("Schools reporting", `${num(reporting.size)}<span class="unit">of ${num(recruited.length)}</span>`, `at least one entry in ${byTerm ? "the selected terms" : "this period"} · recruited schools in the selection`)}
        ${tile(`Reporting in latest ${PER}`, recruited.length && latest ? pct(reportingLast.size, recruited.length) : "—", latest ? `${byTerm ? esc(latest) : "week of " + fmtD(latest)}${inProgress ? " (in progress)" : ""}` : "no entries yet")}
        ${tile("Entries", num(entries), `${num(rows.length)} school-${PER}s${dups ? ` · <b>${num(dups)}</b> duplicate submissions dropped (latest kept)` : ""}`)}
        ${tile("Latest entry", F.last_date ? fmtD(F.last_date) : "—", "across all schools")}
        ${roleKeys.map(k => bigTile(label(k), money(k) ? ugx(tot[k]) : num(isNum(tot[k]) ? Math.round(tot[k]) : null), roleNote(rows, roles[k], stats[k]))).join("")}
        ${ratioKeys.map(k => bigTile(ratios[k].label || k, fmtRatio(ratioOf(rows, ratios[k]), ratios[k]), esc(ratios[k].note || ""))).join("")}
        ${rateKeys.map(k => tile(rates[k].label || k, isNum(rateOf(rows, rates[k])) ? num(Math.round(10 * rateOf(rows, rates[k])) / 10) : "—", `÷ latest Annex H ${rates[k].den === "boarders" ? "boarders" : "enrolment"} · ${num(denomOf(rows, rates[k]))} school-${PER}s`)).join("")}
      </div>
      <div class="grid-2" style="margin-top:12px">
        <div class="card"><h3>Reporting by ${PER} <span class="sub">Schools with an entry, and entries logged${inProgress ? " · * current week, incomplete" : ""}</span></h3>
          ${lineChart(periods.map(plabel), [{ name: "Schools reporting", values: perPeriod(rs => new Set(rs.map(r => r.c)).size) }, { name: "Entries", values: perPeriod(rs => sum(rs.map(r => r.n))) }])}</div>
        <div class="card"><h3>${keySeries.length ? `Key counts by ${PER}` : `Entries by ${PER}`} <span class="sub">Summed over the schools in the selection</span></h3>
          ${lineChart(periods.map(plabel), keySeries.length ? keySeries : [{ name: "Entries", values: perPeriod(rs => sum(rs.map(r => r.n))) }])}</div>
      </div>
      ${rateKeys.length ? `<div class="grid-2" style="margin-top:12px">${rateKeys.slice(0, 2).map(k => `<div class="card"><h3>${esc(rates[k].label)} <span class="sub">by ${PER} · denominator = latest Annex H head-count of the schools reporting that ${PER}</span></h3>${lineChart(periods.map(plabel), [{ name: rates[k].label, values: perPeriod(rs => { const v = rateOf(rs, rates[k]); return isNum(v) ? Math.round(10 * v) / 10 : null; }) }])}</div>`).join("")}</div>` : ""}
      <div class="grid-2" style="margin-top:12px">
        ${r0 ? `<div class="card"><h3>${esc(r0.label)} by ${PER} <span class="sub">${esc(r0.note || "")}</span></h3>${lineChart(periods.map(plabel), [{ name: r0.label, values: perPeriod(rs => { const v = ratioOf(rs, r0); return isNum(v) ? (r0.fmt === "pct" ? Math.round(1000 * v) / 10 : Math.round(v)) : null; }) }], { fmt: v => isNum(v) ? (r0.fmt === "pct" ? v + "%" : ugx(v)) : "—" })}</div>` : ""}
        <div class="card"><h3>By district <span class="sub">${lead ? esc(label(lead)) + (stats[lead] === "mean" ? ` (average per school-${PER})` : "") : "Entries"} · schools reporting / recruited${r0 ? " · " + esc(r0.label.toLowerCase()) : ""}</span></h3>
          ${barList(dist.filter(d => d.schools).sort((a, b) => (b.main ?? b.entries) - (a.main ?? a.entries)).map(d => ({ label: d.district, value: lead ? d.main : d.entries, note: `· ${d.reporting}/${d.schools}${isNum(d.ratio) ? ` · ${fmtRatio(d.ratio, r0)}` : ""}` })), { fmt: lead && money(lead) ? ugx : num })}</div>
      </div>
      <div class="card" style="margin-top:12px"><h3>Explore a question <span class="sub">Any numeric or choice question on the form · numeric = total per ${PER}, choice = answers over the selected ${PER}s</span></h3>
        <label class="meta">Question <select id="pr-explore">${fieldOpts.map(f => `<option value="${esc(f.level)}|${esc(f.name)}" ${`${f.level}|${f.name}` === S.explore[S.form] ? "selected" : ""}>${esc(f.label || f.name)}${f.level !== "top" ? ` (${esc(f.level.slice(4))})` : ""}</option>`).join("")}</select></label>
        <div id="pr-explore-chart" style="margin-top:8px"></div></div>
      <div class="card" style="margin-top:12px"><h3>Schools <span class="sub">Recruited schools in the selection · click a column heading to sort</span></h3><div class="scroll" id="pr-table"></div></div>
      <div class="card" style="margin-top:12px"><h3>Data notes</h3>
        <ul class="meta">
          <li>${F.unmatched?.length ? `<b>${num(F.unmatched.reduce((a, u) => a + u.n, 0))} submissions</b> could not be matched to a recruited school: ${F.unmatched.slice(0, 8).map(u => `${esc(u.id)} (${u.n})`).join(", ")}${F.unmatched.length > 8 ? ", …" : ""}` : "Every submission matched a recruited school."}</li>
          <li>Schools recruited but with no entry in ${byTerm ? "the selected terms" : "this period"}: <b>${num(recruited.length - reporting.size)}</b>${recruited.length - reporting.size ? " — see the Schools table (sort by “Last entry”)" : ""}.</li>
          ${F.one_per_period ? `<li>The form expects one submission per school per ${PER}; where there are several, the latest is used and the rest counted as duplicates (${num(F.n_duplicates || 0)} across the whole form).</li>` : ""}
          ${roles.confirmed && roles.tested ? `<li>Confirmed &gt; RDTs used in a school-${PER}: <b>${num(rows.filter(r => (roleValue(r, roles.confirmed) || 0) > (roleValue(r, roles.tested) || 0)).length)}</b>${roles.cases ? `; confirmed &gt; all cases: <b>${num(rows.filter(r => (roleValue(r, roles.confirmed) || 0) > (roleValue(r, roles.cases) || 0)).length)}</b>` : ""}.</li>` : ""}
          <li>How the tiles read the form (${Object.values(roles).some(r => r && r.source === "auto") ? "some auto-detected from question names — pin in config/prospective.yml if wrong" : "pinned in config/prospective.yml"}): ${roleKeys.map(k => `${esc(label(k))} → ${roleNote(rows, roles[k], stats[k])}`).join("; ") || "none resolved"}${Object.keys(roles).filter(k => !roles[k]).length ? `; <b>not found on the form</b>: ${Object.keys(roles).filter(k => !roles[k]).map(esc).join(", ")}` : ""}.</li>
        </ul></div>`;

    wireToggles("pr-form", k => { S.form = k; save(); render(); });
    if (!byTerm) wireToggles("pr-period", k => { S.period = k; save(); render(); });
    $("#pr-explore").onchange = e => { S.explore[S.form] = e.target.value; save(); drawExplore(); };
    const drawExplore = () => {
      const [level, name] = (S.explore[S.form] || "").split("|");
      const f = fieldOpts.find(x => x.level === level && x.name === name);
      const box = $("#pr-explore-chart");
      if (!f) { box.innerHTML = `<p class="empty">No question selected</p>`; return; }
      const bucket = r => level === "top" ? r : r.rep?.[level.slice(4)];
      if (/select/.test(f.type)) {
        const c = new Map();
        rows.forEach(r => Object.entries(bucket(r)?.cnt?.[name] || {}).forEach(([lab, n]) => c.set(lab, (c.get(lab) || 0) + n)));
        const items = [...c].map(([lab, value]) => ({ label: shortLabel(lab), value })).sort((a, b) => b.value - a.value);
        box.innerHTML = `<div class="grid-2">${donut(items, { unit: "answers" })}${barList(items)}</div>`;
      } else {
        const m = { level, field: name, kind: "sum" };
        const vals = perPeriod(rs => sumRole(rs, m));
        const nSeries = perPeriod(rs => sum(rs.map(r => bucket(r)?.nn?.[name] ?? (bucket(r)?.sum?.[name] !== undefined ? bucket(r).n : 0))));
        const m6 = vals.some(v => v > 99999);
        box.innerHTML = lineChart(periods.map(plabel), [{ name: `${f.label || name} (total per ${PER}${m6 ? ", millions" : ""})`, values: m6 ? toM(vals) : vals }, { name: "Entries answering", values: nSeries }]);
      }
    };
    drawExplore();

    const schoolRows = recruited.map(s => {
      const rs = rows.filter(r => r.c === s.code), all = F.rows.filter(r => r.c === s.code);
      const last = all.length ? all[all.length - 1].w : null;
      const o = { school: s.name, district: s.district, periods: new Set(rs.map(r => r.w)).size, entries: sum(rs.map(r => r.n)), last, gap: last && !byTerm && latest ? weeksAgo(last, latest) : null };
      roleKeys.forEach(k => { o[k] = rs.length ? aggRole(rs, roles[k], stats[k]) : null; });
      ratioKeys.forEach(k => { o["r_" + k] = rs.length ? ratioOf(rs, ratios[k]) : null; });
      rateKeys.forEach(k => { o["p_" + k] = rs.length ? rateOf(rs, rates[k]) : null; });
      return o;
    });
    sortableTable($("#pr-table"), [
      { key: "school", label: "School" }, { key: "district", label: "District" },
      { key: "periods", label: `${byTerm ? "Terms" : "Weeks"} reported`, num: true }, { key: "entries", label: "Entries", num: true },
      { key: "last", label: byTerm ? "Last term entered" : "Last entry (week of)", render: v => v ? (byTerm ? esc(v) : fmtD(v)) : '<span class="chip warning">never</span>' },
      ...(byTerm ? [] : [{ key: "gap", label: "Weeks since", num: true, render: v => v === null ? "—" : (v >= 2 ? `<span class="chip warning">${v}</span>` : String(v)) }]),
      ...roleKeys.filter(k => roles[k].kind === "sum").map(k => ({ key: k, label: label(k) + (stats[k] === "mean" ? " (avg)" : ""), num: true, render: v => isNum(v) ? (money(k) ? ugx(v) : num(Math.round(v))) : "—" })),
      ...ratioKeys.map(k => ({ key: "r_" + k, label: ratios[k].label || k, num: true, render: v => fmtRatio(v, ratios[k]) })),
      ...rateKeys.map(k => ({ key: "p_" + k, label: rates[k].label || k, num: true, render: v => isNum(v) ? num(Math.round(10 * v) / 10) : "—" })),
    ], schoolRows, { sortKey: "entries", dir: -1 });
  }
  PAGES.prospective = { title: "Prospective", render, filters: true };
})();
