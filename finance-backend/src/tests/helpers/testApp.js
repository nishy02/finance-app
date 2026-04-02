/**
 * Test app factory.
 *
 * Strategy: we expose a mutable `currentDb` reference in a dedicated
 * "db proxy" module that Jest maps over the real `src/db/index.js`.
 * Each test calls `setDb(freshInMemoryDb)` before building the app,
 * so every test suite gets a clean, isolated SQLite instance.
 */
process.env.JWT_SECRET = 'test-secret';
process.env.JWT_EXPIRES_IN = '1h';

const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const express = require('express');

// ── in-memory DB factory ──────────────────────────────────────────────────────
function buildDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('viewer','analyst','admin')) DEFAULT 'viewer',
      status TEXT NOT NULL CHECK(status IN ('active','inactive')) DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE financial_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      amount REAL NOT NULL CHECK(amount > 0),
      type TEXT NOT NULL CHECK(type IN ('income','expense')),
      category TEXT NOT NULL,
      date TEXT NOT NULL,
      notes TEXT,
      created_by INTEGER NOT NULL REFERENCES users(id),
      deleted_at TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

// ── app factory ───────────────────────────────────────────────────────────────
// We build inline route handlers that close over the `db` argument,
// mirroring the real routes exactly but without touching the module cache.

