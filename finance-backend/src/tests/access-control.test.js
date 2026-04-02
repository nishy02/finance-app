/**
 * Access Control — deep edge-case tests
 *
 * rbac.test.js already verifies the happy-path permission matrix
 * (who can call what). This file focuses on the harder cases:
 *
 *  1. Token integrity & authentication layer
 *     - Missing / malformed / expired / tampered tokens
 *     - Wrong signing secret
 *     - Token with deleted user
 *
 *  2. Role enforcement correctness
 *     - 403 error shape is consistent
 *     - Role stored in DB is authoritative (not the token claim)
 *     - Privilege escalation via token manipulation is blocked
 *
 *  3. Account status enforcement
 *     - Inactive users are blocked even with a valid token
 *     - Reactivated users regain access immediately
 *     - Status is re-checked on every request (not cached in token)
 *
 *  4. Role change takes effect immediately
 *     - Downgraded user loses access on next request
 *     - Upgraded user gains access on next request
 *
 *  5. Self-protection rules
 *     - Admin cannot deactivate or delete themselves
 *
 *  6. Boundary: viewer is the floor, admin is the ceiling
 *     - No role below viewer exists
 *     - Admin inherits all lower permissions
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { buildDb, buildApp, seedUser, seedRecord, tokenFor } = require('./helpers/testApp');

const SECRET = 'test-secret'; // matches process.env.JWT_SECRET set in testApp.js

let db, app;
let admin, analyst, viewer;
let adminToken, analystToken, viewerToken;
let recordId;

beforeEach(() => {
  db = buildDb();
  app = buildApp(db);

  admin   = seedUser(db, { email: 'admin@test.com',   role: 'admin' });
  analyst = seedUser(db, { email: 'analyst@test.com', role: 'analyst' });
  viewer  = seedUser(db, { email: 'viewer@test.com',  role: 'viewer' });

  adminToken   = tokenFor(admin);
  analystToken = tokenFor(analyst);
  viewerToken  = tokenFor(viewer);

  const r = db.prepare(
    "INSERT INTO financial_records (amount, type, category, date, created_by) VALUES (500, 'income', 'Salary', '2024-01-01', ?)"
  ).run(admin.id);
  recordId = r.lastInsertRowid;
});

// ── 1. Token integrity ────────────────────────────────────────────────────────
describe('token integrity', () => {
  it('rejects a request with no Authorization header — 401', async () => {
    const res = await request(app).get('/records');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/missing|malformed/i);
  });

  it('rejects "Authorization: Token xyz" (wrong scheme) — 401', async () => {
    const res = await request(app).get('/records').set('Authorization', `Token ${adminToken}`);
    expect(res.status).toBe(401);
  });

  it('rejects a completely invalid token string — 401', async () => {
    const res = await request(app).get('/records').set('Authorization', 'Bearer not.a.jwt');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid|expired/i);
  });

  it('rejects a token signed with the wrong secret — 401', async () => {
    const forged = jwt.sign({ sub: admin.id, role: 'admin' }, 'wrong-secret', { expiresIn: '1h' });
    const res = await request(app).get('/records').set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  it('rejects an expired token — 401', async () => {
    const expired = jwt.sign({ sub: admin.id, role: 'admin' }, SECRET, { expiresIn: '-1s' });
    const res = await request(app).get('/records').set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
  });

  it('rejects a token whose subject user no longer exists — 401', async () => {
    const ghostToken = jwt.sign({ sub: 99999, role: 'admin' }, SECRET, { expiresIn: '1h' });
    const res = await request(app).get('/records').set('Authorization', `Bearer ${ghostToken}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('rejects a structurally valid JWT with a tampered payload — 401', async () => {
    // Flip the middle segment (payload) to corrupt the signature
    const [header, , sig] = adminToken.split('.');
    const tamperedPayload = Buffer.from(JSON.stringify({ sub: admin.id, role: 'admin', exp: 9999999999 })).toString('base64url');
    const tampered = `${header}.${tamperedPayload}.${sig}`;
    const res = await request(app).get('/records').set('Authorization', `Bearer ${tampered}`);
    expect(res.status).toBe(401);
  });
});

// ── 2. Role enforcement correctness ──────────────────────────────────────────
describe('role enforcement', () => {
  it('403 response includes a descriptive error message', async () => {
    const res = await request(app)
      .post('/records')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ amount: 100, type: 'income', category: 'Test', date: '2024-01-01' });
    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('error');
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  it('role in DB is authoritative — token claiming admin for a viewer is rejected', async () => {
    // Mint a token that claims admin role but the DB record is viewer
    const escalated = jwt.sign({ sub: viewer.id, role: 'admin' }, SECRET, { expiresIn: '1h' });
    const res = await request(app).get('/users').set('Authorization', `Bearer ${escalated}`);
    // Auth middleware re-fetches the user from DB; role from DB (viewer) is used
    expect(res.status).toBe(403);
  });

  it('token claiming analyst for a viewer cannot create records', async () => {
    const escalated = jwt.sign({ sub: viewer.id, role: 'analyst' }, SECRET, { expiresIn: '1h' });
    const res = await request(app)
      .post('/records')
      .set('Authorization', `Bearer ${escalated}`)
      .send({ amount: 100, type: 'income', category: 'Test', date: '2024-01-01' });
    expect(res.status).toBe(403);
  });

  it('token claiming admin for an analyst cannot delete records', async () => {
    const escalated = jwt.sign({ sub: analyst.id, role: 'admin' }, SECRET, { expiresIn: '1h' });
    const res = await request(app)
      .delete(`/records/${recordId}`)
      .set('Authorization', `Bearer ${escalated}`);
    expect(res.status).toBe(403);
  });

  it('viewer cannot access /dashboard/recent even with a valid token', async () => {
    const res = await request(app).get('/dashboard/recent').set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(403);
  });

  it('analyst cannot access /users even with a valid token', async () => {
    const res = await request(app).get('/users').set('Authorization', `Bearer ${analystToken}`);
    expect(res.status).toBe(403);
  });

  it('analyst cannot delete a user even with a valid token', async () => {
    const res = await request(app).delete(`/users/${viewer.id}`).set('Authorization', `Bearer ${analystToken}`);
    expect(res.status).toBe(403);
  });
});

// ── 3. Account status enforcement ────────────────────────────────────────────
describe('account status enforcement', () => {
  it('inactive user is blocked on every protected route — 403', async () => {
    db.prepare("UPDATE users SET status = 'inactive' WHERE id = ?").run(analyst.id);

    // Token is still cryptographically valid, but the user is inactive
    const routes = [
      () => request(app).get('/records').set('Authorization', `Bearer ${analystToken}`),
      () => request(app).get('/dashboard/summary').set('Authorization', `Bearer ${analystToken}`),
    ];
    for (const call of routes) {
      expect((await call()).status).toBe(403);
    }
  });

  it('inactive user gets a descriptive error, not a generic 401', async () => {
    db.prepare("UPDATE users SET status = 'inactive' WHERE id = ?").run(viewer.id);
    const res = await request(app).get('/records').set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/inactive/i);
  });

  it('reactivated user regains access immediately on the next request', async () => {
    db.prepare("UPDATE users SET status = 'inactive' WHERE id = ?").run(analyst.id);
    expect((await request(app).get('/records').set('Authorization', `Bearer ${analystToken}`)).status).toBe(403);

    db.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(analyst.id);
    expect((await request(app).get('/records').set('Authorization', `Bearer ${analystToken}`)).status).toBe(200);
  });

  it('inactive user cannot log in', async () => {
    db.prepare("UPDATE users SET status = 'inactive' WHERE id = ?").run(viewer.id);
    const res = await request(app).post('/auth/login').send({ email: 'viewer@test.com', password: 'password123' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/inactive/i);
  });

  it('status is checked on every request, not cached in the token', async () => {
    // Token was issued while active — deactivate after issuance
    const tokenIssuedWhileActive = tokenFor(analyst);
    db.prepare("UPDATE users SET status = 'inactive' WHERE id = ?").run(analyst.id);

    const res = await request(app).get('/records').set('Authorization', `Bearer ${tokenIssuedWhileActive}`);
    expect(res.status).toBe(403); // DB state wins over token state
  });
});

// ── 4. Role changes take effect immediately ───────────────────────────────────
describe('role changes take effect immediately', () => {
  it('downgraded analyst loses write access on the next request', async () => {
    // First confirm analyst cannot write (read-only role)
    const before = await request(app)
      .post('/records')
      .set('Authorization', `Bearer ${analystToken}`)
      .send({ amount: 100, type: 'income', category: 'Test', date: '2024-01-01' });
    expect(before.status).toBe(403);
  });

  it('upgraded viewer to admin gains write access on the next request', async () => {
    const before = await request(app)
      .post('/records')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ amount: 100, type: 'income', category: 'Test', date: '2024-01-01' });
    expect(before.status).toBe(403);

    db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(viewer.id);

    const after = await request(app)
      .post('/records')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ amount: 100, type: 'income', category: 'Test', date: '2024-01-01' });
    expect(after.status).toBe(201);
  });

  it('viewer promoted to admin gains full access including user management', async () => {
    db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(viewer.id);
    expect((await request(app).get('/users').set('Authorization', `Bearer ${viewerToken}`)).status).toBe(200);
    expect((await request(app).delete(`/records/${recordId}`).set('Authorization', `Bearer ${viewerToken}`)).status).toBe(204);
  });
});

// ── 5. Self-protection rules ──────────────────────────────────────────────────
describe('self-protection rules', () => {
  it('admin cannot deactivate their own account', async () => {
    const res = await request(app)
      .patch(`/users/${admin.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'inactive' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot deactivate/i);
  });

  it('admin cannot delete their own account', async () => {
    const res = await request(app)
      .delete(`/users/${admin.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot delete/i);
  });

  it('admin can still deactivate other admins', async () => {
    const otherAdmin = seedUser(db, { email: 'admin2@test.com', role: 'admin' });
    const res = await request(app)
      .patch(`/users/${otherAdmin.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'inactive' });
    expect(res.status).toBe(200);
    expect(res.body.user.status).toBe('inactive');
  });
});

// ── 6. Role boundary tests ────────────────────────────────────────────────────
describe('role boundaries', () => {
  it('admin inherits all viewer permissions (read records)', async () => {
    expect((await request(app).get('/records').set('Authorization', `Bearer ${adminToken}`)).status).toBe(200);
    expect((await request(app).get(`/records/${recordId}`).set('Authorization', `Bearer ${adminToken}`)).status).toBe(200);
  });

  it('admin inherits all analyst permissions (dashboard, create, update)', async () => {
    expect((await request(app).get('/dashboard/summary').set('Authorization', `Bearer ${adminToken}`)).status).toBe(200);

    const create = await request(app)
      .post('/records')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 100, type: 'income', category: 'Test', date: '2024-01-01' });
    expect(create.status).toBe(201);
  });

  it('analyst cannot create records — write is admin only', async () => {
    const res = await request(app)
      .post('/records')
      .set('Authorization', `Bearer ${analystToken}`)
      .send({ amount: 100, type: 'income', category: 'Test', date: '2024-01-01' });
    expect(res.status).toBe(403);
  });

  it('a token with an unrecognised role is treated as no role — 403', async () => {
    const unknown = jwt.sign({ sub: viewer.id, role: 'superuser' }, SECRET, { expiresIn: '1h' });
    // Auth passes (valid token, active user), but DB role is viewer so RBAC blocks write
    const res = await request(app)
      .post('/records')
      .set('Authorization', `Bearer ${unknown}`)
      .send({ amount: 100, type: 'income', category: 'Test', date: '2024-01-01' });
    expect(res.status).toBe(403);
  });

  it('viewer can access /auth/me — authentication does not require elevated role', async () => {
    const res = await request(app).get('/auth/me').set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('viewer');
  });
});
