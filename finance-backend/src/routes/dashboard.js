const router = require('express').Router();
const { query: qv, validationResult } = require('express-validator');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');

// All dashboard routes require at least analyst role
router.use(authenticate, requireRole('analyst'));

// GET /dashboard/summary — totals and net balance
router.get('/summary', (req, res) => {
  const row = db
    .prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'income'  THEN amount ELSE 0 END), 0) AS total_income,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) AS total_expenses,
        COALESCE(SUM(CASE WHEN type = 'income'  THEN amount ELSE -amount END), 0) AS net_balance,
        COUNT(*) AS total_records
      FROM financial_records
      WHERE deleted_at IS NULL
    `)
    .get();

  res.json({ summary: row });
});

// GET /dashboard/by-category — totals grouped by category
router.get('/by-category', (req, res) => {
  const rows = db
    .prepare(`
      SELECT
        category,
        type,
        ROUND(SUM(amount), 2) AS total,
        COUNT(*) AS count
      FROM financial_records
      WHERE deleted_at IS NULL
      GROUP BY category, type
      ORDER BY total DESC
    `)
    .all();

  res.json({ categories: rows });
});

// GET /dashboard/trends?period=monthly|weekly&year=2024
router.get(
  '/trends',
  [
    qv('period').optional().isIn(['monthly', 'weekly']),
    qv('year').optional().isInt({ min: 2000, max: 2100 }),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const { period = 'monthly', year = new Date().getFullYear() } = req.query;

    // SQLite strftime for grouping
    const fmt = period === 'weekly' ? '%Y-W%W' : '%Y-%m';

    const rows = db
      .prepare(`
        SELECT
          strftime('${fmt}', date) AS period,
          type,
          ROUND(SUM(amount), 2) AS total,
          COUNT(*) AS count
        FROM financial_records
        WHERE deleted_at IS NULL
          AND strftime('%Y', date) = ?
        GROUP BY period, type
        ORDER BY period ASC
      `)
      .all(String(year));

    res.json({ period, year: +year, trends: rows });
  }
);

// GET /dashboard/recent?limit=10 — recent activity
router.get('/recent', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 10, 50);
  const records = db
    .prepare(`
      SELECT r.*, u.name AS created_by_name
      FROM financial_records r
      JOIN users u ON r.created_by = u.id
      WHERE r.deleted_at IS NULL
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT ?
    `)
    .all(limit);

  res.json({ records });
});

module.exports = router;
