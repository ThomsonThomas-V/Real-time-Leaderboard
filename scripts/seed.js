/**
 * Seed script — populates Redis with demo users and scores
 * Run: node src/scripts/seed.js
 */
require('dotenv').config();
const { getRedisClient } = require('../config/redis');
const UserModel = require('../models/User');
const ScoreModel = require('../models/Score');

const GAMES = ['chess', 'snake', 'tetris', 'pacman', 'space-invaders'];

const DEMO_USERS = [
  { username: 'shadowbyte', email: 'shadow@demo.com', password: 'Demo1234', displayName: 'ShadowByte' },
  { username: 'neonrider', email: 'neon@demo.com', password: 'Demo1234', displayName: 'NeonRider' },
  { username: 'pixelwulf', email: 'pixel@demo.com', password: 'Demo1234', displayName: 'PixelWulf' },
  { username: 'starforge', email: 'star@demo.com', password: 'Demo1234', displayName: 'StarForge' },
  { username: 'ironclad', email: 'iron@demo.com', password: 'Demo1234', displayName: 'IronClad' },
  { username: 'quickblaze', email: 'quick@demo.com', password: 'Demo1234', displayName: 'QuickBlaze' },
  { username: 'vortexai', email: 'vortex@demo.com', password: 'Demo1234', displayName: 'VortexAI' },
  { username: 'ghostframe', email: 'ghost@demo.com', password: 'Demo1234', displayName: 'GhostFrame' },
];

function randomScore(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function seed() {
  console.log('🌱 Seeding leaderboard data...\n');
  const redis = getRedisClient();

  const users = [];
  for (const u of DEMO_USERS) {
    try {
      const created = await UserModel.create(u);
      users.push(created);
      console.log(`✓ Created user: ${u.username}`);
    } catch (err) {
      console.log(`⚠ Skipped ${u.username}: ${err.message}`);
      const existing = await UserModel.findByUsername(u.username);
      if (existing) users.push(UserModel.sanitize(existing));
    }
  }

  console.log('\n📊 Submitting scores...');
  for (const user of users) {
    const numSubmissions = Math.floor(Math.random() * 8) + 3;
    for (let i = 0; i < numSubmissions; i++) {
      const game = GAMES[Math.floor(Math.random() * GAMES.length)];
      const score = randomScore(1000, 99999);
      await ScoreModel.submit({
        userId: user.id,
        gameId: game,
        score,
        metadata: { level: Math.floor(score / 5000) + 1 },
      });
    }
    await UserModel.updateStats(user.id, randomScore(10000, 50000));
    console.log(`✓ Scores for ${user.username}`);
  }

  console.log('\n✅ Seed complete!\n');
  await redis.quit();
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
