const express = require('express');
const rateLimit = require('express-rate-limit');
const AuthService = require('../services/AuthService');
const { requireAuth } = require('../middleware/auth');
const { registerValidator, loginValidator } = require('../middleware/validators');
const logger = require('../config/logger');

const router = express.Router();

// Strict rate limit for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 10,
  message: { error: 'Too many auth attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * POST /auth/register
 * Create a new account
 */
router.post('/register', authLimiter, registerValidator, async (req, res) => {
  try {
    const { username, email, password, displayName } = req.body;
    const result = await AuthService.register({ username, email, password, displayName });

    res.status(201).json({
      message: 'Account created successfully',
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });
  } catch (err) {
    if (err.message === 'Username already taken') {
      return res.status(409).json({ error: 'Conflict', message: err.message });
    }
    logger.error('Register error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * POST /auth/login
 * Authenticate and receive tokens
 */
router.post('/login', authLimiter, loginValidator, async (req, res) => {
  try {
    const { username, password } = req.body;
    const result = await AuthService.login({ username, password });

    res.json({
      message: 'Login successful',
      user: result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });
  } catch (err) {
    if (err.message === 'Invalid credentials') {
      return res.status(401).json({ error: 'Unauthorized', message: 'Invalid credentials' });
    }
    if (err.message === 'Account is deactivated') {
      return res.status(403).json({ error: 'Forbidden', message: err.message });
    }
    logger.error('Login error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * POST /auth/refresh
 * Exchange refresh token for a new access token
 */
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ error: 'Bad Request', message: 'refreshToken is required' });
    }

    const tokens = await AuthService.refreshToken(refreshToken);
    res.json({ ...tokens });
  } catch (err) {
    res.status(401).json({ error: 'Unauthorized', message: err.message });
  }
});

/**
 * POST /auth/logout
 * Revoke the refresh token
 */
router.post('/logout', requireAuth, async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await AuthService.logout(refreshToken);
    }
    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    logger.error('Logout error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * GET /auth/me
 * Get current authenticated user's profile
 */
router.get('/me', requireAuth, async (req, res) => {
  const { passwordHash, ...user } = req.user;
  res.json({ user });
});

module.exports = router;
