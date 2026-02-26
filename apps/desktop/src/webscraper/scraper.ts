/**
 * Web Scraper
 *
 * Core scraping functionality that handles login, navigation, and message extraction
 * from custom websites without APIs.
 */

import type { Page } from 'puppeteer-core';
import { promises as fs } from 'fs';
import { saveSession, loadSession, validateSession, clearSession } from './session-manager';
import type { SiteConfig } from './config-manager';
import {
  classifyError,
  detectPageChange,
  generateErrorMessage,
  shouldAutoPause,
  isRecoverable,
  ErrorType,
} from './error-detector';
import { getSettingsPath } from '../utils/helpers';
import { fetch2FACodeFromIMessage, fetch2FACodeFromGmail } from './twofa-helper';

// ─────────────────────────────────────────────────────────────────────────
// Type Definitions
// ─────────────────────────────────────────────────────────────────────────

export interface BrowserController {
  getPage(sessionId: string): Promise<Page>;
}

export interface Credentials {
  username: string;
  password: string;
}

export interface RawMessage {
  sender?: string;
  content: string;
  timestamp?: string | null;
}

export interface StandardMessage {
  platform: string;
  from: string;
  subject: string;
  body: string;
  timestamp: string;
  originalTimestamp: string | null;
  snippet: string;
  source: string;
  sourceUrl: string;
  scrapedAt: string;
}

export interface ScrapeSuccessResult {
  success: true;
  messages: StandardMessage[];
  timestamp: number;
}

export interface ScrapeErrorResult {
  success: false;
  error: string;
  errorType?: ErrorType;
  timestamp: number;
  recoverable?: boolean;
  requiresManualLogin?: boolean;
  message?: string;
}

export type ScrapeResult = ScrapeSuccessResult | ScrapeErrorResult;

export interface ApiKeys {
  anthropic?: string;
}

export interface Settings {
  apiKeys?: {
    anthropic?: string;
  };
}

export interface AnthropicAPIResponse {
  content?: Array<{
    text?: string;
  }>;
}

export interface AvailableElement {
  tag: string;
  text: string;
  selector: string;
}

// ─────────────────────────────────────────────────────────────────────────
// WebScraper Class
// ─────────────────────────────────────────────────────────────────────────

export class WebScraper {
  private browserController: BrowserController;
  private username: string;

  constructor(browserController: BrowserController, username: string) {
    this.browserController = browserController;
    this.username = username;
  }

  /**
   * Scrape messages from a configured website
   * @param siteConfig - Site configuration
   * @returns Result with success status and messages
   */
  async scrapeMessages(siteConfig: SiteConfig): Promise<ScrapeResult> {
    const sessionId = `webscraper-${siteConfig.id}`;
    let page: Page | null = null;

    try {
      console.warn(`[WebScraper] Starting scrape for ${siteConfig.name}`);

      // Get or create browser page
      page = await this.browserController.getPage(sessionId);

      // Try to use existing session
      const hasValidSession = await this.checkSession(page, siteConfig);

      if (!hasValidSession) {
        // OAuth sites cannot auto-login - require manual re-login
        if ((siteConfig as SiteConfig & { authMethod?: string }).authMethod === 'oauth') {
          console.warn(`[WebScraper] OAuth session expired for ${siteConfig.name}`);
          return {
            success: false,
            error: 'oauth_session_expired',
            message: 'Session expired. Please log in again via the Integrations page.',
            requiresManualLogin: true,
            timestamp: Date.now(),
          };
        }

        // Form-based auth can auto-login
        console.warn(`[WebScraper] No valid session, logging in`);
        await this.login(page, siteConfig);
      } else {
        console.warn(`[WebScraper] Using existing session`);
      }

      // Execute navigation sequence
      if (siteConfig.selectors.navigation && siteConfig.selectors.navigation.length > 0) {
        await this.executeNavigationSteps(page, siteConfig);
      } else {
        // If no navigation steps, just go to the URL
        console.warn(`[WebScraper] No navigation steps, staying on current page`);
      }

      // Extract messages
      const messages = await this.extractMessages(page, siteConfig);

      // Convert to standard format
      const standardMessages = this.convertToStandardFormat(messages, siteConfig);

      console.warn(
        `[WebScraper] Successfully scraped ${standardMessages.length} messages from ${siteConfig.name}`
      );

      return {
        success: true,
        messages: standardMessages,
        timestamp: Date.now(),
      };
    } catch (error) {
      const err = error as Error;
      console.error(`[WebScraper] Error scraping ${siteConfig.name}:`, err);

      const errorType = classifyError(err, page, siteConfig);
      const detectResult = page ? await detectPageChange(page, siteConfig).catch(() => null) : null;
      const errorMessage = generateErrorMessage(errorType, err, detectResult);

      // Clear session if it's expired or auth failed
      if (errorType === ErrorType.SESSION_EXPIRED || errorType === ErrorType.AUTH_FAILURE) {
        await clearSession(this.username, siteConfig.id);
      }

      return {
        success: false,
        error: errorMessage,
        errorType,
        timestamp: Date.now(),
        recoverable: isRecoverable(errorType),
      };
    } finally {
      // Optionally close the page (or keep it open for reuse)
      // await page?.close();
    }
  }

