const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getRedisClient, KEYS } = require('../config/redis');

const SALT_ROUNDS = 12;

class UserModel {
  constructor() {
    this.redis = getRedisClient();
  }

  /**
   * Create a new user
   */
  async create({ username, email, password, displayName }) {
    // Check if username already exists
    const existingId = await this.redis.get(KEYS.userByUsername(username));
    if (existingId) {
      throw new Error('Username already taken');
    }

    const userId = uuidv4();
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const now = Date.now();

    const userData = {
      id: userId,
      username,
      email,
      displayName: displayName || username,
      passwordHash,
      createdAt: now,
      updatedAt: now,
      totalScore: 0,
      gamesPlayed: 0,
      isActive: 1,
    };

    const pipeline = this.redis.pipeline();
    pipeline.hset(KEYS.user(userId), userData);
    pipeline.set(KEYS.userByUsername(username), userId);
    pipeline.sadd(KEYS.allUsers(), userId);
    await pipeline.exec();

    return this.sanitize(userData);
  }

  /**
   * Find user by ID
   */
  async findById(userId) {
    const data = await this.redis.hgetall(KEYS.user(userId));
    if (!data || !data.id) return null;
    return data;
  }

  /**
   * Find user by username
   */
  async findByUsername(username) {
    const userId = await this.redis.get(KEYS.userByUsername(username));
    if (!userId) return null;
    return this.findById(userId);
  }

  /**
   * Verify password
   */
  async verifyPassword(user, password) {
    return bcrypt.compare(password, user.passwordHash);
  }

  /**
   * Update user stats after score submission
   */
  async updateStats(userId, scoreIncrease) {
    const pipeline = this.redis.pipeline();
    pipeline.hincrbyfloat(KEYS.user(userId), 'totalScore', scoreIncrease);
    pipeline.hincrby(KEYS.user(userId), 'gamesPlayed', 1);
    pipeline.hset(KEYS.user(userId), 'updatedAt', Date.now());
    await pipeline.exec();
  }

  /**
   * Get all user IDs
   */
  async getAllUserIds() {
    return this.redis.smembers(KEYS.allUsers());
  }

  /**
   * Remove sensitive fields
   */
  sanitize(user) {
    const { passwordHash, ...safe } = user;
    return safe;
  }
}

module.exports = new UserModel();
