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
      <div class="card" style="margin-top:12px"><h3>Between-school variation (for sample-size work) <span class="sub">Per-school incidence pooled over the selected terms. CV = SD ÷ mean of school rates; k = CV after removing Poisson noise (Hayes &amp; Moulton); SD(log) = SD of log rates. "Clean" excludes records failing the consistency checks (severe &gt; confirmed, confirmed &gt; all cases); "trimmed" keeps only the schools between the p10 and p90 of that rate</span></h3>
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
  /** Per-school pooled rate for a numerator/denominator pair → Map(code → rate). */
  function schoolRates(rows, numKey, denKey) {
    const per = new Map();
    rows.forEach(r => { const n = r[numKey], d = r[denKey]; if (isNum(n) && isNum(d) && d > 0) { const p = per.get(r._school.code) || [0, 0]; p[0] += n; p[1] += d; per.set(r._school.code, p); } });
    return new Map([...per].map(([c, [n, d]]) => [c, n / d]));
  }
  /** Records of the schools whose pooled rate lies within [p_lo, p_hi] of the school distribution. */
  function trimRecs(rows, numKey, denKey, lo = 0.1, hi = 0.9) {
    const rates = schoolRates(rows, numKey, denKey);
    const sorted = [...rates.values()].sort((a, b) => a - b);
    if (sorted.length < 10) return rows;
    const q = p => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];
    const a = q(lo), b = q(hi);
    const keep = new Set([...rates].filter(([, v]) => v >= a && v <= b).map(([c]) => c));
    return rows.filter(r => keep.has(r._school.code));
  }
  function renderCV(schools, allRecs) {
    const el = $("#retro-cv");
    const recs = schools.flatMap(s => termRows(s).map(r => ({ ...r, _school: s })));
    const clean = recs.filter(r => !isFlagged(r));
    const f2 = v => isNum(v) ? (Math.round(v * 100) / 100).toFixed(2) : "—";
    const row = (label, st) => st ? [label, num(st.n), num(Math.round(1000 * st.mean * 10) / 10), f2(st.cv), f2(st.k), f2(st.sdlog)] : [label, "—", "—", "—", "—", "—"];
    const specs = [["Confirmed cases per student", F.confirmed, F.enrol], ["All malaria cases per student", F.cases, F.enrol], ["Confirmed cases per boarder", F.confirmed, F.boarders], ["Severe cases per student", F.severe, F.enrol]];
    const sets = [["", recs], [" (clean)", clean], [" (p10–p90 trimmed)", null]];
    const rowsOut = sets.flatMap(([suffix, rs]) => specs.map(([l, n, d]) => row(l + suffix, cvStats(rs || trimRecs(recs, n, d), n, d))));
    // predictive value of baseline: correlation of per-school confirmed incidence between the two most recent terms, for each set
    const terms = [...new Set(allRecs.map(termKey))].filter(Boolean).sort();
    let corr = "";
    if (terms.length >= 2) {
      const [t1, t2] = terms.slice(-2);
      const corrFor = (label, rs) => {
        const keep = new Set(rs.map(r => r._school.code));
        const byS = new Map();
        allRecs.filter(r => keep.has(r._school.code)).forEach(r => { const n = r[F.confirmed], d = r[F.enrol]; if (isNum(n) && isNum(d) && d > 0) { const o = byS.get(r._school.code) || {}; o[termKey(r)] = n / d; byS.set(r._school.code, o); } });
        const pairs = [...byS.values()].filter(o => isNum(o[t1]) && isNum(o[t2]));
        if (pairs.length < 5) return "";
        const rr = pearson(pairs.map(o => o[t1]), pairs.map(o => o[t2]));
        const k = cvStats(rs, F.confirmed, F.enrol);
        return `<li><b>${label}</b>: incidence in ${esc(t1)} vs ${esc(t2)} correlates at r = ${f2(rr)} (${num(pairs.length)} schools) → adjusting for baseline incidence takes k from ${f2(k?.k)} to about k·√(1−r²) ≈ <b>${f2(k && rr !== null ? k.k * Math.sqrt(1 - rr * rr) : null)}</b>.</li>`;
      };
      corr = `<p class="meta" style="margin-bottom:4px">Baseline predictiveness (confirmed cases per student):</p><ul class="meta" style="margin-top:0">${corrFor("All schools", recs)}${corrFor("Clean records", clean)}${corrFor("p10–p90 trimmed", trimRecs(recs, F.confirmed, F.enrol))}</ul>
        <p class="meta">Trimming drops the schools that drive both k and r, so the baseline-adjusted k moves much less than the unadjusted one. A trimmed k is only the right planning figure if the trial's eligibility or stratification will actually exclude or absorb those schools.</p>`;
    }
    el.innerHTML = table([{t:"Rate"},{t:"Schools",num:true},{t:"Mean per 1,000 per term",num:true},{t:"CV (observed)",num:true},{t:"k (Poisson-corrected)",num:true},{t:"SD of log rate",num:true}], rowsOut) + corr;
  }
  PAGES.retro = { title: "Retrospective", render, filters: true };
})();
