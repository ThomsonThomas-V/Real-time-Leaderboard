/**
 * Tests for AuthService — registration, login, token management
 */
jest.mock('ioredis', () => {
  const store = new Map();
  const mockRedis = {
    get: jest.fn((k) => Promise.resolve(store.get(k) || null)),
    set: jest.fn((k, v) => { store.set(k, v); return Promise.resolve('OK'); }),
    setex: jest.fn((k, ttl, v) => { store.set(k, v); return Promise.resolve('OK'); }),
    del: jest.fn((k) => { store.delete(k); return Promise.resolve(1); }),
    hgetall: jest.fn(),
    hset: jest.fn().mockResolvedValue(1),
    sadd: jest.fn().mockResolvedValue(1),
    pipeline: jest.fn(() => ({
      hset: jest.fn().mockReturnThis(),
      sadd: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    })),
    on: jest.fn(),
    quit: jest.fn(),
    _store: store,
  };
  return jest.fn(() => mockRedis);
});

jest.mock('../src/models/User');

const AuthService = require('../src/services/AuthService');
const UserModel = require('../src/models/User');

describe('AuthService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('register()', () => {
    it('should create a user and return tokens', async () => {
      const mockUser = {
        id: 'uuid-1',
        username: 'testuser',
        email: 'test@example.com',
        displayName: 'Test User',
      };
      UserModel.create.mockResolvedValue(mockUser);

      const result = await AuthService.register({
        username: 'testuser',
        email: 'test@example.com',
        password: 'Secure123',
      });

      expect(result.user).toEqual(mockUser);
      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(typeof result.accessToken).toBe('string');
    });

    it('should propagate username-taken error', async () => {
      UserModel.create.mockRejectedValue(new Error('Username already taken'));

      await expect(
        AuthService.register({ username: 'taken', email: 'x@x.com', password: 'Secure123' })
      ).rejects.toThrow('Username already taken');
    });
  });

  describe('login()', () => {
    it('should return tokens for valid credentials', async () => {
      const mockUser = {
        id: 'uuid-2',
        username: 'testuser',
        email: 'test@example.com',
        isActive: '1',
        passwordHash: 'hashed',
      };
      UserModel.findByUsername.mockResolvedValue(mockUser);
      UserModel.verifyPassword.mockResolvedValue(true);
      UserModel.sanitize.mockReturnValue({ id: 'uuid-2', username: 'testuser' });

      const result = await AuthService.login({ username: 'testuser', password: 'Secure123' });

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
    });

    it('should throw on invalid credentials', async () => {
      UserModel.findByUsername.mockResolvedValue(null);

      await expect(
        AuthService.login({ username: 'nobody', password: 'wrong' })
      ).rejects.toThrow('Invalid credentials');
    });

    it('should throw for wrong password', async () => {
      UserModel.findByUsername.mockResolvedValue({
        id: 'uuid-3', username: 'user', isActive: '1', passwordHash: 'h',
      });
      UserModel.verifyPassword.mockResolvedValue(false);

      await expect(
        AuthService.login({ username: 'user', password: 'wrongpass' })
      ).rejects.toThrow('Invalid credentials');
    });

    it('should throw for deactivated account', async () => {
      UserModel.findByUsername.mockResolvedValue({
        id: 'uuid-4', username: 'banned', isActive: '0', passwordHash: 'h',
      });

      await expect(
        AuthService.login({ username: 'banned', password: 'Pass123' })
      ).rejects.toThrow('Account is deactivated');
    });
  });

  describe('verifyAccessToken()', () => {
    it('should verify and return user for valid access token', async () => {
      const mockUser = { id: 'uuid-5', username: 'u', isActive: '1', passwordHash: 'h' };
      UserModel.create.mockResolvedValue(mockUser);
      UserModel.findById.mockResolvedValue(mockUser);

      const { accessToken } = await AuthService.register({
        username: 'verify-test',
        email: 'v@v.com',
        password: 'Pass1234',
      });

      const user = await AuthService.verifyAccessToken(accessToken);
      expect(user).toBeDefined();
    });

    it('should reject an invalid token', async () => {
      await expect(
        AuthService.verifyAccessToken('not.a.real.token')
      ).rejects.toThrow();
    });
  });
});
