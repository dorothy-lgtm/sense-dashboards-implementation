/* ------------------------------------------------------------ form monitoring view */
let currentForm = null;
function renderFormsOverview() {
  $("#page-forms").innerHTML = `<div class="overview" id="overview"></div><section id="detail"></section>`;
  $("#overview").innerHTML = SUMMARY.forms.map(f => {
    if (f.error) return `<div class="card" data-key="${f.key}"><div class="fname">${esc(f.name)}</div><div class="meta stale">${esc(f.error)}</div></div>`;
    const t = f.totals;
    return `<div class="card" data-key="${f.key}" tabindex="0"><div class="fname">${esc(f.name)}</div>
      <div class="big">${num(t.submissions)}</div>
      <div class="meta">${t.distinct_units !== null ? `${num(t.distinct_units)} distinct schools · ` : ""}+${t.last_24h} in 24 h · last ${fmtDT(t.last_submission)}</div></div>`;
  }).join("");
  $("#overview").querySelectorAll(".card").forEach(c => { c.onclick = () => selectForm(c.dataset.key); c.onkeydown = e => { if (e.key === "Enter" || e.key === " ") selectForm(c.dataset.key); }; });
}

function selectForm(key) {
  currentForm = key;
  setHash("forms", key);
  $("#overview").querySelectorAll(".card").forEach(c => c.setAttribute("aria-current", c.dataset.key === key));
  const f = SUMMARY.forms.find(x => x.key === key);
  $("#detail").innerHTML = f.error ? `<h2>${esc(f.name)}</h2><p class="stale">${esc(f.error)}</p>` : detailHTML(f);
  if (!f.error) drawDaily(f);
}

function detailHTML(f) {
  const t = f.totals, q = f.quality, d = f.duration_minutes, n = t.submissions;
  const groups = Object.entries(f.by_group).map(([g, rows]) => `<div class="card"><h3>By ${esc(g)} <span class="meta">(${esc(f.group_fields_found[g])})</span></h3>
      <div class="scroll">${table([{t:"Value"},{t:"Submissions",num:true}], rows.map(r => [esc(r.value), num(r.n)]))}</div></div>`).join("");
  const missing = f.group_fields_missing.length ? `<p class="meta">Not found in this form (edit <code>config/forms.yml</code>): ${f.group_fields_missing.map(esc).join(", ")}</p>` : "";
  const dupRows = q.duplicates.groups.map(g => [esc(Object.values(g.key).join(" / ")), num(g.n), g.ids.join(", ")]);
  return `
    <h2>${esc(f.name)} <span class="meta">Kobo: ${esc(f.kobo_name || "")} · ${f.deployment_active ? "deployed" : "<span class='stale'>not deployed</span>"}</span></h2>
    <div class="tiles">
      ${tile("Submissions", num(n), t.kobo_reported_count !== null && t.kobo_reported_count !== n ? `Kobo reports ${num(t.kobo_reported_count)}` : "all time")}
      ${t.distinct_units !== null ? tile("Distinct schools", num(t.distinct_units), `by ${esc(f.dedupe_fields.join(" + "))}`) : ""}
      ${tile("Last 24 h", num(t.last_24h), "")}
      ${tile("Last 7 days", num(t.last_7d), "")}
      ${tile("Median duration", d.median_min !== undefined ? `${d.median_min} min` : "—", d.n ? `p10 ${d.p10_min} · p90 ${d.p90_min}` : "no start/end times")}
      ${tile("First / last", `${fmtDT(t.first_submission)}<br>→ ${fmtDT(t.last_submission)}`, "", true)}
    </div>
    <h3>Submissions per day (EAT)</h3>
    <div class="card chart-wrap" id="daily"><div class="tip" id="tip"></div></div>
    <h3>Data quality</h3>
    <div class="tiles">
      ${f.dedupe_fields.length ? flagTile("Repeat submissions", q.duplicates.n, n, "var(--warning)", `extra records sharing ${f.dedupe_fields.join(" + ")}`) : ""}
      ${flagTile("Too fast", q.too_fast.n, n, "var(--serious)", `under ${q.too_fast.threshold_min} min`)}
      ${flagTile("Left open", q.too_slow.n, n, "var(--warning)", `over ${q.too_slow.threshold_min} min`)}
      ${flagTile("Outside hours", q.out_of_hours.n, n, "var(--warning)", `started outside ${q.out_of_hours.hours[0]}:00–${q.out_of_hours.hours[1]}:00`)}
      ${q.missing_gps.applicable ? flagTile("No GPS", q.missing_gps.n, n, "var(--warning)", "no geolocation captured") : ""}
      ${tile("Validation", Object.entries(f.validation).map(([k, v]) => `${esc(k)}: ${num(v)}`).join("<br>") || "—", "Kobo validation status", true)}
    </div>
    ${dupRows.length ? `<div class="card" style="margin-top:12px"><h3>Repeat submissions by school</h3><div class="scroll">${table([{t:"Key"},{t:"Records",num:true},{t:"Kobo _id"}], dupRows)}</div></div>` : ""}
    <div class="two" style="margin-top:12px">
      <div class="card"><h3>By data officer <span class="meta">(${esc(f.enumerator_basis)})</span></h3>
        ${table([{t:"Officer"},{t:"Submissions",num:true},{t:"Median min",num:true},{t:"Last"}], f.by_enumerator.map(e => [esc(e.user), num(e.n), e.median_min ?? "—", fmtDT(e.last_submission)]))}</div>
      <div class="card"><h3>Least-complete questions</h3>
        ${table([{t:"Question"},{t:"Type"},{t:"% answered",num:true}], f.completeness_lowest.map(c => [`<b>${esc(c.name)}</b><br><span class="meta">${esc(c.label)}</span>`, esc(c.type), c.pct]))}</div>
    </div>
    ${groups ? `<div class="two" style="margin-top:12px">${groups}</div>` : ""}
    ${missing}
    <details style="margin-top:16px"><summary>Questions in this form (${f.schema.length})</summary>
      <div class="card" style="margin-top:8px">${table([{t:"Name"},{t:"Type"},{t:"Label"},{t:"xpath"}], f.schema.map(s => [esc(s.name), esc(s.type), esc(s.label), `<code>${esc(s.xpath)}</code>`]))}</div></details>`;
}

