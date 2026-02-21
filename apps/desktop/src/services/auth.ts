/**
 * Auth Service
 * Handles user authentication, registration, and session management
 */

import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getWovlyDir } from '../utils/helpers';

// @ts-ignore - session module is JavaScript
import { saveSession, loadSession, clearSession } from '../../src/auth/session';

/**
 * User data structure
 */
export interface User {
  username: string;
  displayName: string;
  passwordHash: string;
  createdAt: string;
  lastLogin?: string;
}

/**
 * Users storage (username -> user data)
 */
export interface Users {
  [username: string]: User;
}

/**
 * Current user info (minimal, for session)
 */
export interface CurrentUser {
  username: string;
  displayName: string;
}

/**
 * User list item (for display)
 */
export interface UserListItem {
  username: string;
  displayName: string;
  createdAt: string;
}

/**
 * Auth service response
 */
export interface AuthResponse {
  ok: boolean;
  hasUsers?: boolean;
  users?: UserListItem[];
  user?: CurrentUser;
  username?: string;
  loggedIn?: boolean;
  error?: string;
}

/**
 * Login lifecycle hooks
 */
export interface LoginHooks {
  onLogin?: (username: string) => Promise<void>;
  onLogout?: (username: string | null) => Promise<void>;
  onSessionRestore?: (username: string) => Promise<void>;
}

/**
 * AuthService - Manages user authentication and sessions
 */
export class AuthService {
  private static loginHooks: LoginHooks = {};

  /**
   * Set hooks for login/logout lifecycle events
   * @param hooks - Lifecycle hooks
   */
  static setLoginHooks(hooks: LoginHooks): void {
    this.loginHooks = hooks;
  }

  /**
   * Get path to users.json file
   * @returns Path to users file
   */
  private static async getUsersPath(): Promise<string> {
    const baseDir = await getWovlyDir();
    return path.join(baseDir, 'users.json');
  }

  /**
   * Load all users from storage
   * @returns Users object
   */
  private static async loadUsers(): Promise<Users> {
    try {
      const usersPath = await this.getUsersPath();
      const data = await fs.readFile(usersPath, 'utf8');
      return JSON.parse(data) as Users;
    } catch {
      return {};
    }
  }

  /**
   * Save users to storage
   * @param users - Users object to save
   */
  private static async saveUsers(users: Users): Promise<void> {
    const usersPath = await this.getUsersPath();
    await fs.writeFile(usersPath, JSON.stringify(users, null, 2), 'utf8');
  }

  /**
   * Hash password using SHA-256
   * @param password - Plain text password
   * @returns Hashed password
   */
  private static hashPassword(password: string): string {
    return crypto.createHash('sha256').update(password).digest('hex');
  }

  /**
   * Check if any users exist
   * @returns Response with hasUsers boolean
   */
  static async hasUsers(): Promise<AuthResponse> {
    try {
      const users = await this.loadUsers();
      return { ok: true, hasUsers: Object.keys(users).length > 0 };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      return { ok: false, error };
    }
  }

  /**
   * List all registered users
   * @returns Response with user list
   */
  static async listUsers(): Promise<AuthResponse> {
    try {
      const users = await this.loadUsers();
      const userList: UserListItem[] = Object.entries(users).map(([username, data]) => ({
        username,
        displayName: data.displayName || username,
        createdAt: data.createdAt
      }));
      return { ok: true, users: userList };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      return { ok: false, error };
    }
  }

  /**
   * Register a new user
   * @param username - Username
   * @param password - Password
   * @param displayName - Display name (optional)
   * @returns Response with created username
   */
  static async register(
    username: string,
    password: string,
    displayName?: string
  ): Promise<AuthResponse> {
    try {
      if (!username || !password) {
        return { ok: false, error: 'Username and password are required' };
      }

      const users = await this.loadUsers();
      const normalizedUsername = username.toLowerCase().trim();

      if (users[normalizedUsername]) {
        return { ok: false, error: 'Username already exists' };
      }

      users[normalizedUsername] = {
        username: normalizedUsername,
        displayName: displayName || username,
        passwordHash: this.hashPassword(password),
        createdAt: new Date().toISOString()
      };

      await this.saveUsers(users);
      console.log(`[AuthService] User registered: ${normalizedUsername}`);

      return { ok: true, username: normalizedUsername };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      console.error('[AuthService] Register error:', error);
      return { ok: false, error };
    }
  }

