// Infrastructure (Annex G totals + Annex H boarders): facilities per school, boarders per bathroom.
(function () {
  const G = { dorms: "total_dormitories", classrooms: "total_classrooms", bathrooms: "total_bathrooms", quarters: "total_quarters", structures: "total_structures" };
  const THRESH = { adequate: 25, strained: 40 };     // boarders per bathroom stance
  let metric = "dorms";

  const g = (s, k) => { const v = s.G?.answers?.[G[k]]; return isNum(v) ? v : null; };
  const structuresOf = s => { const v = g(s, "structures"); if (isNum(v)) return v; const parts = ["dorms", "classrooms", "bathrooms", "quarters"].map(k => g(s, k)).filter(isNum); return parts.length ? sum(parts) : null; };
  const boardersOf = s => { const t = latestTerm(s); return t && isNum(t.total_boarders) ? t.total_boarders : null; };
  const status = v => v === null ? null : v <= THRESH.adequate ? "Adequate" : v <= THRESH.strained ? "Strained" : "Critical";
  const statusKind = { Adequate: "good", Strained: "warning", Critical: "critical" };

  function rowsFor(schools) {
    return schools.filter(s => s.G).map(s => {
      const b = boardersOf(s), bath = g(s, "bathrooms");
      const per = isNum(b) && isNum(bath) && bath > 0 ? b / bath : null;
      const parts = s.G.n_parts || s.G.n_submissions || 1, coll = s.G.collated || {};
      return { code: s.code, school: s.name, district: s.district, dorms: g(s, "dorms"), classrooms: g(s, "classrooms"), bathrooms: bath, quarters: g(s, "quarters"),
               structures: structuresOf(s), boarders: b, per, status: status(per), parts, resends: s.G.resends || 0,
               collation: Object.entries(coll).map(([k, v]) => `${k}: ${v}`).join("; "), measured: (s.G.repeats?.Classrooms_dormitories_grp || []).length };
    });
  }

  function render() {
    pageHeader("Infrastructure", filterSummary());
    const el = $("#page-infra");
    const rows = rowsFor(filteredSchools());
    const surveys = sum(filteredSchools().map(s => s.G?.n_submissions || 0));
    const multi = rows.filter(r => r.parts > 1), resent = sum(rows.map(r => r.resends));
    const avg = k => mean(rows.map(r => r[k]).filter(isNum));
    const metrics = [["dorms", "Dormitories"], ["classrooms", "Classrooms"], ["bathrooms", "Bathrooms"], ["quarters", "Staff quarters"], ["structures", "Total structures"]];

    el.innerHTML = `
      <div class="tiles">
        ${tile("Avg dormitories", num(avg("dorms")), "per school")}
        ${tile("Avg classrooms", num(avg("classrooms")), "per school")}
        ${tile("Avg bathrooms", num(avg("bathrooms")), "stances per school")}
        ${tile("Avg staff quarters", num(avg("quarters")), "per school")}
        ${tile("Avg structures", num(avg("structures")), "per school")}
        ${tile("Schools surveyed", num(rows.length), `${num(surveys)} Annex G submissions`)}
        ${tile("Multi-part submissions", num(multi.length), multi.length ? `schools entered in several parts, collated: every measured structure kept, totals summed across parts unless identical${resent ? ` · ${num(resent)} exact re-send${resent > 1 ? "s" : ""} dropped` : ""}` : "every school entered in one submission")}
      </div>
      <div class="grid-2" style="margin-top:12px">
        <div class="card"><h3>Facilities by district <span class="sub">Average per school</span></h3>
          ${toggles("infra-metric", metrics.map(([key, label]) => ({ key, label })), metric)}<div id="infra-district"></div></div>
        <div class="card"><h3>Boarders per bathroom <span class="sub">Schools ranked by crowding. Thresholds: up to ${THRESH.adequate} adequate, up to ${THRESH.strained} strained, above ${THRESH.strained} critical. Boarders = ${FILTER.term ? "selected term" : "latest term entered"}</span></h3>
          <div id="infra-crowding"></div></div>
      </div>
      <div class="card" style="margin-top:12px"><h3>Schools <span class="sub">Click a column heading to sort</span></h3><div class="scroll" id="infra-table"></div></div>`;

    const drawDistrict = () => {
      const items = byDistrict(rows).map(([d, rs]) => ({ label: d, value: mean(rs.map(r => r[metric]).filter(isNum)) })).filter(i => isNum(i.value)).sort((a, b) => b.value - a.value);
      $("#infra-district").innerHTML = barList(items) || `<p class="empty">No data</p>`;
    };
    drawDistrict();
    wireToggles("infra-metric", k => { metric = k; drawDistrict(); });

    const crowd = rows.filter(r => isNum(r.per)).sort((a, b) => b.per - a.per);
    $("#infra-crowding").innerHTML = crowd.length
      ? barList(crowd.slice(0, 12).map(r => ({ label: r.school, value: r.per, color: r.status === "Critical" ? "var(--critical)" : r.status === "Strained" ? "var(--serious)" : "var(--good)" })), { fmt: v => num(Math.round(v * 10) / 10) })
        + `<p class="meta">${crowd.length > 12 ? "Top 12 shown. " : ""}${crowd.length} schools with both boarders and bathrooms recorded.</p>`
      : `<p class="empty">No school has both boarders (Annex H) and bathrooms (Annex G) recorded for this selection.</p>`;

    sortableTable($("#infra-table"), [
      { key: "school", label: "School", render: (v, r) => `${esc(v)}${r.parts > 1 ? ` <span class="chip" title="${esc(r.collation)}">${r.parts} parts</span>` : ""}` }, { key: "district", label: "District" },
      { key: "measured", label: "Structures measured", num: true },
      { key: "dorms", label: "Dorms", num: true }, { key: "classrooms", label: "Classrooms", num: true }, { key: "bathrooms", label: "Bathrooms", num: true },
      { key: "quarters", label: "Quarters", num: true }, { key: "boarders", label: "Boarders", num: true },
      { key: "per", label: "Per bathroom", num: true, render: v => isNum(v) ? num(Math.round(v * 10) / 10) : "—" },
      { key: "status", label: "Status", render: v => v ? statusChip(v, statusKind[v]) : "—" },
    ], rows, { sortKey: "school" });
  }
  PAGES.infra = { title: "Infrastructure", render, filters: true };
})();
