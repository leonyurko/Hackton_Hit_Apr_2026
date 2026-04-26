require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const mindRoutes = require('./routes/mind');
const bodyRoutes = require('./routes/body');
const linkRoutes = require('./routes/link');
const guideRoutes = require('./routes/guide');
const reminderRoutes = require('./routes/reminders');
const audioRoutes    = require('./routes/audio');
const testRoutes     = require('./routes/test');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const { startScheduler } = require('./scheduler');

const app = express();

// ---------------------------------------------------------------------------
// Security & middleware
// ---------------------------------------------------------------------------
// Helmet's default CSP blocks inline scripts and the Google Fonts stylesheet
// the frontend uses. Disable it in dev so the served frontend works.
app.use(
  helmet({
    contentSecurityPolicy: process.env.NODE_ENV === 'production',
  })
);

// CORS — in dev, reflect any origin so any local server (5173, 5500, 8000,
// file://) works. In prod, restrict to ALLOWED_ORIGINS.
app.use(
  cors({
    origin:
      process.env.NODE_ENV === 'production'
        ? process.env.ALLOWED_ORIGINS?.split(',').map((s) => s.trim()) || []
        : true,  // reflect any origin (or null for file://)
  })
);

app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '1mb' }));

// ---------------------------------------------------------------------------
// Serve the frontend statically — same-origin = no CORS at all.
// In dev only; in prod the frontend is typically deployed to Vercel/Netlify.
// ---------------------------------------------------------------------------
if (process.env.NODE_ENV !== 'production') {
  const frontendDir = path.join(__dirname, '..', '..', 'frontend');
  app.use(express.static(frontendDir));
  console.log(`📄 Serving frontend from: ${frontendDir}`);
}

// Global rate limit — 120 requests per minute per IP
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please slow down.' },
  })
);

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.use('/api/auth', authRoutes);
app.use('/api/mind', mindRoutes);
app.use('/api/body', bodyRoutes);
app.use('/api/link', linkRoutes);
app.use('/api/guide', guideRoutes);
app.use('/api/reminders', reminderRoutes);
app.use('/api/audio', audioRoutes);

// Dev-only test route (no auth) — disabled in production
if (process.env.NODE_ENV !== 'production') {
  app.use('/api/test', testRoutes);
  console.log('⚠️  Dev test route enabled: POST /api/test/chat (no auth)');
}

// ---------------------------------------------------------------------------
// Error handling (must be last)
// ---------------------------------------------------------------------------
app.use(notFound);
app.use(errorHandler);

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🛡️  Eitan Backend running on port ${PORT}`);
  console.log(`   Environment : ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Health check: http://localhost:${PORT}/health\n`);
  startScheduler();
});

module.exports = app;