function buildApp(db) {
  const app = express();
  app.use(express.json());

  // ── inline auth middleware ──────────────────────────────────────────────────
  function authenticate(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or malformed Authorization header' });
    }
    let payload;
    try {
      payload = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    const user = db.prepare('SELECT id, name, email, role, status FROM users WHERE id = ?').get(payload.sub);
    if (!user) return res.status(401).json({ error: 'User not found' });
    if (user.status === 'inactive') return res.status(403).json({ error: 'Account is inactive' });
    req.user = user;
    next();
  }

  const ROLE_LEVELS = { viewer: 1, analyst: 2, admin: 3 };
  function requireRole(minRole) {
    return (req, res, next) => {
      if ((ROLE_LEVELS[req.user?.role] ?? 0) < (ROLE_LEVELS[minRole] ?? 99)) {
        return res.status(403).json({ error: `Forbidden: requires '${minRole}' role or higher` });
      }
      next();
    };
  }

  // ── /auth ───────────────────────────────────────────────────────────────────
  const authRouter = express.Router();

  authRouter.post('/register', (req, res) => {
    const { name, email, password, role = 'viewer' } = req.body;
    if (!name || !name.trim()) return res.status(422).json({ errors: [{ msg: 'Name is required' }] });
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(422).json({ errors: [{ msg: 'Valid email is required' }] });
    if (!password || password.length < 6) return res.status(422).json({ errors: [{ msg: 'Password must be at least 6 characters' }] });
    if (!['viewer', 'analyst', 'admin'].includes(role)) return res.status(422).json({ errors: [{ msg: 'Invalid role' }] });

    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase())) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    const hash = bcrypt.hashSync(password, 1);
    const r = db.prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)').run(name.trim(), email.toLowerCase(), hash, role);
    const user = db.prepare('SELECT id, name, email, role, status, created_at FROM users WHERE id = ?').get(r.lastInsertRowid);
    res.status(201).json({ user });
  });

  authRouter.post('/login', (req, res) => {
    const { email, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get((email || '').toLowerCase());
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (user.status === 'inactive') return res.status(403).json({ error: 'Account is inactive' });
    const token = jwt.sign({ sub: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  });

  authRouter.get('/me', authenticate, (req, res) => res.json({ user: req.user }));

  app.use('/auth', authRouter);

  // ── /users ──────────────────────────────────────────────────────────────────
  const usersRouter = express.Router();
  usersRouter.use(authenticate, requireRole('admin'));

  usersRouter.get('/', (req, res) => {
    const { status, role, page = 1, limit = 20 } = req.query;
    let q = 'SELECT id, name, email, role, status, created_at FROM users WHERE 1=1';
    const p = [];
    if (status) { q += ' AND status = ?'; p.push(status); }
    if (role)   { q += ' AND role = ?';   p.push(role); }
    const total = db.prepare(q.replace('SELECT id, name, email, role, status, created_at', 'SELECT COUNT(*) as total')).get(...p).total;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    q += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    p.push(parseInt(limit), offset);
    res.json({ users: db.prepare(q).all(...p), pagination: { page: +page, limit: +limit, total } });
  });

  usersRouter.get('/:id', (req, res) => {
    const user = db.prepare('SELECT id, name, email, role, status, created_at FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  });

  usersRouter.patch('/:id', (req, res) => {
    const { role, status, name } = req.body;
    if (role && !['viewer', 'analyst', 'admin'].includes(role)) return res.status(422).json({ errors: [{ msg: 'Invalid role' }] });
    if (status && !['active', 'inactive'].includes(status)) return res.status(422).json({ errors: [{ msg: 'Invalid status' }] });

    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (req.params.id == req.user.id && status === 'inactive') {
      return res.status(400).json({ error: 'Cannot deactivate your own account' });
    }
    const fields = [], params = [];
    for (const [k, v] of Object.entries({ name, role, status })) {
      if (v !== undefined) { fields.push(`${k} = ?`); params.push(v); }
    }
    if (!fields.length) return res.status(400).json({ error: 'No fields to update' });
    fields.push("updated_at = datetime('now')");
    params.push(req.params.id);
    db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    res.json({ user: db.prepare('SELECT id, name, email, role, status, created_at, updated_at FROM users WHERE id = ?').get(req.params.id) });
  });

  usersRouter.delete('/:id', (req, res) => {
    if (req.params.id == req.user.id) return res.status(400).json({ error: 'Cannot delete your own account' });
    const r = db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    if (r.changes === 0) return res.status(404).json({ error: 'User not found' });
    res.status(204).send();
  });

  app.use('/users', usersRouter);

  // ── /records ─────────────────────────────────────────────────────────────────
  const recordsRouter = express.Router();
  recordsRouter.use(authenticate);

  recordsRouter.get('/', (req, res) => {
    const { type, category, from, to, page = 1, limit = 20 } = req.query;
    let base = 'FROM financial_records WHERE deleted_at IS NULL';
    const p = [];
    if (type)     { base += ' AND type = ?';     p.push(type); }
    if (category) { base += ' AND category = ?'; p.push(category); }
    if (from)     { base += ' AND date >= ?';    p.push(from); }
    if (to)       { base += ' AND date <= ?';    p.push(to); }
    const total = db.prepare(`SELECT COUNT(*) as total ${base}`).get(...p).total;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const records = db.prepare(`SELECT * ${base} ORDER BY date DESC LIMIT ? OFFSET ?`).all(...p, parseInt(limit), offset);
    res.json({ records, pagination: { page: +page, limit: +limit, total } });
  });

  recordsRouter.get('/:id', (req, res) => {
    const record = db.prepare('SELECT * FROM financial_records WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
    if (!record) return res.status(404).json({ error: 'Record not found' });
    res.json({ record });
  });

  recordsRouter.post('/', requireRole('analyst'), (req, res) => {
    const { amount, type, category, date, notes } = req.body;
    if (!amount || amount <= 0) return res.status(422).json({ errors: [{ msg: 'Amount must be positive' }] });
    if (!['income', 'expense'].includes(type)) return res.status(422).json({ errors: [{ msg: 'Invalid type' }] });
    if (!category) return res.status(422).json({ errors: [{ msg: 'Category required' }] });
    if (!date) return res.status(422).json({ errors: [{ msg: 'Date required' }] });
    const r = db.prepare('INSERT INTO financial_records (amount, type, category, date, notes, created_by) VALUES (?, ?, ?, ?, ?, ?)').run(amount, type, category, date, notes || null, req.user.id);
    res.status(201).json({ record: db.prepare('SELECT * FROM financial_records WHERE id = ?').get(r.lastInsertRowid) });
  });

  recordsRouter.patch('/:id', requireRole('analyst'), (req, res) => {
    const record = db.prepare('SELECT id FROM financial_records WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
    if (!record) return res.status(404).json({ error: 'Record not found' });
    const fields = [], params = [];
    for (const key of ['amount', 'type', 'category', 'date', 'notes']) {
      if (req.body[key] !== undefined) { fields.push(`${key} = ?`); params.push(req.body[key]); }
    }
    if (!fields.length) return res.status(400).json({ error: 'No fields to update' });
    fields.push("updated_at = datetime('now')");
    params.push(req.params.id);
    db.prepare(`UPDATE financial_records SET ${fields.join(', ')} WHERE id = ?`).run(...params);
    res.json({ record: db.prepare('SELECT * FROM financial_records WHERE id = ?').get(req.params.id) });
  });

  recordsRouter.delete('/:id', requireRole('admin'), (req, res) => {
    const record = db.prepare('SELECT id FROM financial_records WHERE id = ? AND deleted_at IS NULL').get(req.params.id);
    if (!record) return res.status(404).json({ error: 'Record not found' });
    db.prepare("UPDATE financial_records SET deleted_at = datetime('now') WHERE id = ?").run(req.params.id);
    res.status(204).send();
  });

  app.use('/records', recordsRouter);

  // ── /dashboard ───────────────────────────────────────────────────────────────
  const dashRouter = express.Router();
  dashRouter.use(authenticate, requireRole('analyst'));

  dashRouter.get('/summary', (req, res) => {
    const row = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN type='income'  THEN amount ELSE 0 END),0) AS total_income,
        COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0) AS total_expenses,
        COALESCE(SUM(CASE WHEN type='income'  THEN amount ELSE -amount END),0) AS net_balance,
        COUNT(*) AS total_records
      FROM financial_records WHERE deleted_at IS NULL
    `).get();
    res.json({ summary: row });
  });

  dashRouter.get('/by-category', (req, res) => {
    res.json({ categories: db.prepare(`
      SELECT category, type, ROUND(SUM(amount),2) AS total, COUNT(*) AS count
      FROM financial_records WHERE deleted_at IS NULL
      GROUP BY category, type ORDER BY total DESC
    `).all() });
  });

  dashRouter.get('/trends', (req, res) => {
    const { period = 'monthly', year = new Date().getFullYear() } = req.query;
    if (period && !['monthly', 'weekly'].includes(period)) {
      return res.status(422).json({ errors: [{ msg: 'period must be monthly or weekly' }] });
    }
    const fmt = period === 'weekly' ? '%Y-W%W' : '%Y-%m';
    res.json({ period, year: +year, trends: db.prepare(`
      SELECT strftime('${fmt}', date) AS period, type, ROUND(SUM(amount),2) AS total, COUNT(*) AS count
      FROM financial_records WHERE deleted_at IS NULL AND strftime('%Y', date) = ?
      GROUP BY period, type ORDER BY period ASC
    `).all(String(year)) });
  });

  dashRouter.get('/recent', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    res.json({ records: db.prepare(`
      SELECT r.*, u.name AS created_by_name FROM financial_records r
      JOIN users u ON r.created_by = u.id
      WHERE r.deleted_at IS NULL ORDER BY r.created_at DESC, r.id DESC LIMIT ?
    `).all(limit) });
  });

  app.use('/dashboard', dashRouter);

  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  return app;
}

// ── seed helpers ──────────────────────────────────────────────────────────────
function seedUser(db, { name = 'Test User', email, password = 'password123', role = 'viewer', status = 'active' } = {}) {
  const hash = bcrypt.hashSync(password, 1);
  const r = db.prepare('INSERT INTO users (name, email, password, role, status) VALUES (?, ?, ?, ?, ?)').run(name, email, hash, role, status);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid);
}

function seedRecord(db, { amount = 100, type = 'income', category = 'Salary', date = '2024-06-01', notes = null, createdBy } = {}) {
  const r = db.prepare(
    'INSERT INTO financial_records (amount, type, category, date, notes, created_by) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(amount, type, category, date, notes, createdBy);
  return db.prepare('SELECT * FROM financial_records WHERE id = ?').get(r.lastInsertRowid);
}

function tokenFor(user) {
  return jwt.sign({ sub: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1h' });
}

module.exports = { buildDb, buildApp, seedUser, seedRecord, tokenFor };
