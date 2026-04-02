/**
 * Called on server start in production.
 * Seeds demo accounts and sample records only if the users table is empty,
 * so redeploys don't duplicate data.
 */
const db = require('./index');
const bcrypt = require('bcryptjs');

function initProd() {
  const count = db.prepare('SELECT COUNT(*) as n FROM users').get().n;
  if (count > 0 && process.env.FORCE_SEED !== 'true') {
    console.log('DB already seeded, skipping.');
    return;
  }

  console.log('Fresh database — seeding demo data…');

  const insertUser = db.prepare(
    'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)'
  );
  const insertRecord = db.prepare(
    'INSERT INTO financial_records (amount, type, category, date, notes, created_by) VALUES (?, ?, ?, ?, ?, ?)'
  );

  const seed = db.transaction(() => {
    // Wipe existing data if force-seeding
    if (process.env.FORCE_SEED === 'true') {
      db.prepare('DELETE FROM financial_records').run();
      db.prepare('DELETE FROM users').run();
    }
    // Demo users
    insertUser.run('Admin User',   'admin@example.com',   bcrypt.hashSync('admin123',   10), 'admin');
    insertUser.run('Analyst User', 'analyst@example.com', bcrypt.hashSync('analyst123', 10), 'analyst');
    insertUser.run('Viewer User',  'viewer@example.com',  bcrypt.hashSync('viewer123',  10), 'viewer');

    const adminId = db.prepare("SELECT id FROM users WHERE email = 'admin@example.com'").get().id;

    // 10 sample financial records spread across recent months
    const records = [
      [4500.00, 'income',  'Salary',        '2024-10-01', 'October salary',          adminId],
      [1200.00, 'income',  'Freelance',     '2024-10-15', 'Web project payment',     adminId],
      [ 850.00, 'expense', 'Rent',          '2024-10-02', 'Monthly rent',            adminId],
      [ 120.50, 'expense', 'Utilities',     '2024-10-10', 'Electricity & water',     adminId],
      [  95.00, 'expense', 'Food',          '2024-10-18', 'Groceries',               adminId],
      [4500.00, 'income',  'Salary',        '2024-11-01', 'November salary',         adminId],
      [ 850.00, 'expense', 'Rent',          '2024-11-02', 'Monthly rent',            adminId],
      [ 300.00, 'income',  'Freelance',     '2024-11-20', 'Logo design',             adminId],
      [ 210.00, 'expense', 'Transport',     '2024-11-12', 'Flight tickets',          adminId],
      [ 499.99, 'expense', 'Entertainment', '2024-11-25', 'Annual streaming subs',   adminId],
    ];

    for (const r of records) insertRecord.run(...r);
  });

  seed();
  console.log('Seeded 3 users and 10 financial records.');
}

module.exports = { initProd };
