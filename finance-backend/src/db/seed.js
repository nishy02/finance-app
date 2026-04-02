require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('./index');

const users = [
  { name: 'Admin User', email: 'admin@example.com', password: 'admin123', role: 'admin' },
  { name: 'Analyst User', email: 'analyst@example.com', password: 'analyst123', role: 'analyst' },
  { name: 'Viewer User', email: 'viewer@example.com', password: 'viewer123', role: 'viewer' },
];

const categories = ['Salary', 'Freelance', 'Rent', 'Utilities', 'Food', 'Transport', 'Healthcare', 'Entertainment'];
const types = ['income', 'expense'];

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDate(start, end) {
  const d = new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
  return d.toISOString().split('T')[0];
}

console.log('Seeding database...');

// Insert users
const insertUser = db.prepare(
  'INSERT OR IGNORE INTO users (name, email, password, role) VALUES (?, ?, ?, ?)'
);

let adminId;
for (const u of users) {
  const hash = bcrypt.hashSync(u.password, 10);
  insertUser.run(u.name, u.email, hash, u.role);
}

adminId = db.prepare('SELECT id FROM users WHERE email = ?').get('admin@example.com').id;

// Insert 50 sample financial records
const insertRecord = db.prepare(
  'INSERT INTO financial_records (amount, type, category, date, notes, created_by) VALUES (?, ?, ?, ?, ?, ?)'
);

const insertMany = db.transaction(() => {
  for (let i = 0; i < 50; i++) {
    const type = types[randomBetween(0, 1)];
    const category = categories[randomBetween(0, categories.length - 1)];
    const amount = parseFloat((randomBetween(50, 5000) + Math.random()).toFixed(2));
    const date = randomDate(new Date('2024-01-01'), new Date('2024-12-31'));
    insertRecord.run(amount, type, category, date, `Sample ${type} record`, adminId);
  }
});

insertMany();

console.log('Done. Seed accounts:');
console.log('  admin@example.com    / admin123   (admin)');
console.log('  analyst@example.com  / analyst123 (analyst)');
console.log('  viewer@example.com   / viewer123  (viewer)');