  /**
   * Check if we have a valid session
   * @param page - Puppeteer page
   * @param siteConfig - Site configuration
   * @returns True if session is valid
   */
  private async checkSession(page: Page, siteConfig: SiteConfig): Promise<boolean> {
    const maxAge = siteConfig.sessionManagement?.sessionTimeout || 3600000; // Default 1 hour

    // Try to load session
    const loaded = await loadSession(page, this.username, siteConfig.id, maxAge);
    if (!loaded) {
      return false;
    }

    // Validate session by navigating to the site
    const valid = await validateSession(page, siteConfig);
    return valid;
  }

  /**
   * Perform login
   * @param page - Puppeteer page
   * @param siteConfig - Site configuration
   */
  private async login(page: Page, siteConfig: SiteConfig): Promise<void> {
    console.warn(`[WebScraper] Navigating to ${siteConfig.url}`);

    // Navigate with lenient options for better compatibility
    try {
      await page.goto(siteConfig.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    } catch (err) {
      const error = err as Error;
      if (error.message.includes('timeout')) {
        console.warn('[WebScraper] Navigation timeout, trying with load event...');
        await page.goto(siteConfig.url, { waitUntil: 'load', timeout: 10000 }).catch(() => {
          console.warn('[WebScraper] Using partially loaded page');
        });
      } else {
        throw err;
      }
    }

    // Wait for page to stabilize
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Get credentials
    const credentials = await this.getCredentials(siteConfig);

    // Check if we have a recorded login sequence - if so, replay it exactly
    if (siteConfig.selectors.login.sequence && siteConfig.selectors.login.sequence.length > 0) {
      console.warn(
        `[WebScraper] Replaying recorded login sequence (${siteConfig.selectors.login.sequence.length} steps)`
      );

      for (const step of siteConfig.selectors.login.sequence) {
        console.warn(
          `[WebScraper]   Step: ${step.type} ${step.selector} ${step.description || ''}`
        );

        try {
          // Wait for element
          await page.waitForSelector(step.selector, { timeout: 10000 });

          if (step.type === 'type') {
            await page.click(step.selector);

            // Use actual credentials
            if (step.isUsernameField) {
              await page.type(step.selector, credentials.username);
              console.warn('[WebScraper]   ✓ Entered username');
            } else if (step.isPasswordField) {
              await page.type(step.selector, credentials.password);
              console.warn('[WebScraper]   ✓ Entered password');
            } else if (step.is2FAField) {
              // Automatic 2FA code retrieval
              const method = siteConfig.twoFactorAuth?.method || 'unknown';
              console.warn(
                `[WebScraper]   2FA field detected (${method}) - attempting automatic code retrieval`
              );

              // Get site name from config for searching
              const siteName = siteConfig.name.toLowerCase();
              const searchTerm = siteName.replace(/\s+/g, ''); // Remove spaces: "My Chart" → "mychart"

              // Get API key for LLM extraction
              const apiKey = await this.getApiKey();

              let code: string | null = null;

              if (!apiKey) {
                console.warn('[WebScraper]   ⚠ No API key available for 2FA code extraction');
              } else if (method === 'email') {
                // Email-based 2FA - use Gmail
                console.warn('[WebScraper]   Using Gmail for email-based 2FA');
                const googleToken = await this.getGoogleAccessToken();

                if (googleToken) {
                  code = await fetch2FACodeFromGmail(googleToken, searchTerm, apiKey, 10);
                } else {
                  console.warn(
                    '[WebScraper]   ⚠ Gmail not connected - cannot retrieve email 2FA code'
                  );
                }
              } else if (method === 'sms') {
                // SMS-based 2FA - use iMessage
                console.warn('[WebScraper]   Using iMessage for SMS-based 2FA');
                code = await fetch2FACodeFromIMessage(searchTerm, apiKey, 10);
              } else {
                console.warn(
                  `[WebScraper]   ⚠ Unknown 2FA method (${method}) - cannot auto-retrieve code`
                );
              }

              if (code) {
                await page.type(step.selector, code);
                console.warn(`[WebScraper]   ✓ Automatically entered 2FA code: ${code}`);
              } else {
                console.warn(
                  '[WebScraper]   ⚠ Could not retrieve 2FA code automatically - manual entry required'
                );
                // Don't fail - just skip this step and let user handle manually
              }
            }
          } else if (step.type === 'click' && !step.is2FAField) {
            await page.click(step.selector);
            console.warn('[WebScraper]   ✓ Clicked');

            // Wait for potential navigation after clicks
            await page
              .waitForNavigation({ waitUntil: 'networkidle0', timeout: 5000 })
              .catch(() => {});
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        } catch (err: any) {
          console.warn(`[WebScraper]   ⚠ Step failed: ${err.message}`);
          // Continue to next step
        }
      }

      console.warn('[WebScraper] Login sequence replay complete');

      // Skip handle2FA below - sequence already handled 2FA if needed
      const sequenceHandled2FA = siteConfig.selectors.login.sequence.some(
        (step) => step.is2FAField
      );
      if (sequenceHandled2FA) {
        console.warn(
          '[WebScraper] 2FA already handled in login sequence, skipping duplicate check'
        );
        // Jump to success check
        if (siteConfig.selectors.login.successIndicator) {
          await page.waitForSelector(siteConfig.selectors.login.successIndicator, {
            timeout: 15000,
          });
        } else {
          await page
            .waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 })
            .catch(() => {});
        }
        console.warn(`[WebScraper] Login successful`);
        return;
      }
    } else {
      // Fallback to old method if no sequence recorded
      console.warn(`[WebScraper] No login sequence found, using legacy login method`);

      // Fill username
      await page.waitForSelector(siteConfig.selectors.login.usernameField, { timeout: 10000 });
      await page.click(siteConfig.selectors.login.usernameField);
      await page.type(siteConfig.selectors.login.usernameField, credentials.username);

      // Check if password field exists on current page
      let passwordFieldExists = false;
      if (siteConfig.selectors.login.passwordField) {
        try {
          await page.waitForSelector(siteConfig.selectors.login.passwordField, { timeout: 2000 });
          passwordFieldExists = true;
        } catch {
          passwordFieldExists = false;
        }
      }

      // If password field doesn't exist, click submit first
      if (!passwordFieldExists && siteConfig.selectors.login.submitButton) {
        await page.click(siteConfig.selectors.login.submitButton);
        await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }).catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      // Fill password
      if (siteConfig.selectors.login.passwordField) {
        await page.waitForSelector(siteConfig.selectors.login.passwordField, { timeout: 10000 });
        await page.click(siteConfig.selectors.login.passwordField);
        await page.type(siteConfig.selectors.login.passwordField, credentials.password);
      }

      // Click submit button
      if (siteConfig.selectors.login.submitButton) {
        console.warn(`[WebScraper] Submitting login form`);
        await page.click(siteConfig.selectors.login.submitButton);
      }
    }

