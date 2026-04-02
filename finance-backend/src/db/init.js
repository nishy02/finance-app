/**
 * Called on server start in production.
 * Seeds demo accounts only if the users table is empty,
 * so redeploys don't duplicate data.
 */
const db = require('./index');
const bcrypt = require('bcryptjs');

function initProd() {
  const count = db.prepare('SELECT COUNT(*) as n FROM users').get().n;
  if (count > 0) {
    console.log('DB already seeded, skipping.');
    return;
  }

  console.log('Fresh database — seeding demo accounts…');

  const insert = db.prepare(
    'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)'
  );

  const seed = db.transaction(() => {
    insert.run('Admin User',   'admin@example.com',   bcrypt.hashSync('admin123',   10), 'admin');
    insert.run('Analyst User', 'analyst@example.com', bcrypt.hashSync('analyst123', 10), 'analyst');
    insert.run('Viewer User',  'viewer@example.com',  bcrypt.hashSync('viewer123',  10), 'viewer');
  });

  seed();
  console.log('Demo accounts created.');
}

module.exports = { initProd };
