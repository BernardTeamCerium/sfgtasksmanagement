// Sibley Financial Group — Team Task Manager: API core.
// Storage-agnostic: the Node server plugs in a JSON file, Netlify plugs in Netlify Blobs.
//
//   const api = createApi({ storage, passcode, secret, crypto: require('crypto') });
//   const { status, body, headers } = await api.handle({ method, pathname, cookie, body, secure });
//
// storage = { load(): Promise<{ state|null, etag }>, save(state, etag): Promise<boolean> }
// save() returns false when someone else wrote first; the request is then re-run on fresh data.

'use strict';

// Node's crypto module is passed in by the entry point (server.js / Netlify function) so this
// file bundles cleanly as part of an ES module on Netlify.
let crypto;
const SEED = require('../data/seed.json');

const STATUSES = ['Not Started', 'In Progress', 'Waiting', 'Completed'];
const PRIORITIES = ['High', 'Medium', 'Low'];

// Production metrics, in funnel order. Edit labels here; keys are stored in data.
const METRICS = [
  { key: 'leads', label: 'Leads', unit: 'count' },
  { key: 'connects', label: 'Good Connects', unit: 'count' },
  { key: 'appointments', label: 'Appointments', unit: 'count' },
  { key: 'sales', label: 'Sales', unit: 'count' },
  { key: 'premium', label: 'Premium', unit: 'usd' },
];
const METRIC_KEYS = METRICS.map((m) => m.key);

// ---------- helpers ----------

const today = () => new Date().toISOString().slice(0, 10);
const newId = () => crypto.randomBytes(8).toString('hex');
const str = (v, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const date = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback);

function num(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

function initialState() {
  return {
    version: 1,
    members: SEED.members,
    projects: SEED.projects || [],
    tasks: SEED.tasks,
    // October goal of 40 good connects comes from the team's project sheet.
    production: { entries: [], goals: { '2026-10': { connects: 40 } } },
  };
}

function normalize(state) {
  if (!state.production) state.production = { entries: [], goals: { '2026-10': { connects: 40 } } };
  return state;
}

function cleanTask(input, existing = {}) {
  const t = { ...existing };
  const has = (k) => Object.prototype.hasOwnProperty.call(input, k);
  if (has('project')) t.project = str(input.project, 200);
  if (has('title')) t.title = str(input.title, 300);
  if (has('assignee')) t.assignee = str(input.assignee, 100);
  if (has('dateAssigned')) t.dateAssigned = date(input.dateAssigned);
  if (has('dueDate')) t.dueDate = date(input.dueDate);
  if (has('priority')) t.priority = oneOf(input.priority, PRIORITIES, 'Medium');
  if (has('status')) t.status = oneOf(input.status, STATUSES, 'Not Started');
  if (has('nextAction')) t.nextAction = str(input.nextAction, 4000);
  if (has('links')) t.links = str(input.links, 2000);
  return t;
}

const TASK_DEFAULTS = { priority: 'Medium', status: 'Not Started', project: '', title: '', assignee: '', dateAssigned: '', dueDate: '', nextAction: '', links: '' };

function cleanEntry(input, existing = {}) {
  const e = { ...existing };
  if ('date' in input) e.date = date(input.date);
  for (const k of METRIC_KEYS) if (k in input) e[k] = num(input[k]);
  if ('note' in input) e.note = str(input.note, 1000);
  if ('author' in input) e.author = str(input.author, 100);
  return e;
}

// Clearly-labelled demo numbers so the dashboard can be previewed before real data is entered.
function sampleEntries() {
  const out = [];
  const months = 6;
  const now = new Date();
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = months; i >= 0; i--) {
    const y = now.getFullYear(), m = now.getMonth() - i;
    const first = new Date(y, m, 1);
    const last = i === 0 ? now : new Date(y, m + 1, 0);
    const growth = 1 + (months - i) * 0.08;
    for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) {
      if (d.getDay() !== 5 && !(d.getTime() === last.getTime())) continue; // Fridays + month end
      const days = d.getDay() === 5 ? 7 : Math.max(1, ((d.getDate() - 1) % 7) + 1);
      const f = (days / 7) * growth;
      const leads = Math.round((34 + rnd() * 12) * f);
      const connects = Math.round(leads * (0.12 + rnd() * 0.03));
      const appointments = Math.round(connects * (0.45 + rnd() * 0.15));
      const sales = Math.round(appointments * (0.3 + rnd() * 0.15));
      out.push({
        id: newId(), sample: true, author: 'Sample data', note: '',
        date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
        leads, connects, appointments, sales, premium: sales * Math.round(1800 + rnd() * 900),
      });
    }
  }
  return out;
}

