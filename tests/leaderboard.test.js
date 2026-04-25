/**
 * Tests for the Leaderboard Service
 * Uses a mocked Redis client to avoid real Redis dependency
 */
const ScoreModel = require('../../src/models/Score');
const { getPeriodKey } = require('../../src/models/Score');

// Mock ioredis
jest.mock('ioredis', () => {
  const mockPipeline = {
    zadd: jest.fn().mockReturnThis(),
    zincrby: jest.fn().mockReturnThis(),
    lpush: jest.fn().mockReturnThis(),
    ltrim: jest.fn().mockReturnThis(),
    sadd: jest.fn().mockReturnThis(),
    hmget: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([]),
  };

  const mockRedis = {
    zadd: jest.fn(),
    zrevrank: jest.fn(),
    zrevrange: jest.fn(),
    zcard: jest.fn(),
    zscore: jest.fn(),
    zincrby: jest.fn(),
    zrangebyscore: jest.fn(),
    lrange: jest.fn(),
    sadd: jest.fn(),
    smembers: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    setex: jest.fn(),
    del: jest.fn(),
    hgetall: jest.fn(),
    hset: jest.fn(),
    hmget: jest.fn(),
    hincrbyfloat: jest.fn(),
    hincrby: jest.fn(),
    pipeline: jest.fn(() => mockPipeline),
    on: jest.fn(),
    quit: jest.fn(),
  };

  return jest.fn(() => mockRedis);
});

describe('Score Model — Redis Sorted Set operations', () => {
  let redis;

  beforeEach(() => {
    jest.clearAllMocks();
    const Redis = require('ioredis');
    redis = new Redis();
  });

  describe('submit()', () => {
    it('should pipeline updates to global, game, and period leaderboards', async () => {
      const pipeline = redis.pipeline();

      await ScoreModel.submit({
        userId: 'user-123',
        gameId: 'chess',
        score: 5000,
        metadata: { level: 3 },
      });

      // Global leaderboard update (GT = only update if greater)
      expect(pipeline.zadd).toHaveBeenCalledWith(
        expect.stringContaining('global:scores'),
        'GT',
        5000,
        'user-123'
      );

      // Game-specific leaderboard
      expect(pipeline.zadd).toHaveBeenCalledWith(
        expect.stringContaining('game:chess:scores'),
        'GT',
        5000,
        'user-123'
      );

      // History push + trim
      expect(pipeline.lpush).toHaveBeenCalled();
      expect(pipeline.ltrim).toHaveBeenCalled();

      // Game tracking
      expect(pipeline.sadd).toHaveBeenCalledWith(
        expect.stringContaining('user:user-123:games'),
        'chess'
      );
    });
  });

  describe('getUserGlobalRank()', () => {
    it('should return 1-indexed rank for user', async () => {
      redis.zrevrank.mockResolvedValue(0); // Redis: index 0 = rank 1
      const rank = await ScoreModel.getUserGlobalRank('user-123');
      expect(rank).toBe(1);
    });

    it('should return null when user has no score', async () => {
      redis.zrevrank.mockResolvedValue(null);
      const rank = await ScoreModel.getUserGlobalRank('new-user');
      expect(rank).toBeNull();
    });

    it('should return rank 5 for 0-indexed position 4', async () => {
      redis.zrevrank.mockResolvedValue(4);
      const rank = await ScoreModel.getUserGlobalRank('user-456');
      expect(rank).toBe(5);
    });
  });

  describe('getTopPlayers()', () => {
    it('should parse ZREVRANGE WITHSCORES results correctly', async () => {
      redis.zrevrange.mockResolvedValue([
        'user-1', '95000',
        'user-2', '87500',
        'user-3', '72000',
      ]);

      const players = await ScoreModel.getTopPlayers(3, 0);

      expect(players).toHaveLength(3);
      expect(players[0]).toEqual({ userId: 'user-1', score: 95000, rank: 1 });
      expect(players[1]).toEqual({ userId: 'user-2', score: 87500, rank: 2 });
      expect(players[2]).toEqual({ userId: 'user-3', score: 72000, rank: 3 });
    });

    it('should use offset correctly for pagination', async () => {
      redis.zrevrange.mockResolvedValue(['user-11', '55000', 'user-12', '54000']);

      const players = await ScoreModel.getTopPlayers(2, 10);

      expect(players[0].rank).toBe(11);
      expect(players[1].rank).toBe(12);
      expect(redis.zrevrange).toHaveBeenCalledWith(
        expect.any(String), 10, 11, 'WITHSCORES'
      );
    });
  });

  describe('getPlayerNeighborhood()', () => {
    it('should return players around the given user', async () => {
      redis.zrevrank.mockResolvedValue(9); // user is rank 10
      redis.zrevrange.mockResolvedValue([
        'user-7', '71000', 'user-8', '68000', 'user-9', '65000',
        'user-10', '60000', 'user-11', '55000',
      ]);

      const neighborhood = await ScoreModel.getPlayerNeighborhood('user-10', 2);

      expect(neighborhood.length).toBeGreaterThan(0);
      // Start offset is max(0, 9-2) = 7
      expect(redis.zrevrange).toHaveBeenCalledWith(
        expect.any(String), 7, 14, 'WITHSCORES'
      );
    });

    it('should handle user at the top (rank 0) without negative offset', async () => {
      redis.zrevrank.mockResolvedValue(0);
      redis.zrevrange.mockResolvedValue(['user-1', '99000', 'user-2', '85000']);

      await ScoreModel.getPlayerNeighborhood('user-1', 5);

      expect(redis.zrevrange).toHaveBeenCalledWith(
        expect.any(String), 0, 5, 'WITHSCORES' // start clamped at 0
      );
    });
  });
});

describe('getPeriodKey()', () => {
  it('should return a date string for daily period', () => {
    const key = getPeriodKey('daily');
    expect(key).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('should return a week string for weekly period', () => {
    const key = getPeriodKey('weekly');
    expect(key).toMatch(/^\d{4}-W\d{2}$/);
  });

  it('should return a month string for monthly period', () => {
    const key = getPeriodKey('monthly');
    expect(key).toMatch(/^\d{4}-\d{2}$/);
  });

  it('should return a year for yearly period', () => {
    const key = getPeriodKey('yearly');
    expect(key).toMatch(/^\d{4}$/);
  });

  it('should return all-time for unknown period', () => {
    const key = getPeriodKey('forever');
    expect(key).toBe('all-time');
  });
});
