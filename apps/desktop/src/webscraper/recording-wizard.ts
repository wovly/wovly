/**
 * Recording-Based Website Integration Wizard
 *
 * A flexible approach that records user actions naturally instead of rigid step-by-step wizard.
 * The system watches what the user does and learns the flow automatically.
 */

import type { Page } from 'puppeteer-core';
import { saveSession } from './session-manager';
import type { SiteConfig } from './config-manager';

// ─────────────────────────────────────────────────────────────────────────
// Type Definitions
// ─────────────────────────────────────────────────────────────────────────

export interface RecordedAction {
  type: 'click' | 'type' | 'navigate' | 'wait' | 'select_content' | '2fa';
  timestamp: number;
  selector?: string;
  value?: string;
  url?: string;
  description?: string;
  isUsernameField?: boolean;
  isPasswordField?: boolean;
  is2FAField?: boolean;
  twoFactorMethod?: 'sms' | 'email' | 'authenticator' | 'unknown';
  twoFactorTarget?: string; // Phone number or email address shown
}

export interface RecordingSession {
  url: string;
  username: string;
  password: string;
  actions: RecordedAction[];
  contentSelector?: string;
  messageSelectors?: {
    container: string;
    item: string;
    sender?: string;
    content?: string;
    timestamp?: string;
  };
  selectors?: any; // Traditional selector format for scraper compatibility
  twoFactorAuth?: {
    enabled: boolean;
    method?: 'sms' | 'email' | 'authenticator' | 'unknown';
    target?: string; // Phone number or email shown to user
    codeLength?: number;
  };
}

export interface BrowserController {
  getPage(sessionId: string): Promise<Page>;
}

export interface RecordingResult {
  success: boolean;
  session?: RecordingSession;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Recording Wizard
// ─────────────────────────────────────────────────────────────────────────

export class RecordingWizard {
  private browser: BrowserController;
  private appUsername: string;
  private apiKey: string = '';

  constructor(browserController: BrowserController, appUsername: string) {
    this.browser = browserController;
    this.appUsername = appUsername;
  }

  /**
   * Launch interactive recording session
   * User logs in naturally, system records the flow
   */
  async startRecording(
    url: string,
    username: string,
    password: string,
    siteName: string,
    apiKey?: string
  ): Promise<RecordingResult> {
    console.log('[RecordingWizard] Starting recording session');

    const sessionId = `recording-${siteName}-${Date.now()}`;
    const page = await this.browser.getPage(sessionId);

    const recordingSession: RecordingSession = {
      url,
      username,
      password,
      actions: [],
    };

    // Store API key for later use
    this.apiKey = apiKey || '';

    try {
      // Navigate to URL
      console.log(`[RecordingWizard] Navigating to ${url}`);
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

      // Wait for page to stabilize
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // IMPORTANT: Set up event listeners FIRST before showing overlay
      // This ensures we're ready to record before user starts interacting
      await this.setupActionRecording(page, recordingSession);

      // Now inject instruction overlay
      await this.injectRecordingOverlay(page, siteName, username, password);

      // Re-inject overlay on page navigation to keep banner visible
      page.on('load', async () => {
        console.log('[RecordingWizard] Page reloaded/navigated, re-injecting overlay');
        await new Promise((resolve) => setTimeout(resolve, 500)); // Wait for page to stabilize
        await this.injectRecordingOverlay(page, siteName, username, password);
      });

      // Wait for user to complete the flow
      const result = await this.waitForCompletion(page);

      if (!result.success) {
        throw new Error(result.error || 'Recording cancelled');
      }

      // Use AI to automatically detect message selectors on the final page
      if (this.apiKey) {
        console.log('[RecordingWizard] Analyzing page with AI to extract message selectors...');
        try {
          const selectors = await this.analyzePageWithAI(page, this.apiKey);
          // Only use selectors if we have at least container and item (required fields)
          if (selectors && selectors.container && selectors.item) {
            recordingSession.messageSelectors = {
              container: selectors.container,
              item: selectors.item,
              sender: selectors.sender,
              content: selectors.content,
              timestamp: selectors.timestamp,
            };
            console.log('[RecordingWizard] AI successfully extracted message selectors');
          } else {
            console.log(
              '[RecordingWizard] AI could not find valid message selectors - user may need to configure manually'
            );
          }
        } catch (err: any) {
          console.error('[RecordingWizard] AI analysis error:', err.message);
          // Continue anyway - selectors can be configured manually later
        }
      } else {
        console.log('[RecordingWizard] No API key provided - skipping AI analysis');
      }

      // Save session cookies
      await saveSession(page, this.appUsername, siteName);

      console.log(
        `[RecordingWizard] Recording complete with ${recordingSession.actions.length} actions`
      );

      // Convert recorded actions to traditional selector format for compatibility
      const selectors = this.convertActionsToSelectors(recordingSession);

      return {
        success: true,
        session: {
          ...recordingSession,
          selectors, // Add traditional selectors for scraper compatibility
        },
      };
    } catch (error) {
      const err = error as Error;
      console.error('[RecordingWizard] Recording failed:', err);
      return {
        success: false,
        error: err.message,
      };
    } finally {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await page.close().catch(() => {});
    }
  }

