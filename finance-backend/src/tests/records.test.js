const request = require('supertest');
const { buildDb, buildApp, seedUser, seedRecord, tokenFor } = require('./helpers/testApp');

let db, app;
let admin, analyst, viewer;
let adminToken, analystToken, viewerToken;

beforeEach(() => {
  db = buildDb();
  app = buildApp(db);

  admin   = seedUser(db, { email: 'admin@test.com',   role: 'admin' });
  analyst = seedUser(db, { email: 'analyst@test.com', role: 'analyst' });
  viewer  = seedUser(db, { email: 'viewer@test.com',  role: 'viewer' });

  adminToken   = tokenFor(admin);
  analystToken = tokenFor(analyst);
  viewerToken  = tokenFor(viewer);
});

// ── POST /records — creating records ─────────────────────────────────────────
describe('POST /records — creating records', () => {
  const valid = { amount: 1500, type: 'income', category: 'Salary', date: '2024-06-01', notes: 'June pay' };

  it('analyst cannot create a record — 403', async () => {
    const res = await request(app)
      .post('/records')
      .set('Authorization', `Bearer ${analystToken}`)
      .send(valid);
    expect(res.status).toBe(403);
  });

  it('admin can create a record and gets 201 with the record back', async () => {
    const res = await request(app)
      .post('/records')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(valid);
    expect(res.status).toBe(201);
    expect(res.body.record).toMatchObject({
      amount: 1500, type: 'income', category: 'Salary', date: '2024-06-01', notes: 'June pay',
    });
    expect(res.body.record.id).toBeDefined();
    expect(res.body.record.created_by).toBe(admin.id);
  });

  it('admin can create an expense record', async () => {
    const res = await request(app)
      .post('/records')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 200, type: 'expense', category: 'Rent', date: '2024-07-01' });
    expect(res.status).toBe(201);
    expect(res.body.record.type).toBe('expense');
  });

  it('notes field is optional — record is created without it', async () => {
    const { notes, ...withoutNotes } = valid;
    const res = await request(app)
      .post('/records')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(withoutNotes);
    expect(res.status).toBe(201);
    expect(res.body.record.notes).toBeNull();
  });

  it('viewer cannot create a record — 403', async () => {
    const res = await request(app)
      .post('/records')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send(valid);
    expect(res.status).toBe(403);
  });

  it('rejects missing amount — 422', async () => {
    const { amount, ...rest } = valid;
    const res = await request(app).post('/records').set('Authorization', `Bearer ${adminToken}`).send(rest);
    expect(res.status).toBe(422);
  });

  it('rejects zero amount — 422', async () => {
    const res = await request(app).post('/records').set('Authorization', `Bearer ${adminToken}`).send({ ...valid, amount: 0 });
    expect(res.status).toBe(422);
  });

  it('rejects negative amount — 422', async () => {
    const res = await request(app).post('/records').set('Authorization', `Bearer ${adminToken}`).send({ ...valid, amount: -50 });
    expect(res.status).toBe(422);
  });

  it('rejects invalid type — 422', async () => {
    const res = await request(app).post('/records').set('Authorization', `Bearer ${adminToken}`).send({ ...valid, type: 'transfer' });
    expect(res.status).toBe(422);
  });

  it('rejects missing category — 422', async () => {
    const { category, ...rest } = valid;
    const res = await request(app).post('/records').set('Authorization', `Bearer ${adminToken}`).send(rest);
    expect(res.status).toBe(422);
  });

  it('rejects missing date — 422', async () => {
    const { date, ...rest } = valid;
    const res = await request(app).post('/records').set('Authorization', `Bearer ${adminToken}`).send(rest);
    expect(res.status).toBe(422);
  });

  it('requires authentication — 401 without token', async () => {
    const res = await request(app).post('/records').send(valid);
    expect(res.status).toBe(401);
  });
});