  /**
   * Login a user
   * @param username - Username
   * @param password - Password
   * @param currentUserSetter - Function to set the current user in global state
   * @returns Response with user info
   */
  static async login(
    username: string,
    password: string,
    currentUserSetter: (user: CurrentUser) => void
  ): Promise<AuthResponse> {
    try {
      if (!username || !password) {
        return { ok: false, error: 'Username and password are required' };
      }

      const users = await this.loadUsers();
      const normalizedUsername = username.toLowerCase().trim();
      const user = users[normalizedUsername];

      if (!user) {
        return { ok: false, error: 'User not found' };
      }

      if (user.passwordHash !== this.hashPassword(password)) {
        return { ok: false, error: 'Incorrect password' };
      }

      // Set current user
      const currentUser: CurrentUser = {
        username: normalizedUsername,
        displayName: user.displayName
      };
      currentUserSetter(currentUser);

      // Update last login
      users[normalizedUsername].lastLogin = new Date().toISOString();
      await this.saveUsers(users);

      // Save session for persistence
      await saveSession(currentUser);

      console.log(`[AuthService] User logged in: ${normalizedUsername}`);

      // Trigger login hooks (background tasks)
      if (this.loginHooks.onLogin) {
        this.loginHooks.onLogin(normalizedUsername).catch(err => {
          console.error('[AuthService] Login hook error:', err);
        });
      }

      return {
        ok: true,
        user: {
          username: currentUser.username,
          displayName: currentUser.displayName
        }
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      console.error('[AuthService] Login error:', error);
      return { ok: false, error };
    }
  }

  /**
   * Logout the current user
   * @param currentUser - Current user object
   * @param currentUserSetter - Function to clear current user
   * @param cacheClearers - Functions to clear caches
   * @returns Success/error response
   */
  static async logout(
    currentUser: CurrentUser | null,
    currentUserSetter: (user: CurrentUser | null) => void,
    cacheClearers: Array<() => void> = []
  ): Promise<AuthResponse> {
    try {
      const username = currentUser?.username;

      // Clear current user
      currentUserSetter(null);

      // Clear session file
      await clearSession();

      // Clear user-specific caches
      cacheClearers.forEach(clear => clear());

      console.log(`[AuthService] User logged out: ${username || 'unknown'}`);

      // Trigger logout hooks
      if (this.loginHooks.onLogout) {
        this.loginHooks.onLogout(username || null).catch(err => {
          console.error('[AuthService] Logout hook error:', err);
        });
      }

      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      console.error('[AuthService] Logout error:', error);
      return { ok: false, error };
    }
  }

  /**
   * Check and restore session
   * @param currentUser - Current user (if already logged in)
   * @param currentUserSetter - Function to set current user
   * @returns Response with session status
   */
  static async checkSession(
    currentUser: CurrentUser | null,
    currentUserSetter: (user: CurrentUser) => void
  ): Promise<AuthResponse> {
    try {
      // If already logged in, return current user
      if (currentUser) {
        return {
          ok: true,
          loggedIn: true,
          user: {
            username: currentUser.username,
            displayName: currentUser.displayName
          }
        };
      }

      // Try to restore session from file
      const savedSession = await loadSession();
      if (savedSession?.username) {
        // Verify user still exists
        const users = await this.loadUsers();
        const user = users[savedSession.username];

        if (user) {
          // Restore the session
          const restoredUser: CurrentUser = {
            username: savedSession.username,
            displayName: savedSession.displayName || user.displayName
          };
          currentUserSetter(restoredUser);

          console.log(`[AuthService] Session restored for ${restoredUser.username}`);

          // Trigger session restore hooks (background tasks)
          if (this.loginHooks.onSessionRestore) {
            this.loginHooks.onSessionRestore(restoredUser.username).catch(err => {
              console.error('[AuthService] Session restore hook error:', err);
            });
          }

          return {
            ok: true,
            loggedIn: true,
            user: {
              username: restoredUser.username,
              displayName: restoredUser.displayName
            }
          };
        } else {
          // User was deleted, clear the session
          await clearSession();
        }
      }

      return { ok: true, loggedIn: false };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      return { ok: false, error };
    }
  }

  /**
   * Get current user info
   * @param currentUser - Current user object
   * @returns Response with user info
   */
  static getCurrentUser(currentUser: CurrentUser | null): AuthResponse {
    try {
      if (!currentUser) {
        return { ok: false, error: 'Not logged in' };
      }

      return {
        ok: true,
        user: {
          username: currentUser.username,
          displayName: currentUser.displayName
        }
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      return { ok: false, error };
    }
  }
}
