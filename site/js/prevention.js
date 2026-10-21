// Mosquito prevention (Annex G school-level fields): breeding sites, containers, drainage, pesticide/IRS history.
(function () {
  const act = v => /^active/i.test(String(v ?? "")), pas = v => /^passive/i.test(String(v ?? ""));
  const SITE = { any: { label: "Any site", test: (a, w) => yes(a[w + "_breeding_site"]) },
                 active: { label: "Active sites", test: (a, w) => yes(a[w + "_breeding_site"]) && act(a[w + "_active_passive"]) },
                 passive: { label: "Passive sites", test: (a, w) => yes(a[w + "_breeding_site"]) && pas(a[w + "_active_passive"]) } };
  let site = "any";
  const IND = [
    { key: "open_containers", label: "Open containers", test: a => yes(a.open_containers) },
    { key: "within_breeding_site", label: "Breeding sites inside", test: a => SITE[site].test(a, "within") },
    { key: "outside_breeding_site", label: "Breeding sites outside", test: a => SITE[site].test(a, "outside") },
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

    const n = surveys.length;
    const cnt = (w, k) => surveys.filter(a => SITE[k].test(a, w)).length;
    const siteNote = w => { const any = cnt(w, "any"), ac = cnt(w, "active"), pa = cnt(w, "passive"); return `of ${num(n)} schools · ${num(ac)} active, ${num(pa)} passive, ${num(any - ac - pa)} unspecified${any ? ` · active share of sites ${pct(ac, any)}` : ""}`; };
    const siteLabel = { any: "Breeding sites", active: "Active breeding sites", passive: "Passive breeding sites" }[site];
    IND[1].label = siteLabel + " inside"; IND[2].label = siteLabel + " outside";
    const activeShare = w => { const any = cnt(w, "any"); return any ? pct(cnt(w, "active"), any) : "—"; };

    el.innerHTML = `
      <div class="card" style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
        ${toggles("prev-site", Object.entries(SITE).map(([key, v]) => ({ key, label: v.label })), site)}
        <span class="meta">Breeding-site tiles, the district chart and the table count a school when it reports a site inside / outside its premises that is <b>${esc(SITE[site].label.toLowerCase())}</b> (Annex G: "Are breeding sites … active or passive")</span>
      </div>
      <div class="tiles">
        ${tile(siteLabel + " inside", share(IND[1].test), siteNote("within"))}
        ${tile(siteLabel + " outside", share(IND[2].test), siteNote("outside"))}
        ${tile("Active share of sites found", `${activeShare("within")}<span class="unit">inside</span>`, `${activeShare("outside")} outside · active ÷ all schools reporting a site`)}
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
        <div class="card"><h3>Breeding sites: none, passive or active <span class="sub">Share of all surveyed schools · hover for counts</span></h3>
          ${stackedBars([
            { label: "Inside the premises", counts: [n - cnt("within", "any"), cnt("within", "passive"), cnt("within", "any") - cnt("within", "active") - cnt("within", "passive"), cnt("within", "active")], note: `${pct(cnt("within", "active"), n)} active` },
            { label: "Outside the premises", counts: [n - cnt("outside", "any"), cnt("outside", "passive"), cnt("outside", "any") - cnt("outside", "active") - cnt("outside", "passive"), cnt("outside", "active")], note: `${pct(cnt("outside", "active"), n)} active` },
          ], [{ label: "no site", color: "var(--grid)" }, { label: "passive", color: "var(--series-4)" }, { label: "site, type not stated", color: "var(--axis)" }, { label: "active", color: "var(--series-2)" }])}
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
    wireToggles("prev-site", k => { site = k; render(); });

    const yn = v => v === undefined || v === null ? "—" : yes(v) ? statusChip("Yes", "warning") : esc(shortLabel(v));
    const site_ = (v, t) => v === undefined || v === null ? "—" : !yes(v) ? esc(shortLabel(v)) : act(t) ? statusChip("Active", "critical") : pas(t) ? statusChip("Passive", "warning") : statusChip("Yes", "warning");
    sortableTable($("#prev-table"), [
      { key: "school", label: "School" }, { key: "district", label: "District" },
      { key: "inside", label: "Breeding inside", render: (v, r) => site_(v, r.inside_t) }, { key: "outside", label: "Breeding outside", render: (v, r) => site_(v, r.outside_t) },
      { key: "distance", label: "Outside site distance (m)", num: true },
      { key: "containers", label: "Open containers", render: yn }, { key: "drainage", label: "Working drainage", render: v => v === undefined ? "—" : yes(v) ? statusChip("Yes", "good") : esc(shortLabel(v)) },
      { key: "drain_end", label: "Drain ends", render: v => esc(shortLabel(v)) }, { key: "pesticide", label: "Pesticide history", render: v => esc(shortLabel(v)) }, { key: "irs", label: "IRS history", render: v => esc(shortLabel(v)) },
    ], schools.map(s => { const a = s.G.answers; return { school: s.name, district: s.district, inside: a.within_breeding_site, inside_t: a.within_active_passive, outside: a.outside_breeding_site, outside_t: a.outside_active_passive, distance: isNum(a.outside_site_proximity) ? a.outside_site_proximity : null, containers: a.open_containers, drainage: a.functional_drainage_sys, drain_end: a.drainage_channel_end ?? null, pesticide: a.history_pesticide_use ?? null, irs: a.irs_history ?? null }; }), { sortKey: "school" });
  }
  PAGES.prevention = { title: "Mosquito prevention", render, filters: true };
})();
