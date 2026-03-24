const mongoose = require('mongoose');

/* =====================================================
   SECURITY: Input Validation Middleware & Helpers
===================================================== */

// Validation regex patterns
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
const NAME_REGEX = /^[a-zA-Z\s.'-]{2,100}$/;
const PHONE_REGEX = /^[+]?[0-9]{10,15}$/;
const ALPHANUMERIC_REGEX = /^[a-zA-Z0-9]+$/;

/**
 * Validate email format
 */
const isValidEmail = (email) => {
  if (!email || typeof email !== 'string') return false;
  if (email.length > 254) return false;
  return EMAIL_REGEX.test(email);
};

/**
 * Validate name format
 */
const isValidName = (name) => {
  if (!name || typeof name !== 'string') return false;
  return NAME_REGEX.test(name);
};

/**
 * Validate MongoDB ObjectId
 */
const isValidObjectId = (id) => {
  if (!id || typeof id !== 'string') return false;
  return mongoose.Types.ObjectId.isValid(id);
};

/**
 * Validate phone number
 */
const isValidPhone = (phone) => {
  if (!phone || typeof phone !== 'string') return false;
  return PHONE_REGEX.test(phone);
};

/**
 * Sanitize text input - remove HTML tags and limit length
 */
const sanitizeText = (text, maxLength = 500) => {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/<[^>]*>/g, '') // Remove HTML tags
    .replace(/[<>]/g, '') // Remove stray angle brackets
    .trim()
    .slice(0, maxLength);
};

/**
 * Escape HTML characters for XSS prevention
 */
const escapeHtml = (str) => {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

/**
 * Escape regex special characters for ReDoS prevention
 */
const escapeRegex = (str) => {
  if (!str || typeof str !== 'string') return '';
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

/**
 * Middleware factory to validate required fields
 */
const validateRequired = (fields) => {
  return (req, res, next) => {
    const missing = [];

    for (const field of fields) {
      const value = req.body[field];
      if (value === undefined || value === null || value === '') {
        missing.push(field);
      }
    }

    if (missing.length > 0) {
      return res.status(400).json({
        error: `Missing required fields: ${missing.join(', ')}`
      });
    }

    next();
  };
};

/**
 * Middleware to validate ObjectId in params
 */
const validateParamId = (paramName = 'id') => {
  return (req, res, next) => {
    const id = req.params[paramName];

    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid ID format' });
    }

    next();
  };
};

/**
 * Middleware to validate email in body
 */
const validateEmail = (fieldName = 'email') => {
  return (req, res, next) => {
    const email = req.body[fieldName];

    if (email && !isValidEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    next();
  };
};

/**
 * Middleware to sanitize common text fields in body
 */
const sanitizeBody = (fields, maxLength = 500) => {
  return (req, res, next) => {
    for (const field of fields) {
      if (req.body[field] && typeof req.body[field] === 'string') {
        req.body[field] = sanitizeText(req.body[field], maxLength);
      }
    }

    next();
  };
};

/**
 * Middleware to validate and sanitize pagination params
 */
const validatePagination = (req, res, next) => {
  let { page, limit } = req.query;

  // Parse and validate page
  page = parseInt(page, 10);
  if (isNaN(page) || page < 1) {
    page = 1;
  }
  if (page > 10000) {
    page = 10000; // Cap maximum page
  }

  // Parse and validate limit
  limit = parseInt(limit, 10);
  if (isNaN(limit) || limit < 1) {
    limit = 10;
  }
  if (limit > 100) {
    limit = 100; // Cap maximum limit
  }

  req.pagination = { page, limit, skip: (page - 1) * limit };
  next();
};

module.exports = {
  // Validators
  isValidEmail,
  isValidName,
  isValidObjectId,
  isValidPhone,

  // Sanitizers
  sanitizeText,
  escapeHtml,
  escapeRegex,

  // Middleware
  validateRequired,
  validateParamId,
  validateEmail,
  sanitizeBody,
  validatePagination
};
