// District map of Uganda (site/geo/uganda_districts.json: 2020 district boundaries, geoBoundaries CC0).
// Draws an inline SVG choropleth of the study districts and, optionally, one dot per recruited school
// placed at a stable pseudo-random position INSIDE its district — a representative cluster, not the
// school's real location (GPS points are never published).
let GEO = null;
async function loadGeo() {
  if (GEO) return GEO;
  try { const r = await fetch("geo/uganda_districts.json", { cache: "force-cache" }); if (r.ok) GEO = await r.json(); } catch (e) { console.warn("geo", e); }
  return GEO;
}
const GEO_ALIAS = { "GULU CITY": "Gulu", "LIRA CITY": "Lira", "JINJA CITY": "Jinja", "ARUA CITY": "Arua", "FORT PORTAL CITY": "Kabarole", "MBARARA CITY": "Mbarara", "MBALE CITY": "Mbale", "SOROTI CITY": "Soroti", "HOIMA CITY": "Hoima", "MASAKA CITY": "Masaka" };
const geoKey = s => String(s || "").toUpperCase().replace(/\s+DISTRICT$/, "").trim();
function geoFeature(district) {
  if (!GEO) return null;
  const k = geoKey(district);
  const alias = GEO_ALIAS[k];
  return GEO.districts.find(d => geoKey(d.name) === k) || (alias ? GEO.districts.find(d => geoKey(d.name) === geoKey(alias)) : null) || null;
}
/* equirectangular projection; Uganda straddles the equator so no latitude correction is needed */
const MAP = { W: 620, H: 560, lon0: 29.5, lon1: 35.05, lat0: -1.55, lat1: 4.3 };
const px = lon => (lon - MAP.lon0) / (MAP.lon1 - MAP.lon0) * MAP.W;
const py = lat => (MAP.lat1 - lat) / (MAP.lat1 - MAP.lat0) * MAP.H;
const ringPath = ring => "M" + ring.map(p => `${px(p[0]).toFixed(1)},${py(p[1]).toFixed(1)}`).join("L") + "Z";
function inRing(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
/* deterministic positions: seeded by the school code so dots do not jump between refreshes */
function seeded(str) { let h = 2166136261; for (const c of str) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; }; }
function pointInside(feature, seed) {
  const ring = feature.rings.reduce((a, r) => r.length > a.length ? r : a, []);
  const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const rnd = seeded(seed);
  for (let i = 0; i < 60; i++) {
    // bias towards the interior: average two uniform draws, then nudge towards the label point
    const x = x0 + (x1 - x0) * (0.5 * (rnd() + rnd())), y = y0 + (y1 - y0) * (0.5 * (rnd() + rnd()));
    const xx = x + (feature.c[0] - x) * 0.25, yy = y + (feature.c[1] - y) * 0.25;
    if (inRing(ring, xx, yy)) return [xx, yy];
  }
  return feature.c;
}
/**
 * districtMap(items, opts) → SVG string.
 * items = [{district, fill, stroke?, label, title, dim?}]; opts.dots = [{district, code, title, color}]
 */
function districtMap(items, { dots = [], legend = "", showLabels = true } = {}) {
  if (!GEO) return `<p class="empty">District boundaries not loaded.</p>`;
  const byKey = new Map(items.map(i => [geoKey(i.district), i]));
  const used = new Set();
  let base = "", study = "", labels = "", dotsSvg = "";
  GEO.districts.forEach(d => {
    const path = d.rings.map(ringPath).join(" ");
    base += `<path d="${path}" fill="var(--map-base)" stroke="var(--map-line)" stroke-width="0.6"><title>${esc(d.name)}</title></path>`;
  });
  items.forEach(it => {
    const f = geoFeature(it.district);
    if (!f) return;
    used.add(it.district);
    const path = f.rings.map(ringPath).join(" ");
    study += `<path class="dist" data-d="${esc(it.district)}" d="${path}" fill="${it.fill}" stroke="${it.stroke || "var(--map-line-strong)"}" stroke-width="${it.stroke ? 1.6 : 0.9}" opacity="${it.dim ? 0.35 : 1}" style="cursor:pointer"><title>${esc(it.title || it.district)}</title></path>`;
    if (showLabels && it.label !== false) labels += `<text x="${px(f.c[0]).toFixed(1)}" y="${py(f.c[1]).toFixed(1)}" text-anchor="middle" class="maplabel" opacity="${it.dim ? 0.4 : 1}">${esc(it.label ?? titleCase(it.district))}</text>`;
  });
  dots.forEach(s => {
    const f = geoFeature(s.district);
    if (!f) return;
    const [x, y] = pointInside(f, s.code || s.title || "x");
    dotsSvg += `<circle cx="${px(x).toFixed(1)}" cy="${py(y).toFixed(1)}" r="3.2" fill="${s.color || "var(--series-1)"}" stroke="var(--surface)" stroke-width="1"><title>${esc(s.title || "")}</title></circle>`;
  });
  const missing = items.filter(i => !used.has(i.district)).map(i => i.district);
  return `<svg viewBox="0 0 ${MAP.W} ${MAP.H}" width="100%" style="max-height:620px" role="img" aria-label="Map of study districts">
      <g>${base}</g><g>${study}</g><g>${dotsSvg}</g><g>${labels}</g></svg>
    ${legend ? `<div class="legend">${legend}</div>` : ""}
    ${missing.length ? `<p class="meta">Not on the boundary layer: ${missing.map(esc).join(", ")}</p>` : ""}`;
}
