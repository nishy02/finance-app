/**
 * Role hierarchy: admin > analyst > viewer
 * Each role inherits permissions of roles below it.
 */
const ROLE_LEVELS = { viewer: 1, analyst: 2, admin: 3 };

/**
 * Returns middleware that allows access only if the user's role
 * meets or exceeds the required minimum role level.
 */
function requireRole(minRole) {
  return (req, res, next) => {
    const userLevel = ROLE_LEVELS[req.user?.role] ?? 0;
    const requiredLevel = ROLE_LEVELS[minRole] ?? 99;
    if (userLevel < requiredLevel) {
      return res.status(403).json({
        error: `Forbidden: requires '${minRole}' role or higher`,
      });
    }
    next();
  };
}

module.exports = { requireRole };
