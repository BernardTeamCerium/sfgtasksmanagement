/* Sibley Financial Group — Team Task Manager (client) */
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const store = {
  get(k, d) { try { const v = localStorage.getItem('sfg.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('sfg.' + k, JSON.stringify(v)); } catch { /* ignore */ } },
};

const S = {
  data: { tasks: [], members: [], statuses: [], priorities: [], version: 0 },
  view: store.get('view', 'table'),
  me: store.get('me', ''),
  sort: store.get('sort', { key: 'dueDate', dir: 1 }),
  quick: '',
  editingId: null,
  draftNotes: [],
};

// ---------- utilities ----------

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${m}/${d}/${y}`;
}
function initials(name) {
  return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';
}
function cls(s) { return String(s).replace(/\s+/g, ''); }
function linkify(text) {
  return esc(text).replace(/\bhttps?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()">${u}</a>`);
}

function dueState(t) {
  if (!t.dueDate || t.status === 'Completed') return '';
  const today = todayISO();
  if (t.dueDate < today) return 'overdue';
  if (t.dueDate <= addDays(today, 7)) return 'soon';
  return '';
}
function latestNote(t) {
  const n = t.notes || [];
  return n.length ? [...n].sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0] : null;
}

let toastTimer;
function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('error', isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2600);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/login') { showLogin(); throw new Error('Sign in required'); }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ---------- data ----------

async function refresh(force = false) {
  const data = await api('/api/state');
  if (!force && data.version === S.data.version) return;
  S.data = data;
  populateSelects();
  render();
}

function upsertTask(task, version) {
  const i = S.data.tasks.findIndex((t) => t.id === task.id);
  if (i === -1) S.data.tasks.push(task); else S.data.tasks[i] = task;
  if (version) S.data.version = version;
  populateSelects();
  render();
}

async function patchTask(id, changes) {
  try {
    const { task, version } = await api(`/api/tasks/${id}`, { method: 'PUT', body: changes });
    upsertTask(task, version);
    toast('Task updated');
  } catch (e) { toast(e.message, true); }
}

// ---------- filters ----------

function filters() {
  return {
    q: $('#search').value.trim().toLowerCase(),
    assignee: $('#fAssignee').value,
    project: $('#fProject').value,
    priority: $('#fPriority').value,
    status: $('#fStatus').value,
  };
}

function filteredTasks({ ignoreStatus = false } = {}) {
  const f = filters();
  const today = todayISO();
  const week = addDays(today, 7);
  return S.data.tasks.filter((t) => {
    if (f.assignee && t.assignee !== f.assignee) return false;
    if (f.project && t.project !== f.project) return false;
    if (f.priority && t.priority !== f.priority) return false;
    if (!ignoreStatus) {
      if (f.status === '__all') { /* everything */ }
      else if (f.status) { if (t.status !== f.status) return false; }
      else if (S.quick !== 'completed' && t.status === 'Completed') return false;
    }
    if (S.quick === 'open' && t.status === 'Completed') return false;
    if (S.quick === 'overdue' && dueState(t) !== 'overdue') return false;
    if (S.quick === 'soon' && !(t.status !== 'Completed' && t.dueDate && t.dueDate >= today && t.dueDate <= week)) return false;
    if (S.quick === 'completed' && t.status !== 'Completed') return false;
    if (f.q) {
      const hay = [t.project, t.title, t.assignee, t.nextAction, t.links, t.status, t.priority, ...(t.notes || []).map((n) => n.text)].join(' ').toLowerCase();
      if (!hay.includes(f.q)) return false;
    }
    return true;
  });
}

const PRI_RANK = { High: 0, Medium: 1, Low: 2 };
function sortTasks(list) {
  const { key, dir } = S.sort;
  const val = (t) => {
    if (key === 'priority') return PRI_RANK[t.priority] ?? 9;
    if (key === 'status') return S.data.statuses.indexOf(t.status);
    if (key === 'update') return latestNote(t)?.date || '';
    return (t[key] || '').toString().toLowerCase();
  };
  return [...list].sort((a, b) => {
    let va = val(a), vb = val(b);
    // empty dates always last
    if (va === '' && vb !== '') return 1;
    if (vb === '' && va !== '') return -1;
    if (va < vb) return -dir;
    if (va > vb) return dir;
    return (PRI_RANK[a.priority] ?? 9) - (PRI_RANK[b.priority] ?? 9);
  });
}

