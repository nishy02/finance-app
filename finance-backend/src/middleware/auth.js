const jwt = require('jsonwebtoken');
const db = require('../db');

/**
 * Verifies JWT and attaches the user to req.user.
 * Rejects inactive users even if their token is valid.
 */
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  const token = authHeader.slice(7);
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const user = db.prepare('SELECT id, name, email, role, status FROM users WHERE id = ?').get(payload.sub);
  if (!user) return res.status(401).json({ error: 'User not found' });
  if (user.status === 'inactive') return res.status(403).json({ error: 'Account is inactive' });

  req.user = user;
  next();
}

module.exports = { authenticate };
