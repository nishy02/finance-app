/**
 * Tests that enforce the role-based access control matrix:
 *
 *  Action                          | Viewer | Analyst | Admin
 *  --------------------------------|--------|---------|------
 *  GET  /records                   |  ✓     |  ✓      |  ✓
 *  GET  /records/:id               |  ✓     |  ✓      |  ✓
 *  POST /records                   |  ✗     |  ✓      |  ✓
 *  PATCH /records/:id              |  ✗     |  ✓      |  ✓
 *  DELETE /records/:id             |  ✗     |  ✗      |  ✓
 *  GET  /dashboard/*               |  ✗     |  ✓      |  ✓
 *  GET  /users                     |  ✗     |  ✗      |  ✓
 *  PATCH /users/:id (role/status)  |  ✗     |  ✗      |  ✓
 */

const request = require('supertest');
const { buildDb, buildApp, seedUser, tokenFor } = require('./helpers/testApp');

let db, app;
let adminToken, analystToken, viewerToken;
let recordId;

beforeEach(() => {
  db = buildDb();
  app = buildApp(db);

  const admin   = seedUser(db, { email: 'admin@test.com',   role: 'admin' });
  const analyst = seedUser(db, { email: 'analyst@test.com', role: 'analyst' });
  const viewer  = seedUser(db, { email: 'viewer@test.com',  role: 'viewer' });

  adminToken   = tokenFor(admin);
  analystToken = tokenFor(analyst);
  viewerToken  = tokenFor(viewer);

  // Seed one record for read/update/delete tests
  const r = db.prepare(
    "INSERT INTO financial_records (amount, type, category, date, created_by) VALUES (100, 'income', 'Salary', '2024-01-01', ?)"
  ).run(admin.id);
  recordId = r.lastInsertRowid;
});

// ── No token ──────────────────────────────────────────────────────────────────
describe('unauthenticated requests', () => {
  it('GET /records returns 401 without token', async () => {
    expect((await request(app).get('/records')).status).toBe(401);
  });

  it('GET /dashboard/summary returns 401 without token', async () => {
    expect((await request(app).get('/dashboard/summary')).status).toBe(401);
  });

  it('GET /users returns 401 without token', async () => {
    expect((await request(app).get('/users')).status).toBe(401);
  });

  it('rejects a malformed token with 401', async () => {
    const res = await request(app).get('/records').set('Authorization', 'Bearer not.a.token');
    expect(res.status).toBe(401);
  });
});

// ── Viewer permissions ────────────────────────────────────────────────────────
describe('viewer role', () => {
  it('can read the records list', async () => {
    expect((await request(app).get('/records').set('Authorization', `Bearer ${viewerToken}`)).status).toBe(200);
  });

  it('can read a single record', async () => {
    expect((await request(app).get(`/records/${recordId}`).set('Authorization', `Bearer ${viewerToken}`)).status).toBe(200);
  });

  it('cannot create a record — 403', async () => {
    const res = await request(app)
      .post('/records')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ amount: 50, type: 'expense', category: 'Food', date: '2024-03-01' });
    expect(res.status).toBe(403);
  });

  it('cannot update a record — 403', async () => {
    const res = await request(app)
      .patch(`/records/${recordId}`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ amount: 200 });
    expect(res.status).toBe(403);
  });

  it('cannot delete a record — 403', async () => {
    expect((await request(app).delete(`/records/${recordId}`).set('Authorization', `Bearer ${viewerToken}`)).status).toBe(403);
  });

  it('cannot access dashboard summary — 403', async () => {
    expect((await request(app).get('/dashboard/summary').set('Authorization', `Bearer ${viewerToken}`)).status).toBe(403);
  });

  it('cannot access dashboard trends — 403', async () => {
    expect((await request(app).get('/dashboard/trends').set('Authorization', `Bearer ${viewerToken}`)).status).toBe(403);
  });

  it('cannot access dashboard by-category — 403', async () => {
    expect((await request(app).get('/dashboard/by-category').set('Authorization', `Bearer ${viewerToken}`)).status).toBe(403);
  });

  it('cannot list users — 403', async () => {
    expect((await request(app).get('/users').set('Authorization', `Bearer ${viewerToken}`)).status).toBe(403);
  });

  it('cannot update user roles — 403', async () => {
    const res = await request(app)
      .patch('/users/1')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ role: 'admin' });
    expect(res.status).toBe(403);
  });
});