  /**
   * Inject recording overlay with natural instructions
   */
  private async injectRecordingOverlay(
    page: Page,
    siteName: string,
    username: string,
    password: string
  ): Promise<void> {
    await page.evaluate(
      (siteName: string, displayUsername: string) => {
        // Recording banner
        // @ts-expect-error - document available in browser context
        const banner = document.createElement('div');
        banner.id = 'wovly-recording-banner';
        banner.innerHTML = `
          <div style="
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 15px 20px;
            z-index: 999999;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            box-shadow: 0 2px 10px rgba(0,0,0,0.2);
            display: flex;
            align-items: center;
            justify-content: space-between;
          ">
            <div style="display: flex; align-items: center; gap: 15px;">
              <div style="
                width: 12px;
                height: 12px;
                background: #ff4444;
                border-radius: 50%;
                animation: pulse 2s infinite;
              "></div>
              <style>
                @keyframes pulse {
                  0%, 100% { opacity: 1; transform: scale(1); }
                  50% { opacity: 0.5; transform: scale(1.1); }
                }
              </style>
              <div>
                <div style="font-weight: 600; font-size: 16px;">● RECORDING - Start Login Now</div>
                <div style="font-size: 12px; opacity: 0.9;">Login to ${siteName} - Wovly is recording your steps</div>
              </div>
            </div>
            <div style="display: flex; gap: 10px;">
              <button id="wovly-done-recording" style="
                padding: 8px 20px;
                background: white;
                color: #667eea;
                border: none;
                border-radius: 6px;
                font-weight: 600;
                cursor: pointer;
                font-size: 13px;
              ">
                ✓ Done
              </button>
              <button id="wovly-cancel-recording" style="
                padding: 8px 20px;
                background: transparent;
                color: white;
                border: 1px solid rgba(255,255,255,0.3);
                border-radius: 6px;
                font-weight: 600;
                cursor: pointer;
                font-size: 13px;
              ">
                Cancel
              </button>
            </div>
          </div>
        `;

        // Instructions panel
        // @ts-expect-error - document available in browser context
        const instructions = document.createElement('div');
        instructions.id = 'wovly-instructions';
        instructions.innerHTML = `
          <div style="
            position: fixed;
            top: 70px;
            right: 20px;
            background: white;
            color: #333;
            padding: 20px;
            border-radius: 12px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
            z-index: 999998;
            max-width: 350px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          ">
            <h3 style="margin: 0 0 15px 0; font-size: 16px; color: #667eea;">
              🎯 Just Use The Website Normally
            </h3>

            <div style="font-size: 14px; line-height: 1.6; color: #555;">
              <p style="margin: 0 0 12px 0;">
                <strong>1. Log in naturally</strong><br>
                • Enter your username: <code style="background: #f5f5f5; padding: 2px 6px; border-radius: 3px;">${displayUsername}</code><br>
                • Enter your password<br>
                • Click through any pages/buttons<br>
                • Complete 2FA if needed
              </p>

              <p style="margin: 0 0 12px 0;">
                <strong>2. Navigate to your messages</strong><br>
                • Go to the section with the data you want<br>
                • Click through menus as you normally would
              </p>

              <p style="margin: 0 0 12px 0;">
                <strong>3. Navigate to your messages</strong><br>
                • Click through to the page with your messages<br>
                • AI will automatically detect what to scrape
              </p>

              <p style="margin: 0; background: #f0f7ff; padding: 12px; border-radius: 6px; border-left: 3px solid #667eea;">
                <strong>💡 Behind the scenes:</strong><br>
                Wovly is recording your actions and will automatically detect where you entered your username and password.
              </p>
            </div>

            <button id="wovly-finish-setup" style="
              margin-top: 15px;
              width: 100%;
              padding: 12px;
              background: #667eea;
              color: white;
              border: none;
              border-radius: 8px;
              font-weight: 600;
              cursor: pointer;
              font-size: 14px;
            ">
              I've Selected Content - Finish Setup
            </button>
          </div>
        `;

        // @ts-expect-error - document available in browser context
        document.body.insertBefore(banner, document.body.firstChild);
        // @ts-expect-error - document available in browser context
        document.body.appendChild(instructions);
      },
      siteName,
      username
    );

    // Expose control functions (check if already exposed to avoid errors on page navigation)
    try {
      await page.exposeFunction('wovlyFinishRecording', () => {
        console.log('[RecordingWizard] User finished recording');
      });
    } catch (err: any) {
      // Function already exposed - this is fine when re-injecting overlay
      if (!err.message?.includes('already exists')) {
        throw err;
      }
    }

    try {
      await page.exposeFunction('wovlyCancelRecording', () => {
        console.log('[RecordingWizard] User cancelled recording');
      });
    } catch (err: any) {
      // Function already exposed - this is fine when re-injecting overlay
      if (!err.message?.includes('already exists')) {
        throw err;
      }
    }

    // Attach event listeners
    await page.evaluate(() => {
      // @ts-expect-error - document available in browser context
      document.getElementById('wovly-done-recording')?.addEventListener('click', () => {
        // @ts-expect-error - window.wovlyFinishRecording exposed
        window.wovlyFinishRecording();
        // @ts-expect-error - Set completion flag
        window.wovlyRecordingDone = true;
      });

      // @ts-expect-error - document available in browser context
      document.getElementById('wovly-finish-setup')?.addEventListener('click', () => {
        // @ts-expect-error - window.wovlyFinishRecording exposed
        window.wovlyFinishRecording();
        // @ts-expect-error - Set completion flag
        window.wovlyRecordingDone = true;
      });

      // @ts-expect-error - document available in browser context
      document.getElementById('wovly-cancel-recording')?.addEventListener('click', () => {
        // @ts-expect-error - window.wovlyCancelRecording exposed
        window.wovlyCancelRecording();
        // @ts-expect-error - window available in browser context
        window.close();
      });
    });
  }

