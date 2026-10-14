// Nurse and testing (Annex F): qualification, cover, RDT/ACT types, supplies, storage.
(function () {
  function render() {
    pageHeader("Nurse and testing", filterSummary());
    const el = $("#page-nurse");
    const schools = filteredSchools().filter(s => s.F);
    const ans = schools.map(s => s.F.answers);
    const withNurse = ans.filter(a => a.nurse_qualification_resolved || a.nurse_qualification || isNum(a.working_days_n));
    const screenedAll = SUMMARY.forms.find(f => f.key === "enrolment")?.totals?.submissions;
    const eligible = ROSTER?.totals?.screening_outcomes || {};
    const eligN = Object.entries(eligible).filter(([k]) => /^eligible/i.test(k)).reduce((a, [, v]) => a + v, 0);
    const qualified = withNurse.filter(a => a.nurse_qualified === true).length, qualKnown = withNurse.filter(a => a.nurse_qualified !== null && a.nurse_qualified !== undefined).length;
    const weekend = withNurse.filter(a => a.weekend_cover === true).length, weekendKnown = withNurse.filter(a => a.weekend_cover !== undefined).length;
    const days = withNurse.map(a => a.working_days_n).filter(isNum);

    el.innerHTML = `
      <div class="tiles">
        ${tile("Schools screened", num(screenedAll), `${num(eligN)} eligible, all visits (not filtered)`)}
        ${tile("Eligibility rate", screenedAll ? pct(eligN, screenedAll) : "—", "of schools screened")}
        ${tile("Schools with nurse data", num(withNurse.length), "in this selection")}
        ${tile("Qualified nurse", qualKnown ? pct(qualified, qualKnown) : "—", "registered, enrolled or clinical officer")}
        ${tile("Weekend cover", weekendKnown ? pct(weekend, weekendKnown) : "—", "nurse works Saturday or Sunday")}
        ${tile("Avg working days", num(mean(days)), "per week")}
      </div>
      <div class="three" style="margin-top:12px">
        <div class="card"><h3>Nurse qualification <span class="sub">Schools. "Other" is resolved from the specified text where possible</span></h3>${donut(distribution(withNurse, "nurse_qualification_resolved"))}</div>
        <div class="card"><h3>RDT types in use <span class="sub">Schools using each type</span></h3>${barList(distribution(ans, "type_rdt_used"), { color: "var(--series-2)" })}</div>
        <div class="card"><h3>ACT types in use <span class="sub">Schools using each type</span></h3>${barList(distribution(ans, "type_act_used"), { color: "var(--series-3)" })}</div>
      </div>
      <div class="grid-2" style="margin-top:12px">
        <div class="card"><h3>Testing supplies available <span class="sub">Schools reporting each item</span></h3>${barList(distribution(ans, "test_supplies"))}</div>
        <div class="card"><h3>Where supplies are stored <span class="sub">Schools</span></h3>${donut(distribution(ans, "where_supplies_stored"))}</div>
      </div>
      <div class="grid-2" style="margin-top:12px">
        <div class="card"><h3>Dedicated sick bay <span class="sub">Schools</span></h3>${donut(distribution(ans, "dedicated_sickbay"))}</div>
        <div class="card"><h3>Nurse working days <span class="sub">Schools reporting each day</span></h3>${barList(distribution(withNurse, "nurse_working_days"))}</div>
      </div>
      <div class="card" style="margin-top:12px"><h3>Schools <span class="sub">Click a column heading to sort</span></h3><div class="scroll" id="nurse-table"></div></div>`;

    sortableTable($("#nurse-table"), [
      { key: "school", label: "School" }, { key: "district", label: "District" }, { key: "qual", label: "Nurse qualification", render: v => esc(shortLabel(v)) },
      { key: "days", label: "Days / week", num: true }, { key: "hours", label: "Duty hours", num: true },
      { key: "weekend", label: "Weekend", render: v => v === true ? statusChip("Yes", "good") : v === false ? "No" : "—" },
      { key: "sickbay", label: "Sick bay", render: v => esc(shortLabel(v)) }, { key: "rdt", label: "RDT types", render: v => esc((v || []).map(shortLabel).join(", ") || "—") }, { key: "act", label: "ACT types", render: v => esc((v || []).map(shortLabel).join(", ") || "—") },
      { key: "stored", label: "Supplies stored", render: v => esc(shortLabel(v)) },
    ], schools.map(s => { const a = s.F.answers; return { school: s.name, district: s.district, qual: a.nurse_qualification_resolved ?? null, days: a.working_days_n ?? null, hours: a.duty_hours ?? null, weekend: a.weekend_cover, sickbay: a.dedicated_sickbay ?? null, rdt: a.type_rdt_used, act: a.type_act_used, stored: a.where_supplies_stored ?? null }; }), { sortKey: "school" });
  }
  PAGES.nurse = { title: "Nurse and testing", render, filters: true };
})();
