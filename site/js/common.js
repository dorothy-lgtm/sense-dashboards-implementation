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

/* ---------------------------------------------------------------- descriptive stats */
function describe(values) {
  const a = values.filter(isNum).sort((x, y) => x - y);
  if (!a.length) return null;
  const q = p => a[Math.min(a.length - 1, Math.max(0, Math.round(p * (a.length - 1))))];
  return { n: a.length, mean: mean(a), median: median(a), min: a[0], max: a[a.length - 1], p10: q(0.1), p90: q(0.9), total: sum(a) };
}
/** Tile showing an average with its range underneath: "median · min–max · p10–p90 · n" */
function rangeTile(label, values, { unit = "", note = "" } = {}) {
  const d = describe(values);
  if (!d) return tile(label, "—", note);
  return tile(label, `${num(Math.round(d.mean * 10) / 10)}${unit ? `<span class="unit">${unit}</span>` : ""}`,
    `median ${num(d.median)} · range ${num(d.min)}–${num(d.max)} · p10–p90 ${num(d.p10)}–${num(d.p90)}${note ? ` · ${note}` : ""}`);
}

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
  ["structures", "Structures"], ["planning", "Coverage planning"], ["nurse", "Nurse and testing"], ["practices", "Testing & prevention practices"], ["forms", "Form monitoring"],
];

/* ---------------------------------------------------------------- encrypted data + passphrase gate */
const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function deriveKey(pass, salt, iter) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
}
async function decryptBlob(blob, pass) {
  const key = await deriveKey(pass, b64(blob.salt), blob.iter);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(blob.iv) }, key, b64(blob.data));
  return JSON.parse(new TextDecoder().decode(plain));
}
function askPassphrase(message) {
  return new Promise(resolve => {
    $("main").insertAdjacentHTML("afterbegin", `<div class="gate" id="gate"><form class="card" id="gate-form">
      <h2 style="margin-top:0">Team access</h2><p class="sub">This dashboard contains school-level study data. Enter the SENSE team passphrase to open it.</p>
      ${message ? `<p class="stale">${esc(message)}</p>` : ""}
      <input type="password" id="gate-pw" autocomplete="current-password" placeholder="Passphrase" autofocus>
      <label class="meta" style="display:block;margin:8px 0"><input type="checkbox" id="gate-remember"> Remember on this device</label>
      <button type="submit">Open dashboard</button></form></div>`);
    $("#gate-form").onsubmit = e => { e.preventDefault(); const pw = $("#gate-pw").value, rem = $("#gate-remember").checked; $("#gate").remove(); resolve({ pw, rem }); };
  });
}
async function loadData() {
  // Encrypted files are the published form; plaintext only exists in local development.
  const enc = await fetch("data/summary.json.enc", { cache: "no-store" });
  if (!enc.ok) {
    const [s, r, m] = await Promise.all(["summary", "roster", "metrics"].map(f => fetch(`data/${f}.json`, { cache: "no-store" })));
    if (!s.ok) return false;
    SUMMARY = await s.json(); ROSTER = r.ok ? await r.json() : null; METRICS = m.ok ? await m.json() : null;
    return true;
  }
  const blobs = await Promise.all(["summary", "roster", "metrics"].map(async f => { const x = await fetch(`data/${f}.json.enc`, { cache: "no-store" }); return x.ok ? x.json() : null; }));
  let pw = null, remember = false, msg = "";
  try { pw = sessionStorage.getItem("sense_pw") || localStorage.getItem("sense_pw"); } catch (e) {}
  for (let attempt = 0; attempt < 5; attempt++) {
    if (!pw) { const a = await askPassphrase(msg); pw = a.pw; remember = a.rem; }
    try {
      [SUMMARY, ROSTER, METRICS] = await Promise.all(blobs.map(b => b ? decryptBlob(b, pw) : null));
      try { sessionStorage.setItem("sense_pw", pw); if (remember) localStorage.setItem("sense_pw", pw); } catch (e) {}
      return true;
    } catch (e) {
      try { sessionStorage.removeItem("sense_pw"); localStorage.removeItem("sense_pw"); } catch (x) {}
      pw = null; msg = "That passphrase did not unlock the data. Try again.";
    }
  }
  return false;
}
function lockDashboard() {
  try { sessionStorage.removeItem("sense_pw"); localStorage.removeItem("sense_pw"); } catch (e) {}
  location.reload();
}

async function load() {
  $("#nav").innerHTML = NAV.map(([k, t]) => `<a href="#${k}" data-page="${k}" ${PAGES[k] ? "" : 'class="soon" title="coming soon"'}>${t}</a>`).join("");
  $$("#nav a").forEach(a => a.onclick = e => { e.preventDefault(); if (PAGES[a.dataset.page]) showPage(a.dataset.page); });
  $("main").insertAdjacentHTML("beforeend", NAV.map(([k]) => `<section class="page" id="page-${k}" hidden></section>`).join(""));

  const ok = await loadData();
  if (!ok) { $("#freshness").textContent = "No data published yet."; $("#crumbs").innerHTML = `<p class="empty">No data is published. If the pipeline has run, the SITE_PASSPHRASE secret may not be set yet (see README).</p>`; return; }
  $("#lock").hidden = false;
  const pulled = new Date(SUMMARY.pulled_at || SUMMARY.generated_at);
  const ageH = (Date.now() - pulled) / 36e5;
  $("#freshness").innerHTML = `Data pulled ${fmtDT(pulled.toISOString())} EAT` + (ageH > 6 ? ` <span class="stale">(${Math.round(ageH)} h old)</span>` : "");
  const [page, arg] = location.hash.slice(1).split("/");
  showPage(page || "recruit", arg);
  window.addEventListener("hashchange", () => { const [p, a] = location.hash.slice(1).split("/"); if (p !== currentPage) showPage(p, a); });
}
document.addEventListener("DOMContentLoaded", () => load().catch(e => { $("#freshness").textContent = "Could not load data: " + e; console.error(e); }));
