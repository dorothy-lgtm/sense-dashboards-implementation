// Coverage planning: space to be covered by spatial emanators / IRS, built from per-school averages
// of the Annex G structure survey and scaled to a chosen number of schools (one arm = 55 of 165).
(function () {
  const REPEAT = "Classrooms_dormitories_grp";
  const DEF = { schools: 55, basis: "mean", dorms: true, classes: true, scaleClasses: true, surfaces: "walls_ceiling", m2PerEmanator: "", m2PerBottle: 250, maxH: 6, maxLW: 60 };
  let P = { ...DEF };
  try { Object.assign(P, JSON.parse(localStorage.getItem("sense_plan") || "{}")); } catch (e) {}
  const save = () => { try { localStorage.setItem("sense_plan", JSON.stringify(P)); } catch (e) {} };
  const isDorm = r => /dorm/i.test(String(r.structure_category ?? ""));
  const isClass = r => /class/i.test(String(r.structure_category ?? ""));
  const fmt0 = v => isNum(v) ? Math.round(v).toLocaleString("en-GB") : "—";

  /** Per-school space, from surveyed structures (plausibility-filtered), optionally scaling classrooms to reported totals. */
  function schoolSpace(s) {
    const rs = s.G?.repeats?.[REPEAT] || [];
    const ok = [], bad = [];
    rs.forEach(r => {
      const L = r.structure_length, W = r.structure_width, H = r.structure_height;
      if (!isNum(L) || !isNum(W) || !isNum(H)) return;
      (L > 0 && W > 0 && H > 0 && H <= P.maxH && L <= P.maxLW && W <= P.maxLW ? ok : bad).push({ r, L, W, H, floor: L * W, wall: 2 * (L + W) * H, vol: L * W * H, beds: isNum(r.dormitory_capacity) ? r.dormitory_capacity : null });
    });
    const dorms = ok.filter(x => isDorm(x.r)), classes = ok.filter(x => isClass(x.r)), other = ok.filter(x => !isDorm(x.r) && !isClass(x.r));
    const agg = xs => ({ n: xs.length, floor: sum(xs.map(x => x.floor)), wall: sum(xs.map(x => x.wall)), vol: sum(xs.map(x => x.vol)), beds: sum(xs.map(x => x.beds || 0)) });
    const d = agg(dorms), c = agg(classes), o = agg(other);
    // classrooms are only sampled in the survey: scale to the school's reported classroom count
    const repClasses = s.G?.answers?.total_classrooms, repDorms = s.G?.answers?.total_dormitories;
    let cs = { ...c, scaled: false };
    if (P.scaleClasses && isNum(repClasses) && c.n > 0 && repClasses > c.n) {
      const k = repClasses / c.n; cs = { n: repClasses, floor: c.floor * k, wall: c.wall * k, vol: c.vol * k, beds: 0, scaled: true };
    }
    return { code: s.code, name: s.name, district: s.district, surveyed: ok.length, excluded: bad.length, dorms: d, classes: cs, classesSurveyed: c, other: o, repClasses, repDorms };
  }
  function totalsFor(sp) {
    const parts = [P.dorms ? sp.dorms : null, P.classes ? sp.classes : null].filter(Boolean);
    const t = { n: sum(parts.map(p => p.n)), floor: sum(parts.map(p => p.floor)), wall: sum(parts.map(p => p.wall)), vol: sum(parts.map(p => p.vol)), beds: sum(parts.map(p => p.beds)) };
    t.irs = P.surfaces === "walls" ? t.wall : t.wall + t.floor;   // ceilings ≈ floor area
    return t;
  }
  const stat = (arr, k) => P.basis === "median" ? median(arr.map(a => a[k])) : mean(arr.map(a => a[k]));

  function render() {
    pageHeader("Coverage planning", filterSummary());
    const el = $("#page-planning");
    const schools = filteredSchools().filter(s => (s.G?.repeats?.[REPEAT] || []).length);
    const sps = schools.map(schoolSpace).filter(sp => sp.surveyed > 0);
    const tots = sps.map(totalsFor);
    const N = Math.max(1, Number(P.schools) || DEF.schools);
    const per = k => stat(tots, k);
    const total = k => isNum(per(k)) ? per(k) * N : null;
    const emanators = Number(P.m2PerEmanator) > 0 && isNum(total("floor")) ? total("floor") / Number(P.m2PerEmanator) : null;
    const bottles = Number(P.m2PerBottle) > 0 && isNum(total("irs")) ? total("irs") / Number(P.m2PerBottle) : null;
    const excluded = sum(sps.map(sp => sp.excluded)), surveyed = sum(sps.map(sp => sp.surveyed));
    const sd = k => { const a = tots.map(t => t[k]); const m = mean(a); return a.length > 1 ? Math.sqrt(sum(a.map(x => (x - m) ** 2)) / (a.length - 1)) : 0; };
    const ci = k => { if (!isNum(per(k)) || tots.length < 2) return ""; const se = sd(k) / Math.sqrt(tots.length); return `±${fmt0(1.96 * se * N)} (95% CI of the mean × ${N})`; };
    const chk = (id, label, on) => `<label><input type="checkbox" id="${id}" ${on ? "checked" : ""}> ${label}</label>`;

    el.innerHTML = `
      <div class="card" style="margin-bottom:12px"><h3>Assumptions <span class="sub">Averages are taken over the ${num(sps.length)} schools in the current selection that have a structure survey; totals = per-school ${P.basis} × number of schools</span></h3>
        <div class="plan-form">
          <label>Schools to cover <input type="number" id="pl-schools" min="1" max="200" value="${N}"></label>
          <label>Per-school basis <select id="pl-basis"><option value="mean" ${P.basis === "mean" ? "selected" : ""}>Mean</option><option value="median" ${P.basis === "median" ? "selected" : ""}>Median</option></select></label>
          ${chk("pl-dorms", "Dormitories", P.dorms)} ${chk("pl-classes", "Classrooms", P.classes)}
          ${chk("pl-scale", "Scale classrooms to each school's reported classroom count (survey samples classrooms)", P.scaleClasses)}
          <label>IRS surfaces <select id="pl-surfaces"><option value="walls_ceiling" ${P.surfaces === "walls_ceiling" ? "selected" : ""}>Walls + ceilings</option><option value="walls" ${P.surfaces === "walls" ? "selected" : ""}>Walls only</option></select></label>
          <label>m² per emanator unit <input type="number" id="pl-eman" min="1" step="1" placeholder="e.g. 20" value="${P.m2PerEmanator}"></label>
          <label>m² per IRS bottle / sachet <input type="number" id="pl-bottle" min="1" step="1" value="${P.m2PerBottle}"></label>
          <button type="button" id="pl-reset">Defaults</button>
        </div>
        <p class="meta">Floor = length × width; walls = 2 × (length + width) × height (gross interior wall, doors and windows not deducted); ceiling taken equal to floor; volume = floor × height. Structures with height &gt; ${P.maxH} m or any side &gt; ${P.maxLW} m are excluded as implausible (${num(excluded)} of ${num(surveyed + excluded)} records).</p>
      </div>
      <div class="tiles">
        ${tile(`Floor area · ${N} schools`, `${fmt0(total("floor"))}<span class="unit">m²</span>`, `${fmt0(per("floor"))} m² per school · ${ci("floor")}`)}
        ${tile(`Wall area · ${N} schools`, `${fmt0(total("wall"))}<span class="unit">m²</span>`, `${fmt0(per("wall"))} m² per school · ${ci("wall")}`)}
        ${tile(`IRS sprayable · ${N} schools`, `${fmt0(total("irs"))}<span class="unit">m²</span>`, `${P.surfaces === "walls" ? "walls only" : "walls + ceilings"} · ${fmt0(per("irs"))} m² per school`)}
        ${tile(`Volume · ${N} schools`, `${fmt0(total("vol"))}<span class="unit">m³</span>`, `${fmt0(per("vol"))} m³ per school`)}
        ${tile(`Structures · ${N} schools`, fmt0(total("n")), `${num(per("n"))} per school${P.dorms ? ` · ${fmt0(total("beds"))} beds` : ""}`)}
        ${tile("Emanator units", emanators !== null ? fmt0(emanators) : "—", emanators !== null ? `at ${num(Number(P.m2PerEmanator))} m² per unit (floor area)` : "set m² per unit above")}
        ${tile("IRS bottles / sachets", bottles !== null ? fmt0(bottles) : "—", bottles !== null ? `at ${num(Number(P.m2PerBottle))} m² each` : "set m² per bottle above")}
      </div>
      <div class="grid-2" style="margin-top:12px">
        <div class="card"><h3>Per-school averages by structure type <span class="sub">${P.basis} over ${num(sps.length)} schools; "reported" = school-level counts from Annex G, "surveyed" = structures measured individually</span></h3>
          ${table([{t:"Type"},{t:"Surveyed / school",num:true},{t:"Reported / school",num:true},{t:"Floor m² / structure",num:true},{t:"Floor m² / school",num:true},{t:"Wall m² / school",num:true},{t:"Volume m³ / school",num:true}], [
            ["Dormitories", num(stat(sps.map(sp => sp.dorms), "n")), num(stat(sps.filter(sp => isNum(sp.repDorms)).map(sp => ({ v: sp.repDorms })), "v")), fmt0(mean(sps.flatMap(sp => sp.dorms.n ? [sp.dorms.floor / sp.dorms.n] : []))), fmt0(stat(sps.map(sp => sp.dorms), "floor")), fmt0(stat(sps.map(sp => sp.dorms), "wall")), fmt0(stat(sps.map(sp => sp.dorms), "vol"))],
            [`Classrooms${P.scaleClasses ? " (scaled)" : ""}`, num(stat(sps.map(sp => sp.classesSurveyed), "n")), num(stat(sps.filter(sp => isNum(sp.repClasses)).map(sp => ({ v: sp.repClasses })), "v")), fmt0(mean(sps.flatMap(sp => sp.classesSurveyed.n ? [sp.classesSurveyed.floor / sp.classesSurveyed.n] : []))), fmt0(stat(sps.map(sp => sp.classes), "floor")), fmt0(stat(sps.map(sp => sp.classes), "wall")), fmt0(stat(sps.map(sp => sp.classes), "vol"))],
          ])}
          <p class="meta">Sum of surveyed floor area across the selection: dormitories ${fmt0(sum(sps.map(sp => sp.dorms.floor)))} m², classrooms ${fmt0(sum(sps.map(sp => sp.classesSurveyed.floor)))} m² (${fmt0(sum(sps.map(sp => sp.classes.floor)))} m² after scaling).</p></div>
        <div class="card"><h3>Per-school space by district <span class="sub">Mean per school in each district, using the current type selection · arms are cluster-randomised, so district mix drives the total — use the district filter to price a specific set</span></h3>
          <div class="scroll" id="pl-district"></div></div>
      </div>
      <div class="card" style="margin-top:12px"><h3>Schools <span class="sub">Per-school space with the current type selection · click a heading to sort</span></h3><div class="scroll" id="pl-schools-table"></div></div>`;

    // wiring
    const re = () => { save(); render(); };
    $("#pl-schools").onchange = e => { P.schools = Math.max(1, Number(e.target.value) || DEF.schools); re(); };
    $("#pl-basis").onchange = e => { P.basis = e.target.value; re(); };
    $("#pl-dorms").onchange = e => { P.dorms = e.target.checked; re(); };
    $("#pl-classes").onchange = e => { P.classes = e.target.checked; re(); };
    $("#pl-scale").onchange = e => { P.scaleClasses = e.target.checked; re(); };
    $("#pl-surfaces").onchange = e => { P.surfaces = e.target.value; re(); };
    $("#pl-eman").onchange = e => { P.m2PerEmanator = e.target.value; re(); };
    $("#pl-bottle").onchange = e => { P.m2PerBottle = e.target.value; re(); };
    $("#pl-reset").onclick = () => { P = { ...DEF }; re(); };

    const byD = byDistrict(sps).map(([d, ss]) => { const ts = ss.map(totalsFor); return { district: d, schools: ss.length, floor: mean(ts.map(t => t.floor)), wall: mean(ts.map(t => t.wall)), irs: mean(ts.map(t => t.irs)), vol: mean(ts.map(t => t.vol)), n: mean(ts.map(t => t.n)) }; });
    sortableTable($("#pl-district"), [
      { key: "district", label: "District" }, { key: "schools", label: "Schools surveyed", num: true }, { key: "n", label: "Structures", num: true, render: v => num(Math.round(v * 10) / 10) },
      { key: "floor", label: "Floor m²", num: true, render: fmt0 }, { key: "wall", label: "Wall m²", num: true, render: fmt0 }, { key: "irs", label: "IRS m²", num: true, render: fmt0 }, { key: "vol", label: "Volume m³", num: true, render: fmt0 },
    ], byD, { sortKey: "floor", dir: -1 });
    sortableTable($("#pl-schools-table"), [
      { key: "name", label: "School" }, { key: "district", label: "District" }, { key: "n", label: "Structures", num: true },
      { key: "floor", label: "Floor m²", num: true, render: fmt0 }, { key: "wall", label: "Wall m²", num: true, render: fmt0 }, { key: "irs", label: "IRS m²", num: true, render: fmt0 }, { key: "vol", label: "Volume m³", num: true, render: fmt0 },
      { key: "beds", label: "Beds", num: true }, { key: "excluded", label: "Excluded records", num: true },
    ], sps.map((sp, i) => ({ name: sp.name, district: sp.district, n: tots[i].n, floor: tots[i].floor, wall: tots[i].wall, irs: tots[i].irs, vol: tots[i].vol, beds: tots[i].beds, excluded: sp.excluded })), { sortKey: "floor", dir: -1 });
  }
  PAGES.planning = { title: "Coverage planning", render, filters: true };
})();
