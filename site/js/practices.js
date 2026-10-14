// Testing and prevention practices (Annex F): keyword flags from nurse notes, duty hours, school type, working days.
(function () {
  function render() {
    pageHeader("Testing and prevention practices", filterSummary());
    const el = $("#page-practices");
    const schools = filteredSchools().filter(s => s.F);
    const ans = schools.map(s => s.F.answers);
    const labels = METRICS.derived_labels || {}, groups = METRICS.derived_groups || { practices: [], cover: [] };
    const count = k => ans.filter(a => a[k] === true).length;
    const hours = ans.map(a => a.duty_hours).filter(isNum);
    const band = h => h >= 24 ? "24 hours" : h >= 12 ? "12 to 23 hours" : "Under 12 hours";
    const days = ans.map(a => a.working_days_n).filter(isNum);

    el.innerHTML = `
      <div class="tiles">
        ${tile("Schools", num(ans.length), "in this selection")}
        ${tile("Refer severe cases", ans.length ? pct(count("refers_severe"), ans.length) : "—", "of schools mention referral")}
        ${tile("Nurse on site", ans.length ? pct(count("nurse_on_site"), ans.length) : "—", "stays or is always available")}
        ${tile("Nurse duty hours", num(mean(hours)), "per day, end minus start time")}
        ${tile("RDT stockouts", num(count("rdt_stockout")), "schools reporting")}
        ${tile("Data gaps", ans.length ? pct(count("data_gaps"), ans.length) : "—", "of schools")}
      </div>
      <div class="grid-2" style="margin-top:12px">
        <div class="card"><h3>Diagnosis and referral practices <span class="sub">Schools whose nurse notes mention each practice. Counted by keyword, so these are minimum counts</span></h3>
          ${barList(groups.practices.map(k => ({ label: labels[k] || k, value: count(k) })), { color: "var(--series-2)", max: Math.max(1, ans.length) })}</div>
        <div class="card"><h3>Nurse cover and record keeping <span class="sub">Schools</span></h3>
          ${barList(groups.cover.map(k => ({ label: labels[k] || k, value: count(k) })), { color: "var(--series-3)", max: Math.max(1, ans.length) })}</div>
      </div>
      <div class="three" style="margin-top:12px">
        <div class="card"><h3>Nurse duty hours per day <span class="sub">Equal start and end times count as 24 hours</span></h3>${donut(["24 hours", "12 to 23 hours", "Under 12 hours"].map(l => ({ label: l, value: hours.filter(h => band(h) === l).length })))}</div>
        <div class="card"><h3>School type <span class="sub">Schools</span></h3>${donut(distribution(ans, "school_type"))}</div>
        <div class="card"><h3>Nurse working days per week <span class="sub">Schools</span></h3>${barList([...new Set(days)].sort((a, b) => a - b).map(d => ({ label: `${d} day${d === 1 ? "" : "s"}`, value: days.filter(x => x === d).length })))}</div>
      </div>
      <div class="card" style="margin-top:12px"><h3>Practices by school <span class="sub">Amber marks a reported stockout or data gap. "No" means the notes do not mention it. Click a heading to sort</span></h3><div class="scroll" id="prac-table"></div></div>`;

    const flag = (v, warn = false) => v === true ? statusChip("Yes", warn ? "warning" : "good") : v === false ? "No" : "—";
    sortableTable($("#prac-table"), [
      { key: "school", label: "School" }, { key: "district", label: "District" }, { key: "type", label: "Type", render: v => esc(shortLabel(v)) },
      { key: "hours", label: "Duty hours", num: true },
      { key: "refers_severe", label: "Refers severe", render: v => flag(v) }, { key: "mentions_rdt", label: "RDT", render: v => flag(v) },
      { key: "mentions_clinical", label: "Clinical", render: v => flag(v) }, { key: "mentions_microscopy", label: "Microscopy", render: v => flag(v) },
      { key: "rdt_stockout", label: "RDT stockout", render: v => flag(v, true) }, { key: "data_gaps", label: "Data gaps", render: v => flag(v, true) },
      { key: "nurse_on_site", label: "Nurse on site", render: v => flag(v) },
    ], schools.map(s => { const a = s.F.answers; return { school: s.name, district: s.district, type: a.school_type ?? null, hours: a.duty_hours ?? null,
      refers_severe: a.refers_severe, mentions_rdt: a.mentions_rdt, mentions_clinical: a.mentions_clinical, mentions_microscopy: a.mentions_microscopy, rdt_stockout: a.rdt_stockout, data_gaps: a.data_gaps, nurse_on_site: a.nurse_on_site }; }), { sortKey: "school" });
  }
  PAGES.practices = { title: "Testing and prevention practices", render, filters: true };
})();
