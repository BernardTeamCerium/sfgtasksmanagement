// Sibley Financial Group — Team Task Manager
// Zero-dependency Node.js server (Node 18+). Serves the web app from ./public
// and stores shared team data in ./data/tasks.json. (On Netlify, see netlify/functions/api.mjs.)

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { createApi } = require('./lib/core');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'tasks.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const TEAM_PASSCODE = process.env.TEAM_PASSCODE || '';
const MAX_BODY = 1024 * 1024;

// ---------- file storage (single process, so writes never conflict) ----------

const storage = {
  async load() {
    try {
      return { state: JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')), etag: null };
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      return { state: null, etag: null };
    }
  },
  async save(state) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DATA_FILE + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, DATA_FILE);
    return true;
  },
};

const api = createApi({ storage, passcode: TEAM_PASSCODE, secret: process.env.SESSION_SECRET || '', crypto: require('crypto') });

// Serialize requests so a read-modify-write never interleaves with another.
let queue = Promise.resolve();
const serialized = (fn) => (queue = queue.then(fn, fn));

// ---------- http ----------

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

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

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
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
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
    if (url.pathname.startsWith('/api/')) {
      const body = req.method === 'GET' ? {} : await readBody(req);
      const out = await serialized(() => api.handle({
        method: req.method,
        pathname: url.pathname,
        cookie: req.headers.cookie,
        body,
        secure: req.headers['x-forwarded-proto'] === 'https',
      }));
      return sendJson(res, out.status, out.body, out.headers);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end('Method not allowed'); }
    return serveStatic(req, res, url);
  } catch (err) {
    if (!err.status) console.error(err);
    if (!res.headersSent) sendJson(res, err.status || 500, { error: err.status ? err.message : 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log(`SFG Task Manager running at http://localhost:${PORT}`);
  if (!TEAM_PASSCODE) console.log('Note: TEAM_PASSCODE is not set — anyone who can reach this server can view and edit tasks.');
});
