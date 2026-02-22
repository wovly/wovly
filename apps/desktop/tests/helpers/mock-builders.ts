/**
 * Mock builders for domain entities
 * Provides fluent API for creating test data with sensible defaults
 */

import { vi } from 'vitest';

/**
 * Builder for web scraper site configuration
 */
export class SiteConfigBuilder {
  private config: any = {
    id: 'test-site',
    name: 'Test Site',
    url: 'https://test.example.com',
    enabled: true,
    authMethod: 'form',
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
  };

  withId(id: string): this {
    this.config.id = id;
    return this;
  }

  withName(name: string): this {
    this.config.name = name;
    return this;
  }

  withUrl(url: string): this {
    this.config.url = url;
    return this;
  }

  withAuthMethod(authMethod: 'form' | 'oauth'): this {
    this.config.authMethod = authMethod;
    return this;
  }

  withOAuth(provider: string): this {
    this.config.authMethod = 'oauth';
    this.config.oauth = {
      oauthProvider: provider,
      loginDetectionSelector: 'body',
      successDetectionSelector: 'div.logged-in',
    };
    // OAuth sessions last 7 days instead of 1 hour
    this.config.sessionManagement.sessionTimeout = 604800000;
    return this;
  }

  withNavigation(steps: any[]): this {
    this.config.selectors.navigation = steps;
    return this;
  }

  withStatus(status: Partial<any>): this {
    this.config.status = { ...this.config.status, ...status };
    return this;
  }

  disabled(): this {
    this.config.enabled = false;
    return this;
  }

  paused(): this {
    this.config.status.paused = true;
    return this;
  }

  withError(error: string, failures = 1): this {
    this.config.status.lastError = error;
    this.config.status.consecutiveFailures = failures;
    return this;
  }

  build(): any {
    return JSON.parse(JSON.stringify(this.config));
  }
}

/**
 * Builder for message objects
 */
export class MessageBuilder {
  private message: any = {
    id: 'msg_test_123',
    platform: 'custom-test',
    from: 'Test Sender',
    subject: 'Test Subject',
    body: 'Test message body',
    timestamp: new Date().toISOString(),
    snippet: 'Test message body',
    source: 'test-site',
    scrapedAt: new Date().toISOString(),
  };

  withId(id: string): this {
    this.message.id = id;
    return this;
  }

  withPlatform(platform: string): this {
    this.message.platform = platform;
    return this;
  }

  from(sender: string): this {
    this.message.from = sender;
    return this;
  }

  withSubject(subject: string): this {
    this.message.subject = subject;
    return this;
  }

  withBody(body: string): this {
    this.message.body = body;
    this.message.snippet = body.substring(0, 200);
    return this;
  }

  withTimestamp(timestamp: string | Date): this {
    this.message.timestamp = timestamp instanceof Date ? timestamp.toISOString() : timestamp;
    return this;
  }

  fromSource(source: string): this {
    this.message.source = source;
    return this;
  }

  scrapedAt(timestamp: string | Date): this {
    this.message.scrapedAt =
      timestamp instanceof Date ? timestamp.toISOString() : timestamp;
    return this;
  }

  cached(age: number = 3600000): this {
    this.message._cached = true;
    this.message._cacheAge = age;
    return this;
  }

  build(): any {
    return JSON.parse(JSON.stringify(this.message));
  }
}

/**
 * Builder for user context
 */
export class UserBuilder {
  private user: any = {
    username: 'test-user',
    email: 'test@example.com',
    preferences: {},
    integrations: [],
  };

  withUsername(username: string): this {
    this.user.username = username;
    return this;
  }

  withEmail(email: string): this {
    this.user.email = email;
    return this;
  }

  withPreferences(preferences: Record<string, any>): this {
    this.user.preferences = { ...this.user.preferences, ...preferences };
    return this;
  }

  withIntegrations(integrations: string[]): this {
    this.user.integrations = integrations;
    return this;
  }

  build(): any {
    return JSON.parse(JSON.stringify(this.user));
  }
}

/**
 * Mock Puppeteer page for browser automation tests
 */
export function createMockPage(overrides: Partial<any> = {}) {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    waitForSelector: vi.fn().mockResolvedValue(true),
    click: vi.fn().mockResolvedValue(undefined),
    type: vi.fn().mockResolvedValue(undefined),
    select: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(undefined),
    $: vi.fn().mockResolvedValue(null),
    $$: vi.fn().mockResolvedValue([]),
    screenshot: vi.fn().mockResolvedValue(Buffer.from('fake-screenshot')),
    url: vi.fn().mockReturnValue('https://example.com'),
    content: vi.fn().mockResolvedValue('<html><body>Test</body></html>'),
    cookies: vi.fn().mockResolvedValue([]),
    setCookie: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

/**
 * Mock browser for browser automation tests
 */
export function createMockBrowser(overrides: Partial<any> = {}) {
  return {
    newPage: vi.fn().mockResolvedValue(createMockPage()),
    close: vi.fn().mockResolvedValue(undefined),
    pages: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

/**
 * Mock BrowserController for integration tests
 */
export function createMockBrowserController() {
  const mockPage = createMockPage();
  return {
    getPage: vi.fn().mockResolvedValue(mockPage),
    closePage: vi.fn().mockResolvedValue(undefined),
    clearCache: vi.fn().mockResolvedValue(undefined),
    mockPage, // Expose for test assertions
  };
}

/**
 * Create mock file system for storage tests
 */
export function createMockFileSystem() {
  const files = new Map<string, string>();

  return {
    readFile: vi.fn((path: string) => {
      if (!files.has(path)) {
        throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      }
      return Promise.resolve(files.get(path)!);
    }),
    writeFile: vi.fn((path: string, content: string) => {
      files.set(path, content);
      return Promise.resolve();
    }),
    mkdir: vi.fn().mockResolvedValue(undefined),
    access: vi.fn((path: string) => {
      if (!files.has(path)) {
        throw new Error(`ENOENT: no such file or directory, access '${path}'`);
      }
      return Promise.resolve();
    }),
    readdir: vi.fn((path: string) => {
      const entries = Array.from(files.keys())
        .filter((k) => k.startsWith(path))
        .map((k) => k.replace(path + '/', '').split('/')[0])
        .filter((v, i, a) => a.indexOf(v) === i);
      return Promise.resolve(entries);
    }),
    stat: vi.fn().mockResolvedValue({
      isFile: () => true,
      isDirectory: () => false,
      size: 1024,
      mtime: new Date(),
    }),
    files, // Expose for test assertions
  };
}
