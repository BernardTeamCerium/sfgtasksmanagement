/* Sibley Financial Group — Production dashboard (manual monthly numbers, trend vs last month) */
'use strict';

(() => {
  const NS = 'http://www.w3.org/2000/svg';
  // Series colours (validated for colour-blind separation): this month = brand blue, last month = gold (+ dashed).
  const C = { cur: '#1a4aa8', prev: '#c08a2e', earlier: '#c9d3e6', goal: '#2b2b2b', grid: '#e6e9ee', axis: '#677285' };
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  const P = { month: '', metric: store.get('prodMetric', 'connects'), editingId: null };

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
  const daysIn = (ym) => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5)), 0).getDate();

  const metrics = () => S.data.metrics || [];
  const metric = (k) => metrics().find((m) => m.key === k) || metrics()[0];
  const entries = () => (S.data.production && S.data.production.entries) || [];
  const goals = () => (S.data.production && S.data.production.goals) || {};

  function fmt(key, v, compact = false) {
    if (v === null || v === undefined || Number.isNaN(v)) return '—';
    if (metric(key)?.unit === 'usd') {
      if (compact && v >= 1000) return '$' + (v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : Math.round(v / 1000) + 'k');
      return '$' + Math.round(v).toLocaleString();
    }
    return (Math.round(v * 10) / 10).toLocaleString();
  }
  const pct = (v) => (v === null || !Number.isFinite(v) ? '—' : `${Math.round(v * 100)}%`);

  function monthEntries(ym) {
    return entries().filter((e) => e.date && ymOf(e.date) === ym).sort((a, b) => a.date.localeCompare(b.date));
  }
  function totals(ym) {
    const out = {};
    for (const m of metrics()) {
      const vals = monthEntries(ym).map((e) => e[m.key]).filter((v) => v !== null && v !== undefined);
      out[m.key] = vals.length ? vals.reduce((a, b) => a + b, 0) : null;
    }
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
  function isCurrent(ym) { return ym === curYM(); }
  function elapsedDays(ym) { return isCurrent(ym) ? Number(todayISO().slice(8)) : daysIn(ym); }
  function pace(ym, total) {
    if (!isCurrent(ym) || total === null) return null;
    return (total / elapsedDays(ym)) * daysIn(ym);
  }

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
      ? `Month to date (day ${elapsedDays(ym)} of ${daysIn(ym)}) · compared with ${monthLabel(prev)}`
      : `Compared with ${monthLabel(prev)}`;
    $('#nextMonth').disabled = ym >= curYM();
    $('#sampleBanner').hidden = !all.some((e) => e.sample);
    $('#prodEmpty').hidden = all.length > 0;
    $('#prodBody').hidden = all.length === 0;
    if (!all.length) return;

    const cur = totals(ym), last = totals(prev);
    renderSummary(ym, prev, cur, last);
    renderKpis(ym, prev, cur, last);
    renderTabs();
    renderPace(ym, prev);
    renderTrend(ym);
    renderMoM(ym, prev, cur, last);
    renderConv(ym, prev, cur, last);
    renderEntries(ym);
  }

  function renderSummary(ym, prev, cur, last) {
    const ul = $('#prodSummary');
    ul.replaceChildren();
    const tracked = metrics().filter((m) => cur[m.key] !== null || last[m.key] !== null);
    const ups = tracked.filter((m) => (change(cur[m.key], last[m.key]) ?? 0) > 0.005).length;
    const lead = node('li', { class: 'lead' }, ul);
    lead.textContent = isCurrent(ym)
      ? `${monthName(ym)} so far (${elapsedDays(ym)} of ${daysIn(ym)} days): ${ups} of ${tracked.length} metrics are already ahead of ${monthName(prev)}'s full month.`
      : `${monthName(ym)}: ${ups} of ${tracked.length} metrics improved on ${monthName(prev)}.`;
    for (const m of tracked) {
      const li = node('li', {}, ul);
      node('strong', {}, li, `${m.label}: `);
      const c = cur[m.key], l = last[m.key];
      li.append(`${fmt(m.key, c)}`);
      if (l !== null) {
        li.append(' vs ' + fmt(m.key, l) + ` in ${monthShort(prev)} `);
        deltaBadge(change(c, l), li);
      }
      const g = goalFor(ym, m.key);
      if (g !== null && c !== null) {
        const p = pace(ym, c);
        const hit = c >= g;
        const s = node('span', { class: 'goal-note ' + (hit ? 'ok' : p !== null && p >= g ? 'ok' : 'warn') }, li);
        if (hit) s.textContent = ` ✓ Goal of ${fmt(m.key, g)} met`;
        else if (p !== null) s.textContent = ` ${p >= g ? '✓ On pace' : '! Behind pace'} for the ${fmt(m.key, g)} goal (projected ${fmt(m.key, p)})`;
        else s.textContent = ` ! ${fmt(m.key, g - c)} short of the ${fmt(m.key, g)} goal`;
      }
    }
  }

  function renderKpis(ym, prev, cur, last) {
    const wrap = $('#kpis');
    wrap.replaceChildren();
    for (const m of metrics()) {
      const c = cur[m.key], l = last[m.key];
      const tile = node('button', { class: 'kpi' + (m.key === P.metric ? ' active' : ''), 'data-metric': m.key, title: `Show ${m.label} in the charts` }, wrap);
      node('span', { class: 'kpi-label' }, tile, m.label);
      node('span', { class: 'kpi-value' }, tile, fmt(m.key, c));
      const d = node('span', { class: 'kpi-delta' }, tile);
      if (l !== null && c !== null) { deltaBadge(change(c, l), d); d.append(` vs ${monthShort(prev)} (${fmt(m.key, l)})`); }
      else node('span', { class: 'muted' }, d, l === null ? `No ${monthShort(prev)} data` : 'No data yet');
      const g = goalFor(ym, m.key);
      if (g !== null) {
        const ratio = c === null ? 0 : c / g;
        const bar = node('span', { class: 'goalbar', role: 'img', 'aria-label': `${pct(ratio)} of goal` }, tile);
        node('span', { class: 'goalbar-fill' + (ratio >= 1 ? ' done' : ''), style: `width:${Math.min(100, ratio * 100)}%` }, bar);
        node('span', { class: 'kpi-goal' }, tile, `${pct(ratio)} of ${fmt(m.key, g)} goal`);
      }
      const p = pace(ym, c);
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
  }

  function legend(el, items) {
    el.replaceChildren();
    for (const it of items) {
      const s = node('span', { class: 'legend-item' }, el);
      node('span', { class: `legend-key ${it.kind}${it.dashed ? ' dashed' : ''}`, style: it.kind === 'line' ? `border-color:${it.color}` : `background:${it.color}` }, s);
      s.append(it.label);
    }
  }

  function cumulative(ym, key, upTo) {
    const byDay = new Array(daysIn(ym) + 1).fill(0);
    let any = false;
    for (const e of monthEntries(ym)) if (e[key] !== null && e[key] !== undefined) { byDay[Number(e.date.slice(8))] += e[key]; any = true; }
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
    const cur = cumulative(ym, key, elapsedDays(ym));
    const last = cumulative(prev, key, daysIn(prev));
    const goal = goalFor(ym, key);
    legend($('#paceLegend'), [
      { kind: 'line', color: C.cur, label: monthShort(ym) },
      { kind: 'line', color: C.prev, dashed: true, label: monthShort(prev) },
      ...(goal !== null ? [{ kind: 'line', color: C.goal, dashed: true, label: 'Goal' }] : []),
    ]);
    if (!cur && !last) { node('p', { class: 'muted chart-empty' }, box, `No ${m.label.toLowerCase()} entered for ${monthShort(ym)} or ${monthShort(prev)}.`); return; }

    const W = Math.max(320, box.clientWidth || 560), H = 260, pad = { l: 48, r: 64, t: 14, b: 30 };
    const maxDay = 31;
    const maxV = niceMax(Math.max(goal || 0, ...(cur || []).map((p) => p[1]), ...(last || []).map((p) => p[1])) * 1.05);
    const x = (d) => pad.l + ((d - 1) / (maxDay - 1)) * (W - pad.l - pad.r);
    const y = (v) => H - pad.b - (v / maxV) * (H - pad.t - pad.b);
    const svg = node('svg:svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, role: 'img', 'aria-label': `${m.label} cumulative by day, ${monthLabel(ym)} vs ${monthLabel(prev)}` }, box);

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
    // Keep the two end labels from colliding.
    let dyCur = 0, dyPrev = 0;
    if (cur && last) {
      const gap = y(cur[cur.length - 1][1]) - y(last[last.length - 1][1]);
      if (Math.abs(gap) < 14 && Math.abs(x(cur[cur.length - 1][0]) - x(last[last.length - 1][0])) < 60) { dyCur = gap <= 0 ? -7 : 7; dyPrev = -dyCur; }
    }
    if (last) endLabel(last, C.prev, monthShort(prev), dyPrev);
    if (cur) endLabel(cur, C.cur, monthShort(ym), dyCur);

    // Crosshair + tooltip
    const hair = node('svg:line', { y1: pad.t, y2: H - pad.b, stroke: C.axis, 'stroke-width': 1, visibility: 'hidden' }, svg);
    const hit = node('svg:rect', { x: pad.l, y: pad.t, width: W - pad.l - pad.r, height: H - pad.t - pad.b, fill: 'transparent', tabindex: 0 }, svg);
    const at = (pts, d) => (pts && d <= pts.length ? pts[d - 1][1] : null);
    const move = (evt) => {
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
    };
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerleave', () => { hair.setAttribute('visibility', 'hidden'); hideTip(); });
  }

  function renderTrend(ym) {
    const box = $('#trendChart');
    box.replaceChildren();
    const m = metric(P.metric), key = m.key;
    const months = [-5, -4, -3, -2, -1, 0].map((n) => shift(ym, n));
    const vals = months.map((mm) => totals(mm)[key]);
    const gls = months.map((mm) => goalFor(mm, key));
    $('#trendTitle').textContent = `${m.label}: 6-month trend`;
    legend($('#trendLegend'), [
      { kind: 'rect', color: C.cur, label: monthShort(ym) },
      { kind: 'rect', color: C.prev, label: monthShort(months[4]) },
      { kind: 'rect', color: C.earlier, label: 'Earlier' },
      ...(gls.some((g) => g !== null) ? [{ kind: 'line', color: C.goal, dashed: true, label: 'Goal' }] : []),
    ]);
    if (vals.every((v) => v === null)) { node('p', { class: 'muted chart-empty' }, box, `No ${m.label.toLowerCase()} entered in the last six months.`); return; }

    const W = Math.max(320, box.clientWidth || 560), H = 260, pad = { l: 48, r: 12, t: 22, b: 30 };
    const maxV = niceMax(Math.max(...vals.map((v) => v || 0), ...gls.map((g) => g || 0)) * 1.08);
    const slot = (W - pad.l - pad.r) / months.length;
    const bw = Math.min(56, slot * 0.6);
    const y = (v) => H - pad.b - (v / maxV) * (H - pad.t - pad.b);
    const svg = node('svg:svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, role: 'img', 'aria-label': `${m.label} by month, last six months` }, box);
    for (let i = 0; i <= 4; i++) {
      const v = (maxV / 4) * i;
      node('svg:line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), stroke: C.grid, 'stroke-width': 1 }, svg);
      node('svg:text', { x: pad.l - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'axis' }, svg, fmt(key, v, true));
    }
    months.forEach((mm, i) => {
      const cx = pad.l + slot * i + slot / 2;
      const v = vals[i];
      const color = i === 5 ? C.cur : i === 4 ? C.prev : C.earlier;
      if (v !== null && v > 0) {
        const top = y(v), h = H - pad.b - top, r = Math.min(4, h);
        // Rounded top (data end), square at the baseline.
        node('svg:path', { d: `M${cx - bw / 2},${H - pad.b} V${top + r} Q${cx - bw / 2},${top} ${cx - bw / 2 + r},${top} H${cx + bw / 2 - r} Q${cx + bw / 2},${top} ${cx + bw / 2},${top + r} V${H - pad.b} Z`, fill: color }, svg);
      }
      if (gls[i] !== null) node('svg:line', { x1: cx - bw / 2 - 6, x2: cx + bw / 2 + 6, y1: y(gls[i]), y2: y(gls[i]), stroke: C.goal, 'stroke-width': 1.5, 'stroke-dasharray': '2 3' }, svg);
      if (i >= 4 && v !== null) node('svg:text', { x: cx, y: y(v) - 6, 'text-anchor': 'middle', class: 'bar-label' }, svg, fmt(key, v, true));
      node('svg:text', { x: cx, y: H - 10, 'text-anchor': 'middle', class: 'axis' + (i === 5 ? ' strong' : '') }, svg, monthShort(mm));
      const hit = node('svg:rect', { x: pad.l + slot * i, y: pad.t, width: slot, height: H - pad.t - pad.b, fill: 'transparent', tabindex: 0 }, svg);
      const show = (evt) => {
        const rows = [{ color: color === C.earlier ? C.axis : color, value: fmt(key, v), label: m.label }];
        if (i > 0 && v !== null && vals[i - 1] !== null) { const ch = change(v, vals[i - 1]); rows.push({ value: ch === null ? 'n/a' : `${ch > 0 ? '+' : ''}${Math.round(ch * 100)}%`, label: `vs ${monthShort(months[i - 1])}` }); }
        if (gls[i] !== null) rows.push({ value: fmt(key, gls[i]), label: 'goal' });
        showTip(evt, monthLabel(mm), rows);
      };
      hit.addEventListener('pointermove', show);
      hit.addEventListener('focus', () => { const r = hit.getBoundingClientRect(); show({ clientX: r.left + r.width / 2, clientY: r.top + 40 }); });
      hit.addEventListener('pointerleave', hideTip);
      hit.addEventListener('blur', hideTip);
    });
  }

  function renderMoM(ym, prev, cur, last) {
    const t = $('#momTable');
    t.replaceChildren();
    const hr = node('tr', {}, node('thead', {}, t));
    for (const h of ['Metric', monthShort(prev), monthShort(ym), 'Change', 'Goal', '% of goal']) node('th', {}, hr, h);
    const tb = node('tbody', {}, t);
    for (const m of metrics()) {
      const tr = node('tr', {}, tb);
      const g = goalFor(ym, m.key);
      node('td', { class: 't-project' }, tr, m.label);
      node('td', {}, tr, fmt(m.key, last[m.key]));
      node('td', { class: 'num-strong' }, tr, fmt(m.key, cur[m.key]));
      deltaBadge(change(cur[m.key], last[m.key]), node('td', {}, tr));
      node('td', {}, tr, g === null ? '—' : fmt(m.key, g));
      node('td', {}, tr, g === null || cur[m.key] === null ? '—' : pct(cur[m.key] / g));
    }
  }

  function renderConv(ym, prev, cur, last) {
    const t = $('#convTable');
    t.replaceChildren();
    const hr = node('tr', {}, node('thead', {}, t));
    for (const h of ['Step', monthShort(prev), monthShort(ym), 'Change']) node('th', {}, hr, h);
    const tb = node('tbody', {}, t);
    const ratio = (o, a, b) => (o[a] && o[b] !== null ? o[b] / o[a] : null);
    const ks = metrics().filter((m) => m.unit === 'count').map((m) => m.key);
    const steps = [];
    for (let i = 0; i < ks.length - 1; i++) steps.push({ label: `${metric(ks[i]).label} → ${metric(ks[i + 1]).label}`, a: ks[i], b: ks[i + 1], kind: 'rate' });
    if (metric('premium') && metric('sales')) steps.push({ label: 'Average premium per sale', a: 'sales', b: 'premium', kind: 'avg' });
    for (const s of steps) {
      const c = ratio(cur, s.a, s.b), l = ratio(last, s.a, s.b);
      const tr = node('tr', {}, tb);
      node('td', { class: 't-project' }, tr, s.label);
      const f = (v) => (s.kind === 'avg' ? fmt('premium', v) : pct(v));
      node('td', {}, tr, f(l));
      node('td', { class: 'num-strong' }, tr, f(c));
      const td = node('td', {}, tr);
      if (s.kind === 'rate' && c !== null && l !== null) {
        const pp = Math.round((c - l) * 100);
        const cls = pp > 0 ? 'up' : pp < 0 ? 'down' : 'flat';
        node('span', { class: `delta ${cls}` }, td, `${{ up: '▲', down: '▼', flat: '■' }[cls]} ${pp > 0 ? '+' : ''}${pp} pts`);
      } else deltaBadge(change(c, l), td);
    }
  }

  function renderEntries(ym) {
    const t = $('#entryTable');
    t.replaceChildren();
    const list = monthEntries(ym);
    const hr = node('tr', {}, node('thead', {}, t));
    for (const h of ['Period ending', ...metrics().map((m) => m.label), 'Note', 'Entered by']) node('th', {}, hr, h);
    const tb = node('tbody', {}, t);
    if (!list.length) {
      const td = node('td', { colspan: metrics().length + 3, class: 'muted' }, node('tr', {}, tb), `No entries for ${monthLabel(ym)} yet.`);
      td.style.cursor = 'default';
      return;
    }
    for (const e of list) {
      const tr = node('tr', { 'data-entry': e.id, tabindex: 0 }, tb);
      node('td', {}, tr, fmtDate(e.date));
      for (const m of metrics()) node('td', {}, tr, fmt(m.key, e[m.key]));
      node('td', {}, tr, e.note || '');
      node('td', { class: 'muted' }, tr, e.author || '');
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

  function openEntry(id) {
    const e = id ? entries().find((x) => x.id === id) : null;
    P.editingId = e ? e.id : null;
    const f = $('#entryForm');
    buildFields($('#entryFields'), 'm_');
    f.reset();
    $('#entryModalTitle').textContent = e ? 'Edit numbers' : 'Enter numbers';
    $('#deleteEntryBtn').hidden = !e;
    f.date.value = e ? e.date : (isCurrent(P.month) || !P.month ? todayISO() : `${P.month}-${String(daysIn(P.month)).padStart(2, '0')}`);
    for (const m of metrics()) f['m_' + m.key].value = e && e[m.key] !== null && e[m.key] !== undefined ? e[m.key] : '';
    f.note.value = e?.note || '';
    $('#entryModal').showModal();
    f['m_' + metrics()[0].key].focus();
  }

  async function saveEntry(evt) {
    evt.preventDefault();
    const f = $('#entryForm');
    const body = { date: f.date.value, note: f.note.value, author: S.me };
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
