const ScoreModel = require('../models/Score');
const UserModel = require('../models/User');
const { getRedisClient, KEYS } = require('../config/redis');
const logger = require('../config/logger');

class LeaderboardService {
  constructor() {
    this.redis = getRedisClient();
  }

  /**
   * Enrich leaderboard entries with user display data
   */
  async _enrichEntries(entries) {
    if (!entries.length) return [];

    // Batch-fetch all user data in a pipeline
    const pipeline = this.redis.pipeline();
    entries.forEach(({ userId }) => {
      pipeline.hmget(KEYS.user(userId), 'username', 'displayName', 'gamesPlayed');
    });
    const results = await pipeline.exec();

    return entries.map((entry, i) => {
      const [err, [username, displayName, gamesPlayed]] = results[i];
      return {
        ...entry,
        username: err ? 'Unknown' : (username || 'Unknown'),
        displayName: err ? 'Unknown' : (displayName || username || 'Unknown'),
        gamesPlayed: err ? 0 : parseInt(gamesPlayed || 0),
      };
    });
  }

  /**
   * Get global leaderboard (top players across all games)
   */
  async getGlobalLeaderboard({ limit = 50, offset = 0 } = {}) {
    const entries = await ScoreModel.getTopPlayers(limit, offset);
    const enriched = await this._enrichEntries(entries);
    const total = await ScoreModel.getTotalPlayers();

    return {
      type: 'global',
      entries: enriched,
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    };
  }

  /**
   * Get leaderboard for a specific game
   */
  async getGameLeaderboard(gameId, { limit = 50, offset = 0 } = {}) {
    const entries = await ScoreModel.getTopPlayersByGame(gameId, limit, offset);
    const enriched = await this._enrichEntries(entries);

    return {
      type: 'game',
      gameId,
      entries: enriched,
      limit,
      offset,
      hasMore: entries.length === limit,
    };
  }

  /**
   * Get leaderboard for a specific time period
   */
  async getPeriodLeaderboard(period, { limit = 50, offset = 0 } = {}) {
    const validPeriods = ['daily', 'weekly', 'monthly', 'yearly', 'all-time'];
    if (!validPeriods.includes(period)) {
      throw new Error(`Invalid period. Must be one of: ${validPeriods.join(', ')}`);
    }

    const entries = await ScoreModel.getTopPlayersByPeriod(period, limit, offset);
    const enriched = await this._enrichEntries(entries);

    return {
      type: 'period',
      period,
      entries: enriched,
      limit,
      offset,
      hasMore: entries.length === limit,
    };
  }

  /**
   * Get a user's complete ranking info across all leaderboards
   */
  async getUserRankingInfo(userId) {
    const [globalRank, globalScore, neighborhood] = await Promise.all([
      ScoreModel.getUserGlobalRank(userId),
      ScoreModel.getUserGlobalScore(userId),
      ScoreModel.getPlayerNeighborhood(userId, 3),
    ]);

    // Get games the user has played
    const userGames = await this.redis.smembers(KEYS.userGames(userId));

    // Get per-game ranks
    const gameRanks = await Promise.all(
      userGames.map(async (gameId) => ({
        gameId,
        rank: await ScoreModel.getUserGameRank(userId, gameId),
      }))
    );

    const user = await UserModel.findById(userId);
    const enrichedNeighborhood = await this._enrichEntries(neighborhood);

    return {
      userId,
      username: user?.username,
      displayName: user?.displayName,
      global: {
        rank: globalRank,
        score: globalScore,
        totalPlayers: await ScoreModel.getTotalPlayers(),
      },
      gameRanks,
      neighborhood: enrichedNeighborhood,
    };
  }

  /**
   * Generate a top players report for a given period
   * Returns richer data suitable for reports/exports
   */
  async generateTopPlayersReport(period, limit = 20) {
    const leaderboard = await this.getPeriodLeaderboard(period, { limit });

    // Enrich with score history count
    const enriched = await Promise.all(
      leaderboard.entries.map(async (entry) => {
        const history = await ScoreModel.getUserScoreHistory(entry.userId, 5);
        const scores = history.map((h) => h.score);
        const avgScore = scores.length
          ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)
          : 0;

        return {
          ...entry,
          recentScores: history.slice(0, 3).map((h) => ({
            score: h.score,
            gameId: h.gameId,
            date: new Date(h.submittedAt).toISOString(),
          })),
          averageRecentScore: parseFloat(avgScore),
          submissionsInPeriod: history.length,
        };
      })
    );

    return {
      reportType: 'top-players',
      period,
      generatedAt: new Date().toISOString(),
      totalPlayers: leaderboard.total,
      entries: enriched,
    };
  }

  /**
   * Get score history for a user with optional game filter
   */
  async getUserScoreHistory(userId, { gameId, limit = 20 } = {}) {
    if (gameId) {
      return ScoreModel.getUserGameHistory(userId, gameId, limit);
    }
    return ScoreModel.getUserScoreHistory(userId, limit);
  }

  /**
   * Get all active game IDs
   */
  async getAllGames() {
    return this.redis.smembers(KEYS.allGames());
  }
}

module.exports = new LeaderboardService();
