const supabase = require('../config/supabase');

/**
 * Verifies the Supabase JWT from the Authorization header.
 * Attaches the authenticated user to req.user.
 */
async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.split(' ')[1];

  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data?.user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.user = data.user;
  next();
}

/**
 * Optional auth — attaches user if token present, but does not block unauthenticated requests.
 */
async function optionalAuthenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return next();

  const token = authHeader.split(' ')[1];
  const { data } = await supabase.auth.getUser(token);
  if (data?.user) req.user = data.user;

  next();
}

module.exports = { authenticate, optionalAuthenticate };