// ── Analyst permissions ───────────────────────────────────────────────────────
describe('analyst role', () => {
  it('can read the records list', async () => {
    expect((await request(app).get('/records').set('Authorization', `Bearer ${analystToken}`)).status).toBe(200);
  });

  it('can read a single record', async () => {
    expect((await request(app).get(`/records/${recordId}`).set('Authorization', `Bearer ${analystToken}`)).status).toBe(200);
  });

  it('can create a record', async () => {
    const res = await request(app)
      .post('/records')
      .set('Authorization', `Bearer ${analystToken}`)
      .send({ amount: 250, type: 'expense', category: 'Utilities', date: '2024-04-01' });
    expect(res.status).toBe(201);
  });

  it('can update a record', async () => {
    const res = await request(app)
      .patch(`/records/${recordId}`)
      .set('Authorization', `Bearer ${analystToken}`)
      .send({ amount: 999 });
    expect(res.status).toBe(200);
    expect(res.body.record.amount).toBe(999);
  });

  it('cannot delete a record — 403', async () => {
    expect((await request(app).delete(`/records/${recordId}`).set('Authorization', `Bearer ${analystToken}`)).status).toBe(403);
  });

  it('can access dashboard summary', async () => {
    expect((await request(app).get('/dashboard/summary').set('Authorization', `Bearer ${analystToken}`)).status).toBe(200);
  });

  it('can access dashboard trends', async () => {
    expect((await request(app).get('/dashboard/trends').set('Authorization', `Bearer ${analystToken}`)).status).toBe(200);
  });

  it('can access dashboard by-category', async () => {
    expect((await request(app).get('/dashboard/by-category').set('Authorization', `Bearer ${analystToken}`)).status).toBe(200);
  });

  it('cannot list users — 403', async () => {
    expect((await request(app).get('/users').set('Authorization', `Bearer ${analystToken}`)).status).toBe(403);
  });

  it('cannot update user roles — 403', async () => {
    const res = await request(app)
      .patch('/users/1')
      .set('Authorization', `Bearer ${analystToken}`)
      .send({ role: 'admin' });
    expect(res.status).toBe(403);
  });
});

// ── Admin permissions ─────────────────────────────────────────────────────────
describe('admin role', () => {
  it('can read records', async () => {
    expect((await request(app).get('/records').set('Authorization', `Bearer ${adminToken}`)).status).toBe(200);
  });

  it('can create a record', async () => {
    const res = await request(app)
      .post('/records')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 500, type: 'income', category: 'Freelance', date: '2024-05-01' });
    expect(res.status).toBe(201);
  });

  it('can update a record', async () => {
    const res = await request(app)
      .patch(`/records/${recordId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ category: 'Bonus' });
    expect(res.status).toBe(200);
  });

  it('can soft-delete a record', async () => {
    expect((await request(app).delete(`/records/${recordId}`).set('Authorization', `Bearer ${adminToken}`)).status).toBe(204);
  });

  it('can access all dashboard endpoints', async () => {
    const endpoints = ['/dashboard/summary', '/dashboard/by-category', '/dashboard/trends', '/dashboard/recent'];
    for (const ep of endpoints) {
      expect((await request(app).get(ep).set('Authorization', `Bearer ${adminToken}`)).status).toBe(200);
    }
  });

  it('can list users', async () => {
    expect((await request(app).get('/users').set('Authorization', `Bearer ${adminToken}`)).status).toBe(200);
  });

  it('can assign roles to users', async () => {
    const viewerUser = db.prepare("SELECT id FROM users WHERE email = 'viewer@test.com'").get();
    const res = await request(app)
      .patch(`/users/${viewerUser.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'analyst' });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('analyst');
  });

  it('can change user status', async () => {
    const viewerUser = db.prepare("SELECT id FROM users WHERE email = 'viewer@test.com'").get();
    const res = await request(app)
      .patch(`/users/${viewerUser.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'inactive' });
    expect(res.status).toBe(200);
    expect(res.body.user.status).toBe('inactive');
  });
});
