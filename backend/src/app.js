const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const hpp = require('hpp');

const app = express();

/* =========================
   SECURITY: Helmet Headers
   Sets various HTTP headers for security
========================= */
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  crossOriginEmbedderPolicy: false, // Allow embedding if needed
}));

/* =========================
   CORS (SAFE & COMPATIBLE)
========================= */
const allowedOrigins = [
  'http://localhost:8080',
  'http://localhost:5173',
  'https://labflow-manager.vercel.app',
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, Postman, etc.) in development
      if (!origin && process.env.NODE_ENV !== 'production') {
        return callback(null, true);
      }
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    maxAge: 86400, // Cache preflight for 24 hours
  })
);

/* =========================
   BODY PARSER with size limits
========================= */
app.use(express.json({ limit: '10kb' })); // Limit JSON body size
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

/* =========================
   SECURITY: NoSQL Injection Prevention
   Custom sanitizer compatible with Express 5
========================= */
const sanitizeObject = (obj) => {
  if (obj === null || typeof obj !== 'object') return obj;

  for (const key in obj) {
    if (key.startsWith('$') || key.includes('.')) {
      delete obj[key];
    } else if (typeof obj[key] === 'object') {
      sanitizeObject(obj[key]);
    } else if (typeof obj[key] === 'string') {
      // Remove MongoDB operators from string values
      if (obj[key].includes('$')) {
        obj[key] = obj[key].replace(/\$/g, '_');
      }
    }
  }
  return obj;
};

app.use((req, res, next) => {
  // Sanitize body (mutable)
  if (req.body) {
    sanitizeObject(req.body);
  }
  // Note: req.query is read-only in Express 5, but our paramValidator
  // middleware already handles query sanitization at the route level
  next();
});

/* =========================
   SECURITY: HTTP Parameter Pollution
   Prevents duplicate query parameters
========================= */
app.use(hpp({
  whitelist: ['sort', 'fields', 'page', 'limit'] // Allow these to be arrays
}));

/* =========================
   SECURITY: Disable X-Powered-By
========================= */
app.disable('x-powered-by');

/* =========================
   ROUTES
========================= */
app.use('/api', require('./routes'));

app.get('/health', (req, res) => {
  res.send('Backend OK');
});

/* =========================
   ERROR HANDLER
   Prevent stack trace leakage in production
========================= */
app.use((err, req, res, next) => {
  console.error(err.stack);

  // Don't leak error details in production
  const message = process.env.NODE_ENV === 'production'
    ? 'Internal server error'
    : err.message;

  res.status(err.status || 500).json({ error: message });
});

module.exports = app;
