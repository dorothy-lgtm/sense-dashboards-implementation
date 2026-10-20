// Severe cases deep dive (Annex H term records): burden, rates, severity ratio, correlates, data quality.
(function () {
  const K = { sev: "total_severe_cases", conf: "confirmed_malaria", cases: "total_malaria_cases", board: "total_boarders", enrol: "total_school_enroll", rdt: "total_rdt_used", act: "total_act_used" };
  const termKey = r => `${r.year ?? ""} ${r.term ?? ""}`.trim();
  let DENOM = "enrol";   // "enrol" (all students) or "board" (boarders)
  try { DENOM = localStorage.getItem("sense_sev_denom") || DENOM; } catch (e) {}
  const denomKey = () => DENOM === "board" ? K.board : K.enrol;
  const denomLabel = () => DENOM === "board" ? "boarders" : "students enrolled";
  const per1000 = (sev, pop) => isNum(sev) && isNum(pop) && pop > 0 ? 1000 * sev / pop : null;
  const ratio = (sev, conf) => isNum(sev) && isNum(conf) && conf > 0 ? sev / conf : null;
  const r1 = v => isNum(v) ? num(Math.round(v * 10) / 10) : "—";

  function flags(r) {
    const f = [];
    if (isNum(r[K.sev]) && isNum(r[K.conf]) && r[K.sev] > r[K.conf]) f.push("severe > confirmed");
    else if (isNum(r[K.sev]) && isNum(r[K.conf]) && r[K.conf] > 0 && r[K.sev] === r[K.conf]) f.push("severe = confirmed");
    if (isNum(r[K.sev]) && isNum(r[K.cases]) && r[K.sev] > r[K.cases]) f.push("severe > all cases");
    if (isNum(r[K.conf]) && isNum(r[K.cases]) && r[K.conf] > r[K.cases]) f.push("confirmed > all cases");
    if (isNum(r[K.sev]) && r[K.sev] > 0 && (!isNum(r[K.conf]) || r[K.conf] === 0)) f.push("severe with no confirmed");
    const rt = ratio(r[K.sev], r[K.conf]);
    if (rt !== null && rt > 0.5 && !f.length) f.push("severity ratio > 50%");
    return f;
  }

  // Descriptive comparison: severe per 1,000 boarders per term in schools WITH vs WITHOUT a characteristic
  function correlates(schools) {
    const dormNetShare = s => { const ds = (s.G?.repeats?.Classrooms_dormitories_grp || []).filter(r => /dorm/i.test(String(r.structure_category ?? ""))); if (!ds.length) return null; return ds.filter(r => !/^none|very few/i.test(String(r.bednets_hung ?? ""))).length / ds.length; };
    const eavesShare = s => { const rs = s.G?.repeats?.Classrooms_dormitories_grp || []; return rs.length ? rs.filter(r => yes(r.presence_open_eaves)).length / rs.length : null; };
    const tests = [
      { label: "Nets hung in ≥ half of dormitories", test: s => { const v = dormNetShare(s); return v === null ? null : v >= 0.5; } },
      { label: "Open eaves on ≥ half of structures", test: s => { const v = eavesShare(s); return v === null ? null : v >= 0.5; } },
      { label: "Breeding sites inside the school", test: s => s.G ? yes(s.G.answers.within_breeding_site) : null },
      { label: "IRS within the past 12 months", test: s => s.G?.answers?.irs_history ? /12 month/i.test(String(s.G.answers.irs_history)) && !/more than/i.test(String(s.G.answers.irs_history)) : null },
      { label: "Pesticide use within the past 12 months", test: s => s.G?.answers?.history_pesticide_use ? /12 month/i.test(String(s.G.answers.history_pesticide_use)) && !/more than/i.test(String(s.G.answers.history_pesticide_use)) : null },
      { label: "Qualified nurse (registered / enrolled / CO)", test: s => s.F?.answers?.nurse_qualified ?? null },
      { label: "Nurse on duty ≥ 12 h/day", test: s => isNum(s.F?.answers?.duty_hours) ? s.F.answers.duty_hours >= 12 : null },
      { label: "Nurse works weekends", test: s => s.F?.answers?.weekend_cover ?? null },
      { label: "Notes mention referral of severe cases", test: s => s.F?.answers?.refers_severe ?? null },
    ];
    const rate = ss => { const rows = ss.flatMap(s => termRows(s)); const sev = sum(rows.map(r => r[K.sev]).filter(isNum)), b = sum(rows.map(r => r[denomKey()]).filter(isNum)); return b ? 1000 * sev / b : null; };
    return tests.map(t => {
      const withS = schools.filter(s => t.test(s) === true), without = schools.filter(s => t.test(s) === false);
      return { label: t.label, nWith: withS.length, nWithout: without.length, rWith: rate(withS), rWithout: rate(without) };
    }).filter(x => x.nWith && x.nWithout);
  }

  function render() {
    pageHeader("Severe cases", filterSummary());
    const el = $("#page-severe");
    const schools = filteredSchools().filter(s => s.H);
    const rows = schools.flatMap(s => termRows(s).map(r => ({ ...r, _s: s, _flags: flags(r), _term: termKey(r) })));
    const allRows = filteredSchools().filter(s => s.H).flatMap(s => (s.H.repeats?.Enrollment_data_grp || []).map(r => ({ ...r, _s: s, _term: termKey(r) })));
    const S = sum(rows.map(r => r[K.sev]).filter(isNum)), C = sum(rows.map(r => r[K.conf]).filter(isNum)), B = sum(rows.map(r => r[denomKey()]).filter(isNum));
    const flagged = rows.filter(r => r._flags.length);
    const clean = rows.filter(r => !r._flags.length);
    const Sc = sum(clean.map(r => r[K.sev]).filter(isNum)), Cc = sum(clean.map(r => r[K.conf]).filter(isNum)), Bc = sum(clean.map(r => r[denomKey()]).filter(isNum));
    const bySchool = new Map();
    rows.forEach(r => { const k = r._s.code; if (!bySchool.has(k)) bySchool.set(k, { s: r._s, sev: 0, conf: 0, board: 0, terms: 0, flags: new Set() }); const a = bySchool.get(k); a.sev += r[K.sev] || 0; a.conf += r[K.conf] || 0; a.board += r[denomKey()] || 0; a.terms++; r._flags.forEach(f => a.flags.add(f)); });
    const schoolRows = [...bySchool.values()].map(a => ({ school: a.s.name, district: a.s.district, sev: a.sev, conf: a.conf, board: a.board, terms: a.terms, rate: per1000(a.sev, a.board), ratio: ratio(a.sev, a.conf), flags: [...a.flags] }));
    const zeroSchools = schoolRows.filter(r => r.sev === 0).length;

    // by term (all terms, unfiltered by term)
    const terms = [...new Set(allRows.map(r => r._term))].filter(Boolean).sort();
    const termStat = t => { const rs = allRows.filter(r => r._term === t); return { sev: sum(rs.map(r => r[K.sev]).filter(isNum)), conf: sum(rs.map(r => r[K.conf]).filter(isNum)), board: sum(rs.map(r => r[denomKey()]).filter(isNum)), n: rs.length }; };
    const ts = terms.map(termStat);

    // by district
    const dist = byDistrict(schools).map(([d, ss]) => { const rs = rows.filter(r => r._s.district === d); const sev = sum(rs.map(r => r[K.sev]).filter(isNum)), conf = sum(rs.map(r => r[K.conf]).filter(isNum)), board = sum(rs.map(r => r[denomKey()]).filter(isNum)); return { district: d, sev, conf, rate: per1000(sev, board), ratio: ratio(sev, conf), n: rs.length, flagged: rs.filter(r => r._flags.length).length }; });

    // histogram of severe per school-term
    const bands = [["0", v => v === 0], ["1–4", v => v >= 1 && v < 5], ["5–9", v => v >= 5 && v < 10], ["10–19", v => v >= 10 && v < 20], ["20–49", v => v >= 20 && v < 50], ["50+", v => v >= 50]];
    const sevVals = rows.map(r => r[K.sev]).filter(isNum);

    el.innerHTML = `
      <div class="card" style="margin-bottom:12px;border-left:4px solid var(--warning)"><b>Read with care.</b> "Severe cases" is the Annex H field <code>total_severe_cases</code> as entered by the school nurse for each term. Severe malaria is normally a small fraction of confirmed cases; here it is ${pct(S, C)} overall and ${num(flagged.length)} of ${num(rows.length)} school-term records fail a consistency check (e.g. more severe than confirmed cases). Figures marked <i>clean</i> exclude flagged records. The definition the nurses applied (WHO severe malaria vs. referred/admitted) should be confirmed before interpreting the levels.</div>
      <div class="toggles" id="sev-denom"><span class="meta" style="align-self:center;margin-right:6px">Rate denominator:</span>
        <button type="button" data-k="enrol" aria-pressed="${DENOM === "enrol"}">All students enrolled</button><button type="button" data-k="board" aria-pressed="${DENOM === "board"}">Boarders only</button></div>
      <div class="tiles">
        ${tile("Severe cases", num(S), `${num(rows.length)} school-term records · ${num(schools.length)} schools`)}
        ${tile(`Severe per 1,000 ${denomLabel()}`, r1(per1000(S, B)), `per term · clean records: ${r1(per1000(Sc, Bc))}`)}
        ${tile("Severity ratio", pct(S, C), `severe ÷ confirmed · clean records: ${pct(Sc, Cc)}`)}
        ${tile("Schools with any severe case", num(schoolRows.length - zeroSchools), `${num(zeroSchools)} schools report none`)}
        ${flagTile("Records failing a check", flagged.length, rows.length, "var(--critical)", "see data-quality panel")}
        ${tile("Median per school-term", num(median(sevVals)), `p90 ${num(sevVals.length ? [...sevVals].sort((a, b) => a - b)[Math.min(sevVals.length - 1, Math.floor(0.9 * sevVals.length))] : null)} · max ${num(sevVals.length ? Math.max(...sevVals) : null)}`)}
      </div>
      <div class="grid-2" style="margin-top:12px">
        <div class="card"><h3>Severe cases by term <span class="sub">Totals across schools reporting that term; the term filter does not narrow this chart</span></h3>
          ${groupedBars(terms, [{ name: "Severe cases", values: ts.map(t => t.sev) }])}
          ${table([{t:"Term"},{t:"Records",num:true},{t:"Severe",num:true},{t:"Confirmed",num:true},{t:"Severity ratio",num:true},{t:`Per 1,000 ${denomLabel()}`,num:true}], ts.map((t, i) => [esc(terms[i]), num(t.n), num(t.sev), num(t.conf), pct(t.sev, t.conf), r1(per1000(t.sev, t.board))]))}</div>
        <div class="card"><h3>Severe per 1,000 ${denomLabel()} by district <span class="sub">Per term, all terms pooled · amber = district has flagged records</span></h3>
          ${barList(dist.filter(d => isNum(d.rate)).sort((a, b) => b.rate - a.rate).map(d => ({ label: d.district, value: d.rate, color: d.flagged ? "var(--serious)" : "var(--series-1)", note: `(${num(d.sev)} severe, ratio ${pct(d.sev, d.conf)})` })), { fmt: r1 })}</div>
      </div>
      <div class="grid-2" style="margin-top:12px">
        <div class="card"><h3>Distribution of severe cases per school-term</h3>${barList(bands.map(([label, t]) => ({ label, value: sevVals.filter(t).length })))}</div>
        <div class="card"><h3>Severe rate by school characteristic <span class="sub">Severe per 1,000 ${denomLabel()} per term in schools with vs without each characteristic (descriptive only; small groups, unadjusted, includes flagged records)</span></h3>
          ${table([{t:"Characteristic"},{t:"With (n)",num:true},{t:"Rate",num:true},{t:"Without (n)",num:true},{t:"Rate",num:true}],
            correlates(schools).map(c => [esc(c.label), num(c.nWith), r1(c.rWith), num(c.nWithout), r1(c.rWithout)]), "Not enough schools with both Annex H and the characteristic")}</div>
      </div>
      <div class="card" style="margin-top:12px"><h3>Schools ranked by severe rate <span class="sub">All terms pooled · click a heading to sort</span></h3><div class="scroll" id="sev-schools"></div></div>
      <div class="card" style="margin-top:12px"><h3>Data-quality: school-term records failing a consistency check (${num(flagged.length)}) <span class="sub">For Thomas / the data officers to verify against the school registers</span></h3><div class="scroll" id="sev-flags"></div></div>`;

    wireToggles("sev-denom", k => { DENOM = k; try { localStorage.setItem("sense_sev_denom", k); } catch (e) {} render(); });
    sortableTable($("#sev-schools"), [
      { key: "school", label: "School" }, { key: "district", label: "District" }, { key: "terms", label: "Terms", num: true },
      { key: "sev", label: "Severe", num: true }, { key: "conf", label: "Confirmed", num: true }, { key: "board", label: `${denomLabel()} (Σ terms)`, num: true },
      { key: "rate", label: `Severe / 1,000 ${denomLabel()}`, num: true, render: r1 }, { key: "ratio", label: "Severity ratio", num: true, render: v => isNum(v) ? pct(v, 1) : "—" },
      { key: "flags", label: "Checks", render: v => v.length ? v.map(f => statusChip(f, "critical")).join(" ") : statusChip("ok", "good") },
    ], schoolRows, { sortKey: "rate", dir: -1 });
    sortableTable($("#sev-flags"), [
      { key: "school", label: "School" }, { key: "district", label: "District" }, { key: "term", label: "Term" },
      { key: "cases", label: "All cases", num: true }, { key: "conf", label: "Confirmed", num: true }, { key: "sev", label: "Severe", num: true }, { key: "board", label: "Boarders", num: true },
      { key: "flags", label: "Problem", render: v => v.map(f => statusChip(f, "critical")).join(" ") },
    ], flagged.map(r => ({ school: r._s.name, district: r._s.district, term: r._term, cases: r[K.cases] ?? null, conf: r[K.conf] ?? null, sev: r[K.sev] ?? null, board: r[K.board] ?? null, flags: r._flags })), { sortKey: "sev", dir: -1 });
  }
  PAGES.severe = { title: "Severe cases", render, filters: true };
})();