// ---------- rendering ----------

function populateSelects() {
  const { members, priorities, statuses, tasks } = S.data;
  const projects = [...new Set(tasks.map((t) => t.project).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const allPeople = [...new Set([...members, ...tasks.map((t) => t.assignee).filter(Boolean)])];

  const fill = (sel, items, first) => {
    const cur = sel.value;
    sel.innerHTML = (first ? `<option value="">${esc(first)}</option>` : '') + items.map((i) => {
      const [v, l] = Array.isArray(i) ? i : [i, i];
      return `<option value="${esc(v)}">${esc(l)}</option>`;
    }).join('');
    if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
  };

  fill($('#fAssignee'), allPeople, 'All owners');
  fill($('#fProject'), projects, 'All projects');
  fill($('#fPriority'), priorities, 'All priorities');
  fill($('#fStatus'), [...statuses.map((s) => [s, s]), ['__all', 'All (incl. completed)']], 'All open');
  fill($('#me'), [['', '— Select your name —'], ...members.map((m) => [m, m])]);
  $('#me').value = S.me;

  const form = $('#taskForm');
  fill(form.assignee, [['', 'Unassigned'], ...allPeople.map((m) => [m, m])]);
  fill(form.priority, priorities);
  fill(form.status, statuses);
  $('#projectList').innerHTML = projects.map((p) => `<option value="${esc(p)}"></option>`).join('');
}

function renderStats() {
  const tasks = S.data.tasks;
  const today = todayISO();
  const week = addDays(today, 7);
  const open = tasks.filter((t) => t.status !== 'Completed');
  $('#statOpen').textContent = open.length;
  $('#statOverdue').textContent = open.filter((t) => t.dueDate && t.dueDate < today).length;
  $('#statSoon').textContent = open.filter((t) => t.dueDate && t.dueDate >= today && t.dueDate <= week).length;
  $('#statDone').textContent = tasks.filter((t) => t.status === 'Completed').length;
  $$('.stat').forEach((b) => b.classList.toggle('active', b.dataset.quick === S.quick));
}

function render() {
  renderStats();
  $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.view === S.view));
  const root = $('#view');
  if (S.view === 'board') root.innerHTML = renderBoard();
  else if (S.view === 'people') root.innerHTML = renderPeople();
  else root.innerHTML = renderTable();
  if (S.view === 'board') wireBoard();
}

const optionList = (items, cur) => items.map((i) => `<option ${i === cur ? 'selected' : ''}>${esc(i)}</option>`).join('');

function dueHTML(t) {
  if (!t.dueDate) return '<span class="muted">—</span>';
  const st = dueState(t);
  return `<span class="due ${st}" title="${st === 'overdue' ? 'Overdue' : st === 'soon' ? 'Due within 7 days' : ''}">${fmtDate(t.dueDate)}</span>`;
}

