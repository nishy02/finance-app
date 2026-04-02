const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { body, param, validationResult } = require('express-validator');
const db = require('../db');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');

// All user management routes require admin
router.use(authenticate, requireRole('admin'));

// GET /users — list all users
router.get('/', (req, res) => {
  const { status, role, page = 1, limit = 20 } = req.query;
  let query = 'SELECT id, name, email, role, status, created_at FROM users WHERE 1=1';
  const params = [];

  if (status) { query += ' AND status = ?'; params.push(status); }
  if (role)   { query += ' AND role = ?';   params.push(role); }

  const offset = (parseInt(page) - 1) * parseInt(limit);
  const countRow = db.prepare(query.replace('SELECT id, name, email, role, status, created_at', 'SELECT COUNT(*) as total')).get(...params);
  const total = countRow.total;
  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), offset);

  const users = db.prepare(query).all(...params);
  res.json({ users, pagination: { page: +page, limit: +limit, total } });
});

// GET /users/:id
router.get('/:id', param('id').isInt(), (req, res) => {
  const user = db
    .prepare('SELECT id, name, email, role, status, created_at FROM users WHERE id = ?')
    .get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

// PATCH /users/:id — update role or status
router.patch(
  '/:id',
  [
    param('id').isInt(),
    body('role').optional().isIn(['viewer', 'analyst', 'admin']),
    body('status').optional().isIn(['active', 'inactive']),
    body('name').optional().trim().notEmpty(),
  ],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Prevent admin from deactivating themselves
    if (req.params.id == req.user.id && req.body.status === 'inactive') {
      return res.status(400).json({ error: 'Cannot deactivate your own account' });
    }

    const fields = [];
    const params = [];
    for (const key of ['name', 'role', 'status']) {
      if (req.body[key] !== undefined) {
        fields.push(`${key} = ?`);
        params.push(req.body[key]);
      }
    }
    if (!fields.length) return res.status(400).json({ error: 'No fields to update' });

    fields.push("updated_at = datetime('now')");
    params.push(req.params.id);
    db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...params);

    const updated = db
      .prepare('SELECT id, name, email, role, status, created_at, updated_at FROM users WHERE id = ?')
      .get(req.params.id);
    res.json({ user: updated });
  }
);

// DELETE /users/:id — hard delete (admin only, cannot self-delete)
router.delete('/:id', param('id').isInt(), (req, res) => {
  if (req.params.id == req.user.id) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }
  const result = db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'User not found' });
  res.status(204).send();
});

module.exports = router;
