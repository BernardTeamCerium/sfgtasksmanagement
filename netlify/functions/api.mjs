// Netlify Function: serves every /api/* request using the shared core,
// with team data stored in Netlify Blobs (built into every Netlify site — no setup needed).
import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import core from '../../lib/core.js';

const KEY = 'state';

const storage = {
  async load() {
    const store = getStore({ name: 'sfg-task-manager', consistency: 'strong' });
    const found = await store.getWithMetadata(KEY, { type: 'json' });
    return found ? { state: found.data, etag: found.etag } : { state: null, etag: null };
  },
  async save(state, etag) {
    const store = getStore({ name: 'sfg-task-manager', consistency: 'strong' });
    const res = await store.setJSON(KEY, state, etag ? { onlyIfMatch: etag } : { onlyIfNew: true });
    return res.modified !== false;
  },
};

let api;

export default async (req) => {
  api ||= core.createApi({
    storage,
    passcode: process.env.TEAM_PASSCODE || '',
    secret: process.env.SESSION_SECRET || '',
    crypto,
  });
  const url = new URL(req.url);
  let body = {};
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const text = await req.text();
    if (text.length > 1024 * 1024) return Response.json({ error: 'Payload too large' }, { status: 413 });
    if (text) {
      try { body = JSON.parse(text); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }
    }
  }
  const out = await api.handle({
    method: req.method,
    pathname: url.pathname,
    cookie: req.headers.get('cookie') || '',
    body,
    secure: url.protocol === 'https:',
  });
  return new Response(JSON.stringify(out.body), {
    status: out.status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...out.headers },
  });
};

export const config = { path: '/api/*' };
