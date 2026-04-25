const Redis = require('ioredis');
const logger = require('./logger');

const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  db: parseInt(process.env.REDIS_DB) || 0,
  keyPrefix: process.env.REDIS_KEY_PREFIX || 'leaderboard:',
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    logger.warn(`Redis reconnect attempt ${times}, delay: ${delay}ms`);
    return delay;
  },
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: false,
};

let client = null;

function getRedisClient() {
  if (!client) {
    client = new Redis(redisConfig);

    client.on('connect', () => logger.info('Redis connected'));
    client.on('ready', () => logger.info('Redis ready'));
    client.on('error', (err) => logger.error('Redis error:', err));
    client.on('close', () => logger.warn('Redis connection closed'));
    client.on('reconnecting', () => logger.info('Redis reconnecting...'));
  }
  return client;
}

async function closeRedisConnection() {
  if (client) {
    await client.quit();
    client = null;
    logger.info('Redis connection closed gracefully');
  }
}

// Redis key namespaces
const KEYS = {
  // Sorted sets for leaderboards
  globalLeaderboard: () => 'global:scores',
  gameLeaderboard: (gameId) => `game:${gameId}:scores`,
  periodLeaderboard: (period) => `period:${period}:scores`,

  // Hashes for user data
  user: (userId) => `user:${userId}`,
  userByUsername: (username) => `username:${username}`,

  // Lists for score history
  scoreHistory: (userId) => `history:${userId}:scores`,
  gameScoreHistory: (userId, gameId) => `history:${userId}:game:${gameId}`,

  // Strings for metadata
  gameInfo: (gameId) => `game:${gameId}:info`,
  sessionToken: (token) => `session:${token}`,

  // Sets for tracking
  userGames: (userId) => `user:${userId}:games`,
  allGames: () => 'games:all',
  allUsers: () => 'users:all',
};

module.exports = { getRedisClient, closeRedisConnection, KEYS };
