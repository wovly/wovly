/**
 * OAuth Login Handler
 *
 * Provides manual login flow for OAuth-based websites.
 * Opens headful browser, waits for user to complete login,
 * then captures and saves session cookies.
 */

import type { Page } from 'puppeteer-core';
import { saveSession } from './session-manager';
import type { SiteConfig } from './config-manager';

// ─────────────────────────────────────────────────────────────────────────
// Type Definitions
// ─────────────────────────────────────────────────────────────────────────

export interface OAuthConfig {
  successDetectionSelector?: string;
  loginDetectionSelector?: string;
}

export interface LoginOptions {
  timeout?: number;
}

export interface LoginResult {
  success: boolean;
  message?: string;
  sessionSaved?: boolean;
  error?: string;
}

export interface BrowserController {
  newPage(options: { headless: boolean; sessionId: string }): Promise<Page>;
}

// ─────────────────────────────────────────────────────────────────────────
// OAuth Login Handler
// ─────────────────────────────────────────────────────────────────────────

export class OAuthLoginHandler {
  private browser: BrowserController;
  private username: string;

  constructor(browserController: BrowserController, username: string) {
    this.browser = browserController;
    this.username = username;
  }

  /**
   * Launch manual OAuth login flow
   * @param siteConfig - Site configuration
   * @param options - Login options
   * @returns Login result
   */
  async launchManualLogin(
    siteConfig: SiteConfig,
    options: LoginOptions = {}
  ): Promise<LoginResult> {
    console.warn(`[OAuthLogin] Starting manual login for ${siteConfig.name}`);

    const page = await this.browser.newPage({
      headless: false, // IMPORTANT: visible browser for user
      sessionId: `oauth-login-${siteConfig.id}-${Date.now()}`,
    });

    try {
      // Navigate to login URL
      console.warn(`[OAuthLogin] Navigating to ${siteConfig.url}`);
      await page.goto(siteConfig.url, { waitUntil: 'networkidle0', timeout: 30000 });

      // Wait for page to stabilize
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Inject instruction overlay
      await this.injectInstructionOverlay(page, siteConfig);

      // Wait for user to complete login
      const loginSuccess = await this.waitForLoginCompletion(
        page,
        siteConfig,
        options.timeout || 300000
      );

      if (!loginSuccess) {
        throw new Error('Login timeout or cancelled by user');
      }

      // Save session cookies
      console.warn(`[OAuthLogin] Saving session cookies`);
      await saveSession(page, this.username, siteConfig.id);

      // Verify we're actually logged in
      const isLoggedIn = await this.verifyLoginSuccess(page, siteConfig);
      if (!isLoggedIn) {
        throw new Error('Login verification failed');
      }

      console.warn(`[OAuthLogin] Manual login successful for ${siteConfig.name}`);

      return {
        success: true,
        message: 'Login successful, session saved',
        sessionSaved: true,
      };
    } catch (error) {
      const err = error as Error;
      console.error(`[OAuthLogin] Login failed:`, err);
      return {
        success: false,
        error: err.message,
      };
    } finally {
      // Don't close page immediately - let user see success message
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await page.close().catch(() => {
        // Ignore close errors
      });
    }
  }

