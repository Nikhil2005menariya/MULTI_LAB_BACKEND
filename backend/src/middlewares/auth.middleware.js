const jwt = require('jsonwebtoken');
const Staff = require('../models/Staff');
const Student = require('../models/Student');
const Faculty = require('../models/Faculty'); // 🔥 ADD THIS

module.exports = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    let user = null;

    if (decoded.role === 'student') {
      user = await Student.findById(decoded.id);
      if (!user || !user.is_verified) {
        return res.status(401).json({ error: 'User no longer valid' });
      }

    } else if (decoded.role === 'faculty') {   // 🔥 ADD THIS BLOCK
      user = await Faculty.findById(decoded.id);
      if (!user || !user.is_verified) {
        return res.status(401).json({ error: 'User no longer valid' });
      }

    } else {
      // super_admin / incharge / assistant
      user = await Staff.findById(decoded.id);
      if (!user || !user.is_active) {
        return res.status(401).json({ error: 'User no longer valid' });
      }
    }

    req.user = decoded;

    next();

  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};