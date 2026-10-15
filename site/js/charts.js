// Small SVG chart primitives: donut, line, grouped bars. Plain functions returning HTML.
const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)", "var(--series-6)", "var(--series-7)", "var(--series-8)"];
const pct = (n, d) => d ? Math.round(100 * n / d) + "%" : "—";

/** Donut: items = [{label, value}], centre label. Slices in fixed series order; >7 fold into Other. */
function donut(items, { centre = "", unit = "records", maxSlices = 7 } = {}) {
  let data = items.filter(i => i.value > 0).sort((a, b) => b.value - a.value);
  if (data.length > maxSlices) {
    const rest = data.slice(maxSlices - 1);
    data = data.slice(0, maxSlices - 1).concat([{ label: "Other", value: sum(rest.map(r => r.value)) }]);
  }
  const total = sum(data.map(d => d.value));
  if (!total) return `<p class="empty">No data</p>`;
  const R = 60, r = 38, cx = 75, cy = 75;
  let a0 = -Math.PI / 2, paths = "";
  data.forEach((d, i) => {
    const a1 = a0 + 2 * Math.PI * d.value / total;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (ang, rad) => `${cx + rad * Math.cos(ang)} ${cy + rad * Math.sin(ang)}`;
    paths += `<path d="M ${p(a0, R)} A ${R} ${R} 0 ${large} 1 ${p(a1, R)} L ${p(a1, r)} A ${r} ${r} 0 ${large} 0 ${p(a0, r)} Z" fill="${SERIES[i % SERIES.length]}" stroke="var(--surface)" stroke-width="2"><title>${esc(d.label)}: ${num(d.value)} (${pct(d.value, total)})</title></path>`;
    a0 = a1;
  });
  return `<div class="donut"><svg viewBox="0 0 150 150" width="150" height="150" role="img" aria-label="${esc(centre || "donut")}">${paths}
      <text x="75" y="72" text-anchor="middle" class="centre" style="font-size:20px;font-weight:600;fill:var(--ink)">${num(centre || total)}</text>
      <text x="75" y="90" text-anchor="middle">${esc(unit)}</text></svg>
    <div class="dlegend">${data.map((d, i) => `<div><span class="sw" style="background:${SERIES[i % SERIES.length]}"></span><span>${esc(d.label)}</span><span class="meta">${pct(d.value, total)}</span></div>`).join("")}</div></div>`;
}

/** Line chart: categories (x labels), series = [{name, values}] */
function lineChart(categories, series, { height = 220, fmt = num } = {}) {
  const W = 640, H = height, padL = 44, padR = 24, padT = 18, padB = 30;
  const all = series.flatMap(s => s.values).filter(isNum);
  if (!all.length || !categories.length) return `<p class="empty">No data</p>`;
  const max = Math.max(1, ...all) * 1.08;
  const x = i => categories.length === 1 ? (padL + (W - padL - padR) / 2) : padL + i * (W - padL - padR) / (categories.length - 1);
  const y = v => padT + (H - padT - padB) * (1 - v / max);
  const ticks = [0, max / 2, max].map(v => Math.round(v));
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img">`;
  ticks.forEach(t => { svg += `<line x1="${padL}" x2="${W - padR}" y1="${y(t)}" y2="${y(t)}" stroke="var(--grid)"/><text x="${padL - 6}" y="${y(t) + 4}" text-anchor="end">${num(t)}</text>`; });
  categories.forEach((c, i) => { svg += `<text x="${x(i)}" y="${H - 8}" text-anchor="${categories.length > 1 && i === 0 ? "start" : categories.length > 1 && i === categories.length - 1 ? "end" : "middle"}" style="font-size:12px">${esc(c)}</text>`; });
  series.forEach((s, si) => {
    const pts = s.values.map((v, i) => isNum(v) ? `${x(i)},${y(v)}` : null).filter(Boolean);
    svg += `<polyline points="${pts.join(" ")}" fill="none" stroke="${SERIES[si]}" stroke-width="2"/>`;
    s.values.forEach((v, i) => { if (isNum(v)) svg += `<circle cx="${x(i)}" cy="${y(v)}" r="4" fill="${SERIES[si]}" stroke="var(--surface)" stroke-width="2"><title>${esc(s.name)} · ${esc(categories[i])}: ${fmt(v)}</title></circle><text x="${x(i)}" y="${y(v) - 9}" text-anchor="middle" style="fill:var(--ink-2)">${fmt(v)}</text>`; });
  });
  svg += `</svg>`;
  return `<div class="legend">${series.map((s, i) => `<span class="dot" style="background:${SERIES[i]}"></span> ${esc(s.name)} &nbsp;`).join("")}</div>${svg}`;
}