// ── GET /records — viewing records ────────────────────────────────────────────
describe('GET /records — viewing records', () => {
  beforeEach(() => {
    seedRecord(db, { amount: 500,  type: 'income',  category: 'Salary',    date: '2024-01-15', createdBy: admin.id });
    seedRecord(db, { amount: 200,  type: 'expense', category: 'Rent',      date: '2024-02-10', createdBy: admin.id });
    seedRecord(db, { amount: 800,  type: 'income',  category: 'Freelance', date: '2024-03-20', createdBy: admin.id });
    seedRecord(db, { amount: 50,   type: 'expense', category: 'Food',      date: '2024-03-25', createdBy: admin.id });
    seedRecord(db, { amount: 1200, type: 'income',  category: 'Salary',    date: '2024-04-15', createdBy: admin.id });
  });

  it('viewer can list all records', async () => {
    const res = await request(app).get('/records').set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.records).toHaveLength(5);
    expect(res.body.pagination).toMatchObject({ page: 1, total: 5 });
  });

  it('returns records ordered by date descending', async () => {
    const res = await request(app).get('/records').set('Authorization', `Bearer ${viewerToken}`);
    const dates = res.body.records.map(r => r.date);
    expect(dates).toEqual([...dates].sort((a, b) => b.localeCompare(a)));
  });

  it('each record has all expected fields', async () => {
    const res = await request(app).get('/records').set('Authorization', `Bearer ${viewerToken}`);
    const r = res.body.records[0];
    expect(r).toHaveProperty('id');
    expect(r).toHaveProperty('amount');
    expect(r).toHaveProperty('type');
    expect(r).toHaveProperty('category');
    expect(r).toHaveProperty('date');
    expect(r).toHaveProperty('notes');
    expect(r).toHaveProperty('created_by');
    expect(r).toHaveProperty('created_at');
  });

  it('requires authentication — 401 without token', async () => {
    expect((await request(app).get('/records')).status).toBe(401);
  });
});

// ── GET /records/:id — viewing a single record ────────────────────────────────
describe('GET /records/:id', () => {
  let record;
  beforeEach(() => {
    record = seedRecord(db, { amount: 750, type: 'income', category: 'Bonus', date: '2024-05-01', notes: 'Q1 bonus', createdBy: admin.id });
  });

  it('returns the correct record by id', async () => {
    const res = await request(app).get(`/records/${record.id}`).set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.record).toMatchObject({ id: record.id, amount: 750, category: 'Bonus', notes: 'Q1 bonus' });
  });

  it('returns 404 for a non-existent id', async () => {
    const res = await request(app).get('/records/9999').set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(404);
  });

  it('returns 404 for a soft-deleted record', async () => {
    db.prepare("UPDATE financial_records SET deleted_at = datetime('now') WHERE id = ?").run(record.id);
    const res = await request(app).get(`/records/${record.id}`).set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(404);
  });
});

// ── PATCH /records/:id — updating records ─────────────────────────────────────
describe('PATCH /records/:id — updating records', () => {
  let record;
  beforeEach(() => {
    record = seedRecord(db, { amount: 300, type: 'expense', category: 'Food', date: '2024-03-01', notes: 'Groceries', createdBy: admin.id });
  });

  it('analyst cannot update a record — 403', async () => {
    const res = await request(app)
      .patch(`/records/${record.id}`)
      .set('Authorization', `Bearer ${analystToken}`)
      .send({ amount: 450 });
    expect(res.status).toBe(403);
  });

  it('admin can update amount', async () => {
    const res = await request(app)
      .patch(`/records/${record.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 450 });
    expect(res.status).toBe(200);
    expect(res.body.record.amount).toBe(450);
  });

  it('admin can update type', async () => {
    const res = await request(app)
      .patch(`/records/${record.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ type: 'income' });
    expect(res.status).toBe(200);
    expect(res.body.record.type).toBe('income');
  });

  it('admin can update category', async () => {
    const res = await request(app)
      .patch(`/records/${record.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ category: 'Transport' });
    expect(res.status).toBe(200);
    expect(res.body.record.category).toBe('Transport');
  });

  it('admin can update date', async () => {
    const res = await request(app)
      .patch(`/records/${record.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ date: '2024-09-15' });
    expect(res.status).toBe(200);
    expect(res.body.record.date).toBe('2024-09-15');
  });

  it('admin can update notes', async () => {
    const res = await request(app)
      .patch(`/records/${record.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ notes: 'Updated note' });
    expect(res.status).toBe(200);
    expect(res.body.record.notes).toBe('Updated note');
  });

  it('unmentioned fields are preserved after partial update', async () => {
    await request(app)
      .patch(`/records/${record.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 999 });
    const res = await request(app).get(`/records/${record.id}`).set('Authorization', `Bearer ${viewerToken}`);
    expect(res.body.record.category).toBe('Food');
    expect(res.body.record.notes).toBe('Groceries');
  });

  it('viewer cannot update a record — 403', async () => {
    const res = await request(app)
      .patch(`/records/${record.id}`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ amount: 1 });
    expect(res.status).toBe(403);
  });

  it('returns 400 when body has no updatable fields', async () => {
    const res = await request(app)
      .patch(`/records/${record.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 404 for non-existent record', async () => {
    const res = await request(app)
      .patch('/records/9999')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 100 });
    expect(res.status).toBe(404);
  });

  it('returns 404 when updating a soft-deleted record', async () => {
    db.prepare("UPDATE financial_records SET deleted_at = datetime('now') WHERE id = ?").run(record.id);
    const res = await request(app)
      .patch(`/records/${record.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 100 });
    expect(res.status).toBe(404);
  });
});

