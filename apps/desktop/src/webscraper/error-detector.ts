/**
 * Error Detector
 *
 * Classifies errors and detects page structure changes that might break scraping.
 */

import type { Page } from 'puppeteer-core';
import type { SiteConfig } from './config-manager';

// ─────────────────────────────────────────────────────────────────────────
// Type Definitions
// ─────────────────────────────────────────────────────────────────────────

/**
 * Error types for web scraping
 */
export enum ErrorType {
  AUTH_FAILURE = 'auth_failure',
  SESSION_EXPIRED = 'session_expired',
  TIMEOUT = 'timeout',
  PAGE_STRUCTURE_CHANGED = 'page_structure_changed',
  NETWORK_ERROR = 'network_error',
  SELECTOR_NOT_FOUND = 'selector_not_found',
  NAVIGATION_FAILED = 'navigation_failed',
  UNKNOWN = 'unknown',
}

export interface MissingSelector {
  type: string;
  name: string;
  selector: string;
  description?: string;
}

export interface SelectorDetail {
  type: string;
  name: string;
  selector: string;
  error: string;
}

export interface DetectPageChangeResult {
  changed: boolean;
  missingSelectors: MissingSelector[];
  details: SelectorDetail[];
}

// ─────────────────────────────────────────────────────────────────────────
// Error Classification
// ─────────────────────────────────────────────────────────────────────────

/**
 * Classify an error
 * @param error - The error object
 * @param page - Puppeteer page instance (optional)
 * @param siteConfig - Site configuration (optional)
 * @returns Error type
 */
export function classifyError(
  error: Error,
  page: Page | null = null,
  siteConfig: SiteConfig | null = null
): ErrorType {
  const message = error.message.toLowerCase();

  // Authentication failures
  if (
    message.includes('login failed') ||
    message.includes('invalid credentials') ||
    message.includes('authentication failed')
  ) {
    return ErrorType.AUTH_FAILURE;
  }

  // Timeout errors
  if (
    message.includes('timeout') ||
    message.includes('navigation timeout') ||
    message.includes('waiting for selector')
  ) {
    return ErrorType.TIMEOUT;
  }

  // Selector not found
  if (
    message.includes('no node found') ||
    message.includes('failed to find element') ||
    message.includes('selector')
  ) {
    return ErrorType.SELECTOR_NOT_FOUND;
  }

  // Network errors
  if (
    message.includes('net::err') ||
    message.includes('network') ||
    message.includes('connection')
  ) {
    return ErrorType.NETWORK_ERROR;
  }

  // Navigation errors
  if (message.includes('navigation') || message.includes('page crashed')) {
    return ErrorType.NAVIGATION_FAILED;
  }

  // Check if we're on login page (session expired)
  if (page && siteConfig) {
    try {
      const url = page.url();
      if (url.includes('login') || url.includes('signin') || url.includes('auth')) {
        return ErrorType.SESSION_EXPIRED;
      }
    } catch {
      // Ignore errors accessing page URL
    }
  }

  return ErrorType.UNKNOWN;
}

// ─────────────────────────────────────────────────────────────────────────
// Page Change Detection
// ─────────────────────────────────────────────────────────────────────────

/**
 * Detect if page structure has changed
 * @param page - Puppeteer page instance
 * @param siteConfig - Site configuration
 * @returns Detection result
 */