  /**
   * Set up recording of user actions
   */
  private async setupActionRecording(page: Page, session: RecordingSession): Promise<void> {
    // Expose function to record actions from browser context
    await page.exposeFunction('wovlyRecordAction', (action: RecordedAction) => {
      console.log(
        '[RecordingWizard] Recorded action:',
        action.type,
        action.selector,
        action.isUsernameField ? '(USERNAME)' : action.isPasswordField ? '(PASSWORD)' : ''
      );
      session.actions.push(action);

      // If 2FA field detected, update session metadata
      if (action.is2FAField && action.twoFactorMethod) {
        console.log(
          '[RecordingWizard] 2FA detected:',
          action.twoFactorMethod,
          action.twoFactorTarget
        );
        session.twoFactorAuth = {
          enabled: true,
          method: action.twoFactorMethod,
          target: action.twoFactorTarget,
          codeLength: action.value?.length || 6,
        };
      }
    });

    // Inject recording script into page
    await page.evaluateOnNewDocument(
      (username: any, password: any) => {
        // @ts-expect-error - Will be available in browser context
        window.wovlyUsername = username;
        // @ts-expect-error - Will be available in browser context
        window.wovlyPassword = password;

        // Record clicks
        // @ts-expect-error - Browser context code
        document.addEventListener(
          'click',
          (e: any) => {
            const target = e.target as any;

            // Skip if clicking Wovly overlays
            if (target.id?.startsWith('wovly-') || target.closest('[id^="wovly-"]')) {
              return;
            }

            // Generate selector for clicked element
            const selector = generateSelector(target);

            // @ts-expect-error - Exposed function
            window.wovlyRecordAction({
              type: 'click',
              timestamp: Date.now(),
              selector,
              description: `Click ${target.tagName} ${target.textContent?.slice(0, 30) || ''}`,
            });
          },
          true
        );

        // Record typing (and detect username/password/2FA fields)
        // @ts-expect-error - Browser context code
        document.addEventListener(
          'input',
          (e: any) => {
            const target = e.target as any;
            const value = target.value;

            // Skip if not an input
            if (!target.matches('input, textarea')) return;

            const selector = generateSelector(target);

            // Check if this is the username field
            // @ts-expect-error - Will be available
            const isUsernameField = value === window.wovlyUsername;

            // Check if this is the password field
            // @ts-expect-error - Will be available
            const isPasswordField = value === window.wovlyPassword;

            // Detect 2FA fields
            let is2FAField = false;
            let twoFactorMethod: 'sms' | 'email' | 'authenticator' | 'unknown' = 'unknown';
            let twoFactorTarget: string | undefined;

            // Look for 2FA indicators
            const fieldName = (target.name || '').toLowerCase();
            const fieldId = (target.id || '').toLowerCase();
            const fieldPlaceholder = (target.placeholder || '').toLowerCase();
            const fieldType = target.type || '';
            const fieldMaxLength = target.maxLength;

            // Common 2FA field patterns
            const twoFactorPatterns = [
              'code',
              'verification',
              'verify',
              '2fa',
              'two-factor',
              'authenticator',
              'otp',
              'token',
              'security',
              'mfa',
              'multi-factor',
            ];

            const is2FAFieldName = twoFactorPatterns.some(
              (pattern: string) =>
                fieldName.includes(pattern) ||
                fieldId.includes(pattern) ||
                fieldPlaceholder.includes(pattern)
            );

            // Also check if it's a numeric field with 6-8 character limit (typical for codes)
            const looksLike2FACode =
              (fieldType === 'text' || fieldType === 'tel' || fieldType === 'number') &&
              fieldMaxLength >= 4 &&
              fieldMaxLength <= 8;

            if (is2FAFieldName || looksLike2FACode) {
              is2FAField = true;

              // Try to detect the method by looking at page content
              // @ts-expect-error - Browser context
              const pageText = document.body?.innerText || '';
              const pageTextLower = pageText.toLowerCase();

              // Check for SMS indicators (expanded patterns)
              if (
                pageTextLower.match(
                  /sent.*text|sent.*sms|text.*message|mobile.*phone|phone.*\d{3}/
                ) ||
                pageTextLower.includes('text you') ||
                pageTextLower.includes('texted') ||
                pageTextLower.includes('sms code')
              ) {
                twoFactorMethod = 'sms';
                // Try to extract phone number (various formats)
                const phoneMatch = pageText.match(/(\d{3})[^\d]*(\d{3})[^\d]*(\d{4})/);
                if (phoneMatch) {
                  twoFactorTarget = `***-***-${phoneMatch[3]}`;
                }
              }
              // Check for email indicators (expanded patterns)
              else if (
                pageTextLower.match(/sent.*email|check.*email|email.*@|emailed|e-mail/) ||
                pageTextLower.includes('check your inbox') ||
                pageTextLower.includes('sent you an email')
              ) {
                twoFactorMethod = 'email';
                // Try to extract email
                const emailMatch = pageText.match(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i);
                if (emailMatch) {
                  const email = emailMatch[0];
                  // Mask email for privacy
                  const parts = email.split('@');
                  twoFactorTarget = `${parts[0].slice(0, 2)}***@${parts[1]}`;
                }
              }
              // Check for authenticator app (expanded patterns)
              else if (
                pageTextLower.match(
                  /authenticator|authentication app|google authenticator|authy|totp|time-based/
                ) ||
                pageTextLower.includes('auth app') ||
                pageTextLower.includes('authenticator app')
              ) {
                twoFactorMethod = 'authenticator';
              }

              console.log('[2FA Detected]', {
                method: twoFactorMethod,
                target: twoFactorTarget,
                fieldName,
                fieldId,
                pageTextSample: pageTextLower.slice(0, 200), // Log first 200 chars for debugging
              });
            }

            // @ts-expect-error - Exposed function
            window.wovlyRecordAction({
              type: 'type',
              timestamp: Date.now(),
              selector,
              value: isUsernameField || isPasswordField || is2FAField ? '***' : value.slice(0, 20),
              isUsernameField,
              isPasswordField,
              is2FAField,
              twoFactorMethod: is2FAField ? twoFactorMethod : undefined,
              twoFactorTarget: is2FAField ? twoFactorTarget : undefined,
              description: isUsernameField
                ? 'Enter username'
                : isPasswordField
                  ? 'Enter password'
                  : is2FAField
                    ? `Enter 2FA code (${twoFactorMethod})`
                    : 'Type text',
            });
          },
          true
        );

        // Record Shift+Click for content selection
        // @ts-expect-error - Browser context code
        document.addEventListener(
          'click',
          (e: any) => {
            if (!e.shiftKey) return;

            e.preventDefault();
            e.stopPropagation();

            const target = e.target as any;
            const selector = generateSelector(target);

            console.log('[RecordingWizard] Content selected:', selector);

            // @ts-expect-error - Exposed function
            window.wovlyRecordAction({
              type: 'select_content',
              timestamp: Date.now(),
              selector,
              description: 'Selected content to extract',
            });

            // Highlight the selected element
            target.style.outline = '3px solid #667eea';
            target.style.background = 'rgba(102, 126, 234, 0.1)';
          },
          true
        );

        // Helper to generate CSS selector for an element
        function generateSelector(element: any): string {
          if (element.id) {
            return `#${element.id}`;
          }

          const path: string[] = [];
          let current: any = element;

          while (current && current.tagName !== 'BODY') {
            let selector = current.tagName.toLowerCase();

            if (current.className) {
              const classes = current.className
                .split(' ')
                .filter((c: any) => c && !c.startsWith('wovly-'));
              if (classes.length > 0) {
                selector += '.' + classes.join('.');
              }
            }

            // Add nth-child if needed
            if (current.parentElement) {
              const siblings = Array.from(current.parentElement.children);
              const index = siblings.indexOf(current) + 1;
              if (siblings.length > 1) {
                selector += `:nth-child(${index})`;
              }
            }

            path.unshift(selector);
            current = current.parentElement;
          }

          return path.join(' > ');
        }
      },
      session.username,
      session.password
    );

    // CRITICAL: Also inject into the CURRENT page (evaluateOnNewDocument only works for NEW pages)
    // This ensures the event listeners work even if user is already on the login page
    console.log('[RecordingWizard] Injecting event listeners into current page');
    await page.evaluate(
      (username: string, password: string) => {
        // @ts-expect-error - Will be available in browser context
        window.wovlyUsername = username;
        // @ts-expect-error - Will be available in browser context
        window.wovlyPassword = password;

        console.log('[RecordingWizard] Setting up event listeners on current page');

        // Set up ALL event listeners on current page (same as evaluateOnNewDocument)
        // @ts-expect-error - Browser context code
        document.addEventListener(
          'click',
          (e: any) => {
            const target = e.target as any;

            // Skip if clicking Wovly overlays
            if (target.id?.startsWith('wovly-') || target.closest('[id^="wovly-"]')) {
              return;
            }

            // Generate selector for clicked element
            const generateSelector = (element: any): string => {
              if (element.id) {
                return `#${element.id}`;
              }

              const path: string[] = [];
              let current: any = element;

              while (current && current.tagName !== 'BODY') {
                let selector = current.tagName.toLowerCase();

                if (current.className) {
                  const classes = current.className
                    .split(' ')
                    .filter((c: any) => c && !c.startsWith('wovly-'));
                  if (classes.length > 0) {
                    selector += '.' + classes.join('.');
                  }
                }

                // Add nth-child if needed
                if (current.parentElement) {
                  const siblings = Array.from(current.parentElement.children);
                  const index = siblings.indexOf(current) + 1;
                  if (siblings.length > 1) {
                    selector += `:nth-child(${index})`;
                  }
                }

                path.unshift(selector);
                current = current.parentElement;
              }

              return path.join(' > ');
            };

            const selector = generateSelector(target);

            // @ts-expect-error - Exposed function
            window.wovlyRecordAction({
              type: 'click',
              timestamp: Date.now(),
              selector,
              description: `Click ${target.tagName} ${target.textContent?.slice(0, 30) || ''}`,
            });
          },
          true
        );

        // Record typing (and detect username/password/2FA fields)
        // @ts-expect-error - Browser context code
        document.addEventListener(
          'input',
          (e: any) => {
            const target = e.target as any;
            const value = target.value;

            // Skip if not an input
            if (!target.matches('input, textarea')) return;

            // Generate selector
            const generateSelector = (element: any): string => {
              if (element.id) {
                return `#${element.id}`;
              }

              const path: string[] = [];
              let current: any = element;

              while (current && current.tagName !== 'BODY') {
                let selector = current.tagName.toLowerCase();

                if (current.className) {
                  const classes = current.className
                    .split(' ')
                    .filter((c: any) => c && !c.startsWith('wovly-'));
                  if (classes.length > 0) {
                    selector += '.' + classes.join('.');
                  }
                }

                if (current.parentElement) {
                  const siblings = Array.from(current.parentElement.children);
                  const index = siblings.indexOf(current) + 1;
                  if (siblings.length > 1) {
                    selector += `:nth-child(${index})`;
                  }
                }

                path.unshift(selector);
                current = current.parentElement;
              }

              return path.join(' > ');
            };

            const selector = generateSelector(target);

            // Check if this is the username field
            // @ts-expect-error - Will be available
            const isUsernameField = value === window.wovlyUsername;

            // Check if this is the password field
            // @ts-expect-error - Will be available
            const isPasswordField = value === window.wovlyPassword;

            // Detect 2FA fields
            let is2FAField = false;
            let twoFactorMethod: 'sms' | 'email' | 'authenticator' | 'unknown' = 'unknown';
            let twoFactorTarget: string | undefined;

            // Look for 2FA indicators
            const fieldName = (target.name || '').toLowerCase();
            const fieldId = (target.id || '').toLowerCase();
            const fieldPlaceholder = (target.placeholder || '').toLowerCase();
            const fieldType = target.type || '';
            const fieldMaxLength = target.maxLength;

            // Common 2FA field patterns
            const twoFactorPatterns = [
              'code',
              'verification',
              'verify',
              '2fa',
              'two-factor',
              'authenticator',
              'otp',
              'token',
              'security',
              'mfa',
              'multi-factor',
            ];

            const is2FAFieldName = twoFactorPatterns.some(
              (pattern: string) =>
                fieldName.includes(pattern) ||
                fieldId.includes(pattern) ||
                fieldPlaceholder.includes(pattern)
            );

            // Also check if it's a numeric field with 6-8 character limit (typical for codes)
            const looksLike2FACode =
              (fieldType === 'text' || fieldType === 'tel' || fieldType === 'number') &&
              fieldMaxLength >= 4 &&
              fieldMaxLength <= 8;

            if (is2FAFieldName || looksLike2FACode) {
              is2FAField = true;

              // Try to detect the method by looking at page content
              // @ts-expect-error - Browser context
              const pageText = document.body?.innerText || '';
              const pageTextLower = pageText.toLowerCase();

              // Check for SMS indicators
              if (
                pageTextLower.match(
                  /sent.*text|sent.*sms|text.*message|mobile.*phone|phone.*\d{3}/
                ) ||
                pageTextLower.includes('text you') ||
                pageTextLower.includes('texted') ||
                pageTextLower.includes('sms code')
              ) {
                twoFactorMethod = 'sms';
                const phoneMatch = pageText.match(/(\d{3})[^\d]*(\d{3})[^\d]*(\d{4})/);
                if (phoneMatch) {
                  twoFactorTarget = `***-***-${phoneMatch[3]}`;
                }
              }
              // Check for email indicators
              else if (
                pageTextLower.match(/sent.*email|check.*email|email.*@|emailed|e-mail/) ||
                pageTextLower.includes('check your inbox') ||
                pageTextLower.includes('sent you an email')
              ) {
                twoFactorMethod = 'email';
                const emailMatch = pageText.match(/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i);
                if (emailMatch) {
                  const email = emailMatch[0];
                  const parts = email.split('@');
                  twoFactorTarget = `${parts[0].slice(0, 2)}***@${parts[1]}`;
                }
              }
              // Check for authenticator app
              else if (
                pageTextLower.match(
                  /authenticator|authentication app|google authenticator|authy|totp|time-based/
                ) ||
                pageTextLower.includes('auth app') ||
                pageTextLower.includes('authenticator app')
              ) {
                twoFactorMethod = 'authenticator';
              }

              console.log('[2FA Detected]', {
                method: twoFactorMethod,
                target: twoFactorTarget,
                fieldName,
                fieldId,
              });
            }

            // @ts-expect-error - Exposed function
            window.wovlyRecordAction({
              type: 'type',
              timestamp: Date.now(),
              selector,
              value: isUsernameField || isPasswordField || is2FAField ? '***' : value.slice(0, 20),
              isUsernameField,
              isPasswordField,
              is2FAField,
              twoFactorMethod: is2FAField ? twoFactorMethod : undefined,
              twoFactorTarget: is2FAField ? twoFactorTarget : undefined,
              description: isUsernameField
                ? 'Enter username'
                : isPasswordField
                  ? 'Enter password'
                  : is2FAField
                    ? `Enter 2FA code (${twoFactorMethod})`
                    : 'Type text',
            });
          },
          true
        );
      },
      session.username,
      session.password
    );

    console.log('[RecordingWizard] ✅ Event listeners injected into current page');
  }

