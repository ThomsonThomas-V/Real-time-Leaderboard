const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const UserModel = require('../models/User');
const { getRedisClient, KEYS } = require('../config/redis');
const logger = require('../config/logger');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '30d';

class AuthService {
  constructor() {
    this.redis = getRedisClient();
  }

  /**
   * Register a new user
   */
  async register({ username, email, password, displayName }) {
    try {
      const user = await UserModel.create({ username, email, password, displayName });
      const tokens = await this._generateTokens(user);
      logger.info(`New user registered: ${username} (${user.id})`);
      return { user, ...tokens };
    } catch (err) {
      logger.error('Registration failed:', err.message);
      throw err;
    }
  }

  /**
   * Log in an existing user
   */
  async login({ username, password }) {
    const user = await UserModel.findByUsername(username);
    if (!user) {
      throw new Error('Invalid credentials');
    }

    if (!parseInt(user.isActive)) {
      throw new Error('Account is deactivated');
    }

    const valid = await UserModel.verifyPassword(user, password);
    if (!valid) {
      throw new Error('Invalid credentials');
    }

    const tokens = await this._generateTokens(user);
    logger.info(`User logged in: ${username} (${user.id})`);
    return { user: UserModel.sanitize(user), ...tokens };
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshToken(refreshToken) {
    let payload;
    try {
      payload = jwt.verify(refreshToken, JWT_SECRET);
    } catch {
      throw new Error('Invalid or expired refresh token');
    }

    // Check if refresh token is still in Redis (not revoked)
    const storedToken = await this.redis.get(KEYS.sessionToken(payload.jti));
    if (!storedToken) {
      throw new Error('Refresh token has been revoked');
    }

    const user = await UserModel.findById(payload.sub);
    if (!user) throw new Error('User not found');

    // Rotate refresh token
    await this.redis.del(KEYS.sessionToken(payload.jti));
    const tokens = await this._generateTokens(user);
    return tokens;
  }

  /**
   * Logout — revoke refresh token
   */
  async logout(refreshToken) {
    try {
      const payload = jwt.verify(refreshToken, JWT_SECRET);
      await this.redis.del(KEYS.sessionToken(payload.jti));
    } catch {
      // Ignore errors on logout
    }
  }

  /**
   * Verify an access token and return the user
   */
  async verifyAccessToken(token) {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.type !== 'access') throw new Error('Invalid token type');
    const user = await UserModel.findById(payload.sub);
    if (!user) throw new Error('User not found');
    return user;
  }

  /**
   * Generate access + refresh token pair
   */
  async _generateTokens(user) {
    const jti = uuidv4(); // JWT ID for refresh token tracking

    const accessToken = jwt.sign(
      { sub: user.id, username: user.username, type: 'access' },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    const refreshToken = jwt.sign(
      { sub: user.id, type: 'refresh', jti },
      JWT_SECRET,
      { expiresIn: REFRESH_EXPIRES_IN }
    );

    // Store refresh token JTI in Redis for revocation capability
    const ttl = 30 * 24 * 60 * 60; // 30 days in seconds
    await this.redis.setex(KEYS.sessionToken(jti), ttl, user.id);

    return { accessToken, refreshToken };
  }
}

module.exports = new AuthService();
