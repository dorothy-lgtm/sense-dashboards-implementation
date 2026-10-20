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
  PAGES.retro = { title: "Retrospective", render, filters: true };
})();
