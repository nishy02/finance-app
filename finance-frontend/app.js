// ── config ────────────────────────────────────────────────────────────────────
const API = '';

// ── auth helpers ──────────────────────────────────────────────────────────────
const auth = {
  save(token, user) {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
  },
  token() { return localStorage.getItem('token'); },
  user()  { const u = localStorage.getItem('user'); return u ? JSON.parse(u) : null; },
  clear() { localStorage.removeItem('token'); localStorage.removeItem('user'); },
  role()  { return this.user()?.role; },
  is(role) {
    const levels = { viewer: 1, analyst: 2, admin: 3 };
    return (levels[this.role()] ?? 0) >= (levels[role] ?? 99);
  },
};

// ── API client ────────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (auth.token()) opts.headers['Authorization'] = `Bearer ${auth.token()}`;
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(API + path, opts);
  if (res.status === 401) { auth.clear(); location.href = '/index.html'; return; }
  const data = res.status === 204 ? null : await res.json();
  if (!res.ok) throw data;
  return data;
}

// ── nav ───────────────────────────────────────────────────────────────────────
function renderNav() {
  const user = auth.user();
  if (!user) return;

  const nav = document.getElementById('nav');
  if (!nav) return;

  const pages = [
    { href: 'dashboard.html', label: 'Dashboard', minRole: 'analyst' },
    { href: 'records.html',   label: 'Records',   minRole: 'viewer' },
    { href: 'users.html',     label: 'Users',     minRole: 'admin' },
  ];

  const current = location.pathname.split('/').pop();

  nav.innerHTML = `
    <div class="nav-brand">💰 FinanceApp</div>
    <div class="nav-links">
      ${pages.filter(p => auth.is(p.minRole)).map(p => `
        <a href="${p.href}" class="${current === p.href ? 'active' : ''}">${p.label}</a>
      `).join('')}
    </div>
    <div class="nav-user">
      <span class="badge badge-${user.role}">${user.role}</span>
      <span>${user.name}</span>
      <button onclick="logout()" class="btn btn-sm btn-ghost">Logout</button>
    </div>
  `;
}

function logout() {
  auth.clear();
  location.href = 'index.html';
}

// ── guard: redirect to login if not authenticated ─────────────────────────────
function requireAuth(minRole) {
  if (!auth.token()) { location.href = 'index.html'; return false; }
  if (minRole && !auth.is(minRole)) {
    document.body.innerHTML = `<div class="empty-state">
      <div class="empty-icon">🔒</div>
      <p>You don't have permission to view this page.</p>
      <a href="dashboard.html" class="btn btn-primary">Go to Dashboard</a>
    </div>`;
    return false;
  }
  return true;
}

// ── toast notifications ───────────────────────────────────────────────────────
function toast(msg, type = 'success') {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3000);
}

// ── modal helpers ─────────────────────────────────────────────────────────────
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