// ── DELETE /records/:id — deleting records ────────────────────────────────────
describe('DELETE /records/:id — deleting records', () => {
  let record;
  beforeEach(() => {
    record = seedRecord(db, { amount: 100, type: 'income', category: 'Misc', date: '2024-01-01', createdBy: admin.id });
  });

  it('admin can soft-delete a record — 204', async () => {
    const res = await request(app)
      .delete(`/records/${record.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(204);
  });

  it('soft-deleted record no longer appears in list', async () => {
    await request(app).delete(`/records/${record.id}`).set('Authorization', `Bearer ${adminToken}`);
    const res = await request(app).get('/records').set('Authorization', `Bearer ${viewerToken}`);
    expect(res.body.records.find(r => r.id === record.id)).toBeUndefined();
  });

  it('soft-deleted record sets deleted_at in the DB (not a hard delete)', async () => {
    await request(app).delete(`/records/${record.id}`).set('Authorization', `Bearer ${adminToken}`);
    const row = db.prepare('SELECT deleted_at FROM financial_records WHERE id = ?').get(record.id);
    expect(row).toBeDefined();        // row still exists
    expect(row.deleted_at).not.toBeNull(); // but is marked deleted
  });

  it('analyst cannot delete a record — 403', async () => {
    const res = await request(app)
      .delete(`/records/${record.id}`)
      .set('Authorization', `Bearer ${analystToken}`);
    expect(res.status).toBe(403);
  });

  it('viewer cannot delete a record — 403', async () => {
    const res = await request(app)
      .delete(`/records/${record.id}`)
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(403);
  });

  it('returns 404 for non-existent record', async () => {
    const res = await request(app)
      .delete('/records/9999')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  it('returns 404 when deleting an already-deleted record', async () => {
    await request(app).delete(`/records/${record.id}`).set('Authorization', `Bearer ${adminToken}`);
    const res = await request(app).delete(`/records/${record.id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });
});

// ── Filtering records ─────────────────────────────────────────────────────────
describe('GET /records — filtering', () => {
  beforeEach(() => {
    seedRecord(db, { amount: 1000, type: 'income',  category: 'Salary',    date: '2024-01-10', createdBy: admin.id });
    seedRecord(db, { amount: 400,  type: 'expense', category: 'Rent',      date: '2024-01-20', createdBy: admin.id });
    seedRecord(db, { amount: 600,  type: 'income',  category: 'Freelance', date: '2024-02-05', createdBy: admin.id });
    seedRecord(db, { amount: 80,   type: 'expense', category: 'Food',      date: '2024-02-18', createdBy: admin.id });
    seedRecord(db, { amount: 1500, type: 'income',  category: 'Salary',    date: '2024-03-10', createdBy: admin.id });
    seedRecord(db, { amount: 200,  type: 'expense', category: 'Food',      date: '2024-03-22', createdBy: admin.id });
  });

  it('filter by type=income returns only income records', async () => {
    const res = await request(app).get('/records?type=income').set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.records.every(r => r.type === 'income')).toBe(true);
    expect(res.body.records).toHaveLength(3);
  });

  it('filter by type=expense returns only expense records', async () => {
    const res = await request(app).get('/records?type=expense').set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.records.every(r => r.type === 'expense')).toBe(true);
    expect(res.body.records).toHaveLength(3);
  });

  it('filter by category returns only matching records', async () => {
    const res = await request(app).get('/records?category=Salary').set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.records.every(r => r.category === 'Salary')).toBe(true);
    expect(res.body.records).toHaveLength(2);
  });

  it('filter by category=Food returns only Food records', async () => {
    const res = await request(app).get('/records?category=Food').set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.records).toHaveLength(2);
  });

  it('filter by from date returns records on or after that date', async () => {
    const res = await request(app).get('/records?from=2024-02-01').set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.records.every(r => r.date >= '2024-02-01')).toBe(true);
    expect(res.body.records).toHaveLength(4);
  });

  it('filter by to date returns records on or before that date', async () => {
    const res = await request(app).get('/records?to=2024-01-31').set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.records.every(r => r.date <= '2024-01-31')).toBe(true);
    expect(res.body.records).toHaveLength(2);
  });

  it('filter by date range (from + to) returns records within the window', async () => {
    const res = await request(app).get('/records?from=2024-02-01&to=2024-02-28').set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.records).toHaveLength(2);
    expect(res.body.records.every(r => r.date >= '2024-02-01' && r.date <= '2024-02-28')).toBe(true);
  });

  it('combining type and category filters works correctly', async () => {
    const res = await request(app).get('/records?type=expense&category=Food').set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.records.every(r => r.type === 'expense' && r.category === 'Food')).toBe(true);
    expect(res.body.records).toHaveLength(2);
  });

  it('combining type and date range filters works correctly', async () => {
    const res = await request(app).get('/records?type=income&from=2024-02-01').set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.records.every(r => r.type === 'income' && r.date >= '2024-02-01')).toBe(true);
    expect(res.body.records).toHaveLength(2);
  });

  it('filter with no matches returns empty array and total=0', async () => {
    const res = await request(app).get('/records?category=Nonexistent').set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.records).toHaveLength(0);
    expect(res.body.pagination.total).toBe(0);
  });

  it('soft-deleted records are excluded from filtered results', async () => {
    const salary = db.prepare("SELECT id FROM financial_records WHERE category = 'Salary' LIMIT 1").get();
    db.prepare("UPDATE financial_records SET deleted_at = datetime('now') WHERE id = ?").run(salary.id);
    const res = await request(app).get('/records?category=Salary').set('Authorization', `Bearer ${viewerToken}`);
    expect(res.body.records).toHaveLength(1);
  });
});