export async function detectPageChange(
  page: Page,
  siteConfig: SiteConfig
): Promise<DetectPageChangeResult> {
  const results: DetectPageChangeResult = {
    changed: false,
    missingSelectors: [],
    details: [],
  };

  // Check login selectors
  if (siteConfig.selectors.login) {
    const loginSelectors = {
      usernameField: siteConfig.selectors.login.usernameField,
      passwordField: siteConfig.selectors.login.passwordField,
      submitButton: siteConfig.selectors.login.submitButton,
    };

    for (const [name, selector] of Object.entries(loginSelectors)) {
      if (!selector) continue;

      try {
        const exists = await page.$(selector);
        if (!exists) {
          results.missingSelectors.push({ type: 'login', name, selector });
        }
      } catch (error) {
        const err = error as Error;
        results.details.push({ type: 'login', name, selector, error: err.message });
      }
    }
  }

  // Check message selectors (only if not on login page)
  if (siteConfig.selectors.messages) {
    const messageSelectors = {
      container: siteConfig.selectors.messages.container,
      messageItem: siteConfig.selectors.messages.messageItem,
    };

    for (const [name, selector] of Object.entries(messageSelectors)) {
      if (!selector) continue;

      try {
        const exists = await page.$(selector);
        if (!exists) {
          results.missingSelectors.push({ type: 'messages', name, selector });
        }
      } catch (error) {
        const err = error as Error;
        results.details.push({ type: 'messages', name, selector, error: err.message });
      }
    }
  }

  // Check navigation selectors
  if (siteConfig.selectors.navigation && Array.isArray(siteConfig.selectors.navigation)) {
    for (const step of siteConfig.selectors.navigation) {
      if (!step.selector) continue;

      try {
        const exists = await page.$(step.selector);
        if (!exists) {
          results.missingSelectors.push({
            type: 'navigation',
            name: `step-${step.step}`,
            selector: step.selector,
            description: step.description,
          });
        }
      } catch (error) {
        const err = error as Error;
        results.details.push({
          type: 'navigation',
          name: `step-${step.step}`,
          selector: step.selector,
          error: err.message,
        });
      }
    }
  }

  results.changed = results.missingSelectors.length > 0;
  return results;
}

// ─────────────────────────────────────────────────────────────────────────
// Error Messaging & Recovery
// ─────────────────────────────────────────────────────────────────────────

/**
 * Generate error message for user
 * @param errorType - Error type from classifyError
 * @param originalError - Original error object
 * @param detectResult - Result from detectPageChange (optional)
 * @returns User-friendly error message
 */
export function generateErrorMessage(
  errorType: ErrorType,
  originalError: Error,
  detectResult: DetectPageChangeResult | null = null
): string {
  switch (errorType) {
    case ErrorType.AUTH_FAILURE:
      return 'Authentication failed. Please check your credentials and try again.';

    case ErrorType.SESSION_EXPIRED:
      return 'Your session has expired. The integration will attempt to log in again on the next check.';

    case ErrorType.TIMEOUT:
      return 'The website took too long to respond. This might be a temporary issue. Will retry on next check.';

    case ErrorType.PAGE_STRUCTURE_CHANGED:
      if (detectResult && detectResult.missingSelectors.length > 0) {
        const missing = detectResult.missingSelectors.map((s) => s.name).join(', ');
        return `The website structure has changed. Missing selectors: ${missing}. Please reconfigure this integration.`;
      }
      return 'The website structure has changed. Please reconfigure this integration.';

    case ErrorType.NETWORK_ERROR:
      return 'Network error occurred. Please check your internet connection.';

    case ErrorType.SELECTOR_NOT_FOUND:
      return 'Could not find expected elements on the page. The website might have changed.';

    case ErrorType.NAVIGATION_FAILED:
      return 'Failed to navigate to the website. Please check the URL and try again.';

    case ErrorType.UNKNOWN:
    default:
      return `An error occurred: ${originalError.message}`;
  }
}

/**
 * Determine if error should trigger auto-pause
 * @param errorType - Error type
 * @param consecutiveFailures - Number of consecutive failures
 * @returns True if should auto-pause
 */
export function shouldAutoPause(errorType: ErrorType, consecutiveFailures: number): boolean {
  // Always pause on auth failures or page structure changes
  if (errorType === ErrorType.AUTH_FAILURE || errorType === ErrorType.PAGE_STRUCTURE_CHANGED) {
    return true;
  }

  // Auto-pause after 3 consecutive failures
  return consecutiveFailures >= 3;
}

/**
 * Determine if error is recoverable
 * @param errorType - Error type
 * @returns True if error is recoverable
 */
export function isRecoverable(errorType: ErrorType): boolean {
  const recoverableErrors = [ErrorType.TIMEOUT, ErrorType.NETWORK_ERROR, ErrorType.SESSION_EXPIRED];

  return recoverableErrors.includes(errorType);
}
