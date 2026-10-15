// Shared helpers, data loading, shell (sidebar + filters) and page registry.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const fmtDT = iso => iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Kampala", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
const fmtD = iso => iso ? new Date(iso + (iso.length === 10 ? "T00:00:00" : "")).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "—";
const num = v => (v === null || v === undefined || Number.isNaN(v)) ? "—" : (typeof v === "number" ? v.toLocaleString("en-GB", { maximumFractionDigits: 1 }) : v);
const titleCase = s => String(s ?? "").toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const sum = a => a.reduce((x, y) => x + (y || 0), 0);
const isNum = v => typeof v === "number" && !Number.isNaN(v);
const yes = v => { const s = String(v ?? "").trim().toLowerCase(); return /^(yes|all|some|present|partial)\b/.test(s) || s === "y"; };
const no = v => { const s = String(v ?? "").trim().toLowerCase(); return /^(no|none|absent)\b/.test(s) || s === "n"; };

let SUMMARY = null, ROSTER = null, METRICS = null;
const PAGES = {};                        // key → { title, render(arg), filters: bool }
const FILTER = { district: "", school: "", term: "" };   // shared filters for analytic pages

/* ---------------------------------------------------------------- tiles & tables */
function tile(label, value, note = "", small = false) {
  return `<div class="card tile"><div class="label">${label}</div><div class="value${small ? " small" : ""}">${value}</div><div class="note">${note}</div></div>`;
}
function flagTile(label, n, total, color, note) {
  const sev = n === 0 ? "var(--good)" : color;
  const pct = total ? ` <span class="meta">(${(100 * n / total).toFixed(1)}%)</span>` : "";
  return `<div class="card tile"><div class="label flag"><span class="dot" style="background:${sev}"></span>${label}</div><div class="value">${num(n)}${pct}</div><div class="note">${note}</div></div>`;
}
function table(headers, rows, empty = "Nothing to show", rowAttrs = () => "") {
  if (!rows.length) return `<p class="empty">${empty}</p>`;
  return `<table><thead><tr>${headers.map(h => `<th class="${h.num ? "num" : ""}">${h.t}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((r, i) => `<tr ${rowAttrs(r, i)}>${r.map((c, j) => `<td class="${headers[j].num ? "num" : ""}">${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}
/** Sortable table: columns = [{key, label, num, render?}], rows = objects. Click a header to sort. */
function sortableTable(el, columns, rows, opts = {}) {
  let sortKey = opts.sortKey || columns[0].key, dir = opts.dir || 1;
  const draw = () => {
    const sorted = [...rows].sort((a, b) => {
      const x = a[sortKey], y = b[sortKey];
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * dir;
    });
    el.innerHTML = `<table><thead><tr>${columns.map(c => `<th class="sortable ${c.num ? "num" : ""}" data-k="${c.key}">${c.label}${c.key === sortKey ? (dir > 0 ? " ↑" : " ↓") : ""}</th>`).join("")}</tr></thead>
      <tbody>${sorted.map(r => `<tr>${columns.map(c => `<td class="${c.num ? "num" : ""}">${c.render ? c.render(r[c.key], r) : (c.num ? num(r[c.key]) : esc(r[c.key] ?? "—"))}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    $$("th.sortable", el).forEach(th => th.onclick = () => { if (sortKey === th.dataset.k) dir = -dir; else { sortKey = th.dataset.k; dir = columns.find(c => c.key === sortKey).num ? -1 : 1; } draw(); });
  };
  draw();
}
/** Horizontal bar list: items = [{label, value, color?, note?}] */
function barList(items, { max = null, fmt = num, color = "var(--series-1)" } = {}) {
  const m = max ?? Math.max(1, ...items.map(i => i.value || 0));
  return `<div class="barlist">${items.map(i => `<div class="barrow"><div class="barlabel" title="${esc(i.label)}">${esc(i.label)}</div>
    <div class="track"><div style="width:${Math.max(0, Math.min(100, 100 * (i.value || 0) / m))}%;background:${i.color || color}"></div></div>
    <div class="barval">${fmt(i.value)}${i.note ? ` <span class="meta">${i.note}</span>` : ""}</div></div>`).join("")}</div>`;
}
function statusChip(label, kind) { return `<span class="chip ${kind}">${esc(label)}</span>`; }

/* ---------------------------------------------------------------- shared filters for analytic pages */
function filteredSchools() {
  return (METRICS?.schools || []).filter(s => (!FILTER.district || s.district === FILTER.district) && (!FILTER.school || s.code === FILTER.school));
}
function allTerms() {
  const t = new Set();
  (METRICS?.schools || []).forEach(s => (s.H?.repeats?.Enrollment_data_grp || []).forEach(r => { if (r.year || r.term) t.add(`${r.year ?? ""} ${r.term ?? ""}`.trim()); }));
  return [...t].sort();
}
/** Term rows for a school honouring the term filter; "" = all terms. */
function termRows(s) {
  const rows = s.H?.repeats?.Enrollment_data_grp || [];
  return FILTER.term ? rows.filter(r => `${r.year ?? ""} ${r.term ?? ""}`.trim() === FILTER.term) : rows;
}
/** Latest term row for a school (by year/term order) within the filter. */
function latestTerm(s) {
  const rows = termRows(s);
  return rows.length ? rows[rows.length - 1] : null;
}
function filterSummary() {
  const n = filteredSchools().length;
  return `${FILTER.district ? esc(FILTER.district) : "All districts"} | ${FILTER.school ? esc(METRICS.schools.find(s => s.code === FILTER.school)?.name || FILTER.school) : `${n} schools`} | ${FILTER.term ? esc(FILTER.term) : "All terms"}`;
}
function renderFilters() {
  const bar = $("#filters");
  const districts = [...new Set((METRICS?.schools || []).map(s => s.district).filter(Boolean))].sort();
  const schools = (METRICS?.schools || []).filter(s => !FILTER.district || s.district === FILTER.district);
  bar.innerHTML = `
    <label>District <select id="f-district"><option value="">All districts</option>${districts.map(d => `<option ${d === FILTER.district ? "selected" : ""}>${esc(d)}</option>`).join("")}</select></label>
    <label>School <select id="f-school"><option value="">All schools</option>${schools.map(s => `<option value="${esc(s.code)}" ${s.code === FILTER.school ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label>
    <label>Term <select id="f-term"><option value="">All terms</option>${allTerms().map(t => `<option ${t === FILTER.term ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>
    <button id="f-reset" type="button">Reset</button>`;
  $("#f-district").onchange = e => { FILTER.district = e.target.value; FILTER.school = ""; renderFilters(); rerender(); };
  $("#f-school").onchange = e => { FILTER.school = e.target.value; rerender(); };
  $("#f-term").onchange = e => { FILTER.term = e.target.value; rerender(); };
  $("#f-reset").onclick = () => { FILTER.district = FILTER.school = FILTER.term = ""; renderFilters(); rerender(); };
}

/* ---------------------------------------------------------------- shell */
let currentPage = null;
function setHash(page, arg) { history.replaceState(null, "", `#${page}${arg ? "/" + arg : ""}`); }
function showPage(key, arg) {
  if (!PAGES[key]) key = "recruit";
  currentPage = key;
  $$("#nav a").forEach(a => a.setAttribute("aria-current", a.dataset.page === key));
  $$("main section.page").forEach(s => s.hidden = s.id !== `page-${key}`);
  $("#filters").hidden = !PAGES[key].filters || !METRICS;
  if (PAGES[key].filters && METRICS) renderFilters();
  setHash(key, arg || "");
  PAGES[key].render(arg);
}
function rerender() { if (currentPage && PAGES[currentPage].filters) PAGES[currentPage].render(); }

const NAV = [
  ["recruit", "Recruitment"], ["retro", "Retrospective"], ["severe", "Severe cases"], ["infra", "Infrastructure"], ["prevention", "Mosquito prevention"],
  ["structures", "Structures"], ["nurse", "Nurse and testing"], ["practices", "Testing & prevention practices"], ["forms", "Form monitoring"],
];

async function load() {
  $("#nav").innerHTML = NAV.map(([k, t]) => `<a href="#${k}" data-page="${k}" ${PAGES[k] ? "" : 'class="soon" title="coming soon"'}>${t}</a>`).join("");
  $$("#nav a").forEach(a => a.onclick = e => { e.preventDefault(); if (PAGES[a.dataset.page]) showPage(a.dataset.page); });
  $("main").insertAdjacentHTML("beforeend", NAV.map(([k]) => `<section class="page" id="page-${k}" hidden></section>`).join(""));

  const [s, r, m] = await Promise.all(["summary", "roster", "metrics"].map(f => fetch(`data/${f}.json`, { cache: "no-store" })));
  if (!s.ok) { $("#freshness").textContent = "No data yet — the first scheduled run has not completed."; return; }
  SUMMARY = await s.json();
  ROSTER = r.ok ? await r.json() : null;
  METRICS = m.ok ? await m.json() : null;
  const pulled = new Date(SUMMARY.pulled_at || SUMMARY.generated_at);
  const ageH = (Date.now() - pulled) / 36e5;
  $("#freshness").innerHTML = `Data pulled ${fmtDT(pulled.toISOString())} EAT` + (ageH > 6 ? ` <span class="stale">(${Math.round(ageH)} h old)</span>` : "");
  const [page, arg] = location.hash.slice(1).split("/");
  showPage(page || "recruit", arg);
  window.addEventListener("hashchange", () => { const [p, a] = location.hash.slice(1).split("/"); if (p !== currentPage) showPage(p, a); });
}
document.addEventListener("DOMContentLoaded", () => load().catch(e => { $("#freshness").textContent = "Could not load data: " + e; console.error(e); }));