function renderTable() {
  const list = sortTasks(filteredTasks());
  if (!list.length) return emptyState();
  const cols = [
    ['project', 'Project / Workstream'], ['title', 'Task'], ['dateAssigned', 'Assigned'], ['assignee', 'Owner'],
    ['dueDate', 'Due Date'], ['priority', 'Priority'], ['status', 'Status'], ['update', 'Latest Update'], ['nextAction', 'Next Action'],
  ];
  const head = cols.map(([k, l]) => `<th data-sort="${k}">${l}${S.sort.key === k ? `<span class="arrow">${S.sort.dir > 0 ? '▲' : '▼'}</span>` : ''}</th>`).join('');
  const rows = list.map((t) => {
    const n = latestNote(t);
    return `<tr data-id="${esc(t.id)}" class="${t.status === 'Completed' ? 'done' : ''}">
      <td class="t-project">${esc(t.project)}</td>
      <td class="t-title">${esc(t.title)}</td>
      <td>${fmtDate(t.dateAssigned)}</td>
      <td class="t-owner">${t.assignee ? `<span class="avatar" title="${esc(t.assignee)}">${esc(initials(t.assignee))}</span> ${esc(t.assignee)}` : '<span class="muted">Unassigned</span>'}</td>
      <td>${dueHTML(t)}</td>
      <td><select class="inline chip p-${esc(t.priority)}" data-field="priority">${optionList(S.data.priorities, t.priority)}</select></td>
      <td><select class="inline chip s-${esc(cls(t.status))}" data-field="status">${optionList(S.data.statuses, t.status)}</select></td>
      <td>${n ? `<span class="t-note-date">${fmtDate(n.date)}${n.author ? ' · ' + esc(n.author) : ''}</span><div class="t-clamp">${esc(n.text)}</div>` : '<span class="muted">—</span>'}</td>
      <td><div class="t-clamp">${esc(t.nextAction) || '<span class="muted">—</span>'}</div></td>
    </tr>`;
  }).join('');
  return `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function cardHTML(t) {
  const st = dueState(t);
  return `<div class="card" draggable="true" data-id="${esc(t.id)}">
    ${t.project ? `<div class="card-project">${esc(t.project)}</div>` : ''}
    <div class="card-title">${esc(t.title)}</div>
    ${t.nextAction ? `<div class="card-next t-clamp">→ ${esc(t.nextAction)}</div>` : ''}
    <div class="card-meta">
      <span class="chip p-${esc(t.priority)}">${esc(t.priority)}</span>
      ${t.dueDate ? `<span class="chip ${st ? 'chip-' + st : ''}" style="${st ? '' : 'background:#eef0f3;color:#4b5565'}">Due ${fmtDate(t.dueDate)}</span>` : ''}
      ${t.assignee ? `<span class="avatar" title="${esc(t.assignee)}">${esc(initials(t.assignee))}</span>` : ''}
    </div>
  </div>`;
}

function renderBoard() {
  const f = filters();
  let list = filteredTasks({ ignoreStatus: true });
  if (f.status && f.status !== '__all') list = list.filter((t) => t.status === f.status);
  list = sortTasks(list);
  if (S.quick && S.quick !== 'completed' && S.quick !== 'open') { /* quick filters already applied */ }
  const cols = S.data.statuses.map((s) => {
    const items = list.filter((t) => t.status === s);
    return `<div class="column" data-status="${esc(s)}">
      <div class="column-head"><span>${esc(s)}</span><span class="column-count">${items.length}</span></div>
      ${items.map(cardHTML).join('')}
    </div>`;
  }).join('');
  return `<div class="board">${cols}</div>`;
}

function renderPeople() {
  const list = sortTasks(filteredTasks());
  const people = [...new Set([...S.data.members, ...list.map((t) => t.assignee || '')])];
  const blocks = people.map((p) => {
    const mine = list.filter((t) => (t.assignee || '') === p);
    if (!mine.length && (filters().assignee || !p)) return '';
    const overdue = mine.filter((t) => dueState(t) === 'overdue').length;
    return `<div class="person">
      <div class="person-head">
        <span class="avatar">${esc(p ? initials(p) : '?')}</span>
        <div><div class="person-name">${esc(p || 'Unassigned')}</div>
        <div class="person-sub">${mine.length} task${mine.length === 1 ? '' : 's'}${overdue ? ` · ${overdue} overdue` : ''}</div></div>
      </div>
      <ul class="person-list">
        ${mine.length ? mine.map((t) => `<li data-id="${esc(t.id)}">
          <div class="grow"><div class="t-title">${esc(t.title)}</div><div class="sub">${esc(t.project)}${t.project ? ' · ' : ''}${esc(t.status)}</div></div>
          <span class="chip p-${esc(t.priority)}">${esc(t.priority)}</span>
          ${dueHTML(t)}
        </li>`).join('') : '<li class="muted" style="cursor:default">Nothing here 🎉</li>'}
      </ul>
    </div>`;
  }).join('');
  return blocks.trim() ? `<div class="people">${blocks}</div>` : emptyState();
}

function emptyState() {
  return `<div class="empty"><p><strong>No tasks match these filters.</strong></p><p>Try clearing filters or add a new task.</p></div>`;
}

// ---------- board drag & drop ----------

function wireBoard() {
  $$('.card').forEach((c) => {
    c.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', c.dataset.id); c.classList.add('dragging'); });
    c.addEventListener('dragend', () => c.classList.remove('dragging'));
  });
  $$('.column').forEach((col) => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drag-over'); });
    col.addEventListener('dragleave', () => col.classList.remove('drag-over'));
    col.addEventListener('drop', (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      const id = e.dataTransfer.getData('text/plain');
      const t = S.data.tasks.find((x) => x.id === id);
      if (t && t.status !== col.dataset.status) patchTask(id, { status: col.dataset.status });
    });
  });
}

// ---------- task modal ----------

function openTask(id) {
  const t = id ? S.data.tasks.find((x) => x.id === id) : null;
  S.editingId = t ? t.id : null;
  S.draftNotes = [];
  const form = $('#taskForm');
  form.reset();
  $('#taskModalTitle').textContent = t ? 'Edit Task' : 'New Task';
  $('#deleteTaskBtn').hidden = !t;
  form.title.value = t?.title || '';
  form.project.value = t?.project || '';
  form.assignee.value = t ? (t.assignee || '') : (filters().assignee || S.me || '');
  form.dateAssigned.value = t?.dateAssigned || todayISO();
  form.dueDate.value = t?.dueDate || '';
  form.priority.value = t?.priority || 'Medium';
  form.status.value = t?.status || 'Not Started';
  form.nextAction.value = t?.nextAction || '';
  form.links.value = t?.links || '';
  $('#noteDate').value = todayISO();
  $('#noteText').value = '';
  renderNotes(t);
  $('#taskModal').showModal();
  if (!t) form.title.focus();
}

function renderNotes(t) {
  const notes = t ? [...(t.notes || [])] : S.draftNotes;
  notes.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  $('#notes').innerHTML = notes.length ? notes.map((n) => `<li>
    <div class="note-meta"><strong>${fmtDate(n.date)}</strong>${n.author ? `<span>${esc(n.author)}</span>` : ''}</div>
    <div class="note-text">${linkify(n.text)}</div>
    ${t ? `<button type="button" class="note-del" data-note="${esc(n.id)}" title="Delete update">×</button>` : ''}
  </li>`).join('') : '<li class="muted" style="border-left-color:var(--border)">No updates yet.</li>';
  $('#lastUpdated').textContent = t?.lastUpdated ? `Last updated ${fmtDate(t.lastUpdated)}` : '';
}

async function addNote() {
  const text = $('#noteText').value.trim();
  if (!text) return $('#noteText').focus();
  const date = $('#noteDate').value || todayISO();
  if (!S.editingId) {
    S.draftNotes.push({ date, author: S.me, text });
    $('#noteText').value = '';
    return renderNotes(null);
  }
  try {
    const { task, version } = await api(`/api/tasks/${S.editingId}/notes`, { method: 'POST', body: { text, date, author: S.me } });
    upsertTask(task, version);
    $('#noteText').value = '';
    renderNotes(task);
    toast('Update added');
  } catch (e) { toast(e.message, true); }
}

async function saveTask(e) {
  e.preventDefault();
  const form = $('#taskForm');
  const body = {
    title: form.title.value, project: form.project.value, assignee: form.assignee.value,
    dateAssigned: form.dateAssigned.value, dueDate: form.dueDate.value,
    priority: form.priority.value, status: form.status.value,
    nextAction: form.nextAction.value, links: form.links.value,
  };
  // Pending text in the update box is saved too, so nothing typed is lost.
  const pending = $('#noteText').value.trim();
  try {
    let res;
    if (S.editingId) {
      res = await api(`/api/tasks/${S.editingId}`, { method: 'PUT', body });
      if (pending) res = await api(`/api/tasks/${S.editingId}/notes`, { method: 'POST', body: { text: pending, date: $('#noteDate').value, author: S.me } });
    } else {
      res = await api('/api/tasks', { method: 'POST', body });
      const notes = [...S.draftNotes];
      if (pending) notes.push({ text: pending, date: $('#noteDate').value, author: S.me });
      for (const n of notes) res = await api(`/api/tasks/${res.task.id}/notes`, { method: 'POST', body: n });
    }
    upsertTask(res.task, res.version);
    $('#taskModal').close();
    toast(S.editingId ? 'Task saved' : 'Task created');
  } catch (err) { toast(err.message, true); }
}

async function deleteTask() {
  const t = S.data.tasks.find((x) => x.id === S.editingId);
  if (!t || !confirm(`Delete "${t.title}"? This can't be undone.`)) return;
  try {
    const { version } = await api(`/api/tasks/${t.id}`, { method: 'DELETE' });
    S.data.tasks = S.data.tasks.filter((x) => x.id !== t.id);
    S.data.version = version;
    $('#taskModal').close();
    populateSelects();
    render();
    toast('Task deleted');
  } catch (e) { toast(e.message, true); }
}