    // Handle 2FA if enabled (hybrid approach)
    if (siteConfig.twoFactorAuth?.enabled && siteConfig.selectors.login.twoFactorField) {
      console.warn(`[WebScraper] 2FA detected, attempting hybrid authentication`);

      const sessionId = `webscraper-${siteConfig.id}`;
      const success = await this.handle2FA(page, siteConfig, sessionId);

      if (!success) {
        // Don't throw - manual fallback is always available
        console.warn('[WebScraper] 2FA automation failed, user completed manually');
      }
    }

    // Wait for navigation or success indicator
    if (siteConfig.selectors.login.successIndicator) {
      await page.waitForSelector(siteConfig.selectors.login.successIndicator, { timeout: 15000 });
    } else {
      // Wait for navigation
      await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }).catch(() => {
        // Navigation might not happen if it's a SPA
      });
    }

    console.warn(`[WebScraper] Login successful`);

    // Save session if configured
    if (siteConfig.sessionManagement?.saveSession !== false) {
      await saveSession(page, this.username, siteConfig.id);
    }

    // Wait for page to fully render after login (important for SPAs)
    console.warn(`[WebScraper] Waiting for page to stabilize after login...`);
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  /**
   * Handle 2FA code entry during login (HYBRID APPROACH)
   * @param page - Puppeteer page
   * @param siteConfig - Site configuration
   * @param sessionId - Session ID for browser window management
   * @returns true if automated, false if manual fallback used
   */
  private async handle2FA(page: Page, siteConfig: SiteConfig, sessionId: string): Promise<boolean> {
    const twoFA = siteConfig.twoFactorAuth;
    if (!twoFA || !siteConfig.selectors.login.twoFactorField) {
      return false;
    }

    try {
      // Wait for 2FA field to appear
      await page.waitForSelector(siteConfig.selectors.login.twoFactorField, { timeout: 10000 });
      console.warn(`[WebScraper] 2FA field detected`);

      // STEP 1: Attempt automated code retrieval
      let code: string | null = null;

      if (twoFA.method === 'email' && twoFA.requiredIntegration === 'gmail') {
        const googleToken = await this.getGoogleAccessToken();
        if (googleToken) {
          console.warn('[WebScraper] Attempting automated 2FA via Gmail');
          const senderDomain = new URL(siteConfig.url).hostname;
          code = await fetch2FACodeFromGmail(googleToken, senderDomain, await this.getApiKey());
        }
      }

      if (twoFA.method === 'sms' && twoFA.requiredIntegration === 'imessage') {
        const iMessageEnabled = await this.getIMessageEnabled();
        if (iMessageEnabled) {
          console.warn('[WebScraper] Attempting automated 2FA via iMessage');
          const phonePattern = twoFA.target?.split('-').pop() || '';
          code = await fetch2FACodeFromIMessage(phonePattern, await this.getApiKey());
        }
      }

      // STEP 2: If automation succeeded, enter code
      if (code) {
        console.warn(`[WebScraper] Automated 2FA: Entering code ${code}`);
        await page.click(siteConfig.selectors.login.twoFactorField);
        await page.type(siteConfig.selectors.login.twoFactorField, code);

        // Submit if button exists
        const submitButton = await page.$('button[type="submit"]').catch(() => null);
        if (submitButton) {
          await submitButton.click();
        }

        // Wait for 2FA to complete
        await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }).catch(() => {});
        console.warn('[WebScraper] ✅ Automated 2FA completed successfully');
        return true;
      }

      // STEP 3: Fallback to manual 2FA
      console.warn('[WebScraper] Automated 2FA not available, falling back to manual');

      // Show browser window to user (make headful if headless)
      await this.showBrowserForManual2FA(sessionId, siteConfig.name);

      // Wait for user to complete 2FA (with timeout and notification)
      const completed = await this.waitForManual2FA(
        page,
        siteConfig.name,
        siteConfig.selectors.login.twoFactorField
      );

      if (completed) {
        console.warn('[WebScraper] ✅ Manual 2FA completed by user');
        return false; // Indicate manual completion
      } else {
        throw new Error('2FA timeout - user did not complete authentication');
      }
    } catch (err: any) {
      console.error('[WebScraper] 2FA handling error:', err.message);
      throw err; // Re-throw so scraper can handle
    }
  }

  /**
   * Show browser window for manual 2FA
   */
  private async showBrowserForManual2FA(sessionId: string, siteName: string): Promise<void> {
    // This will be implemented in browser controller
    // For now, just log
    console.warn(`[WebScraper] Browser window should be shown for manual 2FA: ${siteName}`);
  }

  /**
   * Wait for user to complete manual 2FA (with timeout and chat notification)
   * @returns true if completed, false if timeout
   */
  private async waitForManual2FA(
    page: Page,
    siteName: string,
    twoFactorSelector: string
  ): Promise<boolean> {
    console.warn('[WebScraper] Waiting for user to complete manual 2FA...');

    const timeout = 300000; // 5 minutes
    const startTime = Date.now();
    let notificationSent = false;

    return new Promise((resolve) => {
      const checkInterval = setInterval(async () => {
        const elapsed = Date.now() - startTime;

        // Send chat notification after 5 minutes
        if (elapsed >= timeout && !notificationSent) {
          notificationSent = true;
          await this.sendChatNotification(
            `Your authentication is needed for ${siteName} to fetch the latest messages`
          );
          console.warn('[WebScraper] Chat notification sent to user');
        }

        // Check if page has changed (2FA completed)
        const has2FAField = await page.$(twoFactorSelector).catch(() => null);

        if (!has2FAField) {
          // 2FA field gone = user completed it
          clearInterval(checkInterval);
          resolve(true);
        }

        // Continue waiting indefinitely after notification
        // (user might take longer than 5 min)
      }, 2000); // Check every 2 seconds
    });
  }

  /**
   * Send notification to chat window
   */
  private async sendChatNotification(message: string): Promise<void> {
    // This will be implemented to send IPC to main window
    // For now, just log
    console.warn(`[WebScraper] Would send notification: ${message}`);
  }

  /**
   * Get Google access token for Gmail API
   */
  private async getGoogleAccessToken(): Promise<string | null> {
    try {
      // This will be replaced with actual implementation
      // For now, return null to force manual fallback
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Check if iMessage is enabled
   */
  private async getIMessageEnabled(): Promise<boolean> {
    try {
      const { SettingsService } = await import('../services/settings');
      return await SettingsService.getIMessageEnabled(this.username);
    } catch {
      return false;
    }
  }

  /**
   * Get API key for LLM calls
   */
  private async getApiKey(): Promise<string> {
    try {
      const settingsPath = await getSettingsPath(this.username);
      const settingsData = await fs.readFile(settingsPath, 'utf-8');
      const settings: Settings = JSON.parse(settingsData);
      return settings.apiKeys?.anthropic || '';
    } catch {
      return '';
    }
  }

  /**
   * Execute navigation steps
   * @param page - Puppeteer page
   * @param siteConfig - Site configuration
   */
  private async executeNavigationSteps(page: Page, siteConfig: SiteConfig): Promise<void> {
    const steps = siteConfig.selectors.navigation || [];

    console.warn(`[WebScraper] Executing ${steps.length} navigation steps`);

    for (const step of steps) {
      console.warn(`[WebScraper] Step ${step.step}: ${step.description}`);

      try {
        if (step.action === 'click') {
          let elementFound = false;

          // Try to wait for the CSS selector first
          try {
            await page.waitForSelector(step.selector, { timeout: 15000 });
            elementFound = true;
          } catch (selectorError) {
            // Log available interactive elements to help debug

            const availableElements = (await page.evaluate(() => {
              const elements: AvailableElement[] = [];
              // @ts-expect-error - document available in browser context
              document.querySelectorAll('a, button, [role="button"]').forEach((el: any) => {
                const text = el.textContent?.trim().substring(0, 50);
                if (text) {
                  elements.push({
                    tag: el.tagName.toLowerCase(),
                    text: text,
                    selector: el.id
                      ? `#${el.id}`
                      : el.className
                        ? `.${el.className.split(' ')[0]}`
                        : el.tagName.toLowerCase(),
                  });
                }
              });
              return elements.slice(0, 20); // First 20 elements
            })) as AvailableElement[];

            console.error(`[WebScraper] Selector not found: ${step.selector}`);
            console.error(
              `[WebScraper] Available interactive elements on page:`,
              JSON.stringify(availableElements, null, 2)
            );

            // Try multiple fallback strategies
            if (step.description) {
              console.warn(`[WebScraper] Trying fallback strategies for: "${step.description}"`);

              // Strategy 1: If targeting SVG, try parent clickable element
              if (step.selector.includes('svg')) {
                console.warn(`[WebScraper] SVG detected, trying parent clickable element`);
                const foundSvgParent = await page.evaluate((selector: string) => {
                  const doc = (globalThis as any).document;
                  try {
                    const svgElement = doc.querySelector(selector.replace(/\s*>\s*svg$/, ''));
                    if (svgElement) {
                      // Look for parent button, link, or clickable element
                      let parent = svgElement.closest('button, a, [role="button"], [onclick]');
                      if (parent) {
                        return true;
                      }
                    }
                  } catch (e) {
                    // Ignore selector errors
                  }
                  return false;
                }, step.selector);

                if (foundSvgParent) {
                  console.warn(`[WebScraper] Found parent clickable element for SVG`);
                  elementFound = true;
                }
              }

              // Strategy 2: Text-based fallback (skip if description is just "svg" or contains only "svg")
              if (!elementFound && step.description) {
                const textMatch = step.description.match(/(?:click|select|tap)\s+(.+)/i);
                let searchText = textMatch ? textMatch[1].trim() : step.description;

                // Skip if search text is just "svg" or icon-related
                if (!['svg', 'icon', 'button'].includes(searchText.toLowerCase())) {
                  // Clean up search text
                  searchText = searchText.split(/[⇆→←↔|]/)[0].trim();
                  searchText = searchText.split(/\s{2,}/)[0].trim();
                  searchText = searchText.substring(0, 100);

                  console.warn(`[WebScraper] Trying text search: "${searchText}"`);

                  const foundByText = (await page.evaluate((text: string) => {
                    const doc = (globalThis as any).document;
                    const elements = Array.from(
                      doc.querySelectorAll('a, button, [role="button"], [onclick]')
                    );

                    const match = elements.find((el: any) => {
                      const elText = el.textContent?.trim() || '';
                      const ariaLabel = el.getAttribute('aria-label') || '';
                      const title = el.getAttribute('title') || '';

                      return (
                        elText.toLowerCase().includes(text.toLowerCase()) ||
                        ariaLabel.toLowerCase().includes(text.toLowerCase()) ||
                        title.toLowerCase().includes(text.toLowerCase())
                      );
                    });
                    return match !== undefined;
                  }, searchText)) as boolean;

                  if (foundByText) {
                    console.warn(
                      `[WebScraper] Found element by text/aria-label/title: "${searchText}"`
                    );
                    elementFound = true;
                  }
                }
              }

              // Strategy 3: Try more flexible selector (remove nth-child)
              if (!elementFound && step.selector.includes('nth-child')) {
                console.warn(`[WebScraper] Trying selector without nth-child constraints`);
                const flexibleSelector = step.selector.replace(
                  /:(nth-child|nth-of-type)\(\d+\)\s*>\s*/g,
                  ' '
                );
                try {
                  await page.waitForSelector(flexibleSelector, { timeout: 5000 });
                  console.warn(`[WebScraper] Found with flexible selector: ${flexibleSelector}`);
                  elementFound = true;
                } catch {
                  // Continue to next strategy
                }
              }

              if (!elementFound) {
                throw selectorError;
              }
            } else {
              throw selectorError;
            }
          }

          // Click the element using appropriate strategy
          if (elementFound) {
            let clickSuccessful = false;

            // Strategy 1: SVG parent click
            if (step.selector.includes('svg')) {
              try {
                const clicked = await page.evaluate((selector: string) => {
                  const doc = (globalThis as any).document;
                  try {
                    const svgElement = doc.querySelector(selector.replace(/\s*>\s*svg$/, ''));
                    if (svgElement) {
                      const parent = svgElement.closest('button, a, [role="button"], [onclick]');
                      if (parent) {
                        parent.click();
                        return true;
                      }
                    }
                  } catch (e) {
                    // Continue to next strategy
                  }
                  return false;
                }, step.selector);

                if (clicked) {
                  console.warn(`[WebScraper] Clicked SVG parent element`);
                  clickSuccessful = true;
                  await new Promise((resolve) => setTimeout(resolve, 2000));
                }
              } catch (e) {
                // Continue to next strategy
              }
            }

            // Strategy 2: Text-based click
            if (!clickSuccessful && step.description) {
              const textMatch = step.description.match(/(?:click|select|tap)\s+(.+)/i);
              let searchText = textMatch ? textMatch[1].trim() : step.description;

              if (!['svg', 'icon', 'button'].includes(searchText.toLowerCase())) {
                searchText = searchText.split(/[⇆→←↔|]/)[0].trim();
                searchText = searchText.split(/\s{2,}/)[0].trim();
                searchText = searchText.substring(0, 100);

                try {
                  const clicked = await page.evaluate((text: string) => {
                    const doc = (globalThis as any).document;
                    const elements = Array.from(
                      doc.querySelectorAll('a, button, [role="button"], [onclick]')
                    );

                    const match = elements.find((el: any) => {
                      const elText = el.textContent?.trim() || '';
                      const ariaLabel = el.getAttribute('aria-label') || '';
                      const title = el.getAttribute('title') || '';
                      return (
                        elText.toLowerCase().includes(text.toLowerCase()) ||
                        ariaLabel.toLowerCase().includes(text.toLowerCase()) ||
                        title.toLowerCase().includes(text.toLowerCase())
                      );
                    });
                    if (match) {
                      (match as any).click();
                      return true;
                    }
                    return false;
                  }, searchText);

                  if (clicked) {
                    console.warn(`[WebScraper] Clicked by text/aria-label: "${searchText}"`);
                    clickSuccessful = true;
                    await new Promise((resolve) => setTimeout(resolve, 2000));
                  }
                } catch (e) {
                  // Continue to next strategy
                }
              }
            }

            // Strategy 3: Flexible selector (without nth-child)
            if (!clickSuccessful && step.selector.includes('nth-child')) {
              const flexibleSelector = step.selector.replace(
                /:(nth-child|nth-of-type)\(\d+\)\s*>\s*/g,
                ' '
              );
              try {
                await page.click(flexibleSelector);
                console.warn(`[WebScraper] Clicked with flexible selector: ${flexibleSelector}`);
                clickSuccessful = true;
                await new Promise((resolve) => setTimeout(resolve, 2000));
              } catch (e) {
                // Continue to next strategy
              }
            }

            // Strategy 4: Original selector
            if (!clickSuccessful) {
              try {
                await Promise.race([
                  page
                    .waitForNavigation({ waitUntil: 'networkidle0', timeout: 10000 })
                    .catch(() => {}),
                  page.click(step.selector),
                ]);
                console.warn(`[WebScraper] Clicked with original selector: ${step.selector}`);
                clickSuccessful = true;
              } catch (clickError) {
                console.error(`[WebScraper] All click strategies failed for: ${step.description}`);
                throw clickError;
              }
            }
          }
        } else if (step.action === 'type' && step.value) {
          await page.waitForSelector(step.selector, { timeout: 15000 });
          await page.type(step.selector, step.value);
        } else if (step.action === 'select' && step.value) {
          await page.waitForSelector(step.selector, { timeout: 15000 });
          await page.select(step.selector, step.value);
        }

        // Wait for next element to appear
        if (step.waitFor) {
          await page.waitForSelector(step.waitFor, { timeout: 15000 });
        }

        // Default delay between steps for SPAs to render
        const delay = step.delay || 1500;
        await new Promise((resolve) => setTimeout(resolve, delay));
      } catch (error) {
        const err = error as Error;
        throw new Error(`Navigation step ${step.step} failed: ${err.message}`);
      }
    }

    console.warn(`[WebScraper] Navigation complete`);
  }

  /**
   * Extract messages from the page using LLM
   * @param page - Puppeteer page
   * @param siteConfig - Site configuration
   * @returns Extracted messages
   */
  private async extractMessages(page: Page, siteConfig: SiteConfig): Promise<RawMessage[]> {
    const selectors = siteConfig.selectors.messages;

    if (!selectors || !selectors.container || !selectors.container.trim()) {
      throw new Error('No message selectors configured - please reconfigure this integration');
    }

    console.warn(`[WebScraper] Extracting messages using AI-powered text extraction`);

    // Wait for message container
    await page.waitForSelector(selectors.container, { timeout: 10000 });

    // Extract all text from the messages area (browser context code)

    const messagesText = (await page.evaluate((containerSelector: string): any => {
      // @ts-expect-error - document available in browser context
      const container = document.querySelector(containerSelector);
      if (!container) return '';

      // Get visible text content, preserving some structure
      return (container as any).innerText || (container as any).textContent || '';
    }, selectors.container)) as string;

    console.warn(
      `[WebScraper] Extracted ${messagesText.length} characters of text from messages area`
    );

    if (!messagesText || messagesText.trim().length === 0) {
      console.warn('[WebScraper] No text found in messages area');
      return [];
    }

    // Use LLM to parse messages from text
    const messages = await this.parseMessagesWithLLM(messagesText, siteConfig);

    console.warn(`[WebScraper] LLM extracted ${messages.length} messages`);
    return messages;
  }

  /**
   * Parse messages from text using LLM
   * @param text - Raw text from messages area
   * @param siteConfig - Site configuration
   * @returns Parsed messages
   */
  private async parseMessagesWithLLM(text: string, siteConfig: SiteConfig): Promise<RawMessage[]> {
    try {
      // Get API keys
      const apiKeys = await this.getApiKeys();
      if (!apiKeys.anthropic) {
        console.warn('[WebScraper] No Anthropic API key, cannot parse messages');
        return [];
      }

      const siteType = (siteConfig as SiteConfig & { siteType?: string }).siteType || 'website';
      const prompt = `Extract individual messages from this text from a ${siteType} (${siteConfig.name}).

Text from messages area:
${text.substring(0, 8000)}

Instructions:
- Identify each separate message/communication
- Extract: sender name, message content, timestamp/date
- IMPORTANT: Look carefully for timestamps in ANY format (dates, times, relative times like "2 hours ago", day names, etc.)
- Timestamps are CRITICAL - search thoroughly for any time indicators near each message
- Common formats: "Feb 15", "2:30 PM", "Yesterday", "Monday", "2 hours ago", "15 minutes ago", "Last week", "Today at 3pm"
- If you find ANY time-related text, include it in the timestamp field
- Only set timestamp to null if there is absolutely no time information anywhere near the message
- Return as a JSON array of message objects
- Each message should have: sender, content, timestamp (only null if truly not found)

Example output format:
[
  {
    "sender": "John Doe",
    "content": "Please review the updated schedule",
    "timestamp": "2:30 PM"
  },
  {
    "sender": "Teacher Sarah",
    "content": "Field trip permission forms are due Friday",
    "timestamp": "Yesterday"
  },
  {
    "sender": "System Admin",
    "content": "Server maintenance tonight",
    "timestamp": "Feb 15"
  }
]

Return ONLY the JSON array, no other text.`;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKeys.anthropic,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001', // Fast and cost-effective
          max_tokens: 4000,
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error('[WebScraper] LLM API error:', response.status);
        console.error('[WebScraper] Error details:', errorBody);
        return [];
      }

      const data = (await response.json()) as AnthropicAPIResponse;
      const result = data.content?.[0]?.text || '';

      // Parse JSON response
      const jsonMatch = result.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        console.error('[WebScraper] Could not find JSON in LLM response');
        return [];
      }

      const messages = JSON.parse(jsonMatch[0]) as RawMessage[];
      return Array.isArray(messages) ? messages : [];
    } catch (error) {
      const err = error as Error;
      console.error('[WebScraper] Error parsing messages with LLM:', err.message);
      return [];
    }
  }

  /**
   * Get API keys for LLM calls
   * @returns API keys object
   */
  private async getApiKeys(): Promise<ApiKeys> {
    try {
      const settingsPath = await getSettingsPath(this.username);
      const settingsData = await fs.readFile(settingsPath, 'utf8');
      const settings = JSON.parse(settingsData) as Settings;

      return {
        anthropic: settings.apiKeys?.anthropic || process.env.ANTHROPIC_API_KEY,
      };
    } catch (error) {
      const err = error as Error;
      console.error('[WebScraper] Error loading API keys:', err.message);
      return {
        anthropic: process.env.ANTHROPIC_API_KEY,
      };
    }
  }

  /**
   * Convert raw messages to standard format
   * @param messages - Raw messages from page
   * @param siteConfig - Site configuration
   * @returns Standardized messages
   */
  private convertToStandardFormat(
    messages: RawMessage[],
    siteConfig: SiteConfig
  ): StandardMessage[] {
    const scrapedAt = new Date().toISOString();

    return messages.map((msg, index) => {
      // Parse timestamp if present
      let parsedTimestamp: string | null = null;
      if (msg.timestamp) {
        parsedTimestamp = this.parseTimestamp(msg.timestamp, siteConfig);
      }

      // Smart fallback for timestamp:
      // If we couldn't parse the timestamp, estimate based on message position
      // (assuming messages are in reverse chronological order - newest first)
      let finalTimestamp = parsedTimestamp;
      if (!finalTimestamp) {
        // Estimate: newer messages were likely sent in the last few hours
        // Each message without timestamp gets estimated as progressively older
        const estimatedMinutesAgo = index * 30; // 30 minutes between messages
        const estimatedDate = new Date();
        estimatedDate.setMinutes(estimatedDate.getMinutes() - estimatedMinutesAgo);
        finalTimestamp = estimatedDate.toISOString();

        console.warn(
          `[WebScraper] No timestamp for message from ${msg.sender}, estimated as ${estimatedMinutesAgo}m ago`
        );
      }

      const messageFormat = (
        siteConfig as SiteConfig & { messageFormat?: { platform?: string; subject?: string } }
      ).messageFormat;

      return {
        platform: messageFormat?.platform || `custom-${siteConfig.id}`,
        from: msg.sender || siteConfig.name,
        subject: messageFormat?.subject || siteConfig.name,
        body: msg.content,
        timestamp: finalTimestamp,
        originalTimestamp: msg.timestamp || null, // Preserve original timestamp string
        snippet: msg.content.substring(0, 200),
        source: siteConfig.id,
        sourceUrl: siteConfig.url,
        scrapedAt, // When we retrieved this message
      };
    });
  }

  /**
   * Parse timestamp string to ISO format
   * @param timestampStr - Timestamp string from page
   * @param siteConfig - Site configuration
   * @returns ISO timestamp or null if unparseable
   */
  private parseTimestamp(timestampStr: string, siteConfig: SiteConfig): string | null {
    try {
      if (!timestampStr || timestampStr === 'null') {
        return null;
      }

      const now = new Date();
      const cleanedStr = timestampStr.trim().toLowerCase();

      // Try direct parsing first (handles ISO dates, "Feb 15 2026", etc.)
      const directDate = new Date(timestampStr);
      if (!isNaN(directDate.getTime()) && directDate.getFullYear() > 2000) {
        return directDate.toISOString();
      }

      // Handle relative times
      interface RelativePattern {
        pattern: RegExp;
        unit: 'minutes' | 'hours' | 'days' | 'weeks';
        value?: number;
      }

      const relativePatterns: RelativePattern[] = [
        // Minutes
        { pattern: /(\d+)\s*minutes?\s*ago/i, unit: 'minutes' },
        { pattern: /(\d+)m\s*ago/i, unit: 'minutes' },

        // Hours
        { pattern: /(\d+)\s*hours?\s*ago/i, unit: 'hours' },
        { pattern: /(\d+)h\s*ago/i, unit: 'hours' },

        // Days
        { pattern: /(\d+)\s*days?\s*ago/i, unit: 'days' },
        { pattern: /(\d+)d\s*ago/i, unit: 'days' },

        // Weeks
        { pattern: /(\d+)\s*weeks?\s*ago/i, unit: 'weeks' },
        { pattern: /last\s*week/i, unit: 'weeks', value: 1 },

        // Common keywords
        { pattern: /^yesterday$/i, unit: 'days', value: 1 },
        { pattern: /^today$/i, unit: 'days', value: 0 },
        { pattern: /^just\s*now$/i, unit: 'minutes', value: 0 },
      ];

      for (const { pattern, unit, value } of relativePatterns) {
        const match = cleanedStr.match(pattern);
        if (match) {
          const amount = value !== undefined ? value : parseInt(match[1]);
          const date = new Date();

          switch (unit) {
            case 'minutes':
              date.setMinutes(date.getMinutes() - amount);
              break;
            case 'hours':
              date.setHours(date.getHours() - amount);
              break;
            case 'days':
              date.setDate(date.getDate() - amount);
              break;
            case 'weeks':
              date.setDate(date.getDate() - amount * 7);
              break;
          }

          return date.toISOString();
        }
      }

      // Handle day names (Monday, Tuesday, etc.)
      const dayNames = [
        'sunday',
        'monday',
        'tuesday',
        'wednesday',
        'thursday',
        'friday',
        'saturday',
      ];
      for (let i = 0; i < dayNames.length; i++) {
        if (cleanedStr.includes(dayNames[i])) {
          const today = now.getDay();
          let daysAgo = today - i;
          if (daysAgo <= 0) daysAgo += 7; // Last week if day hasn't occurred yet this week

          const date = new Date();
          date.setDate(date.getDate() - daysAgo);

          // If timestamp includes time (e.g., "Monday at 2:30 PM"), try to parse it
          const timeMatch = timestampStr.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
          if (timeMatch) {
            let hours = parseInt(timeMatch[1]);
            const minutes = parseInt(timeMatch[2]);
            const isPM = timeMatch[3]?.toLowerCase() === 'pm';

            if (isPM && hours < 12) hours += 12;
            if (!isPM && hours === 12) hours = 0;

            date.setHours(hours, minutes, 0, 0);
          }

          return date.toISOString();
        }
      }

      // Handle time-only formats (e.g., "2:30 PM" - assume today)
      const timeOnlyMatch = timestampStr.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
      if (timeOnlyMatch) {
        const date = new Date();
        let hours = parseInt(timeOnlyMatch[1]);
        const minutes = parseInt(timeOnlyMatch[2]);
        const isPM = timeOnlyMatch[3]?.toLowerCase() === 'pm';

        if (isPM && hours < 12) hours += 12;
        if (!isPM && hours === 12) hours = 0;

        date.setHours(hours, minutes, 0, 0);
        return date.toISOString();
      }

      // Handle date + time with separator (e.g., "Feb 9 • 3:12 PM", "Feb 9 - 3:12 PM")
      const dateTimeMatch = timestampStr.match(
        /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})\s*[•\-–—:]\s*(\d{1,2}):(\d{2})\s*(am|pm)?/i
      );
      if (dateTimeMatch) {
        const monthStr = dateTimeMatch[1];
        const day = parseInt(dateTimeMatch[2]);
        let hours = parseInt(dateTimeMatch[3]);
        const minutes = parseInt(dateTimeMatch[4]);
        const isPM = dateTimeMatch[5]?.toLowerCase() === 'pm';

        // Convert 12-hour to 24-hour format
        if (isPM && hours < 12) hours += 12;
        if (!isPM && hours === 12) hours = 0;

        // Parse month name
        const monthNames = [
          'jan',
          'feb',
          'mar',
          'apr',
          'may',
          'jun',
          'jul',
          'aug',
          'sep',
          'oct',
          'nov',
          'dec',
        ];
        const month = monthNames.findIndex((m) => monthStr.toLowerCase().startsWith(m));

        if (month !== -1) {
          const date = new Date(now.getFullYear(), month, day, hours, minutes, 0, 0);

          // If date is in the future, assume it was last year
          if (date > now) {
            date.setFullYear(now.getFullYear() - 1);
          }

          return date.toISOString();
        }
      }

      // Handle short date formats (e.g., "Feb 15", "2/15", "15 Feb")
      const shortDatePatterns = [
        // Month name + day (e.g., "Feb 15")
        /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})\b/i,
        // Day + month name (e.g., "15 Feb")
        /\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i,
        // Numeric format (e.g., "2/15", "02/15/26")
        /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/,
      ];

      for (const pattern of shortDatePatterns) {
        const match = timestampStr.match(pattern);
        if (match) {
          try {
            // Try to construct a date
            const testDate = new Date(timestampStr + ' ' + now.getFullYear());
            if (!isNaN(testDate.getTime())) {
              // If date is in the future, assume it was last year
              if (testDate > now) {
                testDate.setFullYear(now.getFullYear() - 1);
              }
              return testDate.toISOString();
            }
          } catch (e) {
            // Continue to next pattern
          }
        }
      }

      // If we get here, we couldn't parse it
      console.warn(`[WebScraper] Could not parse timestamp: "${timestampStr}"`);
      return null;
    } catch (error) {
      const err = error as Error;
      console.warn(`[WebScraper] Failed to parse timestamp "${timestampStr}":`, err);
      return null;
    }
  }

  /**
   * Get credentials for the site
   * SECURITY: Credentials retrieved from encrypted local storage ONLY
   * NEVER sent to LLMs - only used for local browser automation
   *
   * @param siteConfig - Site configuration
   * @returns Credentials object
   */
  private async getCredentials(siteConfig: SiteConfig): Promise<Credentials> {
    // Use the WebScraperCredentialService to retrieve credentials securely
    const { WebScraperCredentialService } = await import('../services/webscraper-credentials');

    const result = await WebScraperCredentialService.getCredentialsForAutomation(
      this.username,
      siteConfig.credentialDomain
    );

    if (!result.ok || !result.credential) {
      throw new Error(
        `No credentials found for ${siteConfig.credentialDomain}. ` +
          `Please add credentials in Settings > Credentials or during site configuration.`
      );
    }

    console.warn(
      `[WebScraper] Retrieved credentials for ${siteConfig.credentialDomain} (local use only, never sent to LLM)`
    );

    return {
      username: result.credential.username,
      password: result.credential.password,
    };
  }
}

export default WebScraper;
