/**
 * Global error handling middleware.
 * Must be registered LAST in Express (after all routes).
 */
function errorHandler(err, req, res, next) {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err.message || err);

  // Supabase / known API errors
  if (err.status) {
    return res.status(err.status).json({ error: err.message });
  }

  // Validation errors (express-validator)
  if (err.type === 'validation') {
    return res.status(422).json({ error: 'Validation failed', details: err.details });
  }

  // AI service rate limit
  if (err.code === 'RATE_LIMIT') {
    return res.status(429).json({
      error: 'AI service is busy. Please try again in a moment.',
      retryAfter: err.retryAfter || 5,
    });
  }

  // Default: 500
  res.status(500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
}

/**
 * 404 handler — attach after all routes but before errorHandler.
 */
function notFound(req, res) {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
}

module.exports = { errorHandler, notFound };
