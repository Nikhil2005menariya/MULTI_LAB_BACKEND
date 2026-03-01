const jwt = require('jsonwebtoken');
const Staff = require('../models/Staff');
const Student = require('../models/Student');

module.exports = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    // Validate Bearer format
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];

    // Verify JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    let user = null;

    // Check based on role
    if (decoded.role === 'student') {
      user = await Student.findById(decoded.id);
      if (!user || !user.is_verified) {
        return res.status(401).json({ error: 'User no longer valid' });
      }
    } else {
      user = await Staff.findById(decoded.id);
      if (!user || !user.is_active) {
        return res.status(401).json({ error: 'User no longer valid' });
      }
    }

    // Attach full decoded token
    req.user = decoded;

    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};