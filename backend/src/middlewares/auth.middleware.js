const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const Staff = require('../models/Staff');
const Student = require('../models/Student');
const Faculty = require('../models/Faculty');

/* =====================================================
   SECURITY: Validation Helpers
===================================================== */
const VALID_ROLES = ['student', 'faculty', 'super_admin', 'incharge', 'assistant', 'admin'];

const isValidObjectId = (id) => {
  if (!id || typeof id !== 'string') return false;
  return mongoose.Types.ObjectId.isValid(id);
};

const isValidRole = (role) => {
  if (!role || typeof role !== 'string') return false;
  return VALID_ROLES.includes(role);
};

module.exports = async (req, res, next) => {
  try {
    let token = null;

    // Check Authorization header first
    const authHeader = req.headers.authorization;
    if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    }

    // Fallback: Check query param (for file downloads via browser)
    if (!token && req.query.token && typeof req.query.token === 'string') {
      token = req.query.token;
    }

    // Validate token exists
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    // Validate token exists and has reasonable length
    if (!token || token.length < 10 || token.length > 2000) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (jwtError) {
      // Don't expose JWT error details
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Validate decoded token structure
    if (!decoded || !decoded.id || !decoded.role) {
      return res.status(401).json({ error: 'Invalid token payload' });
    }

    // Validate ObjectId format before database query
    if (!isValidObjectId(decoded.id)) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // Validate role
    if (!isValidRole(decoded.role)) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    let user = null;

    if (decoded.role === 'student') {
      user = await Student.findById(decoded.id).lean();
      if (!user || !user.is_verified) {
        return res.status(401).json({ error: 'User no longer valid' });
      }

    } else if (decoded.role === 'faculty') {
      user = await Faculty.findById(decoded.id).lean();
      if (!user || !user.is_verified) {
        return res.status(401).json({ error: 'User no longer valid' });
      }

    } else {
      // super_admin / incharge / assistant
      user = await Staff.findById(decoded.id).lean();
      if (!user || !user.is_active) {
        return res.status(401).json({ error: 'User no longer valid' });
      }
    }

    // Attach user info to request (only necessary fields)
    req.user = {
      id: decoded.id,
      role: decoded.role,
      lab_id: decoded.lab_id || null
    };

    next();

  } catch (err) {
    console.error('Auth middleware error:', err);
    return res.status(401).json({ error: 'Authentication failed' });
  }
};