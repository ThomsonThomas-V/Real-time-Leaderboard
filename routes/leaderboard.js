const express = require('express');
const LeaderboardService = require('../services/LeaderboardService');
const UserModel = require('../models/User');
const { requireAuth, optionalAuth } = require('../middleware/auth');
const { paginationValidator, periodValidator } = require('../middleware/validators');
const { query, param, validationResult } = require('express-validator');
const logger = require('../config/logger');

const router = express.Router();

/**
 * GET /leaderboard
 * Global leaderboard — top players across all games
 */
router.get('/', optionalAuth, paginationValidator, async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    const data = await LeaderboardService.getGlobalLeaderboard({ limit, offset });

    // If authenticated, include caller's rank
    if (req.user) {
      const ScoreModel = require('../models/Score');
      data.myRank = await ScoreModel.getUserGlobalRank(req.user.id);
      data.myScore = await ScoreModel.getUserGlobalScore(req.user.id);
    }

    res.json(data);
  } catch (err) {
    logger.error('Global leaderboard error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * GET /leaderboard/games
 * List all games that have scores
 */
router.get('/games', async (req, res) => {
  try {
    const games = await LeaderboardService.getAllGames();
    res.json({ games });
  } catch (err) {
    logger.error('List games error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * GET /leaderboard/game/:gameId
 * Leaderboard for a specific game
 */
router.get('/game/:gameId', optionalAuth, paginationValidator, async (req, res) => {
  try {
    const { gameId } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    const data = await LeaderboardService.getGameLeaderboard(gameId, { limit, offset });

    if (req.user) {
      const ScoreModel = require('../models/Score');
      data.myRank = await ScoreModel.getUserGameRank(req.user.id, gameId);
    }

    res.json(data);
  } catch (err) {
    logger.error('Game leaderboard error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * GET /leaderboard/period/:period
 * Leaderboard for a time period: daily | weekly | monthly | yearly | all-time
 */
router.get('/period/:period', optionalAuth, periodValidator, paginationValidator, async (req, res) => {
  try {
    const { period } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    const data = await LeaderboardService.getPeriodLeaderboard(period, { limit, offset });
    res.json(data);
  } catch (err) {
    if (err.message.startsWith('Invalid period')) {
      return res.status(400).json({ error: 'Bad Request', message: err.message });
    }
    logger.error('Period leaderboard error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * GET /leaderboard/me
 * Current user's rankings across all leaderboards
 */
router.get('/me', requireAuth, async (req, res) => {
  try {
    const rankingInfo = await LeaderboardService.getUserRankingInfo(req.user.id);
    res.json(rankingInfo);
  } catch (err) {
    logger.error('User ranking error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * GET /leaderboard/user/:userId
 * Public ranking info for any user
 */
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await UserModel.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'Not Found', message: 'User not found' });
    }

    const rankingInfo = await LeaderboardService.getUserRankingInfo(userId);
    res.json(rankingInfo);
  } catch (err) {
    logger.error('User ranking error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * GET /leaderboard/reports/top-players
 * Generate a top players report for a given period
 */
router.get(
  '/reports/top-players',
  requireAuth,
  [
    query('period')
      .optional()
      .isIn(['daily', 'weekly', 'monthly', 'yearly', 'all-time'])
      .withMessage('Invalid period'),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(422).json({ error: 'Validation Failed', details: errors.array() });
      }

      const { period = 'monthly', limit = 20 } = req.query;
      const report = await LeaderboardService.generateTopPlayersReport(period, limit);

      res.json(report);
    } catch (err) {
      logger.error('Report generation error:', err);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
);

module.exports = router;
