// Sibley Financial Group — Team Task Manager
// Zero-dependency Node.js server (Node 18+). Serves the web app from ./public
// and stores shared team data in ./data/tasks.json.

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'tasks.json');
const SEED_FILE = path.join(__dirname, 'data', 'seed.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const TEAM_PASSCODE = process.env.TEAM_PASSCODE || '';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const MAX_BODY = 1024 * 1024;

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

// ---------- storage ----------

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    const seed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
    const state = { version: 1, members: seed.members, projects: seed.projects || [], tasks: seed.tasks };
    saveState(state);
    return state;
  }
}

function saveState(s) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DATA_FILE + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

let state = loadState();
if (!state.production) {
  // October goal of 40 good connects comes from the team's project sheet.
  state.production = { entries: [], goals: { '2026-10': { connects: 40 } } };
  saveState(state);
}

function commit() {
  state.version = (state.version || 0) + 1;
  saveState(state);
}

// ---------- helpers ----------

const today = () => new Date().toISOString().slice(0, 10);
const newId = () => crypto.randomBytes(8).toString('hex');

function str(v, max = 2000) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}
function date(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
}
function oneOf(v, list, fallback) {
  return list.includes(v) ? v : fallback;
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

function send(res, code, body, headers = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Payload too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('Invalid JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

// ---------- auth (optional shared team passcode) ----------

const sessionToken = () => crypto.createHmac('sha256', SESSION_SECRET).update('sfg:' + TEAM_PASSCODE).digest('hex');

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function isAuthed(req) {
  if (!TEAM_PASSCODE) return true;
  const tok = parseCookies(req).sfg_session || '';
  const expected = sessionToken();
  return tok.length === expected.length && crypto.timingSafeEqual(Buffer.from(tok), Buffer.from(expected));
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// ---------- API ----------

function publicState() {
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

function num(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

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

async function handleApi(req, res, url) {
  const { pathname } = url;
  const method = req.method;

  if (pathname === '/api/session' && method === 'GET') {
    return send(res, 200, { authRequired: !!TEAM_PASSCODE, authed: isAuthed(req) });
  }
  if (pathname === '/api/login' && method === 'POST') {
    const body = await readBody(req);
    if (!TEAM_PASSCODE) return send(res, 200, { ok: true });
    if (!safeEqual(body.passcode || '', TEAM_PASSCODE)) return send(res, 401, { error: 'Incorrect passcode' });
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    return send(res, 200, { ok: true }, {
      'Set-Cookie': `sfg_session=${sessionToken()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 30}${secure}`,
    });
  }
  if (pathname === '/api/logout' && method === 'POST') {
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'sfg_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
  }

  if (!isAuthed(req)) return send(res, 401, { error: 'Sign in required' });

  if (pathname === '/api/state' && method === 'GET') {
    return send(res, 200, publicState());
  }

  if (pathname === '/api/tasks' && method === 'POST') {
    const body = await readBody(req);
    const t = cleanTask(
      { priority: 'Medium', status: 'Not Started', dateAssigned: today(), project: '', title: '', assignee: '', dueDate: '', nextAction: '', links: '', ...body },
      { id: newId(), notes: [], createdAt: new Date().toISOString() }
    );
    if (!t.title) return send(res, 400, { error: 'Task is required' });
    const firstNote = str(body.note, 4000);
    if (firstNote) t.notes.push({ id: newId(), date: today(), author: str(body.author, 100), text: firstNote });
    t.lastUpdated = today();
    if (t.status === 'Completed') t.completedAt = today();
    state.tasks.push(t);
    commit();
    return send(res, 201, { task: t, version: state.version });
  }

  const m = pathname.match(/^\/api\/tasks\/([a-f0-9]+)(\/notes(?:\/([a-f0-9]+))?)?$/);
  if (m) {
    const idx = state.tasks.findIndex((t) => t.id === m[1]);
    if (idx === -1) return send(res, 404, { error: 'Task not found' });
    const task = state.tasks[idx];

    if (!m[2]) {
      if (method === 'PUT' || method === 'PATCH') {
        const body = await readBody(req);
        const updated = cleanTask(body, task);
        if (!updated.title) return send(res, 400, { error: 'Task is required' });
        if (updated.status === 'Completed' && task.status !== 'Completed') updated.completedAt = today();
        if (updated.status !== 'Completed') delete updated.completedAt;
        updated.lastUpdated = today();
        state.tasks[idx] = updated;
        commit();
        return send(res, 200, { task: updated, version: state.version });
      }
      if (method === 'DELETE') {
        state.tasks.splice(idx, 1);
        commit();
        return send(res, 200, { ok: true, version: state.version });
      }
    } else if (!m[3] && method === 'POST') {
      const body = await readBody(req);
      const text = str(body.text, 4000);
      if (!text) return send(res, 400, { error: 'Note text is required' });
      const note = { id: newId(), date: date(body.date) || today(), author: str(body.author, 100), text };
      task.notes = task.notes || [];
      task.notes.push(note);
      task.lastUpdated = today();
      commit();
      return send(res, 201, { task, version: state.version });
    } else if (m[3] && method === 'DELETE') {
      task.notes = (task.notes || []).filter((n) => n.id !== m[3]);
      task.lastUpdated = today();
      commit();
      return send(res, 200, { task, version: state.version });
    }
  }

  // ---- production numbers ----
  const prod = state.production;
  if (pathname === '/api/production/entries' && method === 'POST') {
    const body = await readBody(req);
    const e = cleanEntry({ date: today(), ...body }, { id: newId() });
    if (!e.date) return send(res, 400, { error: 'Date is required' });
    if (!METRIC_KEYS.some((k) => e[k] !== null && e[k] !== undefined)) return send(res, 400, { error: 'Enter at least one number' });
    prod.entries.push(e);
    commit();
    return send(res, 201, publicState());
  }
  const pe = pathname.match(/^\/api\/production\/entries\/([a-f0-9]+)$/);
  if (pe) {
    const i = prod.entries.findIndex((e) => e.id === pe[1]);
    if (i === -1) return send(res, 404, { error: 'Entry not found' });
    if (method === 'PUT') {
      const e = cleanEntry(await readBody(req), prod.entries[i]);
      if (!e.date) return send(res, 400, { error: 'Date is required' });
      delete e.sample;
      prod.entries[i] = e;
      commit();
      return send(res, 200, publicState());
    }
    if (method === 'DELETE') {
      prod.entries.splice(i, 1);
      commit();
      return send(res, 200, publicState());
    }
  }
  if (pathname === '/api/production/goals' && method === 'PUT') {
    const body = await readBody(req);
    if (!/^\d{4}-\d{2}$/.test(body.month || '')) return send(res, 400, { error: 'month must be YYYY-MM' });
    const g = {};
    for (const k of METRIC_KEYS) { const v = num((body.goals || {})[k]); if (v !== null) g[k] = v; }
    if (Object.keys(g).length) prod.goals[body.month] = g; else delete prod.goals[body.month];
    commit();
    return send(res, 200, publicState());
  }
  if (pathname === '/api/production/sample' && method === 'POST') {
    prod.entries = prod.entries.filter((e) => !e.sample).concat(sampleEntries());
    commit();
    return send(res, 200, publicState());
  }
  if (pathname === '/api/production/sample' && method === 'DELETE') {
    prod.entries = prod.entries.filter((e) => !e.sample);
    commit();
    return send(res, 200, publicState());
  }

  if (pathname === '/api/members' && method === 'PUT') {
    const body = await readBody(req);
    if (!Array.isArray(body.members)) return send(res, 400, { error: 'members must be a list' });
    const seen = new Set();
    state.members = body.members
      .map((n) => str(n, 100))
      .filter((n) => n && !seen.has(n.toLowerCase()) && seen.add(n.toLowerCase()));
    commit();
    return send(res, 200, publicState());
  }

  if (pathname === '/api/import' && method === 'POST') {
    const body = await readBody(req);
    if (!Array.isArray(body.tasks)) return send(res, 400, { error: 'tasks must be a list' });
    let added = 0;
    for (const raw of body.tasks.slice(0, 1000)) {
      const t = cleanTask(
        { priority: 'Medium', status: 'Not Started', project: '', title: '', assignee: '', dateAssigned: '', dueDate: '', nextAction: '', links: '', ...raw },
        { id: newId(), notes: [], createdAt: new Date().toISOString() }
      );
      if (!t.title) continue;
      const note = str(raw.note, 4000);
      if (note) t.notes.push({ id: newId(), date: date(raw.lastUpdated) || today(), author: '', text: note });
      t.lastUpdated = date(raw.lastUpdated) || today();
      state.tasks.push(t);
      if (t.assignee && !state.members.includes(t.assignee)) state.members.push(t.assignee);
      added++;
    }
    commit();
    return send(res, 200, { added, ...publicState() });
  }

  return send(res, 404, { error: 'Not found' });
}

// ---------- static files ----------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    return serveStatic(req, res, url);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) send(res, err.status || 500, { error: err.status ? err.message : 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log(`SFG Task Manager running at http://localhost:${PORT}`);
  if (!TEAM_PASSCODE) console.log('Note: TEAM_PASSCODE is not set — anyone who can reach this server can view and edit tasks.');
});
