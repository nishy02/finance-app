const request = require('supertest');
const { buildDb, buildApp, seedUser, tokenFor } = require('./helpers/testApp');

let db, app, adminToken, admin, analyst, viewer;

beforeEach(() => {
  db = buildDb();
  app = buildApp(db);

  admin   = seedUser(db, { name: 'Admin',   email: 'admin@test.com',   role: 'admin' });
  analyst = seedUser(db, { name: 'Analyst', email: 'analyst@test.com', role: 'analyst' });
  viewer  = seedUser(db, { name: 'Viewer',  email: 'viewer@test.com',  role: 'viewer' });

  adminToken = tokenFor(admin);
});

// ── Creating users ────────────────────────────────────────────────────────────
describe('POST /auth/register — creating users', () => {
  it('creates a user with default viewer role', async () => {
    const res = await request(app).post('/auth/register').send({
      name: 'New User', email: 'new@test.com', password: 'pass123',
    });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: 'new@test.com', role: 'viewer', status: 'active' });
    expect(res.body.user.password).toBeUndefined();
  });

  it('creates a user with an explicit role', async () => {
    const res = await request(app).post('/auth/register').send({
      name: 'Ana', email: 'ana@test.com', password: 'pass123', role: 'analyst',
    });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('analyst');
  });

  it('rejects duplicate email with 409', async () => {
    const res = await request(app).post('/auth/register').send({
      name: 'Dup', email: 'admin@test.com', password: 'pass123',
    });
    expect(res.status).toBe(409);
  });

  it('rejects missing name with 422', async () => {
    const res = await request(app).post('/auth/register').send({
      email: 'x@test.com', password: 'pass123',
    });
    expect(res.status).toBe(422);
  });

  it('rejects invalid email with 422', async () => {
    const res = await request(app).post('/auth/register').send({
      name: 'X', email: 'not-an-email', password: 'pass123',
    });
    expect(res.status).toBe(422);
  });

  it('rejects password shorter than 6 chars with 422', async () => {
    const res = await request(app).post('/auth/register').send({
      name: 'X', email: 'x2@test.com', password: '123',
    });
    expect(res.status).toBe(422);
  });

  it('rejects an invalid role value with 422', async () => {
    const res = await request(app).post('/auth/register').send({
      name: 'X', email: 'x3@test.com', password: 'pass123', role: 'superuser',
    });
    expect(res.status).toBe(422);
  });
});

// ── Managing users (admin CRUD) ───────────────────────────────────────────────
describe('GET /users — listing users', () => {
  it('admin can list all users', async () => {
    const res = await request(app).get('/users').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.users.length).toBe(3);
    expect(res.body.pagination).toBeDefined();
  });

  it('can filter by role', async () => {
    const res = await request(app).get('/users?role=analyst').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.users.every(u => u.role === 'analyst')).toBe(true);
  });

  it('can filter by status', async () => {
    db.prepare("UPDATE users SET status = 'inactive' WHERE id = ?").run(viewer.id);
    const res = await request(app).get('/users?status=inactive').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.users.every(u => u.status === 'inactive')).toBe(true);
  });

  it('returns paginated results', async () => {
    const res = await request(app).get('/users?page=1&limit=2').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.users.length).toBe(2);
    expect(res.body.pagination.total).toBe(3);
  });

  it('does not expose password field', async () => {
    const res = await request(app).get('/users').set('Authorization', `Bearer ${adminToken}`);
    res.body.users.forEach(u => expect(u.password).toBeUndefined());
  });
});

describe('GET /users/:id — get single user', () => {
  it('admin can fetch a user by id', async () => {
    const res = await request(app).get(`/users/${viewer.id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(viewer.id);
  });

  it('returns 404 for non-existent user', async () => {
    const res = await request(app).get('/users/9999').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });
});

// ── Assigning roles ───────────────────────────────────────────────────────────
describe('PATCH /users/:id — assigning roles', () => {
  it('admin can promote viewer to analyst', async () => {
    const res = await request(app)
      .patch(`/users/${viewer.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'analyst' });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('analyst');
  });

  it('admin can promote analyst to admin', async () => {
    const res = await request(app)
      .patch(`/users/${analyst.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'admin' });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('admin');
  });

  it('admin can demote admin to viewer', async () => {
    const res = await request(app)
      .patch(`/users/${analyst.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'viewer' });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('viewer');
  });

  it('rejects invalid role value with 422', async () => {
    const res = await request(app)
      .patch(`/users/${viewer.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'god' });
    expect(res.status).toBe(422);
  });

  it('returns 404 when patching non-existent user', async () => {
    const res = await request(app)
      .patch('/users/9999')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'analyst' });
    expect(res.status).toBe(404);
  });
});

// ── Managing user status ──────────────────────────────────────────────────────
describe('PATCH /users/:id — managing status', () => {
  it('admin can deactivate a user', async () => {
    const res = await request(app)
      .patch(`/users/${viewer.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'inactive' });
    expect(res.status).toBe(200);
    expect(res.body.user.status).toBe('inactive');
  });

  it('admin can reactivate an inactive user', async () => {
    db.prepare("UPDATE users SET status = 'inactive' WHERE id = ?").run(viewer.id);
    const res = await request(app)
      .patch(`/users/${viewer.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'active' });
    expect(res.status).toBe(200);
    expect(res.body.user.status).toBe('active');
  });

  it('admin cannot deactivate their own account', async () => {
    const res = await request(app)
      .patch(`/users/${admin.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'inactive' });
    expect(res.status).toBe(400);
  });

  it('inactive user cannot authenticate even with a valid token', async () => {
    db.prepare("UPDATE users SET status = 'inactive' WHERE id = ?").run(viewer.id);
    const staleToken = tokenFor(viewer);
    const res = await request(app).get('/auth/me').set('Authorization', `Bearer ${staleToken}`);
    expect(res.status).toBe(403);
  });

  it('inactive user cannot log in', async () => {
    db.prepare("UPDATE users SET status = 'inactive' WHERE id = ?").run(viewer.id);
    const res = await request(app).post('/auth/login').send({ email: 'viewer@test.com', password: 'password123' });
    expect(res.status).toBe(403);
  });
});

// ── Deleting users ────────────────────────────────────────────────────────────
describe('DELETE /users/:id', () => {
  it('admin can delete another user', async () => {
    const res = await request(app)
      .delete(`/users/${viewer.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(204);
    expect(db.prepare('SELECT id FROM users WHERE id = ?').get(viewer.id)).toBeUndefined();
  });

  it('admin cannot delete their own account', async () => {
    const res = await request(app)
      .delete(`/users/${admin.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });

  it('returns 404 when deleting non-existent user', async () => {
    const res = await request(app)
      .delete('/users/9999')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });
});
