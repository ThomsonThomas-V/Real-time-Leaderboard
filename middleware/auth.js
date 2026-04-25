const AuthService = require('../services/AuthService');
const logger = require('../config/logger');

async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing or malformed Authorization header',
      });
    }

    const token = authHeader.slice(7);
    const user = await AuthService.verifyAccessToken(token);

    req.user = user;
    next();
  } catch (err) {
    logger.debug('Auth failed:', err.message);
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or expired token',
    });
  }
}

async function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      req.user = await AuthService.verifyAccessToken(authHeader.slice(7));
    } catch {
      // Ignore auth errors for optional auth
    }
  }
  next();
}

module.exports = { requireAuth, optionalAuth };