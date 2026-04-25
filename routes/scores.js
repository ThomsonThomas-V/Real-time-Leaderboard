const express = require('express');
const rateLimit = require('express-rate-limit');
const ScoreModel = require('../models/Score');
const UserModel = require('../models/User');
const LeaderboardService = require('../services/LeaderboardService');
const { requireAuth } = require('../middleware/auth');
const { scoreSubmitValidator, paginationValidator } = require('../middleware/validators');
const logger = require('../config/logger');

const router = express.Router();

// Rate limit score submissions (prevent cheating/flooding)
const scoreLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: parseInt(process.env.SCORE_SUBMIT_LIMIT) || 10,
  message: { error: 'Score submission rate limit exceeded. Max 10 per minute.' },
  keyGenerator: (req) => req.user?.id || req.ip,
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * POST /scores
 * Submit a score for a game
 */
router.post('/', requireAuth, scoreLimiter, scoreSubmitValidator, async (req, res) => {
  try {
    const { gameId, score, metadata } = req.body;
    const userId = req.user.id;

    const submitted = await ScoreModel.submit({ userId, gameId, score, metadata });

    // Update user aggregate stats asynchronously
    UserModel.updateStats(userId, score).catch((err) =>
      logger.error('Failed to update user stats:', err)
    );

    // Get the user's new rank
    const newRank = await ScoreModel.getUserGlobalRank(userId);

    logger.info(`Score submitted: user=${userId} game=${gameId} score=${score} rank=${newRank}`);

    res.status(201).json({
      message: 'Score submitted successfully',
      submission: submitted,
      rank: newRank,
    });
  } catch (err) {
    logger.error('Score submission error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * GET /scores/history
 * Get current user's score history (all games or filtered by game)
 */
router.get('/history', requireAuth, paginationValidator, async (req, res) => {
  try {
    const { gameId, limit = 20 } = req.query;
    const userId = req.user.id;

    const history = await LeaderboardService.getUserScoreHistory(userId, { gameId, limit });

    res.json({ userId, history });
  } catch (err) {
    logger.error('Score history error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * GET /scores/history/:userId
 * Get another user's public score history
 */
router.get('/history/:userId', paginationValidator, async (req, res) => {
  try {
    const { userId } = req.params;
    const { gameId, limit = 20 } = req.query;

    const user = await UserModel.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'Not Found', message: 'User not found' });
    }

    const history = await LeaderboardService.getUserScoreHistory(userId, { gameId, limit });
    res.json({ userId, username: user.username, history });
  } catch (err) {
    logger.error('Score history error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