// ── Pagination ────────────────────────────────────────────────────────────────
describe('GET /records — pagination', () => {
  beforeEach(() => {
    for (let i = 1; i <= 15; i++) {
      seedRecord(db, { amount: i * 10, type: 'income', category: 'Test', date: `2024-01-${String(i).padStart(2, '0')}`, createdBy: admin.id });
    }
  });

  it('defaults to page 1 with 20 items per page', async () => {
    const res = await request(app).get('/records').set('Authorization', `Bearer ${viewerToken}`);
    expect(res.body.records).toHaveLength(15); // all 15 fit within default limit of 20
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 20, total: 15 });
  });

  it('respects custom limit', async () => {
    const res = await request(app).get('/records?limit=5').set('Authorization', `Bearer ${viewerToken}`);
    expect(res.body.records).toHaveLength(5);
    expect(res.body.pagination.total).toBe(15);
  });

  it('returns correct page 2 results', async () => {
    const page1 = await request(app).get('/records?limit=5&page=1').set('Authorization', `Bearer ${viewerToken}`);
    const page2 = await request(app).get('/records?limit=5&page=2').set('Authorization', `Bearer ${viewerToken}`);
    const ids1 = page1.body.records.map(r => r.id);
    const ids2 = page2.body.records.map(r => r.id);
    expect(ids1).toHaveLength(5);
    expect(ids2).toHaveLength(5);
    expect(ids1.some(id => ids2.includes(id))).toBe(false); // no overlap
  });

  it('last page returns remaining records', async () => {
    const res = await request(app).get('/records?limit=5&page=3').set('Authorization', `Bearer ${viewerToken}`);
    expect(res.body.records).toHaveLength(5);
  });

  it('page beyond total returns empty array', async () => {
    const res = await request(app).get('/records?limit=5&page=99').set('Authorization', `Bearer ${viewerToken}`);
    expect(res.body.records).toHaveLength(0);
    expect(res.body.pagination.total).toBe(15);
  });
});