function drawDaily(f) {
  const wrap = $("#daily"), tip = $("#tip");
  const rows = f.by_day, W = Math.max(600, wrap.clientWidth - 32), H = 180, padL = 36, padB = 24, padT = 10;
  const max = Math.max(1, ...rows.map(r => r.n));
  const bw = (W - padL) / rows.length, innerH = H - padB - padT;
  const y = v => padT + innerH - (v / max) * innerH;
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Submissions per day">`;
  [0, Math.ceil(max / 2), max].forEach(tv => { svg += `<line x1="${padL}" x2="${W}" y1="${y(tv)}" y2="${y(tv)}" stroke="var(--grid)"/><text x="${padL - 6}" y="${y(tv) + 4}" text-anchor="end">${tv}</text>`; });
  rows.forEach((r, i) => {
    const x = padL + i * bw + 1, w = Math.max(1, bw - 2), h = Math.max(0, y(0) - y(r.n));
    svg += `<rect x="${x}" y="${y(r.n)}" width="${w}" height="${h}" rx="${Math.min(4, w / 2)}" fill="var(--series-1)" data-i="${i}"/>`;
    svg += `<rect x="${x - 1}" y="${padT}" width="${w + 2}" height="${innerH}" fill="transparent" data-i="${i}"/>`;
    if (i % Math.ceil(rows.length / 10) === 0) svg += `<text x="${x + w / 2}" y="${H - 6}" text-anchor="middle">${fmtD(r.date)}</text>`;
  });
  svg += `<line x1="${padL}" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="var(--axis)"/></svg>`;
  wrap.insertAdjacentHTML("beforeend", svg);
  wrap.onmousemove = e => {
    const i = e.target.dataset.i; if (i === undefined) { tip.style.display = "none"; return; }
    const r = rows[+i]; tip.style.display = "block"; tip.textContent = `${fmtD(r.date)}: ${r.n} submission${r.n === 1 ? "" : "s"}`;
    const b = wrap.getBoundingClientRect();
    tip.style.left = Math.min(e.clientX - b.left + 12, b.width - tip.offsetWidth - 8) + "px"; tip.style.top = (e.clientY - b.top - 32) + "px";
  };
  wrap.onmouseleave = () => tip.style.display = "none";
}


PAGES.forms = { title: "Form monitoring", render(arg) { pageHeader("Form monitoring", "submissions, data officers and data-quality flags per Kobo form"); renderFormsOverview(); selectForm(arg || SUMMARY.forms[0].key); }, filters: false };
