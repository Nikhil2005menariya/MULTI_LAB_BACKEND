const multer = require('multer');
const path = require('path');

/* =====================================================
   SECURITY: File Upload Configuration
===================================================== */

// Allowed MIME types
const ALLOWED_MIME_TYPES = ['application/pdf'];

// Maximum file size (5MB - reduced for security)
const MAX_FILE_SIZE = 5 * 1024 * 1024;

// PDF magic bytes signature
const PDF_MAGIC_BYTES = Buffer.from([0x25, 0x50, 0x44, 0x46]); // %PDF

// Sanitize filename to prevent path traversal and special characters
const sanitizeFilename = (filename) => {
  if (!filename || typeof filename !== 'string') return 'unnamed.pdf';

  // Remove path components
  const basename = path.basename(filename);

  // Remove special characters, keep only alphanumeric, dots, hyphens, underscores
  const sanitized = basename
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/\.{2,}/g, '.') // Remove multiple dots
    .replace(/^\.+/, '') // Remove leading dots
    .slice(0, 100); // Limit filename length

  return sanitized || 'unnamed.pdf';
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1, // Only allow single file upload
    fields: 10, // Limit number of non-file fields
    fieldSize: 1024 * 100 // 100KB max field size
  },
  fileFilter: (req, file, cb) => {
    // Validate MIME type
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return cb(new Error('Only PDF files are allowed'));
    }

    // Sanitize the filename
    file.originalname = sanitizeFilename(file.originalname);

    cb(null, true);
  }
});

// Middleware to validate PDF content after upload
const validatePDFContent = (req, res, next) => {
  if (!req.file) {
    return next();
  }

  const buffer = req.file.buffer;

  // Check minimum size
  if (buffer.length < 10) {
    return res.status(400).json({ error: 'Invalid PDF file' });
  }

  // Check PDF magic bytes
  const fileHeader = buffer.slice(0, 4);
  if (!fileHeader.equals(PDF_MAGIC_BYTES)) {
    return res.status(400).json({ error: 'Invalid PDF file format' });
  }

  // Check for potential malicious content patterns
  const content = buffer.toString('utf8', 0, Math.min(buffer.length, 10000));

  // Check for JavaScript in PDF (potential security risk)
  const dangerousPatterns = [
    '/JavaScript',
    '/JS',
    '/Launch',
    '/SubmitForm',
    '/ImportData'
  ];

  for (const pattern of dangerousPatterns) {
    if (content.includes(pattern)) {
      console.warn('PDF with potentially dangerous content detected');
      // Note: We log but don't block as some legitimate PDFs may have these
    }
  }

  next();
};

// Error handling middleware for multer errors
const handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File size exceeds 5MB limit' });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Only one file allowed' });
    }
    return res.status(400).json({ error: 'File upload error' });
  }

  if (err) {
    return res.status(400).json({ error: err.message || 'Upload failed' });
  }

  next();
};

module.exports = upload;
module.exports.validatePDFContent = validatePDFContent;
module.exports.handleUploadError = handleUploadError;