  /**
   * Inject instruction overlay into page
   * @param page - Puppeteer page
   * @param siteConfig - Site configuration
   */
  private async injectInstructionOverlay(page: Page, siteConfig: SiteConfig): Promise<void> {
    await page.evaluate((siteName: any) => {
      // @ts-expect-error - document available in browser context
      const overlay = document.createElement('div');
      overlay.id = 'wovly-oauth-instructions';
      overlay.innerHTML = `
        <div style="
          position: fixed;
          top: 20px;
          right: 20px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 20px;
          border-radius: 12px;
          box-shadow: 0 10px 40px rgba(0,0,0,0.3);
          z-index: 999999;
          max-width: 350px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        ">
          <div style="font-size: 18px; font-weight: 600; margin-bottom: 12px;">
            🔐 Setting up ${siteName}
          </div>
          <div style="font-size: 14px; line-height: 1.6; margin-bottom: 16px;">
            Please complete the login process:
            <ul style="margin: 8px 0; padding-left: 20px;">
              <li>Click "Sign in with Google" (or other OAuth)</li>
              <li>Enter your credentials</li>
              <li>Complete any 2FA verification</li>
            </ul>
          </div>
          <div style="
            background: rgba(255,255,255,0.2);
            padding: 12px;
            border-radius: 8px;
            font-size: 13px;
          ">
            ℹ️ Your session will be saved automatically once you're logged in.
          </div>
          <button
            id="wovly-oauth-done"
            style="
              margin-top: 16px;
              width: 100%;
              padding: 12px;
              background: white;
              color: #667eea;
              border: none;
              border-radius: 8px;
              font-weight: 600;
              cursor: pointer;
              font-size: 14px;
            "
          >
            I'm Logged In - Continue
          </button>
          <button
            id="wovly-oauth-cancel"
            style="
              margin-top: 8px;
              width: 100%;
              padding: 10px;
              background: transparent;
              color: white;
              border: 1px solid rgba(255,255,255,0.3);
              border-radius: 8px;
              cursor: pointer;
              font-size: 13px;
            "
          >
            Cancel
          </button>
        </div>
      `;
      // @ts-expect-error - document available in browser context
      document.body.appendChild(overlay);
    }, siteConfig.name);

    // Expose functions for user interaction
    await page.exposeFunction('wovlyOAuthDone', () => {
      console.warn('[OAuthLogin] User confirmed login completion');
    });

    await page.exposeFunction('wovlyOAuthCancel', () => {
      console.warn('[OAuthLogin] User cancelled login');
    });

    // Attach event listeners (browser context code)

    await page.evaluate(() => {
      // @ts-expect-error - document and window available in browser context
      document.getElementById('wovly-oauth-done')?.addEventListener('click', () => {
        // @ts-expect-error - window.wovlyOAuthDone exposed by page.exposeFunction
        window.wovlyOAuthDone();
        // @ts-expect-error - document available in browser context
        document.getElementById('wovly-oauth-instructions').remove();
      });

      // @ts-expect-error - document and window available in browser context
      document.getElementById('wovly-oauth-cancel')?.addEventListener('click', () => {
        // @ts-expect-error - window.wovlyOAuthCancel exposed by page.exposeFunction
        window.wovlyOAuthCancel();
        // @ts-expect-error - window available in browser context
        window.close();
      });
    });
  }

  /**
   * Wait for user to complete login
   * @param page - Puppeteer page
   * @param siteConfig - Site configuration
   * @param timeout - Max wait time in milliseconds
   * @returns True if login completed
   */
  private async waitForLoginCompletion(
    page: Page,
    siteConfig: SiteConfig,
    timeout: number = 300000
  ): Promise<boolean> {
    const startTime = Date.now();

    return new Promise((resolve) => {
      // Check every 2 seconds if login is complete
      const checkInterval = setInterval(async () => {
        const elapsed = Date.now() - startTime;

        // Timeout check
        if (elapsed > timeout) {
          clearInterval(checkInterval);
          resolve(false);
          return;
        }

        // Check if page is closed (user cancelled)
        if (page.isClosed()) {
          clearInterval(checkInterval);
          resolve(false);
          return;
        }

        // Check if login successful
        const loggedIn = await this.verifyLoginSuccess(page, siteConfig);
        if (loggedIn) {
          clearInterval(checkInterval);
          resolve(true);
          return;
        }
      }, 2000);
    });
  }

  /**
   * Verify login was successful
   * @param page - Puppeteer page
   * @param siteConfig - Site configuration
   * @returns True if logged in
   */
  private async verifyLoginSuccess(page: Page, siteConfig: SiteConfig): Promise<boolean> {
    try {
      // Method 1: Check for success indicator
      if (siteConfig.selectors.oauth?.successDetectionSelector) {
        const successElement = await page.$(siteConfig.selectors.oauth.successDetectionSelector);
        if (successElement) {
          return true;
        }
      }

      // Method 2: Check that login page elements are gone
      if (siteConfig.selectors.oauth?.loginDetectionSelector) {
        const loginElement = await page.$(siteConfig.selectors.oauth.loginDetectionSelector);
        if (!loginElement) {
          // Login page gone = likely logged in
          return true;
        }
      }

      // Method 3: Check URL changed from login page
      const currentUrl = page.url();
      if (siteConfig.url && !currentUrl.includes('login') && !currentUrl.includes('signin')) {
        return true;
      }

      return false;
    } catch (error) {
      console.error('[OAuthLogin] Error verifying login:', error);
      return false;
    }
  }
}

export default OAuthLoginHandler;
