/* =====================================================
   SECURITY: Role-Based Access Control Middleware
===================================================== */

// Define all valid roles in the system
const VALID_ROLES = ['student', 'faculty', 'super_admin', 'incharge', 'assistant', 'admin'];

/**
 * Role validation middleware
 * @param {string|string[]} allowedRoles - Single role or array of allowed roles
 * @returns {Function} Express middleware function
 */
module.exports = (allowedRoles) => {
  // Normalize to array
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

  // Validate provided roles at middleware creation time
  for (const role of roles) {
    if (!VALID_ROLES.includes(role)) {
      throw new Error(`Invalid role configuration: ${role}`);
    }
  }

  return (req, res, next) => {
    // Ensure user object exists (auth middleware should run first)
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Validate user role exists and is a string
    if (!req.user.role || typeof req.user.role !== 'string') {
      return res.status(401).json({ error: 'Invalid user session' });
    }

    // Check if user's role is in the allowed roles
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    next();
  };
};

// Export helper to check multiple roles
module.exports.hasAnyRole = (allowedRoles) => module.exports(allowedRoles);

// Export valid roles for reference
module.exports.VALID_ROLES = VALID_ROLES;
