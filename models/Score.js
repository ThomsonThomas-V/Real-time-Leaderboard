const { v4: uuidv4 } = require('uuid');
const { getRedisClient, KEYS } = require('../config/redis');

// Period helpers
function getPeriodKey(period) {
  const now = new Date();
  switch (period) {
    case 'daily':
      return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
    case 'weekly': {
      const startOfYear = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
      const weekNum = Math.ceil(((now - startOfYear) / 86400000 + startOfYear.getUTCDay() + 1) / 7);
      return `${now.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
    }
    case 'monthly':
      return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    case 'yearly':
      return `${now.getUTCFullYear()}`;
    default:
      return 'all-time';
  }
}

class ScoreModel {
  constructor() {
    this.redis = getRedisClient();
  }

  /**
   * Submit a score — the core leaderboard operation using Redis Sorted Sets
   * Uses ZADD with XX flag to only update if score is higher (competitive mode)
   * or NX flag (always add).
   */
  async submit({ userId, gameId, score, metadata = {} }) {
    const scoreId = uuidv4();
    const now = Date.now();
    const periods = ['daily', 'weekly', 'monthly', 'yearly', 'all-time'];

    // Build the score record for history
    const scoreRecord = JSON.stringify({
      id: scoreId,
      userId,
      gameId,
      score: parseFloat(score),
      metadata,
      submittedAt: now,
    });

    const pipeline = this.redis.pipeline();

    // 1. Update global leaderboard (sorted set: score → userId)
    //    ZADD with GT: only updates if new score is greater
    pipeline.zadd(KEYS.globalLeaderboard(), 'GT', score, userId);

    // 2. Update per-game leaderboard
    pipeline.zadd(KEYS.gameLeaderboard(gameId), 'GT', score, userId);

    // 3. Update all time-period leaderboards (using ZINCRBY for cumulative totals)
    for (const period of periods) {
      const periodKey = getPeriodKey(period);
      pipeline.zincrby(KEYS.periodLeaderboard(`${period}:${periodKey}`), score, userId);
    }

    // 4. Push to user's global score history (capped at 500 entries)
    pipeline.lpush(KEYS.scoreHistory(userId), scoreRecord);
    pipeline.ltrim(KEYS.scoreHistory(userId), 0, 499);

    // 5. Push to user's per-game history (capped at 200 entries)
    pipeline.lpush(KEYS.gameScoreHistory(userId, gameId), scoreRecord);
    pipeline.ltrim(KEYS.gameScoreHistory(userId, gameId), 0, 199);

    // 6. Track which games this user has played
    pipeline.sadd(KEYS.userGames(userId), gameId);
    pipeline.sadd(KEYS.allGames(), gameId);

    await pipeline.exec();

    return {
      id: scoreId,
      userId,
      gameId,
      score: parseFloat(score),
      metadata,
      submittedAt: now,
    };
  }

  /**
   * Get user's rank on the global leaderboard (0-indexed, 0 = top)
   * Returns 1-indexed rank for display purposes
   */
  async getUserGlobalRank(userId) {
    // ZREVRANK: higher score = lower index = better rank
    const rank = await this.redis.zrevrank(KEYS.globalLeaderboard(), userId);
    return rank === null ? null : rank + 1;
  }

  /**
   * Get user's best score on global leaderboard
   */
  async getUserGlobalScore(userId) {
    const score = await this.redis.zscore(KEYS.globalLeaderboard(), userId);
    return score === null ? null : parseFloat(score);
  }

  /**
   * Get user's rank in a specific game
   */
  async getUserGameRank(userId, gameId) {
    const rank = await this.redis.zrevrank(KEYS.gameLeaderboard(gameId), userId);
    return rank === null ? null : rank + 1;
  }

  /**
   * Get top N players from global leaderboard
   * ZREVRANGE with WITHSCORES returns members in descending score order
   */
  async getTopPlayers(limit = 100, offset = 0) {
    const results = await this.redis.zrevrange(
      KEYS.globalLeaderboard(),
      offset,
      offset + limit - 1,
      'WITHSCORES'
    );
    return this._parseZrevrangeResults(results, offset);
  }

  /**
   * Get top N players from a specific game leaderboard
   */
  async getTopPlayersByGame(gameId, limit = 100, offset = 0) {
    const results = await this.redis.zrevrange(
      KEYS.gameLeaderboard(gameId),
      offset,
      offset + limit - 1,
      'WITHSCORES'
    );
    return this._parseZrevrangeResults(results, offset);
  }

  /**
   * Get top N players for a specific time period
   */
  async getTopPlayersByPeriod(period, limit = 100, offset = 0) {
    const periodKey = getPeriodKey(period);
    const results = await this.redis.zrevrange(
      KEYS.periodLeaderboard(`${period}:${periodKey}`),
      offset,
      offset + limit - 1,
      'WITHSCORES'
    );
    return this._parseZrevrangeResults(results, offset);
  }

  /**
   * Get players around a specific user (neighborhood)
   * Useful for showing "you and nearby players"
   */
  async getPlayerNeighborhood(userId, range = 5) {
    const rank = await this.redis.zrevrank(KEYS.globalLeaderboard(), userId);
    if (rank === null) return [];

    const start = Math.max(0, rank - range);
    const end = rank + range;

    const results = await this.redis.zrevrange(
      KEYS.globalLeaderboard(),
      start,
      end,
      'WITHSCORES'
    );

    return this._parseZrevrangeResults(results, start);
  }

  /**
   * Get score history for a user
   */
  async getUserScoreHistory(userId, limit = 50, offset = 0) {
    const raw = await this.redis.lrange(KEYS.scoreHistory(userId), offset, offset + limit - 1);
    return raw.map((r) => JSON.parse(r));
  }

  /**
   * Get score history for a user in a specific game
   */
  async getUserGameHistory(userId, gameId, limit = 20) {
    const raw = await this.redis.lrange(KEYS.gameScoreHistory(userId, gameId), 0, limit - 1);
    return raw.map((r) => JSON.parse(r));
  }

  /**
   * Get total number of players on global leaderboard
   */
  async getTotalPlayers() {
    return this.redis.zcard(KEYS.globalLeaderboard());
  }

  /**
   * Get scores within a score range (useful for percentile queries)
   */
  async getPlayersByScoreRange(minScore, maxScore) {
    const results = await this.redis.zrangebyscore(
      KEYS.globalLeaderboard(),
      minScore,
      maxScore,
      'WITHSCORES'
    );
    return this._parseZrevrangeResults(results, 0);
  }

  /**
   * Parse the flat [member, score, member, score, ...] array from Redis
   */
  _parseZrevrangeResults(results, startOffset = 0) {
    const parsed = [];
    for (let i = 0; i < results.length; i += 2) {
      parsed.push({
        userId: results[i],
        score: parseFloat(results[i + 1]),
        rank: startOffset + Math.floor(i / 2) + 1,
      });
    }
    return parsed;
  }
}

module.exports = new ScoreModel();
module.exports.getPeriodKey = getPeriodKey;
