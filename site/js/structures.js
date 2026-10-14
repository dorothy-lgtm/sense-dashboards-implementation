// Structures (Annex G repeat group — one record per building): materials, eaves, screens, nets, windows.
(function () {
  const REPEAT = "Classrooms_dormitories_grp";
  const isDorm = r => /dorm/i.test(String(r.structure_category ?? ""));
  const isClass = r => /class/i.test(String(r.structure_category ?? ""));
  const screened = r => /all|some|yes|partial/i.test(String(r.screened_windows ?? "")) && !/none|no\b/i.test(String(r.screened_windows ?? ""));
  const netsHung = r => { const s = String(r.bednets_hung ?? "").toLowerCase(); return s && !/none|^no\b|0-10|very few/.test(s); };
  const windowsClosed = r => yes(r.windows_closed);
  const eaves = r => yes(r.presence_open_eaves);

  function render() {
    pageHeader("Structures", filterSummary());
    const el = $("#page-structures");
    const schools = filteredSchools().filter(s => s.G);
    const recs = schools.flatMap(s => (s.G.repeats?.[REPEAT] || []).map(r => ({ ...r, _school: s })));
    const dorms = recs.filter(isDorm), classes = recs.filter(isClass);
    const cap = dorms.map(r => r.dormitory_capacity).filter(isNum);
    const share = (rows, t) => rows.length ? pct(rows.filter(t).length, rows.length) : "—";
    if (!recs.length) {
      el.innerHTML = `<p class="empty">No individual structure records in this selection (Annex G repeat group "${REPEAT}").</p>`;
      return;
    }
    const distRows = byDistrict(schools).map(([d, ss]) => {
      const rs = ss.flatMap(s => s.G.repeats?.[REPEAT] || []), ds = rs.filter(isDorm);
      return { district: d, structures: rs.length, eaves: rs.length ? 100 * rs.filter(eaves).length / rs.length : null, screened: rs.length ? 100 * rs.filter(screened).length / rs.length : null,
               nets: ds.length ? 100 * ds.filter(netsHung).length / ds.length : null, closed: ds.length ? 100 * ds.filter(windowsClosed).length / ds.length : null };
    });
    el.innerHTML = `
      <div class="tiles">
        ${tile("Dormitories", num(dorms.length), "individually surveyed")}
        ${tile("Classrooms", num(classes.length), "individually surveyed")}
        ${tile("Avg dorm capacity", num(mean(cap)), "beds per dormitory")}
        ${tile("Open eaves", share(recs, eaves), "of structures")}
        ${tile("Screened windows", share(recs, screened), "all or some")}
        ${tile("Nets hung", share(dorms, netsHung), "of dormitories")}
        ${tile("Windows closed at night", share(dorms, windowsClosed), "of dormitories")}
      </div>
      <div class="three" style="margin-top:12px">
        <div class="card"><h3>Wall material <span class="sub">All structures</span></h3>${donut(distribution(recs, "wall_material"))}</div>
        <div class="card"><h3>Roof material <span class="sub">All structures</span></h3>${donut(distribution(recs, "roof_material"))}</div>
        <div class="card"><h3>Floor material <span class="sub">All structures</span></h3>${donut(distribution(recs, "floor_material"))}</div>
      </div>
      <div class="grid-2" style="margin-top:12px">
        <div class="card"><h3>Bed nets hung in dormitories <span class="sub">Share of beds with a net hung, by dormitory</span></h3>${barList(distribution(dorms, "bednets_hung"), { color: "var(--series-3)" })}
          ${distribution(dorms, "bednets_type").length ? `<h3 style="margin-top:14px">Net types</h3>${barList(distribution(dorms, "bednets_type"), { color: "var(--series-3)" })}` : ""}</div>
        <div class="card"><h3>Mosquito entry protection <span class="sub">Share of structures by district. Click a heading to sort</span></h3><div class="scroll" id="struct-district"></div></div>
      </div>
      <div class="grid-2" style="margin-top:12px">
        <div class="card"><h3>Structure categories</h3>${barList(distribution(recs, "structure_category"))}</div>
        <div class="card"><h3>Dormitory capacity <span class="sub">Beds per dormitory</span></h3>
          ${cap.length ? barList([["< 20", v => v < 20], ["20–39", v => v >= 20 && v < 40], ["40–59", v => v >= 40 && v < 60], ["60–99", v => v >= 60 && v < 100], ["100+", v => v >= 100]].map(([label, t]) => ({ label, value: cap.filter(t).length }))) : `<p class="empty">No capacity recorded</p>`}
          <p class="meta">Median ${num(median(cap))} beds · total capacity ${num(sum(cap))} beds across ${num(cap.length)} dormitories</p></div>
      </div>`;
    sortableTable($("#struct-district"), [
      { key: "district", label: "District" }, { key: "structures", label: "Structures", num: true },
      { key: "eaves", label: "Open eaves", num: true, render: v => isNum(v) ? Math.round(v) + "%" : "—" },
      { key: "screened", label: "Screened", num: true, render: v => isNum(v) ? Math.round(v) + "%" : "—" },
      { key: "nets", label: "Nets hung", num: true, render: v => isNum(v) ? Math.round(v) + "%" : "—" },
      { key: "closed", label: "Windows closed", num: true, render: v => isNum(v) ? Math.round(v) + "%" : "—" },
    ], distRows, { sortKey: "district" });
  }
  PAGES.structures = { title: "Structures", render, filters: true };
})();
