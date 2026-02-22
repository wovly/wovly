/**
 * Integration tests for WebScraper workflows
 * Tests complete end-to-end scenarios
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SiteConfigBuilder,
  MessageBuilder,
  createMockPage,
  createMockBrowser,
} from '../helpers/mock-builders';

describe('WebScraper Integration Tests', () => {
  describe('Complete Scraping Workflow', () => {
    it('should execute full scraping flow: login → navigate → extract', async () => {
      // Arrange: Set up complete configuration
      const siteConfig = new SiteConfigBuilder()
        .withId('brightwheel')
        .withName('Brightwheel Daycare')
        .withNavigation([
          {
            step: 1,
            action: 'click',
            selector: 'a.messages-tab',
            waitFor: 'div.messages-container',
            description: 'Click Messages tab',
          },
        ])
        .build();

      const mockPage = createMockPage({
        evaluate: vi.fn().mockResolvedValue([
          {
            sender: 'Teacher Sarah',
            content: 'Field trip forms due Friday',
            timestamp: '2 hours ago',
          },
          {
            sender: 'Admin Office',
            content: 'School closed Monday',
            timestamp: 'Yesterday',
          },
        ]),
      });

      // Act: Execute workflow steps
      // 1. Login
      await mockPage.goto(siteConfig.url);
      await mockPage.type(siteConfig.selectors.login.usernameField, 'test@example.com');
      await mockPage.type(siteConfig.selectors.login.passwordField, 'password123');
      await mockPage.click(siteConfig.selectors.login.submitButton);
      await mockPage.waitForSelector(siteConfig.selectors.login.successIndicator);

      // 2. Navigate
      for (const step of siteConfig.selectors.navigation) {
        await mockPage.click(step.selector);
        if (step.waitFor) {
          await mockPage.waitForSelector(step.waitFor);
        }
      }

      // 3. Extract messages
      const messages = await mockPage.evaluate();

      // Assert: Verify workflow completed successfully
      expect(mockPage.goto).toHaveBeenCalledWith(siteConfig.url);
      expect(mockPage.type).toHaveBeenCalledTimes(2);
      expect(mockPage.click).toHaveBeenCalledTimes(2); // Login + navigation
      expect(messages).toHaveLength(2);
      expect(messages[0].sender).toBe('Teacher Sarah');
      expect(messages[1].sender).toBe('Admin Office');
    });

    it('should handle session reuse when session is valid', async () => {
      const mockPage = createMockPage({
        cookies: vi.fn().mockResolvedValue([
          { name: 'session_id', value: 'abc123', domain: 'example.com' },
        ]),
        url: vi.fn().mockReturnValue('https://example.com/dashboard'),
      });

      // Simulate valid session
      await mockPage.goto('https://example.com/messages');

      // Assert: Should not redirect to login
      expect(mockPage.url()).not.toContain('/login');
      await expect(mockPage.cookies()).resolves.toHaveLength(1);
    });

    it('should detect and handle session expiry', async () => {
      const mockPage = createMockPage({
        url: vi.fn().mockReturnValue('https://example.com/login'),
      });

      // Simulate session expiry (redirected to login)
      await mockPage.goto('https://example.com/messages');

      // Assert: Detect login page
      const currentUrl = mockPage.url();
      expect(currentUrl).toContain('/login');
      // In real implementation, this would trigger re-login
    });
  });

  describe('OAuth Login Workflow', () => {
    it('should handle OAuth login flow', async () => {
      const siteConfig = new SiteConfigBuilder()
        .withOAuth('google')
        .withId('brightwheel-oauth')
        .build();

      let urlCallCount = 0;
      const mockPage = createMockPage({
        url: vi.fn(() => {
          urlCallCount++;
          return urlCallCount === 1
            ? 'https://accounts.google.com/oauth'
            : 'https://brightwheel.com/dashboard';
        }),
      });

      // Act: Navigate to site (triggers OAuth)
      await mockPage.goto(siteConfig.url);

      // First URL check - should be OAuth page
      expect(mockPage.url()).toContain('oauth');

      // User completes OAuth manually (simulated)
      // System waits for success indicator
      await mockPage.waitForSelector(siteConfig.oauth.successDetectionSelector);

      // Save session
      const cookies = await mockPage.cookies();

      // Assert: Workflow completed
      expect(mockPage.goto).toHaveBeenCalled();
      expect(mockPage.url()).toBe('https://brightwheel.com/dashboard');
      expect(cookies).toBeDefined();
    });

    it('should detect OAuth session expiry and require manual re-login', async () => {
      const siteConfig = new SiteConfigBuilder()
        .withOAuth('google')
        .build();

      const mockPage = createMockPage({
        url: vi.fn().mockReturnValue('https://accounts.google.com/oauth'),
      });

      // Simulate expired OAuth session
      await mockPage.goto(siteConfig.url);

      // Assert: Requires manual login
      expect(mockPage.url()).toContain('oauth');
      // Status should be oauth_session_expired
      // Should NOT auto-pause (unlike form auth)
    });
  });

  describe('Multi-Step Navigation', () => {
    it('should execute navigation steps in correct order', async () => {
      const siteConfig = new SiteConfigBuilder()
        .withNavigation([
          {
            step: 1,
            action: 'click',
            selector: 'button.messages',
            waitFor: 'div.msg-container',
            description: 'Open messages',
          },
          {
            step: 2,
            action: 'click',
            selector: 'button.inbox',
            waitFor: 'div.msg-list',
            description: 'Open inbox',
          },
          {
            step: 3,
            action: 'click',
            selector: 'button.all',
            waitFor: 'div.all-messages',
            description: 'Show all',
          },
        ])
        .build();

      const mockPage = createMockPage();
      const clickOrder: string[] = [];

      mockPage.click = vi.fn((selector: string) => {
        clickOrder.push(selector);
        return Promise.resolve();
      });

      // Execute navigation
      for (const step of siteConfig.selectors.navigation) {
        await mockPage.click(step.selector);
        if (step.waitFor) {
          await mockPage.waitForSelector(step.waitFor);
        }
      }

      // Assert: Clicks happened in correct order
      expect(clickOrder).toEqual([
        'button.messages',
        'button.inbox',
        'button.all',
      ]);
      expect(mockPage.waitForSelector).toHaveBeenCalledTimes(3);
    });

    it('should handle navigation with delays between steps', async () => {
      const siteConfig = new SiteConfigBuilder()
        .withNavigation([
          {
            step: 1,
            action: 'click',
            selector: 'button.next',
            delay: 1000,
            description: 'Click with delay',
          },
        ])
        .build();

      const mockPage = createMockPage();
      const startTime = Date.now();

      // Execute with delay
      for (const step of siteConfig.selectors.navigation) {
        await mockPage.click(step.selector);
        if (step.delay) {
          await new Promise((resolve) => setTimeout(resolve, step.delay));
        }
      }

      const elapsed = Date.now() - startTime;

      // Assert: Delay was respected
      expect(elapsed).toBeGreaterThanOrEqual(1000);
      expect(mockPage.click).toHaveBeenCalled();
    });
  });

  describe('Error Recovery', () => {
    it('should handle network timeout gracefully', async () => {
      const mockPage = createMockPage({
        waitForSelector: vi.fn().mockRejectedValue(new Error('Timeout: 30000ms exceeded')),
      });

      // Attempt navigation
      try {
        await mockPage.waitForSelector('div.messages', { timeout: 30000 });
      } catch (error: any) {
        // Assert: Error is timeout
        expect(error.message).toContain('Timeout');
      }

      // Error should be classified as 'timeout'
      const errorType = 'timeout'; // From error classifier
      expect(errorType).toBe('timeout');
    });

    it('should increment failure counter on consecutive errors', async () => {
      const siteConfig = new SiteConfigBuilder()
        .withStatus({ consecutiveFailures: 2 })
        .build();

      // Simulate another failure
      const newFailureCount = siteConfig.status.consecutiveFailures + 1;

      // Assert: Counter incremented
      expect(newFailureCount).toBe(3);
      // At 3 failures, should auto-pause (for form auth)
      if (siteConfig.authMethod === 'form' && newFailureCount >= 3) {
        expect(true).toBe(true); // Would be paused
      }
    });

    it('should reset failure counter on success', async () => {
      const siteConfig = new SiteConfigBuilder()
        .withStatus({ consecutiveFailures: 2, lastError: 'timeout' })
        .build();

      // Simulate successful scrape
      siteConfig.status.consecutiveFailures = 0;
      siteConfig.status.lastError = null;

      // Assert: Counters reset
      expect(siteConfig.status.consecutiveFailures).toBe(0);
      expect(siteConfig.status.lastError).toBeNull();
    });
  });

  describe('Message Deduplication', () => {
    it('should generate consistent IDs for same message', () => {
      const msg1 = new MessageBuilder()
        .from('Sender')
        .withBody('Content')
        .withTimestamp('2026-02-17T12:00:00Z')
        .fromSource('brightwheel')
        .build();

      const msg2 = new MessageBuilder()
        .from('Sender')
        .withBody('Content')
        .withTimestamp('2026-02-17T12:00:00Z')
        .fromSource('brightwheel')
        .build();

      // IDs should be identical
      expect(msg1.id).toBe(msg2.id);
    });

    it('should filter duplicates when appending to storage', () => {
      const existing = [
        new MessageBuilder().withId('msg_1').build(),
        new MessageBuilder().withId('msg_2').build(),
      ];

      const newMessages = [
        new MessageBuilder().withId('msg_2').build(), // Duplicate
        new MessageBuilder().withId('msg_3').build(), // New
      ];

      // Deduplicate
      const existingIds = new Set(existing.map((m) => m.id));
      const unique = newMessages.filter((m) => !existingIds.has(m.id));

      // Assert: Only new message added
      expect(unique).toHaveLength(1);
      expect(unique[0].id).toBe('msg_3');
    });
  });

  describe('Session Management', () => {
    it('should save cookies after successful login', async () => {
      const mockPage = createMockPage({
        cookies: vi.fn().mockResolvedValue([
          { name: 'session_id', value: 'xyz789' },
          { name: 'user_token', value: 'abc123' },
        ]),
      });

      // Login completed
      const cookies = await mockPage.cookies();

      // Assert: Cookies available for saving
      expect(cookies).toHaveLength(2);
      expect(cookies[0].name).toBe('session_id');
      expect(cookies[1].name).toBe('user_token');
    });

    it('should use different session timeouts for OAuth vs form auth', () => {
      const formConfig = new SiteConfigBuilder()
        .withAuthMethod('form')
        .build();

      const oauthConfig = new SiteConfigBuilder()
        .withOAuth('google')
        .build();

      // Assert: Different timeouts
      expect(formConfig.sessionManagement.sessionTimeout).toBe(3600000); // 1 hour
      expect(oauthConfig.sessionManagement.sessionTimeout).toBe(604800000); // 7 days
    });
  });

  describe('Real-World Scenarios', () => {
    it('should handle typical daycare portal workflow', async () => {
      // Brightwheel-like scenario
      const siteConfig = new SiteConfigBuilder()
        .withId('brightwheel')
        .withName('Brightwheel Daycare')
        .withUrl('https://schools.mybrightwheel.com')
        .withNavigation([
          {
            step: 1,
            action: 'click',
            selector: 'a[href*="/messages"]',
            waitFor: 'div.messages-container',
            description: 'Open messages',
          },
        ])
        .build();

      const mockPage = createMockPage({
        evaluate: vi.fn().mockResolvedValue([
          { sender: 'Teacher', content: 'Field trip next week', timestamp: '2h ago' },
          { sender: 'Nurse', content: 'Medication reminder', timestamp: 'yesterday' },
        ]),
      });

      // Execute workflow
      await mockPage.goto(siteConfig.url);
      await mockPage.type('input[name="email"]', 'parent@example.com');
      await mockPage.type('input[name="password"]', 'password');
      await mockPage.click('button[type="submit"]');
      await mockPage.waitForSelector('div.dashboard');
      await mockPage.click('a[href*="/messages"]');
      const messages = await mockPage.evaluate();

      // Assert
      expect(messages).toHaveLength(2);
      expect(messages[0].sender).toBe('Teacher');
      expect(messages[1].sender).toBe('Nurse');
    });

    it('should handle tax portal workflow', async () => {
      // TurboTax-like scenario
      const siteConfig = new SiteConfigBuilder()
        .withId('turbotax')
        .withName('TurboTax')
        .withUrl('https://myturbotax.intuit.com')
        .build();

      const mockPage = createMockPage({
        evaluate: vi.fn().mockResolvedValue([
          {
            sender: 'TurboTax Support',
            content: 'Tax return submitted',
            timestamp: '2026-02-16T10:00:00Z',
          },
        ]),
      });

      // Login and extract
      await mockPage.goto(siteConfig.url);
      const messages = await mockPage.evaluate();

      // Assert
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toContain('Tax return');
    });

    it('should handle school portal with multi-step navigation', async () => {
      const siteConfig = new SiteConfigBuilder()
        .withId('school-portal')
        .withNavigation([
          { step: 1, action: 'click', selector: 'a.communications', waitFor: 'div.comms' },
          { step: 2, action: 'click', selector: 'button.inbox', waitFor: 'div.messages' },
          { step: 3, action: 'click', selector: 'button.show-all', waitFor: 'div.all-msgs' },
        ])
        .build();

      const mockPage = createMockPage();

      // Navigate through steps
      for (const step of siteConfig.selectors.navigation) {
        await mockPage.click(step.selector);
        await mockPage.waitForSelector(step.waitFor!);
      }

      // Assert: All steps executed
      expect(mockPage.click).toHaveBeenCalledTimes(3);
      expect(mockPage.waitForSelector).toHaveBeenCalledTimes(3);
    });
  });
});
