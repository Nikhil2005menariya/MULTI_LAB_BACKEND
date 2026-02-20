const express = require('express');
const cors = require('cors');

const app = express();

/* =========================
   CORS (SAFE & COMPATIBLE)
========================= */
app.use(
  cors({
    origin: [
      'http://localhost:8080', // Lovable frontend
      'http://localhost:5173',  // Vite
      'https://labflow-manager.vercel.app',
    ],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
  })
);

/* =========================
   BODY PARSER
========================= */
app.use(express.json());

/* =========================
   ROUTES
========================= */
app.use('/api', require('./routes'));

app.get('/health', (req, res) => {
  res.send('Backend OK');
});

module.exports = app;