/** Grouped bars: categories (x labels), series = [{name, values}] */
function groupedBars(categories, series, { height = 220, fmt = num } = {}) {
  const W = 640, H = height, padL = 44, padR = 16, padT = 14, padB = 30;
  const all = series.flatMap(s => s.values).filter(isNum);
  if (!all.length || !categories.length) return `<p class="empty">No data</p>`;
  const max = Math.max(1, ...all) * 1.08;
  const gw = (W - padL - padR) / categories.length, bw = Math.min(40, (gw * 0.7) / series.length);
  const y = v => padT + (H - padT - padB) * (1 - v / max);
  const ticks = [0, max / 2, max].map(v => Math.round(v));
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img">`;
  ticks.forEach(t => { svg += `<line x1="${padL}" x2="${W - padR}" y1="${y(t)}" y2="${y(t)}" stroke="var(--grid)"/><text x="${padL - 6}" y="${y(t) + 4}" text-anchor="end">${num(t)}</text>`; });
  categories.forEach((c, i) => {
    const gx = padL + i * gw + (gw - bw * series.length - 2 * (series.length - 1)) / 2;
    series.forEach((s, si) => {
      const v = s.values[i]; if (!isNum(v)) return;
      const bx = gx + si * (bw + 2);
      svg += `<rect x="${bx}" y="${y(v)}" width="${bw}" height="${Math.max(0, y(0) - y(v))}" rx="3" fill="${SERIES[si]}"><title>${esc(s.name)} · ${esc(c)}: ${fmt(v)}</title></rect><text x="${bx + bw / 2}" y="${y(v) - 5}" text-anchor="middle" style="fill:var(--ink-2)">${fmt(v)}</text>`;
    });
    svg += `<text x="${padL + i * gw + gw / 2}" y="${H - 8}" text-anchor="middle" style="font-size:12px">${esc(c)}</text>`;
  });
  svg += `<line x1="${padL}" x2="${W - padR}" y1="${y(0)}" y2="${y(0)}" stroke="var(--axis)"/></svg>`;
  return `<div class="legend">${series.map((s, i) => `<span class="dot" style="background:${SERIES[i]}"></span> ${esc(s.name)} &nbsp;`).join("")}</div>${svg}`;
}

/** Kobo choice labels are often long upper-case sentences: "NONE, OR VERY FEW — ALMOST NO ... (0-10%)".
 *  Keep the part before the dash plus any "(…%)" range, in sentence case. */
function shortLabel(v) {
  if (v === null || v === undefined) return "—";
  let s = String(v).trim();
  const range = (s.match(/\((\d[^()]*%[^()]*)\)/) || [])[1];
  s = s.split(/\s[—–-]\s|—/)[0].trim();
  if (s.length > 60) s = s.slice(0, 57) + "…";
  const isUpper = s === s.toUpperCase() && /[A-Z]/.test(s);
  if (isUpper) s = s.charAt(0) + s.slice(1).toLowerCase();
  s = s.replace(/\b(rdt|act|irs|pf|pv|hrp2|pldh|mou|id)\b/gi, m => m.toUpperCase()).replace(/\bp\.f\b/gi, "P.f").replace(/\bpan\b/gi, "Pan");
  return range && !s.includes("%") ? `${s} (${range})` : s;
}
/** 100% stacked horizontal bars. rows = [{label, counts:[...], note?}], bands = [{label, color}] */
function stackedBars(rows, bands) {
  if (!rows.length) return `<p class="empty">No data</p>`;
  return `<div class="legend">${bands.map(b => `<span class="dot" style="background:${b.color}"></span> ${esc(b.label)} &nbsp;`).join("")}</div>
    <div class="barlist">${rows.map(r => { const t = sum(r.counts) || 1; return `<div class="barrow"><div class="barlabel" title="${esc(r.label)}">${esc(r.label)}</div>
      <div class="track" style="display:flex;overflow:hidden">${r.counts.map((n, i) => n ? `<div style="width:${100 * n / t}%;background:${bands[i].color};border-radius:0"><title>${esc(bands[i].label)}: ${n} (${pct(n, t)})</title></div>` : "").join("")}</div>
      <div class="barval">${r.note ?? ""}</div></div>`; }).join("")}</div>`;
}
/** Distribution of a categorical answer across records → [{label, value}] sorted desc.
 *  Values are grouped case-insensitively and shown with shortLabel(). */
function distribution(records, key) {
  const c = new Map();
  records.forEach(r => {
    const v = r?.[key];
    if (v === undefined || v === null || v === "") return;
    (Array.isArray(v) ? v : [v]).forEach(x => { const k = String(x).trim().toUpperCase(); c.set(k, (c.get(k) || 0) + 1); });
  });
  return [...c].map(([k, value]) => ({ label: shortLabel(k), value })).sort((a, b) => b.value - a.value);
}
/** Toggle button group; onChange(key). Returns the container element's HTML and wires after insert via wireToggles. */
function toggles(id, options, active) {
  return `<div class="toggles" id="${id}">${options.map(o => `<button type="button" data-k="${esc(o.key)}" aria-pressed="${o.key === active}">${esc(o.label)}</button>`).join("")}</div>`;
}
function wireToggles(id, onChange) {
  $$(`#${id} button`).forEach(b => b.onclick = () => { $$(`#${id} button`).forEach(x => x.setAttribute("aria-pressed", x === b)); onChange(b.dataset.k); });
}
function byDistrict(schools) {
  const m = new Map();
  schools.forEach(s => { const d = s.district || "(no district)"; if (!m.has(d)) m.set(d, []); m.get(d).push(s); });
  return [...m].sort((a, b) => a[0].localeCompare(b[0]));
}
function pageHeader(title, subtitle) {
  $("#page-title").textContent = title;
  $("#crumbs").innerHTML = subtitle || "";
}