function publicState(state) {
  return {
    version: state.version,
    members: state.members,
    projects: state.projects || [],
    tasks: state.tasks,
    statuses: STATUSES,
    priorities: PRIORITIES,
    metrics: METRICS,
    production: state.production,
  };
}

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

const reply = (status, body, headers = {}) => ({ status, body, headers });
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

// ---------- mutations: (state, body, params) => response body. Throw HttpError for 4xx. ----------

const ROUTES = [
  ['POST', /^\/api\/tasks$/, (s, b) => {
    const t = cleanTask({ ...TASK_DEFAULTS, dateAssigned: today(), ...b }, { id: newId(), notes: [], createdAt: new Date().toISOString() });
    if (!t.title) throw new HttpError(400, 'Task is required');
    const firstNote = str(b.note, 4000);
    if (firstNote) t.notes.push({ id: newId(), date: today(), author: str(b.author, 100), text: firstNote });
    t.lastUpdated = today();
    if (t.status === 'Completed') t.completedAt = today();
    s.tasks.push(t);
    return { task: t, status: 201 };
  }],
  ['PUT', /^\/api\/tasks\/([a-f0-9]+)$/, (s, b, [id]) => {
    const i = findTask(s, id);
    const task = s.tasks[i];
    const updated = cleanTask(b, task);
    if (!updated.title) throw new HttpError(400, 'Task is required');
    if (updated.status === 'Completed' && task.status !== 'Completed') updated.completedAt = today();
    if (updated.status !== 'Completed') delete updated.completedAt;
    updated.lastUpdated = today();
    s.tasks[i] = updated;
    return { task: updated };
  }],
  ['DELETE', /^\/api\/tasks\/([a-f0-9]+)$/, (s, b, [id]) => {
    s.tasks.splice(findTask(s, id), 1);
    return { ok: true };
  }],
  ['POST', /^\/api\/tasks\/([a-f0-9]+)\/notes$/, (s, b, [id]) => {
    const task = s.tasks[findTask(s, id)];
    const text = str(b.text, 4000);
    if (!text) throw new HttpError(400, 'Note text is required');
    task.notes = task.notes || [];
    task.notes.push({ id: newId(), date: date(b.date) || today(), author: str(b.author, 100), text });
    task.lastUpdated = today();
    return { task, status: 201 };
  }],
  ['DELETE', /^\/api\/tasks\/([a-f0-9]+)\/notes\/([a-f0-9]+)$/, (s, b, [id, noteId]) => {
    const task = s.tasks[findTask(s, id)];
    task.notes = (task.notes || []).filter((n) => n.id !== noteId);
    task.lastUpdated = today();
    return { task };
  }],
  ['PUT', /^\/api\/members$/, (s, b) => {
    if (!Array.isArray(b.members)) throw new HttpError(400, 'members must be a list');
    const seen = new Set();
    s.members = b.members.map((n) => str(n, 100)).filter((n) => n && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()));
    return { full: true };
  }],
  ['POST', /^\/api\/import$/, (s, b) => {
    if (!Array.isArray(b.tasks)) throw new HttpError(400, 'tasks must be a list');
    let added = 0;
    for (const raw of b.tasks.slice(0, 1000)) {
      const t = cleanTask({ ...TASK_DEFAULTS, ...raw }, { id: newId(), notes: [], createdAt: new Date().toISOString() });
      if (!t.title) continue;
      const note = str(raw.note, 4000);
      if (note) t.notes.push({ id: newId(), date: date(raw.lastUpdated) || today(), author: '', text: note });
      t.lastUpdated = date(raw.lastUpdated) || today();
      s.tasks.push(t);
      if (t.assignee && !s.members.includes(t.assignee)) s.members.push(t.assignee);
      added++;
    }
    return { full: true, extra: { added } };
  }],
  ['POST', /^\/api\/production\/entries$/, (s, b) => {
    const e = cleanEntry({ date: today(), ...b }, { id: newId() });
    if (!e.date) throw new HttpError(400, 'Date is required');
    if (!METRIC_KEYS.some((k) => e[k] !== null && e[k] !== undefined)) throw new HttpError(400, 'Enter at least one number');
    s.production.entries.push(e);
    return { full: true, status: 201 };
  }],
  ['PUT', /^\/api\/production\/entries\/([a-f0-9]+)$/, (s, b, [id]) => {
    const i = findEntry(s, id);
    const e = cleanEntry(b, s.production.entries[i]);
    if (!e.date) throw new HttpError(400, 'Date is required');
    delete e.sample;
    s.production.entries[i] = e;
    return { full: true };
  }],
  ['DELETE', /^\/api\/production\/entries\/([a-f0-9]+)$/, (s, b, [id]) => {
    s.production.entries.splice(findEntry(s, id), 1);
    return { full: true };
  }],
  ['PUT', /^\/api\/production\/goals$/, (s, b) => {
    if (!/^\d{4}-\d{2}$/.test(b.month || '')) throw new HttpError(400, 'month must be YYYY-MM');
    const g = {};
    for (const k of METRIC_KEYS) { const v = num((b.goals || {})[k]); if (v !== null) g[k] = v; }
    if (Object.keys(g).length) s.production.goals[b.month] = g; else delete s.production.goals[b.month];
    return { full: true };
  }],
  ['POST', /^\/api\/production\/sample$/, (s) => {
    s.production.entries = s.production.entries.filter((e) => !e.sample).concat(sampleEntries());
    return { full: true };
  }],
  ['DELETE', /^\/api\/production\/sample$/, (s) => {
    s.production.entries = s.production.entries.filter((e) => !e.sample);
    return { full: true };
  }],
];

