const mongoose = require('mongoose');

/* =====================================================
   SECURITY: Parameter Validation Middleware
   Validates route params, query params to prevent injection
===================================================== */

// Validate MongoDB ObjectId format
const isValidObjectId = (id) => {
  if (!id || typeof id !== 'string') return false;
  return mongoose.Types.ObjectId.isValid(id) && /^[a-fA-F0-9]{24}$/.test(id);
};

// Validate asset tag format (alphanumeric with hyphens/underscores)
const isValidAssetTag = (tag) => {
  if (!tag || typeof tag !== 'string') return false;
  return /^[a-zA-Z0-9_-]{1,50}$/.test(tag);
};

// Validate transaction ID format (human-readable ID or ObjectId)
const isValidTransactionId = (id) => {
  if (!id || typeof id !== 'string') return false;
  const trimmed = id.trim();
  // Accept common app transaction IDs like LAB-..., TR-..., TXN-... and similar safe IDs.
  if (/^[A-Za-z0-9][A-Za-z0-9_-]{1,99}$/.test(trimmed)) return true;
  // Accept Mongo ObjectId form as well.
  if (mongoose.Types.ObjectId.isValid(trimmed) && /^[a-fA-F0-9]{24}$/.test(trimmed)) return true;
  return false;
};

// Validate search query (prevent injection)
const sanitizeSearchQuery = (query) => {
  if (!query || typeof query !== 'string') return '';
  // Remove special regex characters and limit length
  return query
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .slice(0, 100)
    .trim();
};

// Validate pagination params
const validatePagination = (page, limit) => {
  const validPage = Math.max(1, Math.min(parseInt(page) || 1, 1000));
  const validLimit = Math.max(1, Math.min(parseInt(limit) || 10, 100));
  return { page: validPage, limit: validLimit };
};

// Validate date range
const isValidDateRange = (startDate, endDate) => {
  if (!startDate && !endDate) return true;

  const start = startDate ? new Date(startDate) : null;
  const end = endDate ? new Date(endDate) : null;

  if (start && isNaN(start.getTime())) return false;
  if (end && isNaN(end.getTime())) return false;
  if (start && end && start > end) return false;

  return true;
};

/* =====================================================
   MIDDLEWARE: Validate ObjectId params
===================================================== */
const validateObjectId = (...paramNames) => {
  return (req, res, next) => {
    for (const paramName of paramNames) {
      const id = req.params[paramName];
      if (id && !isValidObjectId(id)) {
        return res.status(400).json({
          error: `Invalid ${paramName} format`
        });
      }
    }
    next();
  };
};

/* =====================================================
   MIDDLEWARE: Validate asset tag param
===================================================== */
const validateAssetTag = (paramName = 'assetTag') => {
  return (req, res, next) => {
    const tag = req.params[paramName];
    if (tag && !isValidAssetTag(tag)) {
      return res.status(400).json({
        error: 'Invalid asset tag format'
      });
    }
    next();
  };
};

/* =====================================================
   MIDDLEWARE: Validate transaction ID param
===================================================== */
const validateTransactionId = (paramName = 'transaction_id') => {
  return (req, res, next) => {
    const id = req.params[paramName];
    if (id && !isValidTransactionId(id)) {
      return res.status(400).json({
        error: 'Invalid transaction ID format'
      });
    }
    next();
  };
};

/* =====================================================
   MIDDLEWARE: Sanitize search queries
===================================================== */
const sanitizeSearch = (queryParams = ['q', 'search', 'query', 'keyword']) => {
  return (req, res, next) => {
    for (const param of queryParams) {
      if (req.query[param]) {
        req.query[param] = sanitizeSearchQuery(req.query[param]);
      }
    }
    next();
  };
};

/* =====================================================
   MIDDLEWARE: Validate and normalize pagination
===================================================== */
const validatePaginationParams = (req, res, next) => {
  const { page, limit } = validatePagination(req.query.page, req.query.limit);
  req.query.page = page;
  req.query.limit = limit;
  next();
};

/* =====================================================
   MIDDLEWARE: Validate date range in query
===================================================== */
const validateDateRange = (startParam = 'startDate', endParam = 'endDate') => {
  return (req, res, next) => {
    const startDate = req.query[startParam];
    const endDate = req.query[endParam];

    if (!isValidDateRange(startDate, endDate)) {
      return res.status(400).json({
        error: 'Invalid date range'
      });
    }
    next();
  };
};

/* =====================================================
   MIDDLEWARE: Validate status values
===================================================== */
const validateStatus = (allowedStatuses) => {
  return (req, res, next) => {
    const status = req.body.status || req.query.status;
    if (status && !allowedStatuses.includes(status)) {
      return res.status(400).json({
        error: `Invalid status. Allowed: ${allowedStatuses.join(', ')}`
      });
    }
    next();
  };
};

/* =====================================================
   MIDDLEWARE: Validate lab ID format
===================================================== */
const validateLabId = (paramName = 'labId') => {
  return (req, res, next) => {
    const labId = req.params[paramName];
    if (labId && !isValidObjectId(labId)) {
      return res.status(400).json({
        error: 'Invalid lab ID format'
      });
    }
    next();
  };
};

module.exports = {
  isValidObjectId,
  isValidAssetTag,
  isValidTransactionId,
  sanitizeSearchQuery,
  validatePagination,
  isValidDateRange,
  validateObjectId,
  validateAssetTag,
  validateTransactionId,
  sanitizeSearch,
  validatePaginationParams,
  validateDateRange,
  validateStatus,
  validateLabId
};
