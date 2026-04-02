const router = require('express').Router();
const { body, param, query: qv, validationResult } = require('express-validator');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');

router.use(authenticate);

// GET /records — viewers, analysts, admins can all read
router.get(
  '/',
  [
    qv('type').optional().isIn(['income', 'expense']),
    qv('category').optional().trim(),
    qv('from').optional().isDate(),
    qv('to').optional().isDate(),
    qv('page').optional().isInt({ min: 1 }),
    qv('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const { type, category, from, to, page = 1, limit = 20 } = req.query;
    let base = 'FROM financial_records WHERE deleted_at IS NULL';
    const params = [];

    if (type)     { base += ' AND type = ?';     params.push(type); }
    if (category) { base += ' AND category = ?'; params.push(category); }
    if (from)     { base += ' AND date >= ?';    params.push(from); }
    if (to)       { base += ' AND date <= ?';    params.push(to); }

    const total = db.prepare(`SELECT COUNT(*) as total ${base}`).get(...params).total;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const records = db
      .prepare(`SELECT * ${base} ORDER BY date DESC LIMIT ? OFFSET ?`)
      .all(...params, parseInt(limit), offset);

    res.json({ records, pagination: { page: +page, limit: +limit, total } });
  }
);

// GET /records/:id
router.get('/:id', param('id').isInt(), (req, res) => {
  const record = db
    .prepare('SELECT * FROM financial_records WHERE id = ? AND deleted_at IS NULL')
    .get(req.params.id);
  if (!record) return res.status(404).json({ error: 'Record not found' });
  res.json({ record });
});

// POST /records — analyst and admin only
router.post(
  '/',
  requireRole('analyst'),
  [
    body('amount').isFloat({ gt: 0 }).withMessage('Amount must be a positive number'),
    body('type').isIn(['income', 'expense']).withMessage('Type must be income or expense'),
    body('category').trim().notEmpty().withMessage('Category is required'),
    body('date').isDate().withMessage('Date must be a valid date (YYYY-MM-DD)'),
    body('notes').optional().trim(),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const { amount, type, category, date, notes } = req.body;
    const result = db
      .prepare(
        'INSERT INTO financial_records (amount, type, category, date, notes, created_by) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(amount, type, category, date, notes || null, req.user.id);

    const record = db
      .prepare('SELECT * FROM financial_records WHERE id = ?')
      .get(result.lastInsertRowid);
    res.status(201).json({ record });
  }
);

// PATCH /records/:id — analyst and admin only
router.patch(
  '/:id',
  requireRole('analyst'),
  [
    param('id').isInt(),
    body('amount').optional().isFloat({ gt: 0 }),
    body('type').optional().isIn(['income', 'expense']),
    body('category').optional().trim().notEmpty(),
    body('date').optional().isDate(),
    body('notes').optional().trim(),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const record = db
      .prepare('SELECT id FROM financial_records WHERE id = ? AND deleted_at IS NULL')
      .get(req.params.id);
    if (!record) return res.status(404).json({ error: 'Record not found' });

    const fields = [];
    const params = [];
    for (const key of ['amount', 'type', 'category', 'date', 'notes']) {
      if (req.body[key] !== undefined) {
        fields.push(`${key} = ?`);
        params.push(req.body[key]);
      }
    }
    if (!fields.length) return res.status(400).json({ error: 'No fields to update' });

    fields.push("updated_at = datetime('now')");
    params.push(req.params.id);
    db.prepare(`UPDATE financial_records SET ${fields.join(', ')} WHERE id = ?`).run(...params);

    const updated = db.prepare('SELECT * FROM financial_records WHERE id = ?').get(req.params.id);
    res.json({ record: updated });
  }
);

// DELETE /records/:id — soft delete, admin only
router.delete('/:id', requireRole('admin'), param('id').isInt(), (req, res) => {
  const record = db
    .prepare('SELECT id FROM financial_records WHERE id = ? AND deleted_at IS NULL')
    .get(req.params.id);
  if (!record) return res.status(404).json({ error: 'Record not found' });

  db.prepare("UPDATE financial_records SET deleted_at = datetime('now') WHERE id = ?").run(req.params.id);
  res.status(204).send();
});

module.exports = router;
