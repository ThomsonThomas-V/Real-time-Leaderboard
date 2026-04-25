const { body, query, param, validationResult } = require('express-validator');

/**
 * Collect validation errors and respond with 422 if any
 */
function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({
      error: 'Validation Failed',
      details: errors.array().map((e) => ({ field: e.path, message: e.msg })),
    });
  }
  next();
}

// --- Auth validators ---
const registerValidator = [
  body('username')
    .trim()
    .isLength({ min: 3, max: 30 })
    .withMessage('Username must be 3–30 characters')
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage('Username may only contain letters, numbers, underscores, hyphens'),
  body('email').isEmail().normalizeEmail().withMessage('Must be a valid email'),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
    .matches(/[A-Z]/)
    .withMessage('Password must contain at least one uppercase letter')
    .matches(/[0-9]/)
    .withMessage('Password must contain at least one number'),
  body('displayName').optional().trim().isLength({ max: 50 }),
  validate,
];

const loginValidator = [
  body('username').trim().notEmpty().withMessage('Username is required'),
  body('password').notEmpty().withMessage('Password is required'),
  validate,
];

// --- Score validators ---
const scoreSubmitValidator = [
  body('gameId')
    .trim()
    .notEmpty()
    .withMessage('gameId is required')
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage('gameId must be alphanumeric'),
  body('score')
    .isFloat({ min: 0, max: 9999999 })
    .withMessage('Score must be a positive number (max 9,999,999)'),
  body('metadata').optional().isObject().withMessage('Metadata must be an object'),
  validate,
];

// --- Leaderboard validators ---
const paginationValidator = [
  query('limit').optional().isInt({ min: 1, max: 500 }).toInt().withMessage('Limit must be 1–500'),
  query('offset').optional().isInt({ min: 0 }).toInt().withMessage('Offset must be >= 0'),
  validate,
];

const periodValidator = [
  param('period')
    .isIn(['daily', 'weekly', 'monthly', 'yearly', 'all-time'])
    .withMessage('Period must be: daily, weekly, monthly, yearly, or all-time'),
  validate,
];

module.exports = {
  registerValidator,
  loginValidator,
  scoreSubmitValidator,
  paginationValidator,
  periodValidator,
};
