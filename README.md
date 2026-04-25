# Real-Time Leaderboard Service

A production-ready backend for ranking users across games using **Redis Sorted Sets** for O(log N) score updates and rank queries.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Express API Server                    │
│                                                         │
│  POST /api/v1/auth/register   POST /api/v1/auth/login   │
│  POST /api/v1/scores          GET  /api/v1/leaderboard  │
│  GET  /api/v1/leaderboard/game/:id                      │
│  GET  /api/v1/leaderboard/period/:period                │
│  GET  /api/v1/leaderboard/reports/top-players           │
└─────────────────────┬───────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────┐
│                     Redis                               │
│                                                         │
│  Sorted Sets (ZADD GT / ZINCRBY / ZREVRANGE)           │
│  ├── leaderboard:global:scores                          │
│  ├── leaderboard:game:{gameId}:scores                   │
│  └── leaderboard:period:{period}:{key}:scores           │
│                                                         │
│  Hashes  → user data                                    │
│  Lists   → score history (capped)                       │
│  Sets    → user→games, all games, all users             │
│  Strings → username→userId index, JWT session tokens    │
└─────────────────────────────────────────────────────────┘
```

## Why Redis Sorted Sets?

| Operation | Redis Command | Complexity |
|-----------|--------------|------------|
| Submit/update score | `ZADD GT` | O(log N) |
| Accumulate period score | `ZINCRBY` | O(log N) |
| Get top N players | `ZREVRANGE` | O(log N + M) |
| Get user rank | `ZREVRANK` | O(log N) |
| Get user score | `ZSCORE` | O(1) |
| Count total players | `ZCARD` | O(1) |
| Score range query | `ZRANGEBYSCORE` | O(log N + M) |

---

## Quick Start

### Prerequisites
- Node.js 18+
- Redis 7+

### Installation

```bash
# Clone and install
cd leaderboard
npm install

# Configure environment
cp .env.example .env
# Edit .env with your Redis connection details

# Seed demo data (optional)
npm run seed

# Start the server
npm run dev   # development (nodemon)
npm start     # production
```

### Running Tests

```bash
npm test              # run all tests
npm run test:watch    # watch mode
```

---

## API Reference

### Authentication

#### `POST /api/v1/auth/register`
```json
{
  "username": "shadowbyte",
  "email": "shadow@example.com",
  "password": "Secure123",
  "displayName": "ShadowByte"
}
```
**Response:** `{ user, accessToken, refreshToken }`

#### `POST /api/v1/auth/login`
```json
{ "username": "shadowbyte", "password": "Secure123" }
```
**Response:** `{ user, accessToken, refreshToken }`

#### `POST /api/v1/auth/refresh`
```json
{ "refreshToken": "..." }
```

#### `GET /api/v1/auth/me`
Returns current user profile. Requires `Authorization: Bearer <token>`.

---

### Score Submission

#### `POST /api/v1/scores` 🔒
```json
{
  "gameId": "chess",
  "score": 95000,
  "metadata": { "level": 15, "timeSeconds": 180 }
}
```
- Uses `ZADD GT` — only updates the leaderboard if the new score exceeds the stored score
- Uses `ZINCRBY` for cumulative period leaderboards
- Appends to score history (capped at 500 entries per user)
- Rate limited to 10 submissions/minute per user

#### `GET /api/v1/scores/history?gameId=chess&limit=20` 🔒
Returns authenticated user's score history.

---

### Leaderboard

#### `GET /api/v1/leaderboard?limit=50&offset=0`
Global leaderboard. Returns your rank too if authenticated.

#### `GET /api/v1/leaderboard/game/:gameId`
Game-specific leaderboard.

#### `GET /api/v1/leaderboard/period/:period`
Period leaderboard. `period` = `daily | weekly | monthly | yearly | all-time`

#### `GET /api/v1/leaderboard/me` 🔒
Your complete ranking info — global rank, per-game ranks, and neighborhood (nearby players).

#### `GET /api/v1/leaderboard/user/:userId`
Any user's public ranking info.

#### `GET /api/v1/leaderboard/reports/top-players?period=monthly&limit=20` 🔒
Generates a full report with recent scores, averages, and trends.

---

## Redis Key Design

```
leaderboard:global:scores          → sorted set (userId → bestScore)
leaderboard:game:{gameId}:scores   → sorted set (userId → bestScore)
leaderboard:period:monthly:2025-04:scores → sorted set (cumulative)
leaderboard:user:{userId}          → hash (user profile)
leaderboard:username:{username}    → string (→ userId index)
leaderboard:history:{userId}:scores → list (last 500 entries)
leaderboard:session:{jti}          → string (refresh token tracking)
leaderboard:user:{userId}:games    → set (games played)
leaderboard:users:all              → set (all user IDs)
leaderboard:games:all              → set (all game IDs)
```

## Security Features

- **JWT** access + refresh token pair with rotation
- **bcrypt** password hashing (12 rounds)
- **Rate limiting**: global (100 req/15min), auth (10/15min), scores (10/min)
- **Helmet** security headers
- **express-validator** request validation
- **CORS** configuration
- Refresh token revocation via Redis

## Project Structure

```
src/
├── config/
│   ├── redis.js       # Redis client + key namespaces
│   └── logger.js      # Winston logger
├── middleware/
│   ├── auth.js        # JWT middleware
│   └── validators.js  # express-validator rules
├── models/
│   ├── User.js        # User CRUD (Redis hashes)
│   └── Score.js       # Sorted set operations
├── routes/
│   ├── auth.js        # /auth/*
│   ├── scores.js      # /scores/*
│   └── leaderboard.js # /leaderboard/*
├── services/
│   ├── AuthService.js       # Token management
│   └── LeaderboardService.js # Enriched queries + reports
├── scripts/
│   └── seed.js        # Demo data seeder
├── app.js             # Express app setup
└── server.js          # Entry point + graceful shutdown

tests/
├── leaderboard.test.js
└── auth.test.js
```
