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

// ── helpers ───────────────────────────────────────────────────────────────────
function seed(overrides) {
  return seedRecord(db, { createdBy: admin.id, ...overrides });
}

// ── GET /dashboard/summary ────────────────────────────────────────────────────
describe('GET /dashboard/summary', () => {
  it('returns zero totals when there are no records', async () => {
    const res = await request(app).get('/dashboard/summary').set('Authorization', `Bearer ${analystToken}`);
    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({
      total_income: 0,
      total_expenses: 0,
      net_balance: 0,
      total_records: 0,
    });
  });

  it('calculates total_income correctly', async () => {
    seed({ amount: 1000, type: 'income',  category: 'Salary',    date: '2024-01-01' });
    seed({ amount: 500,  type: 'income',  category: 'Freelance', date: '2024-01-02' });
    seed({ amount: 200,  type: 'expense', category: 'Rent',      date: '2024-01-03' });

    const res = await request(app).get('/dashboard/summary').set('Authorization', `Bearer ${analystToken}`);
    expect(res.body.summary.total_income).toBe(1500);
  });

  it('calculates total_expenses correctly', async () => {
    seed({ amount: 300, type: 'expense', category: 'Rent',  date: '2024-01-01' });
    seed({ amount: 150, type: 'expense', category: 'Food',  date: '2024-01-02' });
    seed({ amount: 800, type: 'income',  category: 'Salary', date: '2024-01-03' });

    const res = await request(app).get('/dashboard/summary').set('Authorization', `Bearer ${analystToken}`);
    expect(res.body.summary.total_expenses).toBe(450);
  });

  it('calculates net_balance as income minus expenses', async () => {
    seed({ amount: 2000, type: 'income',  category: 'Salary', date: '2024-01-01' });
    seed({ amount: 600,  type: 'expense', category: 'Rent',   date: '2024-01-02' });
    seed({ amount: 400,  type: 'expense', category: 'Food',   date: '2024-01-03' });

    const res = await request(app).get('/dashboard/summary').set('Authorization', `Bearer ${analystToken}`);
    expect(res.body.summary.net_balance).toBe(1000); // 2000 - 600 - 400
  });

  it('net_balance is negative when expenses exceed income', async () => {
    seed({ amount: 100,  type: 'income',  category: 'Misc',  date: '2024-01-01' });
    seed({ amount: 800,  type: 'expense', category: 'Rent',  date: '2024-01-02' });

    const res = await request(app).get('/dashboard/summary').set('Authorization', `Bearer ${analystToken}`);
    expect(res.body.summary.net_balance).toBe(-700);
  });

  it('total_records counts all active records', async () => {
    seed({ amount: 100, type: 'income',  category: 'A', date: '2024-01-01' });
    seed({ amount: 200, type: 'expense', category: 'B', date: '2024-01-02' });
    seed({ amount: 300, type: 'income',  category: 'C', date: '2024-01-03' });

    const res = await request(app).get('/dashboard/summary').set('Authorization', `Bearer ${analystToken}`);
    expect(res.body.summary.total_records).toBe(3);
  });

  it('excludes soft-deleted records from all totals', async () => {
    seed({ amount: 1000, type: 'income',  category: 'Salary', date: '2024-01-01' });
    const deleted = seed({ amount: 9999, type: 'income', category: 'Bonus', date: '2024-01-02' });
    db.prepare("UPDATE financial_records SET deleted_at = datetime('now') WHERE id = ?").run(deleted.id);

    const res = await request(app).get('/dashboard/summary').set('Authorization', `Bearer ${analystToken}`);
    expect(res.body.summary.total_income).toBe(1000);
    expect(res.body.summary.total_records).toBe(1);
  });

  it('admin can access summary', async () => {
    const res = await request(app).get('/dashboard/summary').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it('viewer cannot access summary — 403', async () => {
    const res = await request(app).get('/dashboard/summary').set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(403);
  });

  it('returns 401 without a token', async () => {
    expect((await request(app).get('/dashboard/summary')).status).toBe(401);
  });
});

// ── GET /dashboard/by-category ────────────────────────────────────────────────
describe('GET /dashboard/by-category', () => {
  it('returns empty array when there are no records', async () => {
    const res = await request(app).get('/dashboard/by-category').set('Authorization', `Bearer ${analystToken}`);
    expect(res.status).toBe(200);
    expect(res.body.categories).toEqual([]);
  });

  it('groups records by category and type', async () => {
    seed({ amount: 1000, type: 'income',  category: 'Salary', date: '2024-01-01' });
    seed({ amount: 500,  type: 'income',  category: 'Salary', date: '2024-02-01' });
    seed({ amount: 300,  type: 'expense', category: 'Rent',   date: '2024-01-05' });

    const res = await request(app).get('/dashboard/by-category').set('Authorization', `Bearer ${analystToken}`);
    expect(res.status).toBe(200);

    const salaryIncome = res.body.categories.find(c => c.category === 'Salary' && c.type === 'income');
    expect(salaryIncome).toBeDefined();
    expect(salaryIncome.total).toBe(1500);
    expect(salaryIncome.count).toBe(2);

    const rentExpense = res.body.categories.find(c => c.category === 'Rent' && c.type === 'expense');
    expect(rentExpense).toBeDefined();
    expect(rentExpense.total).toBe(300);
    expect(rentExpense.count).toBe(1);
  });

  it('same category with different types appears as separate entries', async () => {
    seed({ amount: 200, type: 'income',  category: 'Misc', date: '2024-01-01' });
    seed({ amount: 100, type: 'expense', category: 'Misc', date: '2024-01-02' });

    const res = await request(app).get('/dashboard/by-category').set('Authorization', `Bearer ${analystToken}`);
    const miscEntries = res.body.categories.filter(c => c.category === 'Misc');
    expect(miscEntries).toHaveLength(2);
  });

  it('results are ordered by total descending', async () => {
    seed({ amount: 100,  type: 'income', category: 'Small',  date: '2024-01-01' });
    seed({ amount: 5000, type: 'income', category: 'Large',  date: '2024-01-02' });
    seed({ amount: 500,  type: 'income', category: 'Medium', date: '2024-01-03' });

    const res = await request(app).get('/dashboard/by-category').set('Authorization', `Bearer ${analystToken}`);
    const totals = res.body.categories.map(c => c.total);
    expect(totals).toEqual([...totals].sort((a, b) => b - a));
  });

  it('each entry has category, type, total, and count fields', async () => {
    seed({ amount: 400, type: 'expense', category: 'Food', date: '2024-01-01' });

    const res = await request(app).get('/dashboard/by-category').set('Authorization', `Bearer ${analystToken}`);
    const entry = res.body.categories[0];
    expect(entry).toHaveProperty('category');
    expect(entry).toHaveProperty('type');
    expect(entry).toHaveProperty('total');
    expect(entry).toHaveProperty('count');
  });

  it('excludes soft-deleted records from category totals', async () => {
    seed({ amount: 300, type: 'income', category: 'Salary', date: '2024-01-01' });
    const deleted = seed({ amount: 9000, type: 'income', category: 'Salary', date: '2024-01-02' });
    db.prepare("UPDATE financial_records SET deleted_at = datetime('now') WHERE id = ?").run(deleted.id);

    const res = await request(app).get('/dashboard/by-category').set('Authorization', `Bearer ${analystToken}`);
    const salary = res.body.categories.find(c => c.category === 'Salary');
    expect(salary.total).toBe(300);
    expect(salary.count).toBe(1);
  });

  it('viewer cannot access by-category — 403', async () => {
    expect((await request(app).get('/dashboard/by-category').set('Authorization', `Bearer ${viewerToken}`)).status).toBe(403);
  });
});

// ── GET /dashboard/trends ─────────────────────────────────────────────────────
describe('GET /dashboard/trends', () => {
  beforeEach(() => {
    // Spread records across Jan–Mar 2024
    seed({ amount: 1000, type: 'income',  category: 'Salary',    date: '2024-01-10' });
    seed({ amount: 200,  type: 'expense', category: 'Rent',      date: '2024-01-20' });
    seed({ amount: 800,  type: 'income',  category: 'Freelance', date: '2024-02-05' });
    seed({ amount: 150,  type: 'expense', category: 'Food',      date: '2024-02-18' });
    seed({ amount: 1200, type: 'income',  category: 'Salary',    date: '2024-03-10' });
    // A record in a different year — should not appear in 2024 results
    seed({ amount: 500,  type: 'income',  category: 'Salary',    date: '2023-06-01' });
  });

  it('returns monthly trends for the requested year', async () => {
    const res = await request(app)
      .get('/dashboard/trends?period=monthly&year=2024')
      .set('Authorization', `Bearer ${analystToken}`);

    expect(res.status).toBe(200);
    expect(res.body.period).toBe('monthly');
    expect(res.body.year).toBe(2024);

    const periods = res.body.trends.map(t => t.period);
    expect(periods).toContain('2024-01');
    expect(periods).toContain('2024-02');
    expect(periods).toContain('2024-03');
    // The 2023 record must not appear
    expect(periods.some(p => p.startsWith('2023'))).toBe(false);
  });

  it('monthly trend totals are correct per period and type', async () => {
    const res = await request(app)
      .get('/dashboard/trends?period=monthly&year=2024')
      .set('Authorization', `Bearer ${analystToken}`);

    const jan = res.body.trends.find(t => t.period === '2024-01' && t.type === 'income');
    expect(jan.total).toBe(1000);
    expect(jan.count).toBe(1);

    const janExp = res.body.trends.find(t => t.period === '2024-01' && t.type === 'expense');
    expect(janExp.total).toBe(200);

    const feb = res.body.trends.find(t => t.period === '2024-02' && t.type === 'income');
    expect(feb.total).toBe(800);
  });

  it('trends are ordered by period ascending', async () => {
    const res = await request(app)
      .get('/dashboard/trends?period=monthly&year=2024')
      .set('Authorization', `Bearer ${analystToken}`);

    const periods = res.body.trends.map(t => t.period);
    expect(periods).toEqual([...periods].sort());
  });

  it('returns weekly trends when period=weekly', async () => {
    const res = await request(app)
      .get('/dashboard/trends?period=weekly&year=2024')
      .set('Authorization', `Bearer ${analystToken}`);

    expect(res.status).toBe(200);
    expect(res.body.period).toBe('weekly');
    // Weekly periods look like "2024-W02"
    expect(res.body.trends.every(t => /^\d{4}-W\d{2}$/.test(t.period))).toBe(true);
  });

  it('defaults to monthly when period is omitted', async () => {
    const res = await request(app)
      .get('/dashboard/trends?year=2024')
      .set('Authorization', `Bearer ${analystToken}`);

    expect(res.body.period).toBe('monthly');
  });

  it('returns empty trends array for a year with no records', async () => {
    const res = await request(app)
      .get('/dashboard/trends?year=2099')
      .set('Authorization', `Bearer ${analystToken}`);

    expect(res.status).toBe(200);
    expect(res.body.trends).toEqual([]);
  });

  it('excludes soft-deleted records from trends', async () => {
    const deleted = seed({ amount: 9999, type: 'income', category: 'Bonus', date: '2024-01-15' });
    db.prepare("UPDATE financial_records SET deleted_at = datetime('now') WHERE id = ?").run(deleted.id);

    const res = await request(app)
      .get('/dashboard/trends?period=monthly&year=2024')
      .set('Authorization', `Bearer ${analystToken}`);

    const jan = res.body.trends.find(t => t.period === '2024-01' && t.type === 'income');
    expect(jan.total).toBe(1000); // only the non-deleted record
  });

  it('rejects an invalid period value — 422', async () => {
    const res = await request(app)
      .get('/dashboard/trends?period=yearly')
      .set('Authorization', `Bearer ${analystToken}`);
    expect(res.status).toBe(422);
  });

  it('each trend entry has period, type, total, and count', async () => {
    const res = await request(app)
      .get('/dashboard/trends?period=monthly&year=2024')
      .set('Authorization', `Bearer ${analystToken}`);

    const entry = res.body.trends[0];
    expect(entry).toHaveProperty('period');
    expect(entry).toHaveProperty('type');
    expect(entry).toHaveProperty('total');
    expect(entry).toHaveProperty('count');
  });

  it('viewer cannot access trends — 403', async () => {
    expect((await request(app).get('/dashboard/trends').set('Authorization', `Bearer ${viewerToken}`)).status).toBe(403);
  });

  it('returns 401 without a token', async () => {
    expect((await request(app).get('/dashboard/trends')).status).toBe(401);
  });
});

// ── GET /dashboard/recent ─────────────────────────────────────────────────────
describe('GET /dashboard/recent', () => {
  it('returns empty array when there are no records', async () => {
    const res = await request(app).get('/dashboard/recent').set('Authorization', `Bearer ${analystToken}`);
    expect(res.status).toBe(200);
    expect(res.body.records).toEqual([]);
  });

  it('returns the most recent records first', async () => {
    // Insert with explicit created_at ordering via separate inserts
    seed({ amount: 100, type: 'income',  category: 'A', date: '2024-01-01' });
    seed({ amount: 200, type: 'expense', category: 'B', date: '2024-02-01' });
    seed({ amount: 300, type: 'income',  category: 'C', date: '2024-03-01' });

    const res = await request(app).get('/dashboard/recent').set('Authorization', `Bearer ${analystToken}`);
    // Most recently inserted = last seeded, should appear first
    const amounts = res.body.records.map(r => r.amount);
    expect(amounts[0]).toBe(300);
    expect(amounts[1]).toBe(200);
    expect(amounts[2]).toBe(100);
  });

  it('includes created_by_name from the joined users table', async () => {
    seed({ amount: 500, type: 'income', category: 'Salary', date: '2024-01-01' });

    const res = await request(app).get('/dashboard/recent').set('Authorization', `Bearer ${analystToken}`);
    expect(res.body.records[0]).toHaveProperty('created_by_name');
    expect(typeof res.body.records[0].created_by_name).toBe('string');
  });

  it('defaults to 10 records', async () => {
    for (let i = 1; i <= 15; i++) {
      seed({ amount: i * 10, type: 'income', category: 'Test', date: `2024-01-${String(i).padStart(2, '0')}` });
    }
    const res = await request(app).get('/dashboard/recent').set('Authorization', `Bearer ${analystToken}`);
    expect(res.body.records).toHaveLength(10);
  });

  it('respects a custom limit', async () => {
    for (let i = 1; i <= 15; i++) {
      seed({ amount: i * 10, type: 'income', category: 'Test', date: `2024-01-${String(i).padStart(2, '0')}` });
    }
    const res = await request(app).get('/dashboard/recent?limit=5').set('Authorization', `Bearer ${analystToken}`);
    expect(res.body.records).toHaveLength(5);
  });

  it('caps limit at 50', async () => {
    for (let i = 1; i <= 60; i++) {
      seed({ amount: 10, type: 'income', category: 'Test', date: '2024-01-01' });
    }
    const res = await request(app).get('/dashboard/recent?limit=100').set('Authorization', `Bearer ${analystToken}`);
    expect(res.body.records).toHaveLength(50);
  });

  it('excludes soft-deleted records', async () => {
    seed({ amount: 100, type: 'income', category: 'Keep', date: '2024-01-01' });
    const deleted = seed({ amount: 999, type: 'income', category: 'Gone', date: '2024-01-02' });
    db.prepare("UPDATE financial_records SET deleted_at = datetime('now') WHERE id = ?").run(deleted.id);

    const res = await request(app).get('/dashboard/recent').set('Authorization', `Bearer ${analystToken}`);
    expect(res.body.records).toHaveLength(1);
    expect(res.body.records[0].category).toBe('Keep');
  });

  it('admin can access recent activity', async () => {
    const res = await request(app).get('/dashboard/recent').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it('viewer cannot access recent activity — 403', async () => {
    expect((await request(app).get('/dashboard/recent').set('Authorization', `Bearer ${viewerToken}`)).status).toBe(403);
  });

  it('returns 401 without a token', async () => {
    expect((await request(app).get('/dashboard/recent')).status).toBe(401);
  });
});
