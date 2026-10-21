// Retrospective (Annex H term records): cases, boarders, RDT/ACT per school-term.
(function () {
  const F = {
    boarders: "total_boarders", enrol: "total_school_enroll", cases: "total_malaria_cases", confirmed: "confirmed_malaria",
    severe: "total_severe_cases", rdt: "total_rdt_used", act: "total_act_used",
  };
  const termKey = r => `${r.year ?? ""} ${r.term ?? ""}`.trim();

  function render() {
    pageHeader("Retrospective", filterSummary());
    const el = $("#page-retro");
    const schools = filteredSchools().filter(s => s.H);
    const recs = schools.flatMap(s => termRows(s).map(r => ({ ...r, _school: s })));      // honours the term filter
    const allRecs = filteredSchools().filter(s => s.H).flatMap(s => (s.H.repeats?.Enrollment_data_grp || []).map(r => ({ ...r, _school: s })));
    const avg = (rows, k) => mean(rows.map(r => r[k]).filter(isNum));
    const districts = new Set(schools.map(s => s.district).filter(Boolean));

    const terms = [...new Set(allRecs.map(termKey))].filter(Boolean).sort();
    const perTerm = k => terms.map(t => avg(allRecs.filter(r => termKey(r) === t), k));

    const dist = byDistrict(schools).map(([d, ss]) => {
      const rows = ss.flatMap(s => termRows(s));
      return { district: d, confirmed: avg(rows, F.confirmed), boarders: avg(rows, F.boarders), enrol: avg(rows, F.enrol), cases: avg(rows, F.cases), n: rows.length, schools: ss.length };
    });

    el.innerHTML = `
      <div class="tiles">
        ${tile("Districts covered", num(districts.size))}
        ${tile("Schools covered", num(schools.length), `${num(recs.length)} school-term records`)}
        ${rangeTile("Avg enrolment (all students)", recs.map(r => r[F.enrol]), { note: "per school-term" })}
        ${rangeTile("Avg boarders", recs.map(r => r[F.boarders]), { note: "per school-term" })}
        ${rangeTile("Avg malaria cases (all)", recs.map(r => r[F.cases]), { note: "per school-term" })}
        ${rangeTile("Avg confirmed cases", recs.map(r => r[F.confirmed]), { note: "per school-term" })}
        ${rangeTile("Avg severe cases", recs.map(r => r[F.severe]), { note: "per school-term" })}
        ${rangeTile("Avg RDT used", recs.map(r => r[F.rdt]), { note: "per school-term" })}
        ${rangeTile("Avg ACT used", recs.map(r => r[F.act]), { note: "per school-term" })}
      </div>
      <div class="card" style="margin-top:12px"><h3>Between-school variation (for sample-size work) <span class="sub">Per-school incidence pooled over the selected terms. CV = SD ÷ mean of school rates; k = CV after removing Poisson noise (Hayes &amp; Moulton); SD(log) = SD of log rates. "Clean" excludes records failing the consistency checks (severe &gt; confirmed, confirmed &gt; all cases)</span></h3>
        <div id="retro-cv"></div></div>
      <div class="grid-2" style="margin-top:12px">
        <div class="card"><h3>Cases by term <span class="sub">Average per school; the term filter does not narrow this chart</span></h3>
          ${lineChart(terms, [{ name: "Confirmed", values: perTerm(F.confirmed) }, { name: "Severe", values: perTerm(F.severe) }])}</div>
        <div class="card"><h3>RDT and ACT used <span class="sub">Average per school by term</span></h3>
          ${groupedBars(terms, [{ name: "RDT used", values: perTerm(F.rdt) }, { name: "ACT used", values: perTerm(F.act) }])}</div>
      </div>
      <div class="grid-2" style="margin-top:12px">
        <div class="card"><h3>Confirmed cases by district <span class="sub">Average per school per term</span></h3>
          ${barList(dist.filter(d => isNum(d.confirmed)).sort((a, b) => b.confirmed - a.confirmed).map(d => ({ label: d.district, value: d.confirmed })))}</div>
        <div class="card"><h3>Enrolment and boarders by district <span class="sub">Average per school per term · enrolment = all students</span></h3>
          ${barList(dist.filter(d => isNum(d.enrol)).sort((a, b) => b.enrol - a.enrol).map(d => ({ label: d.district, value: d.enrol, color: "var(--series-3)", note: `· boarders ${num(Math.round(d.boarders ?? 0))}` })))}</div>
      </div>
      <div class="card" style="margin-top:12px"><h3>School-term records <span class="sub">Click a column heading to sort</span></h3><div class="scroll" id="retro-table"></div></div>`;
    renderCV(schools, allRecs);

    sortableTable($("#retro-table"), [
      { key: "school", label: "School" }, { key: "district", label: "District" }, { key: "term", label: "Term" },
      { key: "enrol", label: "Enrolment", num: true }, { key: "boarders", label: "Boarders", num: true },
      { key: "cases", label: "Cases", num: true }, { key: "confirmed", label: "Confirmed", num: true }, { key: "severe", label: "Severe", num: true },
      { key: "rdt", label: "RDT used", num: true }, { key: "act", label: "ACT used", num: true },
      { key: "positivity", label: "Confirmed / RDT", num: true, render: v => isNum(v) ? pct(v, 1) : "—" },
    ], recs.map(r => ({
      school: r._school.name, district: r._school.district, term: termKey(r), enrol: r[F.enrol] ?? null, boarders: r[F.boarders] ?? null,
      cases: r[F.cases] ?? null, confirmed: r[F.confirmed] ?? null, severe: r[F.severe] ?? null, rdt: r[F.rdt] ?? null, act: r[F.act] ?? null,
      positivity: isNum(r[F.confirmed]) && isNum(r[F.rdt]) && r[F.rdt] > 0 ? r[F.confirmed] / r[F.rdt] : null,
    })), { sortKey: "school" });
  }
  const isFlagged = r => (isNum(r[F.severe]) && isNum(r[F.confirmed]) && r[F.severe] > r[F.confirmed]) || (isNum(r[F.confirmed]) && isNum(r[F.cases]) && r[F.confirmed] > r[F.cases]) || (isNum(r[F.severe]) && r[F.severe] > 0 && !r[F.confirmed]);
  function cvStats(rows, numKey, denKey) {
    const per = new Map();
    rows.forEach(r => { const n = r[numKey], d = r[denKey]; if (isNum(n) && isNum(d) && d > 0) { const p = per.get(r._school.code) || [0, 0]; p[0] += n; p[1] += d; per.set(r._school.code, p); } });
    const rates = [...per.values()].map(([n, d]) => n / d), pt = [...per.values()].map(([, d]) => d);
    if (rates.length < 3) return null;
    const m = mean(rates), sd = Math.sqrt(sum(rates.map(x => (x - m) ** 2)) / (rates.length - 1));
    const pois = mean(pt.map(d => m / d));
    const k = Math.sqrt(Math.max(0, sd * sd - pois)) / m;
    const logs = rates.filter(x => x > 0).map(Math.log), ml = mean(logs), sdl = logs.length > 2 ? Math.sqrt(sum(logs.map(x => (x - ml) ** 2)) / (logs.length - 1)) : null;
    return { n: rates.length, mean: m, cv: sd / m, k, sdlog: sdl };
  }
  function pearson(a, b) { const ma = mean(a), mb = mean(b); const num = sum(a.map((x, i) => (x - ma) * (b[i] - mb))); const den = Math.sqrt(sum(a.map(x => (x - ma) ** 2)) * sum(b.map(y => (y - mb) ** 2))); return den ? num / den : null; }
  /** Correlation of per-school rates between the two most recent terms, for the schools in `rs`. */
  function termCorr(rs, allRecs, numKey, denKey, t1, t2) {
    const keep = new Set(rs.map(r => r._school.code));
    const byS = new Map();
    allRecs.filter(r => keep.has(r._school.code)).forEach(r => { const n = r[numKey], d = r[denKey]; if (isNum(n) && isNum(d) && d > 0) { const o = byS.get(r._school.code) || {}; o[termKey(r)] = n / d; byS.set(r._school.code, o); } });
    const pairs = [...byS.values()].filter(o => isNum(o[t1]) && isNum(o[t2]));
    if (pairs.length < 5) return { r: null, n: pairs.length };
    return { r: pearson(pairs.map(o => o[t1]), pairs.map(o => o[t2])), n: pairs.length };
  }
  function renderCV(schools, allRecs) {
    const el = $("#retro-cv");
    const recs = schools.flatMap(s => termRows(s).map(r => ({ ...r, _school: s })));
    const clean = recs.filter(r => !isFlagged(r));
    const f2 = v => isNum(v) ? (Math.round(v * 100) / 100).toFixed(2) : "—";
    const terms = [...new Set(allRecs.map(termKey))].filter(Boolean).sort();
    const [t1, t2] = terms.length >= 2 ? terms.slice(-2) : [null, null];
    const specs = [["Confirmed cases per student", F.confirmed, F.enrol], ["All malaria cases per student", F.cases, F.enrol], ["Confirmed cases per boarder", F.confirmed, F.boarders], ["Severe cases per student", F.severe, F.enrol]];
    const sets = [["", recs], [" (clean)", clean]];
    const rowsOut = sets.flatMap(([suffix, set]) => specs.map(([l, n, d]) => {
      const st = cvStats(set, n, d);
      if (!st) return [l + suffix, "—", "—", "—", "—", "—", "—", "—"];
      const c = t1 ? termCorr(set, allRecs, n, d, t1, t2) : { r: null, n: 0 };
      const adj = isNum(c.r) ? st.k * Math.sqrt(1 - c.r * c.r) : null;
      return [l + suffix, num(st.n), num(Math.round(1000 * st.mean * 10) / 10), f2(st.cv), f2(st.k), f2(st.sdlog),
              isNum(c.r) ? `${f2(c.r)} <span class="meta">(${num(c.n)})</span>` : "—", `<b>${f2(adj)}</b>`];
    }));
    el.innerHTML = table([{t:"Rate"},{t:"Schools",num:true},{t:"Mean per 1,000 per term",num:true},{t:"CV (observed)",num:true},{t:"k (Poisson-corrected)",num:true},{t:"SD of log rate",num:true},
                          {t:`r, ${t1 ? esc(t1) + " vs " + esc(t2) : "last two terms"}`,num:true},{t:"k after baseline adjustment",num:true}], rowsOut)
      + `<p class="meta">r = correlation across schools of the per-school rate in the last two terms (schools with both terms in brackets) — a proxy for how well baseline incidence predicts the trial outcome. k after baseline adjustment ≈ k·√(1−r²): the between-school CV left once the analysis adjusts for (or randomisation is stratified on) baseline incidence.</p>`;
  }
  PAGES.retro = { title: "Retrospective", render, filters: true };
})();