// ---------- settings ----------

function renderMembers() {
  $('#memberList').innerHTML = S.data.members.map((m, i) => `<li>
    <span class="avatar">${esc(initials(m))}</span><span class="grow">${esc(m)}</span>
    <button class="btn btn-link" data-remove="${i}">Remove</button>
  </li>`).join('') || '<li class="muted">No team members yet.</li>';
}

async function saveMembers(members) {
  try {
    S.data = await api('/api/members', { method: 'PUT', body: { members } });
    populateSelects();
    renderMembers();
    render();
  } catch (e) { toast(e.message, true); }
}

const CSV_COLS = ['Project / Workstream', 'Task', 'Date Assigned', 'Assigned To', 'Due Date', 'Priority', 'Status', 'Task Updates', 'Next Action', 'Last Updated', 'Links / Files'];

function exportCSV() {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = sortTasks(S.data.tasks).map((t) => {
    const notes = [...(t.notes || [])].sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .map((n) => `${fmtDate(n.date)}${n.author ? ' (' + n.author + ')' : ''}: ${n.text}`).join('\n');
    return [t.project, t.title, fmtDate(t.dateAssigned), t.assignee, fmtDate(t.dueDate), t.priority, t.status, notes, t.nextAction, fmtDate(t.lastUpdated), t.links].map(q).join(',');
  });
  const blob = new Blob([[CSV_COLS.map(q).join(','), ...rows].join('\r\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `sfg-tasks-${todayISO()}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function parseCSV(text) {
  const rows = []; let row = []; let cell = ''; let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') inQ = false;
      else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function toISO(s) {
  s = (s || '').trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  m = s.match(/^\d{4}-\d{2}-\d{2}$/);
  return m ? s : '';
}

async function importCSV(file) {
  const rows = parseCSV(await file.text());
  const headerIdx = rows.findIndex((r) => r.some((c) => c.trim() === 'Task'));
  if (headerIdx === -1) return toast('Could not find a "Task" header row in that CSV', true);
  const head = rows[headerIdx].map((h) => h.trim());
  const col = (name) => head.indexOf(name);
  const get = (r, name) => (col(name) >= 0 ? (r[col(name)] || '').trim() : '');
  const tasks = rows.slice(headerIdx + 1).filter((r) => get(r, 'Task')).map((r) => ({
    project: get(r, 'Project / Workstream'), title: get(r, 'Task'), dateAssigned: toISO(get(r, 'Date Assigned')),
    assignee: get(r, 'Assigned To'), dueDate: toISO(get(r, 'Due Date')), priority: get(r, 'Priority'),
    status: get(r, 'Status'), note: get(r, 'Task Updates'), nextAction: get(r, 'Next Action'),
    lastUpdated: toISO(get(r, 'Last Updated')), links: get(r, 'Links / Files'),
  }));
  if (!tasks.length) return toast('No task rows found', true);
  if (!confirm(`Import ${tasks.length} task(s)? They will be added alongside existing tasks.`)) return;
  try {
    const res = await api('/api/import', { method: 'POST', body: { tasks } });
    S.data = res;
    populateSelects(); renderMembers(); render();
    toast(`Imported ${res.added} task(s)`);
  } catch (e) { toast(e.message, true); }
}

// ---------- auth ----------

function showLogin() {
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#passcode').focus();
}

async function start() {
  const session = await api('/api/session');
  $('#logoutBtn').hidden = !session.authRequired;
  if (!session.authed) return showLogin();
  $('#login').hidden = true;
  $('#app').hidden = false;
  await refresh(true);
  if (!S.me && S.data.members.length) toast('Tip: choose your name in "I am" so your updates are signed.');
}

// ---------- events ----------

function wire() {
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#loginError').hidden = true;
    try {
      await api('/api/login', { method: 'POST', body: { passcode: $('#passcode').value } });
      $('#passcode').value = '';
      start();
    } catch (err) { $('#loginError').textContent = err.message; $('#loginError').hidden = false; }
  });
  $('#logoutBtn').addEventListener('click', async () => { await api('/api/logout', { method: 'POST' }); showLogin(); });

  $('#me').addEventListener('change', (e) => { S.me = e.target.value; store.set('me', S.me); });
  $('#newTaskBtn').addEventListener('click', () => openTask(null));

  $$('.tab').forEach((b) => b.addEventListener('click', () => { S.view = b.dataset.view; store.set('view', S.view); render(); }));
  $$('.stat').forEach((b) => b.addEventListener('click', () => {
    S.quick = S.quick === b.dataset.quick ? '' : b.dataset.quick;
    if (S.quick) $('#fStatus').value = '';
    render();
  }));

  ['#fAssignee', '#fProject', '#fPriority'].forEach((s) => $(s).addEventListener('change', render));
  $('#fStatus').addEventListener('change', () => { S.quick = ''; render(); });
  let t;
  $('#search').addEventListener('input', () => { clearTimeout(t); t = setTimeout(render, 150); });
  $('#clearFilters').addEventListener('click', () => {
    ['#search', '#fAssignee', '#fProject', '#fPriority', '#fStatus'].forEach((s) => ($(s).value = ''));
    S.quick = '';
    render();
  });

  const view = $('#view');
  view.addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (th) {
      const key = th.dataset.sort;
      S.sort = { key, dir: S.sort.key === key ? -S.sort.dir : 1 };
      store.set('sort', S.sort);
      return render();
    }
    if (e.target.closest('select, a')) return;
    const item = e.target.closest('[data-id]');
    if (item) openTask(item.dataset.id);
  });
  view.addEventListener('change', (e) => {
    const sel = e.target.closest('select[data-field]');
    if (!sel) return;
    const id = sel.closest('[data-id]').dataset.id;
    patchTask(id, { [sel.dataset.field]: sel.value });
  });

  $('#taskForm').addEventListener('submit', saveTask);
  $('#addNoteBtn').addEventListener('click', addNote);
  $('#noteText').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addNote(); } });
  $('#deleteTaskBtn').addEventListener('click', deleteTask);
  $('#notes').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-note]');
    if (!b || !S.editingId || !confirm('Delete this update?')) return;
    try {
      const { task, version } = await api(`/api/tasks/${S.editingId}/notes/${b.dataset.note}`, { method: 'DELETE' });
      upsertTask(task, version);
      renderNotes(task);
    } catch (err) { toast(err.message, true); }
  });

  $$('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

  $('#settingsBtn').addEventListener('click', () => { renderMembers(); $('#settingsModal').showModal(); });
  $('#memberForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#memberName').value.trim();
    if (!name) return;
    $('#memberName').value = '';
    saveMembers([...S.data.members, name]);
  });
  $('#memberList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-remove]');
    if (!b) return;
    const name = S.data.members[+b.dataset.remove];
    if (!confirm(`Remove ${name} from the team list? Their existing tasks stay assigned to them.`)) return;
    saveMembers(S.data.members.filter((_, i) => i !== +b.dataset.remove));
  });
  $('#exportBtn').addEventListener('click', exportCSV);
  $('#importFile').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importCSV(f); });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'n' && !e.metaKey && !e.ctrlKey && !document.querySelector('dialog[open]') && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
      e.preventDefault(); openTask(null);
    }
  });

  // Keep everyone in sync: pick up teammates' changes every 20s and when the tab regains focus.
  setInterval(() => { if (!document.hidden && !document.querySelector('dialog[open]') && !$('#app').hidden) refresh().catch(() => {}); }, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('#app').hidden) refresh().catch(() => {}); });
}

wire();
start().catch((e) => toast(e.message, true));
