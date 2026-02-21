/**
 * Session Manager
 *
 * Handles cookie persistence for web scraping sessions.
 * Saves cookies after login to avoid re-authentication on every check.
 */

import { promises as fs } from 'fs';
import path from 'path';
import type { Page, Cookie } from 'puppeteer-core';
import { getSessionsDir } from './config-manager';

// ─────────────────────────────────────────────────────────────────────────
// Type Definitions
// ─────────────────────────────────────────────────────────────────────────

export interface SessionData {
  cookies: Cookie[];
  timestamp: number;
  url: string;
}

export interface SiteConfig {
  url: string;
  selectors: {
    login: {
      usernameField: string;
      passwordField?: string;
      submitButton?: string;
      successIndicator?: string;
    };
  };
}

export interface SessionError extends Error {
  code?: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Session Management Functions
// ─────────────────────────────────────────────────────────────────────────

/**
 * Get session file path for a site
 * @param username - User's username
 * @param siteId - Site identifier
 * @returns Path to session file
 */
async function getSessionFilePath(username: string, siteId: string): Promise<string> {
  const sessionsDir = await getSessionsDir(username);
  return path.join(sessionsDir, `${siteId}.session`);
}

/**
 * Save session cookies for a site
 * @param page - Puppeteer page instance
 * @param username - User's username
 * @param siteId - Site identifier
 * @returns True if session saved successfully
 */
export async function saveSession(page: Page, username: string, siteId: string): Promise<boolean> {
  try {
    const cookies = await page.cookies();
    const sessionData: SessionData = {
      cookies,
      timestamp: Date.now(),
      url: page.url(),
    };

    const sessionPath = await getSessionFilePath(username, siteId);
    await fs.writeFile(sessionPath, JSON.stringify(sessionData, null, 2));

    // Session saved successfully
    return true;
  } catch (error) {
    console.error(`[SessionManager] Error saving session for ${siteId}:`, error);
    return false;
  }
}

/**
 * Load session cookies for a site
 * @param page - Puppeteer page instance
 * @param username - User's username
 * @param siteId - Site identifier
 * @param maxAge - Maximum age of session in milliseconds (default: 1 hour)
 * @returns True if session loaded successfully
 */
export async function loadSession(
  page: Page,
  username: string,
  siteId: string,
  maxAge: number = 3600000
): Promise<boolean> {
  try {
    const sessionPath = await getSessionFilePath(username, siteId);
    const content = await fs.readFile(sessionPath, 'utf-8');
    const sessionData = JSON.parse(content) as SessionData;

    // Check if session is still valid (not too old)
    const age = Date.now() - sessionData.timestamp;
    if (age > maxAge) {
      // Session too old
      return false;
    }

    // Set cookies
    await page.setCookie(...sessionData.cookies);

    // Session loaded successfully
    return true;
  } catch (error) {
    const err = error as SessionError;
    if (err.code !== 'ENOENT') {
      console.error(`[SessionManager] Error loading session for ${siteId}:`, error);
    }
    return false;
  }
}

/**
 * Check if a session is still valid by navigating to the site
 * @param page - Puppeteer page instance
 * @param siteConfig - Site configuration
 * @returns True if session is valid
 */
export async function validateSession(page: Page, siteConfig: SiteConfig): Promise<boolean> {
  try {
    // Navigate with lenient options for better compatibility
    try {
      await page.goto(siteConfig.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    } catch (err) {
      const error = err as Error;
      if (error.message.includes('timeout')) {
        await page.goto(siteConfig.url, { waitUntil: 'load', timeout: 10000 }).catch(() => {
          // Ignore navigation errors
        });
      } else {
        throw err;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Check if we're logged in by looking for the success indicator
    // or by checking if we're NOT on the login page
    const onLoginPage = await page.evaluate((loginSelector: string) => {
      // @ts-expect-error - document is available in browser context
      const loginElement = document.querySelector(loginSelector);
      return loginElement !== null;
    }, siteConfig.selectors.login.usernameField);

    // If we see the login form, session is invalid
    if (onLoginPage) {
      // Session invalid - login form detected
      return false;
    }

    // Try to find the success indicator
    if (siteConfig.selectors.login.successIndicator) {
      try {
        await page.waitForSelector(siteConfig.selectors.login.successIndicator, {
          timeout: 5000,
        });
        // Session valid - success indicator found
        return true;
      } catch {
        // Session invalid - success indicator not found
        return false;
      }
    }

    // If no success indicator specified, assume valid if not on login page
    return true;
  } catch (error) {
    console.error(`[SessionManager] Error validating session:`, error);
    return false;
  }
}

/**
 * Clear session for a site
 * @param username - User's username
 * @param siteId - Site identifier
 * @returns True if session cleared successfully
 */
export async function clearSession(username: string, siteId: string): Promise<boolean> {
  try {
    const sessionPath = await getSessionFilePath(username, siteId);
    await fs.unlink(sessionPath);
    // Session cleared successfully
    return true;
  } catch (error) {
    const err = error as SessionError;
    if (err.code !== 'ENOENT') {
      console.error(`[SessionManager] Error clearing session for ${siteId}:`, error);
    }
    return false;
  }
}

/**
 * Check if a session exists
 * @param username - User's username
 * @param siteId - Site identifier
 * @returns True if session file exists
 */
export async function hasSession(username: string, siteId: string): Promise<boolean> {
  try {
    const sessionPath = await getSessionFilePath(username, siteId);
    await fs.access(sessionPath);
    return true;
  } catch {
    return false;
  }
}