function findTask(s, id) {
  const i = s.tasks.findIndex((t) => t.id === id);
  if (i === -1) throw new HttpError(404, 'Task not found');
  return i;
}
function findEntry(s, id) {
  const i = s.production.entries.findIndex((e) => e.id === id);
  if (i === -1) throw new HttpError(404, 'Entry not found');
  return i;
}

// ---------- factory ----------

function createApi({ storage, passcode = '', secret = '', crypto: cryptoModule }) {
  if (!cryptoModule) throw new Error('createApi needs the Node crypto module');
  crypto = cryptoModule;
  // Without an explicit secret, derive a stable one from the passcode so sessions survive restarts / cold starts.
  const key = secret || crypto.createHash('sha256').update('sfg-session:' + passcode).digest('hex');
  const sessionToken = () => crypto.createHmac('sha256', key).update('sfg:' + passcode).digest('hex');

  function isAuthed(cookie) {
    if (!passcode) return true;
    const tok = parseCookies(cookie).sfg_session || '';
    const expected = sessionToken();
    return tok.length === expected.length && crypto.timingSafeEqual(Buffer.from(tok), Buffer.from(expected));
  }

  async function load() {
    const { state, etag } = await storage.load();
    if (state) return { state: normalize(state), etag };
    return { state: initialState(), etag: null };
  }

  async function handle({ method, pathname, cookie, body = {}, secure = false }) {
    try {
      if (pathname === '/api/session' && method === 'GET') {
        return reply(200, { authRequired: !!passcode, authed: isAuthed(cookie) });
      }
      if (pathname === '/api/login' && method === 'POST') {
        if (!passcode) return reply(200, { ok: true });
        if (!safeEqual(body.passcode || '', passcode)) return reply(401, { error: 'Incorrect passcode' });
        return reply(200, { ok: true }, {
          'Set-Cookie': `sfg_session=${sessionToken()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 30}${secure ? '; Secure' : ''}`,
        });
      }
      if (pathname === '/api/logout' && method === 'POST') {
        return reply(200, { ok: true }, { 'Set-Cookie': 'sfg_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
      }
      if (!isAuthed(cookie)) return reply(401, { error: 'Sign in required' });

      if (pathname === '/api/state' && method === 'GET') {
        return reply(200, publicState((await load()).state));
      }

      for (const [m, re, fn] of ROUTES) {
        const match = method === m && pathname.match(re);
        if (!match) continue;
        // Optimistic concurrency: re-run on fresh data if another write landed first.
        for (let attempt = 0; attempt < 5; attempt++) {
          const { state, etag } = await load();
          const result = fn(state, body || {}, match.slice(1));
          state.version = (state.version || 0) + 1;
          if (!(await storage.save(state, etag))) continue;
          const out = result.full ? { ...result.extra, ...publicState(state) } : { ...result, version: state.version };
          delete out.full; delete out.extra;
          const status = result.status || 200;
          delete out.status;
          if (result.task) out.task = result.task;
          return reply(status, out);
        }
        return reply(409, { error: 'Too many people saving at once — please try again.' });
      }
      return reply(404, { error: 'Not found' });
    } catch (err) {
      if (err instanceof HttpError) return reply(err.status, { error: err.message });
      console.error(err);
      return reply(500, { error: 'Server error' });
    }
  }

  return { handle };
}

module.exports = { createApi, METRICS, STATUSES, PRIORITIES };
