// Mosquito prevention (Annex G school-level fields): breeding sites, containers, drainage, pesticide/IRS history.
(function () {
  const IND = [
    { key: "open_containers", label: "Open containers", test: a => yes(a.open_containers) },
    { key: "within_breeding_site", label: "Breeding sites inside", test: a => yes(a.within_breeding_site) },
    { key: "outside_breeding_site", label: "Breeding sites outside", test: a => yes(a.outside_breeding_site) },
    { key: "functional_drainage_sys", label: "Working drainage", test: a => yes(a.functional_drainage_sys) },
    { key: "drain_leaves", label: "Open drain leaves compound", test: a => /open drain|leav|outside|out of/i.test(String(a.drainage_channel_end ?? "")) },
    { key: "pesticide_recent", label: "Pesticide in last 12 months", test: a => recent(a.history_pesticide_use) },
    { key: "irs_recent", label: "IRS in last 12 months", test: a => recent(a.irs_history) },
  ];
  // "recent" = the answer says yes/within the last year; adjust once the choice labels are known
  const recent = v => { const s = String(v ?? "").toLowerCase(); return /12 month|last year|past year|within.*year|this year|yes/.test(s) && !/never|no\b|more than|over a year|>/.test(s); };
  let ind = "open_containers";

  function render() {
    pageHeader("Mosquito prevention", filterSummary());
    const el = $("#page-prevention");
    const schools = filteredSchools().filter(s => s.G);
    const surveys = schools.map(s => s.G.answers);
    const share = test => { const have = surveys.filter(a => a !== undefined); return have.length ? pct(have.filter(test).length, have.length) : "—"; };

    el.innerHTML = `
      <div class="tiles">
        ${tile("Breeding sites inside", share(IND[1].test), "of surveys")}
        ${tile("Breeding sites outside", share(IND[2].test), "of surveys")}
        ${tile("Open containers", share(IND[0].test), "of surveys")}
        ${tile("Working drainage", share(IND[3].test), "of surveys")}
        ${tile("Pesticide, last 12 months", share(IND[5].test), "of surveys")}
        ${tile("IRS, last 12 months", share(IND[6].test), "of surveys")}
      </div>
      <div class="grid-2" style="margin-top:12px">
        <div class="card"><h3>By district <span class="sub">Share of surveys</span></h3>${toggles("prev-ind", IND.map(i => ({ key: i.key, label: i.label })), ind)}<div id="prev-district"></div></div>
        <div class="card"><h3>Where drainage ends <span class="sub">Surveys with a working drainage system</span></h3>
          ${donut(distribution(surveys.filter(a => yes(a.functional_drainage_sys)), "drainage_channel_end"))}</div>
      </div>
      <div class="three" style="margin-top:12px">
        <div class="card"><h3>Pesticide use history <span class="sub">All surveys</span></h3>${barList(distribution(surveys, "history_pesticide_use"), { color: "var(--series-2)" }) || ""}</div>
        <div class="card"><h3>Indoor residual spraying history <span class="sub">All surveys</span></h3>${barList(distribution(surveys, "irs_history"), { color: "var(--series-2)" }) || ""}</div>
        <div class="card"><h3>Breeding sites: active or passive <span class="sub">Where a site was found</span></h3>
          ${barList([...distribution(surveys.filter(a => yes(a.within_breeding_site)), "within_active_passive").map(d => ({ ...d, label: "Inside — " + d.label })),
                     ...distribution(surveys.filter(a => yes(a.outside_breeding_site)), "outside_active_passive").map(d => ({ ...d, label: "Outside — " + d.label }))])}
          ${(() => { const p = surveys.map(a => a.outside_site_proximity).filter(isNum); return p.length ? `<p class="meta">Outside sites: median ${num(median(p))} m from the school (${p.length} with a distance recorded)</p>` : ""; })()}</div>
      </div>
      <div class="card" style="margin-top:12px"><h3>Schools <span class="sub">Click a column heading to sort</span></h3><div class="scroll" id="prev-table"></div></div>`;

    const drawDistrict = () => {
      const t = IND.find(i => i.key === ind).test;
      const items = byDistrict(schools).map(([d, ss]) => ({ label: d, value: ss.length ? 100 * ss.filter(s => t(s.G.answers)).length / ss.length : null, note: `(${ss.length})` })).filter(i => isNum(i.value)).sort((a, b) => b.value - a.value);
      $("#prev-district").innerHTML = barList(items, { max: 100, fmt: v => Math.round(v) + "%", color: "var(--series-2)" });
    };
    drawDistrict();
    wireToggles("prev-ind", k => { ind = k; drawDistrict(); });

    const yn = v => v === undefined || v === null ? "—" : yes(v) ? statusChip("Yes", "warning") : esc(v);
    sortableTable($("#prev-table"), [
      { key: "school", label: "School" }, { key: "district", label: "District" },
      { key: "inside", label: "Breeding inside", render: yn }, { key: "outside", label: "Breeding outside", render: yn },
      { key: "containers", label: "Open containers", render: yn }, { key: "drainage", label: "Working drainage", render: v => v === undefined ? "—" : yes(v) ? statusChip("Yes", "good") : esc(v) },
      { key: "drain_end", label: "Drain ends" }, { key: "pesticide", label: "Pesticide history" }, { key: "irs", label: "IRS history" },
    ], schools.map(s => { const a = s.G.answers; return { school: s.name, district: s.district, inside: a.within_breeding_site, outside: a.outside_breeding_site, containers: a.open_containers, drainage: a.functional_drainage_sys, drain_end: a.drainage_channel_end ?? null, pesticide: a.history_pesticide_use ?? null, irs: a.irs_history ?? null }; }), { sortKey: "school" });
  }
  PAGES.prevention = { title: "Mosquito prevention", render, filters: true };
})();