  /**
   * Use AI to analyze the current page and extract message selectors
   * Only analyzes visible elements to keep token usage low
   */
  private async analyzePageWithAI(
    page: Page,
    apiKey: string
  ): Promise<{
    container?: string;
    item?: string;
    sender?: string;
    content?: string;
    timestamp?: string;
  }> {
    console.log('[RecordingWizard] Analyzing page with AI to find message selectors...');

    try {
      // Take screenshot (compressed to reduce token usage)
      const screenshot = await page.screenshot({
        encoding: 'base64',
        type: 'jpeg',
        quality: 70,
        fullPage: false, // Only visible viewport
      });

      // Get visible DOM elements only (not entire page)
      const visibleHTML: any = await page.evaluate(() => {
        // Helper to check if element is in viewport and visible
        const isVisible = (el: any): boolean => {
          const rect = el.getBoundingClientRect();
          // @ts-ignore - window exists in browser context
          const vh = window.innerHeight;
          // @ts-ignore - window exists in browser context
          const style1 = window.getComputedStyle(el).display;
          // @ts-ignore - window exists in browser context
          const style2 = window.getComputedStyle(el).visibility;
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            rect.top < vh &&
            rect.bottom > 0 &&
            style1 !== 'none' &&
            style2 !== 'hidden'
          );
        };

        // Get all potentially relevant elements (lists, tables, divs with multiple children)
        const candidates = Array.from(
          // @ts-expect-error - document exists in browser context (page.evaluate)
          document.querySelectorAll(
            'ul, ol, table, div[class*="list"], div[class*="message"], div[class*="item"], div[class*="conversation"]'
          )
        );

        const visibleElements: any[] = [];

        candidates.forEach((el: any) => {
          if (isVisible(el) && el.children.length >= 2) {
            // Get CSS path for this element
            const getPath = (element: any): string => {
              if (element.id) return `#${element.id}`;
              if (element.className && typeof element.className === 'string') {
                const classes = element.className
                  .split(' ')
                  .filter((c: string) => c && !c.match(/^\d/));
                if (classes.length > 0) {
                  return `${element.tagName.toLowerCase()}.${classes.slice(0, 2).join('.')}`;
                }
              }
              return element.tagName.toLowerCase();
            };

            visibleElements.push({
              selector: getPath(el),
              tag: el.tagName.toLowerCase(),
              classes: el.className,
              childCount: el.children.length,
              textSample: el.textContent?.slice(0, 100),
            });
          }
        });

        return {
          elements: visibleElements.slice(0, 20), // Limit to top 20 to reduce tokens
          // @ts-ignore - document exists in browser context
          pageTitle: document.title,
          // @ts-ignore - window exists in browser context
          url: window.location.href,
        };
      });

      // Call Claude API with vision
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-5-20250929', // Use latest Sonnet 4.5 for good balance of speed/accuracy
          max_tokens: 1024,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/jpeg',
                    data: screenshot,
                  },
                },
                {
                  type: 'text',
                  text: `You are analyzing a web page to find MESSAGE/CONVERSATION selectors for scraping.

Page Info:
- Title: ${visibleHTML.pageTitle}
- URL: ${visibleHTML.url}

Visible Elements:
${JSON.stringify(visibleHTML.elements, null, 2)}

TASK: Identify CSS selectors for messages/conversations on this page.

Look for:
1. Container holding the list of messages/items
2. Individual message/item selector
3. Sender/author field (name, email, or username)
4. Message content/body field
5. Timestamp/date field

Return ONLY valid JSON (no markdown, no explanation):
{
  "container": "CSS selector for message list container",
  "item": "CSS selector for individual message (relative to container)",
  "sender": "CSS selector for sender/author field (relative to item)",
  "content": "CSS selector for message content (relative to item)",
  "timestamp": "CSS selector for timestamp (relative to item)"
}

If you cannot find messages, return: {"error": "No messages found"}

IMPORTANT:
- Use simple, robust selectors (prefer classes over complex paths)
- Make selectors relative where indicated
- Only return the JSON object, nothing else`,
                },
              ],
            },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error(`Claude API error: ${response.status}`);
      }

      const data: any = await response.json();
      const content = data.content?.[0]?.text || '';

      // Parse JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error('[RecordingWizard] No JSON found in AI response:', content);
        return {};
      }

      const selectors = JSON.parse(jsonMatch[0]);

      if (selectors.error) {
        console.log('[RecordingWizard] AI could not find messages:', selectors.error);
        return {};
      }

      console.log('[RecordingWizard] AI extracted selectors:', selectors);
      return selectors;
    } catch (err: any) {
      console.error('[RecordingWizard] AI analysis failed:', err.message);
      return {};
    }
  }

  /**
   * Convert recorded actions to traditional selector format for scraper compatibility
   * @param session - Recording session with actions
   * @returns Traditional selector configuration
   */
  private convertActionsToSelectors(session: RecordingSession): any {
    const actions = session.actions;

    // Find login field selectors
    const usernameAction = actions.find((a) => a.isUsernameField);
    const passwordAction = actions.find((a) => a.isPasswordField);
    const twoFactorAction = actions.find((a) => a.is2FAField);

    console.log('[RecordingWizard] Converting actions to selectors:');
    console.log('  Total actions:', actions.length);
    console.log(
      '  Username action:',
      usernameAction ? `selector="${usernameAction.selector}"` : 'NOT FOUND'
    );
    console.log(
      '  Password action:',
      passwordAction ? `selector="${passwordAction.selector}"` : 'NOT FOUND'
    );
    console.log(
      '  2FA action:',
      twoFactorAction ? `selector="${twoFactorAction.selector}"` : 'NOT FOUND'
    );

    // Extract the actual LOGIN SEQUENCE from recorded actions
    // This captures the exact steps the user took during login
    const loginSequence: any[] = [];
    let inLoginFlow = false;
    let loginComplete = false;

    for (const action of actions) {
      // Start of login flow
      if (action.isUsernameField) {
        inLoginFlow = true;
      }

      // Capture all actions during login (until 2FA is complete or we hit navigation)
      if (inLoginFlow && !loginComplete) {
        if (
          action.isUsernameField ||
          action.isPasswordField ||
          action.is2FAField ||
          action.type === 'click'
        ) {
          loginSequence.push({
            type: action.type,
            selector: action.selector,
            isUsernameField: action.isUsernameField,
            isPasswordField: action.isPasswordField,
            is2FAField: action.is2FAField,
            description: action.description,
          });
        }

        // Login is complete after final submit (after password or 2FA)
        if (action.is2FAField) {
          // Continue until we find the submit after 2FA
          const actionIndex = actions.indexOf(action);
          const submitAfter2FA = actions.slice(actionIndex + 1).find((a) => a.type === 'click');
          if (submitAfter2FA) {
            loginSequence.push({
              type: submitAfter2FA.type,
              selector: submitAfter2FA.selector,
              description: submitAfter2FA.description,
            });
          }
          loginComplete = true;
        } else if (action.isPasswordField) {
          // For non-2FA logins, complete after submit following password
          const actionIndex = actions.indexOf(action);
          const nextClick = actions.slice(actionIndex + 1).find((a) => a.type === 'click');
          if (nextClick && !actions.slice(actionIndex + 1).some((a) => a.is2FAField)) {
            // No 2FA after password, so this submit completes login
            loginComplete = true;
          }
        }
      }
    }

    // Find submit button for backward compatibility
    let submitButton = '';
    if (passwordAction) {
      const passwordIndex = actions.indexOf(passwordAction);
      const submitAction = actions.slice(passwordIndex + 1).find((a) => a.type === 'click');
      submitButton = submitAction?.selector || '';
    }

    console.log('[RecordingWizard] Extracted login sequence:', loginSequence.length, 'steps');

    // Extract navigation steps (clicks after successful login)
    const navigationSteps: any[] = [];
    let foundLogin = false;

    // Get all selectors used in the login sequence to exclude from navigation
    const loginSequenceSelectors = new Set(loginSequence.map((step) => step.selector));

    // Also include traditional login field selectors
    const loginFieldSelectors = [
      usernameAction?.selector,
      passwordAction?.selector,
      twoFactorAction?.selector,
      submitButton,
    ].filter(Boolean);

    loginFieldSelectors.forEach((selector) => loginSequenceSelectors.add(selector));

    for (const action of actions) {
      // Skip login-related actions (typing in username/password/2FA)
      if (action.isUsernameField || action.isPasswordField || action.is2FAField) {
        foundLogin = true;
        continue;
      }

      // Skip any action whose selector is in the login sequence
      if (action.selector && loginSequenceSelectors.has(action.selector)) {
        continue;
      }

      // After login, convert remaining clicks to navigation steps
      if (foundLogin && action.type === 'click' && action.selector) {
        navigationSteps.push({
          step: navigationSteps.length + 1,
          action: 'click',
          selector: action.selector,
          description: action.description || `Click ${action.selector}`,
          delay: 1500,
        });
      }
    }

    // Improve 2FA method detection by analyzing button clicks before 2FA field
    if (session.twoFactorAuth?.enabled && twoFactorAction) {
      const twoFactorIndex = actions.indexOf(twoFactorAction);

      // Look at recent click actions before the 2FA field to detect method
      const recentClicks = actions
        .slice(Math.max(0, twoFactorIndex - 5), twoFactorIndex)
        .filter((a) => a.type === 'click' && a.description);

      for (const click of recentClicks) {
        const desc = (click.description || '').toLowerCase();

        // Check for SMS/text indicators in button text
        if (desc.includes('text') || desc.includes('sms') || desc.includes('phone')) {
          console.log('[RecordingWizard] Detected SMS 2FA from button:', click.description);
          session.twoFactorAuth.method = 'sms';
          break;
        }

        // Check for email indicators in button text
        if (desc.includes('email') || desc.includes('e-mail') || desc.includes('@')) {
          console.log('[RecordingWizard] Detected Email 2FA from button:', click.description);
          session.twoFactorAuth.method = 'email';
          break;
        }
      }
    }

    // Determine required integration based on 2FA method
    let requiredIntegration: 'gmail' | 'imessage' | null = null;
    if (session.twoFactorAuth?.enabled) {
      if (session.twoFactorAuth.method === 'email') {
        requiredIntegration = 'gmail';
      } else if (session.twoFactorAuth.method === 'sms') {
        requiredIntegration = 'imessage';
      }
      // authenticator/unknown → null (cannot automate)

      console.log('[RecordingWizard] Final 2FA method:', session.twoFactorAuth.method);
    }

    const result = {
      login: {
        usernameField: usernameAction?.selector || '',
        passwordField: passwordAction?.selector || '',
        submitButton,
        successIndicator: '', // Not available from recording
        twoFactorField: twoFactorAction?.selector,
        sequence: loginSequence, // ✨ NEW: Actual recorded login sequence
      },
      navigation: navigationSteps,
      messages: session.messageSelectors || {
        container: '',
        item: '',
      },
      // Include 2FA metadata
      twoFactorAuth: session.twoFactorAuth
        ? {
            enabled: true,
            method: session.twoFactorAuth.method,
            target: session.twoFactorAuth.target,
            codeLength: session.twoFactorAuth.codeLength,
            requiredIntegration,
            selector: twoFactorAction?.selector,
          }
        : undefined,
    };

    console.log('[RecordingWizard] Converted selectors:');
    console.log('  usernameField:', result.login.usernameField);
    console.log('  passwordField:', result.login.passwordField);
    console.log('  submitButton:', result.login.submitButton);
    console.log('  twoFactorField:', result.login.twoFactorField);

    return result;
  }

  /**
   * Wait for user to complete the recording
   */
  private async waitForCompletion(page: Page): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({ success: false, error: 'Recording timeout (5 minutes)' });
      }, 300000);

      // Poll for completion
      const checkInterval = setInterval(async () => {
        if (page.isClosed()) {
          clearInterval(checkInterval);
          clearTimeout(timeout);
          resolve({ success: false, error: 'Page closed' });
          return;
        }

        // Check if user clicked "Done"
        const isDone = await page
          .evaluate(() => {
            // @ts-expect-error - Custom flag
            return window.wovlyRecordingDone === true;
          })
          .catch(() => false);

        if (isDone) {
          clearInterval(checkInterval);
          clearTimeout(timeout);
          resolve({ success: true });
        }
      }, 1000);

      // Set up completion trigger
      page.evaluate(() => {
        // @ts-expect-error - Browser context code
        const doneButton = document.getElementById('wovly-done-recording');
        // @ts-expect-error - Browser context code
        const finishButton = document.getElementById('wovly-finish-setup');

        [doneButton, finishButton].forEach((button) => {
          button?.addEventListener('click', () => {
            // @ts-expect-error - Custom flag
            window.wovlyRecordingDone = true;
          });
        });
      });
    });
  }
}

export default RecordingWizard;
