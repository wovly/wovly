/**
 * Common test utilities and helpers
 */

import { vi } from 'vitest';

/**
 * Create a mock user context for testing
 */
export function createMockUser(overrides = {}) {
  return {
    username: 'test-user',
    email: 'test@example.com',
    ...overrides,
  };
}

/**
 * Create a mock site configuration for web scraper tests
 */
export function createMockSiteConfig(overrides = {}) {
  return {
    id: 'test-site',
    name: 'Test Site',
    url: 'https://test.example.com',
    enabled: true,
    authMethod: 'form' as const,
    credentialDomain: 'example.com',
    selectors: {
      login: {
        usernameField: 'input[name="email"]',
        passwordField: 'input[name="password"]',
        submitButton: 'button[type="submit"]',
        successIndicator: 'div.dashboard',
      },
      navigation: [],
      messages: {
        container: 'div.messages-list',
        messageItem: 'div.message-card',
        sender: '.message-author',
        content: '.message-body',
        timestamp: '.message-date',
      },
    },
    sessionManagement: {
      saveSession: true,
      sessionTimeout: 3600000,
    },
    status: {
      lastError: null,
      consecutiveFailures: 0,
      paused: false,
    },
    ...overrides,
  };
}

/**
 * Create a mock message for testing
 */
export function createMockMessage(overrides = {}) {
  return {
    id: 'msg_test_123',
    platform: 'custom-test',
    from: 'Test Sender',
    subject: 'Test Subject',
    body: 'Test message body',
    timestamp: new Date().toISOString(),
    snippet: 'Test message body',
    source: 'test-site',
    scrapedAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Wait for a condition to be true
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  options = { timeout: 5000, interval: 100 }
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < options.timeout) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, options.interval));
  }

  throw new Error(`Condition not met within ${options.timeout}ms`);
}

/**
 * Create a spy that resolves after a delay
 */
export function createDelayedSpy<T>(resolveValue: T, delayMs: number = 100) {
  return vi.fn(
    () =>
      new Promise<T>((resolve) => {
        setTimeout(() => resolve(resolveValue), delayMs);
      })
  );
}

/**
 * Create a spy that rejects with an error
 */
export function createRejectedSpy(error: Error) {
  return vi.fn(() => Promise.reject(error));
}
