/* Sibley Financial Group — Production dashboard (manual/imported numbers, trend vs last month & last year) */
'use strict';

(() => {
  const NS = 'http://www.w3.org/2000/svg';
  // Series colours (validated for colour-blind separation): this month = brand blue, last month = gold (+ dashed).
  const C = { cur: '#1a4aa8', prev: '#c08a2e', earlier: '#c9d3e6', goal: '#2b2b2b', grid: '#e6e9ee', axis: '#677285' };
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  // Conversion steps shown when both metrics exist (Leads → Appointments → Good Connects → Sales).
  const STEPS = [['leads', 'appointments'], ['appointments', 'connects'], ['appointments', 'sales'], ['connects', 'sales']];

  const P = { month: '', metric: store.get('prodMetric', 'connects'), range: store.get('prodRange', 12), editingId: null };

  // ---------- helpers ----------
  const ymOf = (iso) => iso.slice(0, 7);
  const curYM = () => todayISO().slice(0, 7);
  function shift(ym, n) {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 1 + n, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  const monthName = (ym) => MONTHS[Number(ym.slice(5)) - 1];
  const monthShort = (ym) => monthName(ym).slice(0, 3);
  const monthLabel = (ym) => `${monthName(ym)} ${ym.slice(0, 4)}`;
  const monthShortYr = (ym) => `${monthShort(ym)} ${ym.slice(0, 4)}`;
  const daysIn = (ym) => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5)), 0).getDate();
  const md = (iso) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8))}`;

  const metrics = () => S.data.metrics || [];
  const metric = (k) => metrics().find((m) => m.key === k) || metrics()[0];
  const entries = () => (S.data.production && S.data.production.entries) || [];
  const goals = () => (S.data.production && S.data.production.goals) || {};
  const has = (e, k) => e[k] !== null && e[k] !== undefined;

  function fmt(key, v, compact = false) {
    if (v === null || v === undefined || Number.isNaN(v)) return '—';
    if (metric(key)?.unit === 'usd') {
      if (compact && v >= 1e6) return '$' + (v / 1e6).toFixed(v >= 1e7 ? 0 : 1) + 'M';
      if (compact && v >= 1000) return '$' + Math.round(v / 1000) + 'k';
      return '$' + Math.round(v).toLocaleString();
    }
    return (Math.round(v * 10) / 10).toLocaleString();
  }
  const pct = (v) => (v === null || !Number.isFinite(v) ? '—' : `${Math.round(v * 100)}%`);

  function monthEntries(ym) {
    return entries().filter((e) => e.date && ymOf(e.date) === ym).sort((a, b) => a.date.localeCompare(b.date));
  }
  function total(ym, key) {
    const vals = monthEntries(ym).filter((e) => has(e, key)).map((e) => e[key]);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  }
  function totals(ym) {
    const out = {};
    for (const m of metrics()) out[m.key] = total(ym, m.key);
    return out;
  }
  function goalFor(ym, key) {
    const months = Object.keys(goals()).filter((g) => g <= ym && goals()[g][key] !== undefined).sort();
    return months.length ? goals()[months[months.length - 1]][key] : null;
  }
  function change(cur, prev) {
    if (cur === null || prev === null) return null;
    if (prev === 0) return cur === 0 ? 0 : null;
    return (cur - prev) / prev;
  }
  const isCurrent = (ym) => ym === curYM();
  const elapsedDays = (ym) => (isCurrent(ym) ? Number(todayISO().slice(8)) : daysIn(ym));
  function pace(ym, t) {
    if (!isCurrent(ym) || t === null) return null;
    return (t / elapsedDays(ym)) * daysIn(ym);
  }

  // Which days of a month a metric's numbers cover. Entries without a start date are assumed to
  // cover the 7 days ending on their date (a weekly total).
  function coverage(ym, key) {
    if (ym > curYM()) return { status: 'future' };
    const es = monthEntries(ym).filter((e) => has(e, key));
    if (!es.length) return { status: 'missing' };
    const first = `${ym}-01`;
    const starts = es.map((e) => {
      if (e.start) return e.start < first ? first : e.start;
      const d = Number(e.date.slice(8)) - 6;
      return d <= 1 ? first : `${ym}-${String(d).padStart(2, '0')}`;
    });
    const from = starts.sort()[0];
    const to = es[es.length - 1].date;
    const target = elapsedDays(ym);
    const lateStart = Number(from.slice(8)) > 7;
    const earlyEnd = Number(to.slice(8)) < target - 6;
    let label = '';
    if (lateStart && earlyEnd) label = `${md(from)}–${md(to)} only`;
    else if (lateStart) label = `from ${md(from)} only`;
    else if (earlyEnd) label = `through ${md(to)} only`;
    return { status: lateStart || earlyEnd ? 'partial' : 'complete', from, to, label };
  }
  const usable = (cov) => cov.status === 'complete';
  const isoDay = (ym, d) => `${ym}-${String(d).padStart(2, '0')}`;
  // The days still missing for a month + metric, to pre-fill the entry form.
  function gapSpan(ym, key) {
    const cov = coverage(ym, key);
    const endDay = elapsedDays(ym);
    if (cov.status === 'missing') return { start: isoDay(ym, 1), end: isoDay(ym, endDay), metric: key };
    if (cov.status !== 'partial') return null;
    const fromDay = Number(cov.from.slice(8)), toDay = Number(cov.to.slice(8));
    if (toDay < endDay - 6) return { start: isoDay(ym, toDay + 1), end: isoDay(ym, endDay), metric: key };
    return { start: isoDay(ym, 1), end: isoDay(ym, fromDay - 1), metric: key };
  }
  const sameSpan = (a, b) => a.status !== 'missing' && b.status !== 'missing' && a.from === b.from && a.to === b.to;

  function defaultMonth() {
    const cur = curYM();
    if (monthEntries(cur).length) return cur;
    const past = entries().map((e) => ymOf(e.date)).filter((m) => m <= cur).sort();
    return past.length ? past[past.length - 1] : cur;
  }

  function node(tag, attrs = {}, parent, text) {
    const n = tag.startsWith('svg:') ? document.createElementNS(NS, tag.slice(4)) : document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) n.setAttribute(k, v);
    if (text !== undefined) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }
  function deltaBadge(ch, parent, suffix = '') {
    const cls = ch === null ? 'flat' : ch > 0.005 ? 'up' : ch < -0.005 ? 'down' : 'flat';
    const icon = { up: '▲', down: '▼', flat: '■' }[cls];
    const label = ch === null ? 'n/a' : `${ch > 0 ? '+' : ''}${Math.round(ch * 100)}%`;
    return node('span', { class: `delta ${cls}` }, parent, `${icon} ${label}${suffix}`);
  }
  const partialTag = (parent, text) => node('span', { class: 'delta partial' }, parent, `◐ ${text}`);
  // Compare two months only when both are complete (the current month counts as complete to date).
  function compareInto(parent, key, ymA, ymB, label) {
    const a = total(ymA, key), b = total(ymB, key);
    const ca = coverage(ymA, key), cb = coverage(ymB, key);
    if (a === null || b === null) return false;
    if (!usable(ca) || !usable(cb)) {
      partialTag(parent, `${!usable(ca) ? monthShort(ymA) : monthShort(ymB)} incomplete`);
      parent.append(` ${label} (${fmt(key, b)})`);
      return true;
    }
    deltaBadge(change(a, b), parent);
    parent.append(` ${label} (${fmt(key, b)})`);
    return true;
  }
  function niceMax(v) {
    if (!v || v <= 0) return 4;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const s of [1, 2, 2.5, 5, 10]) if (s * p >= v) return s * p;
    return 10 * p;
  }

  // ---------- tooltip ----------
  const tip = () => $('#chartTip');
  function showTip(evt, title, rows) {
    const t = tip();
    t.replaceChildren();
    node('div', { class: 'tip-title' }, t, title);
    for (const r of rows) {
      const row = node('div', { class: 'tip-row' }, t);
      if (r.color) node('span', { class: 'tip-key' + (r.dashed ? ' dashed' : ''), style: `border-color:${r.color}` }, row);
      node('strong', {}, row, r.value);
      node('span', { class: 'muted' }, row, r.label);
    }
    t.hidden = false;
    const x = Math.min(evt.clientX + 14, window.innerWidth - t.offsetWidth - 8);
    const y = Math.max(8, evt.clientY - t.offsetHeight - 12);
    t.style.left = x + 'px';
    t.style.top = y + 'px';
  }
  const hideTip = () => { tip().hidden = true; };

  // ---------- render ----------
  function render() {
    if (!P.month) P.month = defaultMonth();
    if (!metric(P.metric)) P.metric = metrics()[0]?.key;
    const ym = P.month, prev = shift(ym, -1);
    const all = entries();

    $('#prodTitle').textContent = `${monthLabel(ym)} Production`;
    $('#prodSubtitle').textContent = isCurrent(ym)
      ? `Month to date (day ${elapsedDays(ym)} of ${daysIn(ym)}) · compared with ${monthLabel(prev)} and ${monthLabel(shift(ym, -12))}`
      : `Compared with ${monthLabel(prev)} and ${monthLabel(shift(ym, -12))}`;
    $('#nextMonth').disabled = ym >= curYM();
    $('#sampleBanner').hidden = !all.some((e) => e.sample);
    $('#prodEmpty').hidden = all.length > 0;
    $('#prodBody').hidden = all.length === 0;
    if (!all.length) return;

    renderSummary(ym, prev);
    renderGaps(ym, prev);
    renderKpis(ym, prev);
    renderTabs();
    renderPace(ym, prev);
    renderTrend(ym);
    renderMoM(ym, prev);
    renderYtd(ym);
    renderConv(ym, prev);
    renderCoverage(ym);
    renderEntries(ym);
  }

  function renderSummary(ym, prev) {
    const ul = $('#prodSummary');
    ul.replaceChildren();
    const ly = shift(ym, -12);
    const tracked = metrics().filter((m) => total(ym, m.key) !== null);
    const comparable = tracked.filter((m) => total(prev, m.key) !== null && usable(coverage(ym, m.key)) && usable(coverage(prev, m.key)));
    const ups = comparable.filter((m) => (change(total(ym, m.key), total(prev, m.key)) ?? 0) > 0.005).length;
    const lead = node('li', { class: 'lead' }, ul);
    if (!tracked.length) lead.textContent = `No numbers entered for ${monthName(ym)} yet.`;
    else if (!comparable.length) lead.textContent = `${monthName(ym)}: not enough complete numbers yet to compare with ${monthName(prev)}.`;
    else lead.textContent = isCurrent(ym)
      ? `${monthName(ym)} so far (${elapsedDays(ym)} of ${daysIn(ym)} days): ${ups} of ${comparable.length} comparable metrics are already ahead of ${monthName(prev)}'s full month.`
      : `${monthName(ym)}: ${ups} of ${comparable.length} comparable metrics improved on ${monthName(prev)}.`;
    for (const m of tracked) {
      const li = node('li', {}, ul);
      node('strong', {}, li, `${m.label}: `);
      const c = total(ym, m.key);
      const cov = coverage(ym, m.key);
      li.append(fmt(m.key, c) + ' ');
      if (!usable(cov)) partialTag(li, `${cov.label}`);
      const l = total(prev, m.key);
      if (l !== null) {
        li.append(` · vs ${monthShort(prev)} `);
        const pc = coverage(prev, m.key);
        if (usable(cov) && usable(pc)) deltaBadge(change(c, l), li); else li.append(`${fmt(m.key, l)}${usable(pc) ? '' : ' (partial)'}`);
      }
      const y = total(ly, m.key);
      if (y !== null && usable(cov) && usable(coverage(ly, m.key))) {
        li.append(` · vs ${monthShortYr(ly)} `);
        deltaBadge(change(c, y), li);
      }
      const g = goalFor(ym, m.key);
      if (g !== null && c !== null) {
        const p = pace(ym, c);
        const s = node('span', { class: 'goal-note' }, li);
        if (c >= g) { s.classList.add('ok'); s.textContent = ` ✓ Goal of ${fmt(m.key, g)} met`; }
        else if (!usable(cov)) { s.classList.add('warn'); s.textContent = ` ! Can't check the ${fmt(m.key, g)} goal: numbers incomplete`; }
        else if (p !== null) { s.classList.add(p >= g ? 'ok' : 'warn'); s.textContent = ` ${p >= g ? '✓ On pace' : '! Behind pace'} for the ${fmt(m.key, g)} goal (projected ${fmt(m.key, p)})`; }
        else { s.classList.add('warn'); s.textContent = ` ! ${fmt(m.key, g - c)} short of the ${fmt(m.key, g)} goal`; }
      }
    }
  }

  function renderGaps(ym, prev) {
    const ul = $('#gapsList');
    ul.replaceChildren();
    const items = [];
    for (const m of metrics()) {
      const ever = entries().some((e) => has(e, m.key) && !e.sample);
      if (!ever && !entries().some((e) => has(e, m.key))) { items.push([m.label, 'never entered for any month']); continue; }
      const parts = [];
      for (const mm of [ym, prev]) {
        const cov = coverage(mm, m.key);
        if (cov.status === 'missing') parts.push(`${monthShort(mm)}: missing`);
        else if (cov.status === 'partial') parts.push(`${monthShort(mm)}: ${cov.label}`);
      }
      if (parts.length) items.push([m.label, parts.join(' · ')]);
    }
    $('#gapsCard').hidden = !items.length;
    for (const [label, text] of items) {
      const li = node('li', {}, ul);
      node('strong', {}, li, `${label}: `);
      li.append(text);
    }
  }

  function renderKpis(ym, prev) {
    const wrap = $('#kpis');
    wrap.replaceChildren();
    const ly = shift(ym, -12);
    for (const m of metrics()) {
      const c = total(ym, m.key);
      const cov = coverage(ym, m.key);
      const tile = node('button', { class: 'kpi' + (m.key === P.metric ? ' active' : '') + (cov.status === 'missing' ? ' kpi-missing' : ''), 'data-metric': m.key, title: `Show ${m.label} in the charts` }, wrap);
      node('span', { class: 'kpi-label' }, tile, m.label);
      node('span', { class: 'kpi-value' }, tile, cov.status === 'missing' ? 'Missing' : fmt(m.key, c));
      if (cov.status === 'partial') node('span', { class: 'kpi-partial' }, tile, `◐ ${cov.label}`);
      const d1 = node('span', { class: 'kpi-delta' }, tile);
      if (!(c !== null && compareInto(d1, m.key, ym, prev, `vs ${monthShort(prev)}`))) node('span', { class: 'muted' }, d1, total(prev, m.key) === null ? `No ${monthShort(prev)} numbers` : '');
      const d2 = node('span', { class: 'kpi-delta' }, tile);
      if (c !== null && total(ly, m.key) !== null) compareInto(d2, m.key, ym, ly, `vs ${monthShortYr(ly)}`);
      const g = goalFor(ym, m.key);
      if (g !== null) {
        const ratio = c === null ? 0 : c / g;
        const bar = node('span', { class: 'goalbar', role: 'img', 'aria-label': `${pct(ratio)} of goal` }, tile);
        node('span', { class: 'goalbar-fill' + (ratio >= 1 ? ' done' : ''), style: `width:${Math.min(100, ratio * 100)}%` }, bar);
        node('span', { class: 'kpi-goal' }, tile, `${pct(ratio)} of ${fmt(m.key, g)} goal`);
      }
      const p = usable(cov) ? pace(ym, c) : null;
      if (p !== null) node('span', { class: 'kpi-pace' }, tile, `On pace for ${fmt(m.key, p)}`);
    }
  }

  function renderTabs() {
    const row = $('#metricTabs');
    row.replaceChildren();
    node('span', { class: 'muted small' }, row, 'Chart metric:');
    for (const m of metrics()) {
      node('button', { class: 'tab' + (m.key === P.metric ? ' active' : ''), role: 'tab', 'aria-selected': String(m.key === P.metric), 'data-metric': m.key }, row, m.label);
    }
    $$('#rangeTabs .tab').forEach((b) => b.classList.toggle('active', Number(b.dataset.range) === P.range));
  }

  function legend(el, items) {
    el.replaceChildren();
    for (const it of items) {
      const s = node('span', { class: 'legend-item' }, el);
      node('span', { class: `legend-key ${it.kind}${it.dashed ? ' dashed' : ''}`, style: it.kind === 'line' ? `border-color:${it.color}` : it.kind === 'outline' ? `border-color:${it.color}` : `background:${it.color}` }, s);
      s.append(it.label);
    }
  }

  // Running total by day. A total that covers several days (an entry with a start date, such as a
  // monthly report figure) is spread evenly across those days so the line shows a pace, not a jump.
  let spreadUsed = false;
  function cumulative(ym, key, upTo) {
    const byDay = new Array(daysIn(ym) + 1).fill(0);
    let any = false;
    for (const e of monthEntries(ym)) {
      if (!has(e, key)) continue;
      any = true;
      const end = Number(e.date.slice(8));
      const start = e.start ? (ymOf(e.start) < ym ? 1 : Number(e.start.slice(8))) : end;
      if (end > start) spreadUsed = true;
      for (let d = start; d <= end; d++) byDay[d] += e[key] / (end - start + 1);
    }
    if (!any) return null;
    const out = [];
    let run = 0;
    for (let d = 1; d <= upTo; d++) { run += byDay[d]; out.push([d, run]); }
    return out;
  }

  function renderPace(ym, prev) {
    const box = $('#paceChart');
    box.replaceChildren();
    const m = metric(P.metric), key = m.key;
    $('#paceTitle').textContent = `${m.label}: month-to-date pace`;
    spreadUsed = false;
    // Stop each line on the last day its numbers cover, so a partial month doesn't look finished.
    const upTo = (mm, full) => { const cv = coverage(mm, key); return cv.status === 'partial' ? Math.min(full, Number(cv.to.slice(8))) : full; };
    const cur = cumulative(ym, key, upTo(ym, elapsedDays(ym)));
    const last = cumulative(prev, key, upTo(prev, daysIn(prev)));
    const goal = goalFor(ym, key);
    legend($('#paceLegend'), [
      { kind: 'line', color: C.cur, label: monthShort(ym) },
      { kind: 'line', color: C.prev, dashed: true, label: monthShort(prev) },
      ...(goal !== null ? [{ kind: 'line', color: C.goal, dashed: true, label: 'Goal' }] : []),
    ]);
    if (!cur && !last) { node('p', { class: 'muted chart-empty' }, box, `No ${m.label.toLowerCase()} entered for ${monthShort(ym)} or ${monthShort(prev)}.`); return; }

    const W = Math.max(320, box.clientWidth || 560), H = 260, pad = { l: 56, r: 64, t: 14, b: 30 };
    const maxDay = 31;
    const maxV = niceMax(Math.max(goal || 0, ...(cur || []).map((p) => p[1]), ...(last || []).map((p) => p[1])) * 1.05);
    const x = (d) => pad.l + ((d - 1) / (maxDay - 1)) * (W - pad.l - pad.r);
    const y = (v) => H - pad.b - (v / maxV) * (H - pad.t - pad.b);
    const svg = node('svg:svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, role: 'img', 'aria-label': `${m.label} running total by day, ${monthLabel(ym)} vs ${monthLabel(prev)}` }, box);

    for (let i = 0; i <= 4; i++) {
      const v = (maxV / 4) * i;
      node('svg:line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), stroke: C.grid, 'stroke-width': 1 }, svg);
      node('svg:text', { x: pad.l - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'axis' }, svg, fmt(key, v, true));
    }
    for (const d of [1, 8, 15, 22, 29]) node('svg:text', { x: x(d), y: H - 10, 'text-anchor': 'middle', class: 'axis' }, svg, `Day ${d}`);

    if (goal !== null) {
      node('svg:line', { x1: pad.l, x2: W - pad.r, y1: y(goal), y2: y(goal), stroke: C.goal, 'stroke-width': 1.5, 'stroke-dasharray': '2 4' }, svg);
      node('svg:text', { x: pad.l + 6, y: y(goal) - 6, class: 'axis' }, svg, `Goal ${fmt(key, goal, true)}`);
    }
    const line = (pts, color, dashed) => node('svg:polyline', {
      points: pts.map(([d, v]) => `${x(d)},${y(v)}`).join(' '), fill: 'none', stroke: color, 'stroke-width': 2,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'stroke-dasharray': dashed ? '6 4' : null,
    }, svg);
    const endLabel = (pts, color, label, dy) => {
      const [d, v] = pts[pts.length - 1];
      node('svg:circle', { cx: x(d), cy: y(v), r: 4, fill: color, stroke: '#fff', 'stroke-width': 2 }, svg);
      node('svg:text', { x: x(d) + 8, y: y(v) + 4 + dy, class: 'end-label' }, svg, `${label} ${fmt(key, v, true)}`);
    };
    if (last) line(last, C.prev, true);
    if (cur) line(cur, C.cur, false);
    let dyCur = 0, dyPrev = 0;
    if (cur && last) {
      const gap = y(cur[cur.length - 1][1]) - y(last[last.length - 1][1]);
      if (Math.abs(gap) < 14 && Math.abs(x(cur[cur.length - 1][0]) - x(last[last.length - 1][0])) < 60) { dyCur = gap <= 0 ? -7 : 7; dyPrev = -dyCur; }
    }
    if (last) endLabel(last, C.prev, monthShort(prev), dyPrev);
    if (cur) endLabel(cur, C.cur, monthShort(ym), dyCur);

    const hair = node('svg:line', { y1: pad.t, y2: H - pad.b, stroke: C.axis, 'stroke-width': 1, visibility: 'hidden' }, svg);
    const hit = node('svg:rect', { x: pad.l, y: pad.t, width: W - pad.l - pad.r, height: H - pad.t - pad.b, fill: 'transparent', tabindex: 0 }, svg);
    const at = (pts, d) => (pts && d <= pts.length ? pts[d - 1][1] : null);
    hit.addEventListener('pointermove', (evt) => {
      const r = svg.getBoundingClientRect();
      const px = ((evt.clientX - r.left) / r.width) * W;
      const d = Math.max(1, Math.min(maxDay, Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (maxDay - 1) + 1)));
      hair.setAttribute('x1', x(d)); hair.setAttribute('x2', x(d)); hair.setAttribute('visibility', 'visible');
      const rows = [];
      const cv = at(cur, d), lv = at(last, d);
      if (cv !== null) rows.push({ color: C.cur, value: fmt(key, cv), label: `${monthShort(ym)} to date` });
      if (lv !== null) rows.push({ color: C.prev, dashed: true, value: fmt(key, lv), label: `${monthShort(prev)} to date` });
      if (goal !== null) rows.push({ value: fmt(key, goal), label: 'goal' });
      showTip(evt, `Day ${d}`, rows);
    });
    hit.addEventListener('pointerleave', () => { hair.setAttribute('visibility', 'hidden'); hideTip(); });
    if (spreadUsed) node('p', { class: 'muted small chart-note' }, box, 'Monthly or multi-day totals are spread evenly across the days they cover.');
  }

  function renderTrend(ym) {
    const box = $('#trendChart');
    box.replaceChildren();
    const m = metric(P.metric), key = m.key;
    const n = P.range;
    const months = Array.from({ length: n }, (_, i) => shift(ym, i - n + 1));
    const vals = months.map((mm) => total(mm, key));
    const covs = months.map((mm) => coverage(mm, key));
    const gls = months.map((mm) => goalFor(mm, key));
    $('#trendTitle').textContent = `${m.label}: ${n}-month trend`;
    legend($('#trendLegend'), [
      { kind: 'rect', color: C.cur, label: monthShort(ym) },
      { kind: 'rect', color: C.prev, label: monthShort(months[n - 2]) },
      { kind: 'rect', color: C.earlier, label: 'Earlier' },
      ...(covs.some((c) => c.status === 'partial') ? [{ kind: 'outline', color: C.axis, label: 'Partial month' }] : []),
      ...(gls.some((g) => g !== null) ? [{ kind: 'line', color: C.goal, dashed: true, label: 'Goal' }] : []),
    ]);
    if (vals.every((v) => v === null)) { node('p', { class: 'muted chart-empty' }, box, `No ${m.label.toLowerCase()} entered in these ${n} months.`); return; }

    const W = Math.max(320, box.clientWidth || 560), H = 260, pad = { l: 56, r: 12, t: 22, b: 30 };
    const maxV = niceMax(Math.max(...vals.map((v) => v || 0), ...gls.map((g) => g || 0)) * 1.08);
    const slot = (W - pad.l - pad.r) / n;
    const bw = Math.max(6, Math.min(56, slot * 0.66));
    const y = (v) => H - pad.b - (v / maxV) * (H - pad.t - pad.b);
    const svg = node('svg:svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, role: 'img', 'aria-label': `${m.label} by month, last ${n} months` }, box);
    for (let i = 0; i <= 4; i++) {
      const v = (maxV / 4) * i;
      node('svg:line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), stroke: C.grid, 'stroke-width': 1 }, svg);
      node('svg:text', { x: pad.l - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'axis' }, svg, fmt(key, v, true));
    }
    const labelEvery = n <= 12 ? 1 : 3;
    months.forEach((mm, i) => {
      const cx = pad.l + slot * i + slot / 2;
      const v = vals[i];
      const partial = covs[i].status === 'partial';
      const color = i === n - 1 ? C.cur : i === n - 2 ? C.prev : C.earlier;
      if (v !== null && v > 0) {
        const top = y(v), h = H - pad.b - top, r = Math.min(4, h, bw / 2);
        node('svg:path', {
          d: `M${cx - bw / 2},${H - pad.b} V${top + r} Q${cx - bw / 2},${top} ${cx - bw / 2 + r},${top} H${cx + bw / 2 - r} Q${cx + bw / 2},${top} ${cx + bw / 2},${top + r} V${H - pad.b} Z`,
          fill: color, 'fill-opacity': partial ? 0.35 : 1, stroke: partial ? (color === C.earlier ? C.axis : color) : 'none', 'stroke-width': partial ? 1.5 : 0, 'stroke-dasharray': partial ? '3 2' : null,
        }, svg);
      }
      if (gls[i] !== null) node('svg:line', { x1: cx - bw / 2 - 4, x2: cx + bw / 2 + 4, y1: y(gls[i]), y2: y(gls[i]), stroke: C.goal, 'stroke-width': 1.5, 'stroke-dasharray': '2 3' }, svg);
      if (i >= n - 2 && v !== null) node('svg:text', { x: cx, y: y(v) - 6, 'text-anchor': 'middle', class: 'bar-label' }, svg, fmt(key, v, true));
      if (i % labelEvery === (n - 1) % labelEvery || i === n - 1) {
        const lbl = mm.endsWith('-01') || i === 0 ? `${monthShort(mm)} ’${mm.slice(2, 4)}` : monthShort(mm);
        node('svg:text', { x: cx, y: H - 10, 'text-anchor': 'middle', class: 'axis' + (i === n - 1 ? ' strong' : '') }, svg, lbl);
      }
      const hit = node('svg:rect', { x: pad.l + slot * i, y: pad.t, width: slot, height: H - pad.t - pad.b, fill: 'transparent', tabindex: 0 }, svg);
      const show = (evt) => {
        const rows = [{ color: color === C.earlier ? C.axis : color, value: covs[i].status === 'missing' ? 'Missing' : fmt(key, v), label: m.label }];
        if (partial) rows.push({ value: '◐', label: covs[i].label });
        if (i > 0 && v !== null && vals[i - 1] !== null && usable(covs[i]) && usable(covs[i - 1])) {
          const ch = change(v, vals[i - 1]);
          rows.push({ value: ch === null ? 'n/a' : `${ch > 0 ? '+' : ''}${Math.round(ch * 100)}%`, label: `vs ${monthShort(months[i - 1])}` });
        }
        if (gls[i] !== null) rows.push({ value: fmt(key, gls[i]), label: 'goal' });
        showTip(evt, monthLabel(mm), rows);
      };
      hit.addEventListener('pointermove', show);
      hit.addEventListener('focus', () => { const r = hit.getBoundingClientRect(); show({ clientX: r.left + r.width / 2, clientY: r.top + 40 }); });
      hit.addEventListener('pointerleave', hideTip);
      hit.addEventListener('blur', hideTip);
      hit.addEventListener('click', () => { P.month = mm; render(); });
    });
  }

  function cellVal(td, key, ym) {
    const v = total(ym, key), cov = coverage(ym, key);
    if (cov.status === 'missing') { node('span', { class: 'muted' }, td, '—'); return; }
    td.append(fmt(key, v));
    if (cov.status === 'partial') node('span', { class: 'cell-note', title: cov.label }, td, ' ◐');
  }
  function cellDelta(td, key, a, b) {
    const va = total(a, key), vb = total(b, key);
    if (va === null || vb === null) { td.textContent = '—'; return; }
    if (!usable(coverage(a, key)) || !usable(coverage(b, key))) { partialTag(td, 'partial'); return; }
    deltaBadge(change(va, vb), td);
  }

  function renderMoM(ym, prev) {
    const t = $('#momTable');
    t.replaceChildren();
    const ly = shift(ym, -12);
    const hr = node('tr', {}, node('thead', {}, t));
    for (const h of ['Metric', monthShortYr(prev), monthShortYr(ym), 'vs last month', monthShortYr(ly), 'vs last year', 'Goal', '% of goal']) node('th', {}, hr, h);
    const tb = node('tbody', {}, t);
    for (const m of metrics()) {
      const tr = node('tr', {}, tb);
      const g = goalFor(ym, m.key);
      node('td', { class: 't-project' }, tr, m.label);
      cellVal(node('td', {}, tr), m.key, prev);
      cellVal(node('td', { class: 'num-strong' }, tr), m.key, ym);
      cellDelta(node('td', {}, tr), m.key, ym, prev);
      cellVal(node('td', {}, tr), m.key, ly);
      cellDelta(node('td', {}, tr), m.key, ym, ly);
      node('td', {}, tr, g === null ? '—' : fmt(m.key, g));
      const c = total(ym, m.key);
      node('td', {}, tr, g === null || c === null ? '—' : pct(c / g));
    }
  }

  function renderYtd(ym) {
    const t = $('#ytdTable');
    t.replaceChildren();
    const year = Number(ym.slice(0, 4)), mo = Number(ym.slice(5));
    const span = mo === 1 ? 'Jan' : `Jan–${monthShort(ym)}`;
    $('#ytdTitle').textContent = `Year to date (${span})`;
    const hr = node('tr', {}, node('thead', {}, t));
    for (const h of ['Metric', String(year - 1), String(year), 'Change', 'Notes']) node('th', {}, hr, h);
    const tb = node('tbody', {}, t);
    for (const m of metrics()) {
      const sumYear = (y) => {
        let sum = null; const missing = [], partial = [];
        for (let i = 1; i <= mo; i++) {
          const mm = `${y}-${String(i).padStart(2, '0')}`;
          const v = total(mm, m.key), cov = coverage(mm, m.key);
          if (v !== null) sum = (sum || 0) + v;
          if (cov.status === 'missing') missing.push(monthShort(mm));
          else if (cov.status === 'partial') partial.push(`${monthShort(mm)} ${cov.label}`);
        }
        const gaps = [];
        if (missing.length === mo) gaps.push('no numbers');
        else {
          if (missing.length) gaps.push(missing.length > 3 ? `${missing.length} months missing` : `${missing.join(', ')} missing`);
          gaps.push(...partial);
        }
        return { sum, gaps };
      };
      const a = sumYear(year - 1), b = sumYear(year);
      if (a.sum === null && b.sum === null) continue;
      const tr = node('tr', {}, tb);
      node('td', { class: 't-project' }, tr, m.label);
      node('td', {}, tr, fmt(m.key, a.sum));
      node('td', { class: 'num-strong' }, tr, fmt(m.key, b.sum));
      const td = node('td', {}, tr);
      if (a.sum !== null && b.sum !== null && !a.gaps.length && !b.gaps.length) deltaBadge(change(b.sum, a.sum), td);
      else if (a.sum !== null && b.sum !== null) partialTag(td, 'incomplete');
      else td.textContent = '—';
      const notes = [[year - 1, a.gaps], [year, b.gaps]].filter(([, g]) => g.length).map(([y, g]) => `${y}: ${g.join(', ')}`);
      node('td', { class: 'muted small' }, tr, notes.join('. '));
    }
    if (!tb.children.length) node('td', { colspan: 5, class: 'muted' }, node('tr', {}, tb), 'No numbers for these months yet.');
  }

  function renderConv(ym, prev) {
    const t = $('#convTable');
    t.replaceChildren();
    const hr = node('tr', {}, node('thead', {}, t));
    for (const h of ['Step', monthShort(prev), monthShort(ym), 'Change']) node('th', {}, hr, h);
    const tb = node('tbody', {}, t);
    const rate = (mm, a, b) => {
      const ca = coverage(mm, a), cb = coverage(mm, b);
      const va = total(mm, a), vb = total(mm, b);
      if (!va || vb === null || !sameSpan(ca, cb)) return { v: null, note: va && vb !== null ? 'different days' : '' };
      return { v: vb / va, note: ca.status === 'partial' ? ca.label : '' };
    };
    for (const [a, b] of STEPS) {
      if (!metric(a) || !metric(b) || metric(a).key !== a || metric(b).key !== b) continue;
      const c = rate(ym, a, b), l = rate(prev, a, b);
      const tr = node('tr', {}, tb);
      node('td', { class: 't-project' }, tr, `${metric(a).label} → ${metric(b).label}`);
      for (const r of [l, c]) {
        const td = node('td', { class: r === c ? 'num-strong' : '' }, tr, pct(r.v));
        if (r.note) node('span', { class: 'cell-note', title: r.note }, td, r.v === null ? ` (${r.note})` : ' ◐');
      }
      const td = node('td', {}, tr);
      if (c.v !== null && l.v !== null) {
        const pp = Math.round((c.v - l.v) * 100);
        const cls = pp > 0 ? 'up' : pp < 0 ? 'down' : 'flat';
        node('span', { class: `delta ${cls}` }, td, `${{ up: '▲', down: '▼', flat: '■' }[cls]} ${pp > 0 ? '+' : ''}${pp} pts`);
      } else td.textContent = '—';
    }
  }

  function renderCoverage(ym) {
    const t = $('#covTable');
    t.replaceChildren();
    const months = Array.from({ length: 12 }, (_, i) => shift(ym, i - 11));
    const hr = node('tr', {}, node('thead', {}, t));
    node('th', {}, hr, 'Metric');
    for (const mm of months) {
      const th = node('th', { class: 'cov-month' + (mm === ym ? ' sel' : ''), 'data-month': mm, title: monthLabel(mm) }, hr, monthShort(mm));
      if (mm.endsWith('-01') || mm === months[0]) node('span', { class: 'cov-year' }, th, `’${mm.slice(2, 4)}`);
    }
    const tb = node('tbody', {}, t);
    for (const m of metrics()) {
      const tr = node('tr', {}, tb);
      node('td', { class: 't-project' }, tr, m.label);
      for (const mm of months) {
        const cov = coverage(mm, m.key);
        const sym = { complete: '✓', partial: '◐', missing: '✕', future: '' }[cov.status];
        const title = cov.status === 'missing' ? `${m.label}, ${monthLabel(mm)}: missing`
          : cov.status === 'partial' ? `${m.label}, ${monthLabel(mm)}: ${cov.label}`
          : cov.status === 'complete' ? `${m.label}, ${monthLabel(mm)}: ${fmt(m.key, total(mm, m.key))}` : '';
        const td = node('td', { class: 'cov-cell', 'data-month': mm, 'data-metric': m.key, title: title + (cov.status === 'missing' || cov.status === 'partial' ? ' — click to enter' : '') }, tr);
        node('span', { class: `cov cov-${cov.status}` }, td, sym);
      }
    }
  }

  function renderEntries(ym) {
    const t = $('#entryTable');
    t.replaceChildren();
    const list = monthEntries(ym);
    const shown = metrics().filter((m) => list.some((e) => has(e, m.key)));
    const hr = node('tr', {}, node('thead', {}, t));
    for (const h of ['Period', ...shown.map((m) => m.label), 'Note', 'Source / entered by']) node('th', {}, hr, h);
    const tb = node('tbody', {}, t);
    if (!list.length) {
      node('td', { colspan: shown.length + 3, class: 'muted' }, node('tr', {}, tb), `No entries for ${monthLabel(ym)} yet.`);
      return;
    }
    for (const e of list) {
      const tr = node('tr', { 'data-entry': e.id, tabindex: 0 }, tb);
      node('td', {}, tr, e.start && e.start !== e.date ? `${fmtDate(e.start)} – ${fmtDate(e.date)}` : fmtDate(e.date));
      for (const m of shown) node('td', {}, tr, fmt(m.key, e[m.key]));
      node('td', {}, tr, e.note || '');
      node('td', { class: 'muted' }, tr, [e.source, e.author].filter(Boolean).join(' · '));
    }
  }

  // ---------- modals ----------
  function buildFields(container, prefix) {
    container.querySelectorAll('[data-metric-field]').forEach((n) => n.remove());
    for (const m of metrics()) {
      const lab = node('label', { 'data-metric-field': m.key }, container, m.label + (m.unit === 'usd' ? ' ($)' : ''));
      node('input', { name: prefix + m.key, type: 'number', min: 0, step: m.unit === 'usd' ? '0.01' : '1', inputmode: 'decimal', placeholder: '—' }, lab);
    }
  }

  function openEntry(id, preset) {
    const e = id ? entries().find((x) => x.id === id) : null;
    P.editingId = e ? e.id : null;
    const f = $('#entryForm');
    buildFields($('#entryFields'), 'm_');
    f.reset();
    $('#entryModalTitle').textContent = e ? 'Edit numbers' : 'Enter numbers';
    $('#deleteEntryBtn').hidden = !e;
    f.date.value = e ? e.date : (isCurrent(P.month) || !P.month ? todayISO() : `${P.month}-${String(daysIn(P.month)).padStart(2, '0')}`);
    f.start.value = e?.start || '';
    if (preset) { f.start.value = preset.start; f.date.value = preset.end; }
    for (const m of metrics()) f['m_' + m.key].value = e && has(e, m.key) ? e[m.key] : '';
    f.note.value = e?.note || '';
    $('#entryModal').showModal();
    f['m_' + (preset?.metric || metrics()[0].key)].focus();
  }

  async function saveEntry(evt) {
    evt.preventDefault();
    const f = $('#entryForm');
    const body = { date: f.date.value, start: f.start.value, note: f.note.value, author: S.me };
    for (const m of metrics()) body[m.key] = f['m_' + m.key].value;
    try {
      S.data = P.editingId
        ? await api(`/api/production/entries/${P.editingId}`, { method: 'PUT', body })
        : await api('/api/production/entries', { method: 'POST', body });
      P.month = ymOf(body.date);
      $('#entryModal').close();
      render();
      toast('Numbers saved');
    } catch (e) { toast(e.message, true); }
  }

  async function deleteEntry() {
    if (!P.editingId || !confirm('Delete this entry?')) return;
    try {
      S.data = await api(`/api/production/entries/${P.editingId}`, { method: 'DELETE' });
      $('#entryModal').close();
      render();
      toast('Entry deleted');
    } catch (e) { toast(e.message, true); }
  }

  function openGoals() {
    const f = $('#goalsForm');
    buildFields($('#goalFields'), 'g_');
    $('#goalsModalTitle').textContent = `Goals for ${monthLabel(P.month)}`;
    for (const m of metrics()) { const g = goalFor(P.month, m.key); f['g_' + m.key].value = g === null ? '' : g; }
    $('#goalsModal').showModal();
  }

  async function saveGoals(evt) {
    evt.preventDefault();
    const f = $('#goalsForm');
    const g = {};
    for (const m of metrics()) g[m.key] = f['g_' + m.key].value;
    try {
      S.data = await api('/api/production/goals', { method: 'PUT', body: { month: P.month, goals: g } });
      $('#goalsModal').close();
      render();
      toast('Goals saved');
    } catch (e) { toast(e.message, true); }
  }

  // ---------- CSV import ----------
  // Columns: Period Start (optional), Period End, one column per metric (named like the metric), Note, Source.
  // Excel support: a small reader library is bundled in /vendor and loaded only when needed.
  let xlsxLib;
  function loadXlsxReader() {
    xlsxLib ||= new Promise((resolve, reject) => {
      const sc = document.createElement('script');
      sc.src = 'vendor/read-excel-file-9.3.12.min.js';
      sc.onload = () => (window.readXlsxFile ? resolve(window.readXlsxFile) : reject(new Error('Excel reader failed to load')));
      sc.onerror = () => reject(new Error('Excel reader failed to load'));
      document.head.appendChild(sc);
    });
    return xlsxLib;
  }
  const cellText = (v) => {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`;
    return String(v);
  };
  async function readRows(file) {
    if (!/\.xlsx$/i.test(file.name)) return parseCSV(await file.text());
    const read = await loadXlsxReader();
    const result = await read(file);
    const sheets = Array.isArray(result) && result.length && result[0] && 'data' in result[0] ? result : [{ sheet: 'Sheet1', data: result }];
    // Prefer the "Fill In" sheet, else the first sheet that has a Period End column.
    const hasEnd = (sh) => sh.data.some((r) => r.some((c) => /^period ?end(ing)?$/i.test(cellText(c).trim())));
    const pickSheet = sheets.find((sh) => /fill ?in/i.test(sh.sheet) && hasEnd(sh)) || sheets.find(hasEnd) || sheets[0];
    return pickSheet.data.map((r) => r.map(cellText));
  }

  async function importProduction(file) {
    let raw;
    try { raw = await readRows(file); } catch (e) { return toast(`Couldn't read that file: ${e.message}`, true); }
    const rows = raw.filter((r) => r.some((c) => c.trim()));
    const norm = (s) => s.toLowerCase().replace(/\(\$\)|\$/g, '').replace(/[^a-z]/g, '');
    const hi = rows.findIndex((r) => r.some((c) => ['periodend', 'periodending', 'date'].includes(norm(c))));
    if (hi === -1) return toast('Could not find a "Period End" column in that CSV', true);
    const head = rows[hi].map(norm);
    const col = (...names) => head.findIndex((h) => names.includes(h));
    const iEnd = col('periodend', 'periodending', 'date'), iStart = col('periodstart', 'start'), iNote = col('note', 'notes'), iSrc = col('source');
    const mcols = metrics().map((m) => [m.key, col(norm(m.label), m.key)]).filter(([, i]) => i >= 0);
    if (!mcols.length) return toast(`No metric columns found. Use headers like: ${metrics().map((m) => m.label).join(', ')}`, true);
    const out = [];
    for (const r of rows.slice(hi + 1)) {
      const date = toISO(r[iEnd] || '');
      if (!date) continue;
      const e = { date, start: iStart >= 0 ? toISO(r[iStart] || '') : '', note: iNote >= 0 ? (r[iNote] || '').trim() : '', source: iSrc >= 0 ? (r[iSrc] || '').trim() : 'CSV import' };
      for (const [k, i] of mcols) { const v = (r[i] || '').replace(/[$,\s]/g, ''); if (v !== '') e[k] = v; }
      out.push(e);
    }
    const filled = out.filter((e) => mcols.some(([k]) => e[k] !== undefined));
    if (!filled.length) return toast('No numbers found to import. Fill in at least one cell first.', true);
    out.length = 0; out.push(...filled);
    const srcs = [...new Set(out.map((e) => e.source))].join(', ');
    if (!confirm(`Import ${out.length} row(s) of production numbers?\n\nRows imported earlier from the same source (${srcs}) are replaced. Everything else, including numbers typed in by hand, is kept.`)) return;
    try {
      S.data = await api('/api/production/import', { method: 'POST', body: { entries: out, replaceImported: true } });
      P.month = '';
      render();
      toast(`Imported ${S.data.added} row(s)`);
    } catch (e) { toast(e.message, true); }
  }

  // ---------- presentation mode ----------
  function setPresenting(on) {
    document.body.classList.toggle('presenting', on);
    $('#presentBtn').textContent = on ? 'Exit presentation' : 'Present';
    try {
      if (on && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
      if (!on && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    } catch { /* fullscreen not available */ }
    requestAnimationFrame(render);
  }

  // ---------- events ----------
  function wire() {
    $('#prevMonth').addEventListener('click', () => { P.month = shift(P.month, -1); render(); });
    $('#nextMonth').addEventListener('click', () => { P.month = shift(P.month, 1); render(); });
    $('#addEntryBtn').addEventListener('click', () => openEntry(null));
    $('#prodEmpty').addEventListener('click', (e) => { if (e.target.closest('[data-action=add-entry]')) openEntry(null); });
    $('#goalsBtn').addEventListener('click', openGoals);
    $('#entryForm').addEventListener('submit', saveEntry);
    $('#goalsForm').addEventListener('submit', saveGoals);
    $('#deleteEntryBtn').addEventListener('click', deleteEntry);
    $('#prodImportFile').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importProduction(f); });
    $('#presentBtn').addEventListener('click', () => setPresenting(!document.body.classList.contains('presenting')));
    document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && document.body.classList.contains('presenting')) setPresenting(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.body.classList.contains('presenting') && !document.querySelector('dialog[open]')) setPresenting(false); });

    const pick = (e) => {
      const b = e.target.closest('[data-metric]');
      if (!b) return;
      P.metric = b.dataset.metric;
      store.set('prodMetric', P.metric);
      render();
    };
    $('#metricTabs').addEventListener('click', pick);
    $('#kpis').addEventListener('click', pick);
    $('#rangeTabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-range]');
      if (!b) return;
      P.range = Number(b.dataset.range);
      store.set('prodRange', P.range);
      render();
    });
    $('#covTable').addEventListener('click', (e) => {
      const cell = e.target.closest('td[data-metric]');
      if (cell) {
        const gap = gapSpan(cell.dataset.month, cell.dataset.metric);
        if (gap) { P.month = cell.dataset.month; render(); openEntry(null, gap); return; }
      }
      const c = e.target.closest('[data-month]');
      if (c) { P.month = c.dataset.month; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    });
    const entryClick = (e) => { const r = e.target.closest('[data-entry]'); if (r) openEntry(r.dataset.entry); };
    $('#entryTable').addEventListener('click', entryClick);
    $('#entryTable').addEventListener('keydown', (e) => { if (e.key === 'Enter') entryClick(e); });

    $('#loadSampleBtn').addEventListener('click', async () => {
      try { S.data = await api('/api/production/sample', { method: 'POST' }); P.month = ''; render(); toast('Sample data loaded'); } catch (e) { toast(e.message, true); }
    });
    $('#clearSampleBtn').addEventListener('click', async () => {
      if (!confirm('Remove all sample numbers? Numbers your team entered are kept.')) return;
      try { S.data = await api('/api/production/sample', { method: 'DELETE' }); P.month = ''; render(); toast('Sample data cleared'); } catch (e) { toast(e.message, true); }
    });

    let rt;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (!$('#productionPage').hidden) render(); }, 150); });
  }

  window.renderProduction = render;
  wire();
})();
