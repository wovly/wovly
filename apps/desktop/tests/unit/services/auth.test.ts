/**
 * Unit tests for AuthService
 * Tests authentication, registration, and session management
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

// Import the compiled service
const { AuthService } = require('../../../dist/services/auth');

describe('AuthService', () => {
  let testWovlyDir: string;
  let originalEnv: string | undefined;
  const testUsername = 'testuser';
  const testPassword = 'testpass123';

  beforeEach(async () => {
    // Create unique temp directory for this test run
    testWovlyDir = path.join(os.tmpdir(), `wovly-auth-test-${Date.now()}-${Math.random().toString(36).substring(7)}`);
    await fs.mkdir(testWovlyDir, { recursive: true });

    // Override WOVLY_DIR environment variable
    originalEnv = process.env.WOVLY_DIR;
    process.env.WOVLY_DIR = testWovlyDir;
  });

  afterEach(async () => {
    // Restore environment
    if (originalEnv !== undefined) {
      process.env.WOVLY_DIR = originalEnv;
    } else {
      delete process.env.WOVLY_DIR;
    }

    // Clean up test directory
    try {
      await fs.rm(testWovlyDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('hasUsers', () => {
    it('should return false when no users exist', async () => {
      const result = await AuthService.hasUsers();

      expect(result.ok).toBe(true);
      expect(result.hasUsers).toBe(false);
    });

    it('should return true after registering a user', async () => {
      await AuthService.register(testUsername, testPassword);
      const result = await AuthService.hasUsers();

      expect(result.ok).toBe(true);
      expect(result.hasUsers).toBe(true);
    });
  });

  describe('register', () => {
    it('should register a new user successfully', async () => {
      const result = await AuthService.register(testUsername, testPassword, 'Test User');

      expect(result.ok).toBe(true);
      expect(result.username).toBe(testUsername);
    });

    it('should normalize username to lowercase', async () => {
      const result = await AuthService.register('TestUser', testPassword);

      expect(result.ok).toBe(true);
      expect(result.username).toBe('testuser');
    });

    it('should reject registration with empty username', async () => {
      const result = await AuthService.register('', testPassword);

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Username and password are required');
    });

    it('should reject registration with empty password', async () => {
      const result = await AuthService.register(testUsername, '');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Username and password are required');
    });

    it('should reject duplicate username', async () => {
      await AuthService.register(testUsername, testPassword);
      const result = await AuthService.register(testUsername, 'differentpass');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Username already exists');
    });

    it('should use username as displayName if not provided', async () => {
      await AuthService.register(testUsername, testPassword);
      const users = await AuthService.listUsers();

      expect(users.users![0].displayName).toBe(testUsername);
    });

    it('should use provided displayName', async () => {
      await AuthService.register(testUsername, testPassword, 'Custom Display');
      const users = await AuthService.listUsers();

      expect(users.users![0].displayName).toBe('Custom Display');
    });
  });

  describe('listUsers', () => {
    it('should return empty array when no users exist', async () => {
      const result = await AuthService.listUsers();

      expect(result.ok).toBe(true);
      expect(result.users).toEqual([]);
    });

    it('should list all registered users', async () => {
      await AuthService.register('user1', 'pass1', 'User One');
      await AuthService.register('user2', 'pass2', 'User Two');

      const result = await AuthService.listUsers();

      expect(result.ok).toBe(true);
      expect(result.users).toHaveLength(2);
      expect(result.users![0].username).toBe('user1');
      expect(result.users![0].displayName).toBe('User One');
      expect(result.users![1].username).toBe('user2');
      expect(result.users![1].displayName).toBe('User Two');
    });

    it('should include createdAt timestamp', async () => {
      await AuthService.register(testUsername, testPassword);
      const result = await AuthService.listUsers();

      expect(result.users![0].createdAt).toBeDefined();
      expect(typeof result.users![0].createdAt).toBe('string');
    });
  });

  describe('login', () => {
    beforeEach(async () => {
      await AuthService.register(testUsername, testPassword, 'Test User');
    });

    it('should login successfully with correct credentials', async () => {
      let capturedUser: any = null;
      const result = await AuthService.login(
        testUsername,
        testPassword,
        (user) => { capturedUser = user; }
      );

      expect(result.ok).toBe(true);
      expect(result.user?.username).toBe(testUsername);
      expect(result.user?.displayName).toBe('Test User');
      expect(capturedUser).toEqual({ username: testUsername, displayName: 'Test User' });
    });

    it('should normalize username during login', async () => {
      let capturedUser: any = null;
      const result = await AuthService.login(
        'TestUser',  // Mixed case
        testPassword,
        (user) => { capturedUser = user; }
      );

      expect(result.ok).toBe(true);
      expect(result.user?.username).toBe(testUsername);
      expect(capturedUser?.username).toBe(testUsername);
    });

    it('should reject login with incorrect password', async () => {
      const result = await AuthService.login(
        testUsername,
        'wrongpassword',
        () => {}
      );

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Incorrect password');
    });

    it('should reject login for non-existent user', async () => {
      const result = await AuthService.login(
        'nonexistent',
        testPassword,
        () => {}
      );

      expect(result.ok).toBe(false);
      expect(result.error).toBe('User not found');
    });

    it('should reject login with empty username', async () => {
      const result = await AuthService.login('', testPassword, () => {});

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Username and password are required');
    });

    it('should reject login with empty password', async () => {
      const result = await AuthService.login(testUsername, '', () => {});

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Username and password are required');
    });

    it('should trigger onLogin hook after successful login', async () => {
      let hookCalled = false;
      let hookUsername = '';

      AuthService.setLoginHooks({
        onLogin: async (username) => {
          hookCalled = true;
          hookUsername = username;
        }
      });

      await AuthService.login(testUsername, testPassword, () => {});

      // Wait a bit for async hook to execute
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(hookCalled).toBe(true);
      expect(hookUsername).toBe(testUsername);
    });
  });

  describe('logout', () => {
    it('should clear current user', async () => {
      const currentUser = { username: testUsername, displayName: 'Test User' };
      let capturedUser: any = 'unchanged';

      const result = await AuthService.logout(
        currentUser,
        (user) => { capturedUser = user; }
      );

      expect(result.ok).toBe(true);
      expect(capturedUser).toBeNull();
    });

    it('should execute cache clearers', async () => {
      const currentUser = { username: testUsername, displayName: 'Test User' };
      let clearer1Called = false;
      let clearer2Called = false;

      await AuthService.logout(
        currentUser,
        () => {},
        [
          () => { clearer1Called = true; },
          () => { clearer2Called = true; }
        ]
      );

      expect(clearer1Called).toBe(true);
      expect(clearer2Called).toBe(true);
    });

    it('should trigger onLogout hook', async () => {
      let hookCalled = false;
      let hookUsername = '';

      AuthService.setLoginHooks({
        onLogout: async (username) => {
          hookCalled = true;
          hookUsername = username || 'null';
        }
      });

      const currentUser = { username: testUsername, displayName: 'Test User' };
      await AuthService.logout(currentUser, () => {});

      // Wait for async hook
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(hookCalled).toBe(true);
      expect(hookUsername).toBe(testUsername);
    });

    it('should handle logout when no user is logged in', async () => {
      const result = await AuthService.logout(null, () => {});

      expect(result.ok).toBe(true);
    });
  });

  describe('checkSession', () => {
    beforeEach(async () => {
      await AuthService.register(testUsername, testPassword, 'Test User');
    });

    it('should return current user if already logged in', async () => {
      const currentUser = { username: testUsername, displayName: 'Test User' };
      const result = await AuthService.checkSession(currentUser, () => {});

      expect(result.ok).toBe(true);
      expect(result.loggedIn).toBe(true);
      expect(result.user?.username).toBe(testUsername);
    });

    it('should return not logged in if no session exists', async () => {
      const result = await AuthService.checkSession(null, () => {});

      expect(result.ok).toBe(true);
      expect(result.loggedIn).toBe(false);
    });

    it('should restore session from file if valid', async () => {
      // First login to save session
      await AuthService.login(testUsername, testPassword, () => {});

      // Now check session with null currentUser (simulating app restart)
      let restoredUser: any = null;
      const result = await AuthService.checkSession(
        null,
        (user) => { restoredUser = user; }
      );

      expect(result.ok).toBe(true);
      expect(result.loggedIn).toBe(true);
      expect(result.user?.username).toBe(testUsername);
      expect(restoredUser?.username).toBe(testUsername);
    });

    it('should trigger onSessionRestore hook when restoring session', async () => {
      let hookCalled = false;
      let hookUsername = '';

      AuthService.setLoginHooks({
        onSessionRestore: async (username) => {
          hookCalled = true;
          hookUsername = username;
        }
      });

      // Login to save session
      await AuthService.login(testUsername, testPassword, () => {});

      // Check session (restore)
      await AuthService.checkSession(null, () => {});

      // Wait for async hook
      await new Promise(resolve => setTimeout(resolve, 50));

      expect(hookCalled).toBe(true);
      expect(hookUsername).toBe(testUsername);
    });
  });

  describe('getCurrentUser', () => {
    it('should return current user if logged in', () => {
      const currentUser = { username: testUsername, displayName: 'Test User' };
      const result = AuthService.getCurrentUser(currentUser);

      expect(result.ok).toBe(true);
      expect(result.user?.username).toBe(testUsername);
      expect(result.user?.displayName).toBe('Test User');
    });

    it('should return error if not logged in', () => {
      const result = AuthService.getCurrentUser(null);

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Not logged in');
    });
  });

  describe('setLoginHooks', () => {
    it('should allow setting custom hooks', () => {
      const hooks = {
        onLogin: async (username: string) => {},
        onLogout: async (username: string | null) => {},
        onSessionRestore: async (username: string) => {}
      };

      // Should not throw
      expect(() => AuthService.setLoginHooks(hooks)).not.toThrow();
    });

    it('should allow partial hooks', () => {
      const hooks = {
        onLogin: async (username: string) => {}
      };

      // Should not throw
      expect(() => AuthService.setLoginHooks(hooks)).not.toThrow();
    });
  });
});
