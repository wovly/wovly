// @ts-nocheck - Complex browser context code with extensive DOM APIs

import type { Page } from 'puppeteer-core';
import { testSelector } from './element-detector';
import { promises as fs } from 'fs';
import { getSettingsPath } from '../utils/helpers';

/**
 * Visual Selector Tool
 *
 * Provides an interactive browser-based UI for selecting elements visually.
 * Includes hover highlighting, click-to-select, and navigation recording.
 */

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

export interface LoginSelectors {
  usernameField: string;
  passwordField?: string;
  submitButton?: string;
  successIndicator?: string;
}

export interface NavigationStep {
  step: number;
  action: string;
  selector: string;
  waitFor?: string;
  description?: string;
  delay?: number;
  value?: string;
}

export interface RecordedStep extends NavigationStep {
  elementInfo?: {
    text: string;
    tag: string;
  };
}

export interface ApiKeys {
  anthropic?: string;
}

export interface Settings {
  apiKeys?: ApiKeys;
}

export interface EmailMessage {
  id: string;
  snippet?: string;
  internalDate?: string;
  payload?: {
    body?: { data?: string };
    parts?: Array<{
      mimeType?: string;
      body?: { data?: string };
    }>;
  };
}

export interface GmailResponse {
  messages?: EmailMessage[];
}

// ─────────────────────────────────────────────────────────────────────────
// Visual Selector Tool Class
// ─────────────────────────────────────────────────────────────────────────

class VisualSelectorTool {
  private browserController: BrowserController;
  private username: string;
  private googleAccessToken: string | null;

  constructor(browserController: BrowserController, username: string) {
    this.browserController = browserController;
    this.username = username;
    this.googleAccessToken = null;
  }

  /**
   * Set Google access token for 2FA email checking
   */
  setGoogleAccessToken(token: string | null): void {
    this.googleAccessToken = token;
    if (token) {
      console.warn('[VisualSelector] Google access token configured for 2FA support');
    }
  }

  /**
   * Launch visual selector mode for a single element
   */
  async selectElement(
    url: string,
    purpose: string,
    suggestedSelector: string | null = null,
    credentials: Credentials | null = null,
    loginSelectors: LoginSelectors | null = null,
    navigationSteps: NavigationStep[] | null = null
  ): Promise<string> {
    const sessionId = `visual-selector-${Date.now()}`;
    const page = await this.browserController.getPage(sessionId);

    console.log('[VisualSelector] selectElement called with:', {
      url,
      purpose,
      hasCredentials: !!credentials,
      hasLoginSelectors: !!loginSelectors,
      navigationStepsCount: navigationSteps?.length || 0,
    });

    try {
      // Navigate with lenient options for better compatibility
      console.log('[VisualSelector] Navigating to:', url);
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      } catch (err: unknown) {
        if ((err as Error).message.includes('timeout')) {
          await page.goto(url, { waitUntil: 'load', timeout: 10000 }).catch(() => {});
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Inject status banner immediately
      await this.injectStatusBanner(page, 'Loading page...');

      // Auto-login if credentials provided
      if (credentials && loginSelectors) {
        console.log('[VisualSelector] Auto-logging in before element selection...');
        await this.updateStatusBanner(page, '🔐 Logging in... Please wait, do not touch anything.');
        await this.performLogin(page, credentials, loginSelectors);
        console.log('[VisualSelector] Login complete, current URL:', page.url());
      }

      // Execute navigation steps if provided
      if (navigationSteps && navigationSteps.length > 0) {
        console.log(`[VisualSelector] Executing ${navigationSteps.length} navigation steps...`);
        await this.updateStatusBanner(
          page,
          `🧭 Navigating... (0/${navigationSteps.length} steps complete)`
        );

        // Wait for page to stabilize after login before navigating
        await new Promise((resolve) => setTimeout(resolve, 3000));

        for (let i = 0; i < navigationSteps.length; i++) {
          const step = navigationSteps[i];
          console.log(`[VisualSelector] Step ${step.step}: ${step.description}`);
          await this.updateStatusBanner(
            page,
            `🧭 Navigating... (${i}/${navigationSteps.length} steps complete) - ${step.description}`
          );

          try {
            if (step.action === 'click') {
              let elementFound = false;

              // Try to wait for the CSS selector first
              try {
                await page.waitForSelector(step.selector, { timeout: 15000 });
                elementFound = true;
              } catch (selectorError) {
                // Log available interactive elements to help debug
                const availableElements = await page.evaluate(() => {
                  const elements = [];
                  (globalThis as any).document
                    .querySelectorAll('a, button, [role="button"]')
                    .forEach((el) => {
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
                });

                console.error(`[VisualSelector] Selector not found: ${step.selector}`);
                console.error(
                  `[VisualSelector] Available interactive elements on page:`,
                  JSON.stringify(availableElements, null, 2)
                );

                // Try text-based fallback if we have a description
                if (step.description) {
                  console.log(
                    `[VisualSelector] Trying text-based fallback for: "${step.description}"`
                  );

                  // Extract the likely text from description (e.g., "Click Messaging" -> "Messaging")
                  const textMatch = step.description.match(/(?:click|select|tap)\s+(.+)/i);
                  let searchText = textMatch ? textMatch[1].trim() : step.description;

                  // Clean up search text - remove extra content
                  searchText = searchText.split(/[⇆→←↔|]/)[0].trim();
                  searchText = searchText.split(/\s{2,}/)[0].trim();
                  searchText = searchText.substring(0, 100);

                  console.log(`[VisualSelector] Cleaned search text: "${searchText}"`);

                  const foundByText = await page.evaluate((text) => {
                    const elements = Array.from(
                      (globalThis as any).document.querySelectorAll('a, button, [role="button"]')
                    );
                    const match = elements.find((el) => {
                      const elText = el.textContent?.trim() || '';
                      return elText.toLowerCase().includes(text.toLowerCase());
                    });
                    return match !== undefined;
                  }, searchText);

                  if (foundByText) {
                    console.log(`[VisualSelector] Found element by text: "${searchText}"`);
                    elementFound = true;
                  } else {
                    throw selectorError;
                  }
                }
              }

              // Click the element (either by CSS selector or by text)
              if (elementFound) {
                try {
                  await page.click(step.selector);
                } catch (clickError) {
                  // If CSS selector click fails, try clicking by text
                  if (step.description) {
                    const textMatch = step.description.match(/(?:click|select|tap)\s+(.+)/i);
                    const searchText = textMatch ? textMatch[1].trim() : step.description;

                    await page.evaluate((text) => {
                      const elements = Array.from(
                        (globalThis as any).document.querySelectorAll('a, button, [role="button"]')
                      );
                      const match = elements.find((el) => {
                        const elText = el.textContent?.trim() || '';
                        return elText.toLowerCase().includes(text.toLowerCase());
                      });
                      if (match) {
                        match.click();
                      }
                    }, searchText);

                    console.log(`[VisualSelector] Clicked by text fallback: "${searchText}"`);
                  } else {
                    throw clickError;
                  }
                }
              }
            } else if (step.action === 'type') {
              await page.waitForSelector(step.selector, { timeout: 15000 });
              await page.type(step.selector, step.value);
            } else if (step.action === 'select') {
              await page.waitForSelector(step.selector, { timeout: 15000 });
              await page.select(step.selector, step.value);
            }

            if (step.waitFor) {
              await page.waitForSelector(step.waitFor, { timeout: 15000 });
            }

            // Default delay between steps for SPAs
            const delay = step.delay || 1500;
            await new Promise((resolve) => setTimeout(resolve, delay));
          } catch (error: unknown) {
            console.error(
              `[VisualSelector] Navigation step ${step.step} failed:`,
              (error as Error).message
            );
            throw new Error(`Navigation step ${step.step} failed: ${(error as Error).message}`);
          }
        }
        console.log('[VisualSelector] Navigation complete, ready for selection');
        console.log('[VisualSelector] Final URL after navigation:', page.url());
        await this.updateStatusBanner(
          page,
          `✅ Navigation complete! (${navigationSteps.length}/${navigationSteps.length} steps)`
        );
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      // Show ready message
      const readyMessage =
        credentials || navigationSteps?.length > 0
          ? '✨ Ready! Click on the element you want to select.'
          : '✨ Ready! Click on the element you want to select.';
      await this.updateStatusBanner(page, readyMessage, 'success');

      // Inject the visual selector overlay
      console.log('[VisualSelector] Injecting selector overlay...');
      await this.injectSelectorOverlay(page, purpose, suggestedSelector);

      // Wait for user to select an element
      const selectedSelector = await new Promise((resolve, reject) => {
        page.exposeFunction('confirmSelector', resolve);
        page.exposeFunction('cancelSelector', () => reject(new Error('User cancelled')));
      });

      return selectedSelector;
    } finally {
      await page.close();
    }
  }

  /**
   * Record navigation sequence
   * @param {string} url - Starting URL
   * @param {Object} credentials - Login credentials (optional)
   * @param {Object} loginSelectors - Login form selectors (optional)
   * @returns {Promise<Array>} Array of navigation steps
   */
  async recordNavigationSequence(url, credentials = null, loginSelectors = null) {
    const sessionId = `nav-recorder-${Date.now()}`;
    const page = await this.browserController.getPage(sessionId);

    try {
      // Navigate with lenient options for better compatibility
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      } catch (err: unknown) {
        if ((err as Error).message.includes('timeout')) {
          await page.goto(url, { waitUntil: 'load', timeout: 10000 }).catch(() => {});
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Inject initial status banner
      await this.injectStatusBanner(page, 'Loading page...');

      // Auto-login if credentials provided
      if (credentials && loginSelectors) {
        console.log('[VisualSelector] Auto-logging in before navigation recording...');
        await this.updateStatusBanner(page, '🔐 Logging in... Please wait.');
        await this.performLogin(page, credentials, loginSelectors);
        await this.updateStatusBanner(
          page,
          '✅ Logged in! Click on elements to record navigation steps.',
          'success'
        );
      } else {
        await this.updateStatusBanner(
          page,
          '✅ Ready! Click on elements to record navigation steps.',
          'success'
        );
      }

      // Set up recorder persistence across page navigations
      let finished = false;
      let cancelled = false;
      let resolveRecording, rejectRecording;
      let currentSteps = []; // Store steps outside page context

      const recordingPromise = new Promise((resolve, reject) => {
        resolveRecording = resolve;
        rejectRecording = reject;
      });

      // Expose function to get current steps (called by recorder on each click)
      await page.exposeFunction('recordStep', (step) => {
        currentSteps.push(step);
        console.log(`[VisualSelector] Recorded step ${step.step}: ${step.description}`);
      });

      // Expose functions for finish/cancel
      await page.exposeFunction('finishRecording', () => {
        finished = true;
        resolveRecording(currentSteps);
      });

      await page.exposeFunction('cancelRecording', () => {
        cancelled = true;
        rejectRecording(new Error('User cancelled'));
      });

      // Re-inject recorder after each navigation to persist across page loads
      page.on('load', async () => {
        if (!finished && !cancelled) {
          console.log(
            '[VisualSelector] Page loaded, re-injecting recorder with ${currentSteps.length} existing steps...'
          );
          await this.injectNavigationRecorder(page, currentSteps);
        }
      });

      // Inject the navigation recorder initially
      await this.injectNavigationRecorder(page, currentSteps);

      // Wait for user to finish recording
      const navigationSteps = await recordingPromise;

      return navigationSteps;
    } finally {
      await page.close();
    }
  }

  /**
   * Inject selector overlay UI into the page
   */
  async injectSelectorOverlay(page, purpose, suggestedSelector) {
    await page.evaluate(
      (purpose, suggested) => {
        // Remove any existing overlay
        const existing = (globalThis as any).document.getElementById('wovly-selector-overlay');
        if (existing) existing.remove();

        // Create overlay container
        const overlay = (globalThis as any).document.createElement('div');
        overlay.id = 'wovly-selector-overlay';
        overlay.innerHTML = `
        <style>
          #wovly-selector-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            z-index: 2147483647;
            pointer-events: none;
          }

          .wovly-panel {
            position: fixed;
            top: 20px;
            right: 20px;
            width: 420px;
            background: white;
            border-radius: 12px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            padding: 0;
            pointer-events: all;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 14px;
          }

          .wovly-panel-header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 20px;
            border-radius: 12px 12px 0 0;
          }

          .wovly-panel-header h3 {
            margin: 0 0 8px 0;
            font-size: 18px;
            font-weight: 600;
          }

          .wovly-panel-header p {
            margin: 0;
            font-size: 13px;
            opacity: 0.95;
            line-height: 1.5;
          }

          .wovly-panel-body {
            padding: 20px;
          }

          .wovly-panel h3 {
            margin: 0 0 15px 0;
            font-size: 16px;
            font-weight: 600;
          }

          .wovly-instructions {
            margin: 0 0 15px 0;
            padding: 12px;
            background: #f0f7ff;
            border-left: 3px solid #0066cc;
            border-radius: 4px;
            font-size: 13px;
            line-height: 1.6;
          }

          .wovly-instructions ol {
            margin: 8px 0 0 0;
            padding-left: 20px;
          }

          .wovly-instructions li {
            margin: 4px 0;
          }

          .wovly-panel input {
            width: 100%;
            padding: 8px;
            border: 1px solid #ddd;
            border-radius: 4px;
            margin-bottom: 10px;
            font-family: monospace;
            font-size: 12px;
          }

          .wovly-panel button {
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            margin-right: 8px;
          }

          .wovly-panel button.primary {
            background: #0066cc;
            color: white;
          }

          .wovly-panel button.secondary {
            background: #f0f0f0;
            color: #333;
          }

          .wovly-panel .info {
            margin-top: 10px;
            padding: 10px;
            background: #f8f9fa;
            border-radius: 4px;
            font-size: 12px;
          }

          .wovly-highlight {
            outline: 2px solid #0066cc !important;
            outline-offset: 2px !important;
            background-color: rgba(0, 102, 204, 0.1) !important;
            cursor: pointer !important;
          }

          .wovly-selected {
            outline: 3px solid #00cc66 !important;
            outline-offset: 2px !important;
            background-color: rgba(0, 204, 102, 0.2) !important;
          }
        </style>

        <div class="wovly-panel">
          <div class="wovly-panel-header">
            <h3>🎯 Element Selector Tool</h3>
            <p>Select: ${purpose}</p>
          </div>
          <div class="wovly-panel-body">
            <div class="wovly-instructions">
              <strong>How to use:</strong>
              <ol>
                <li><strong>Hover</strong> over elements - they'll highlight in blue</li>
                <li><strong>Click</strong> an element to select it</li>
                <li><strong>Test</strong> the selector to see all matches</li>
                <li><strong>Confirm</strong> when you're happy with the selection</li>
              </ol>
            </div>
            ${suggested ? `<div class="info">💡 AI suggested: <code style="font-size: 11px;">${suggested}</code></div>` : ''}
            <label style="display: block; margin-bottom: 5px; font-size: 12px; font-weight: 500; color: #666;">Selected element:</label>
            <input type="text" id="wovly-css-selector" placeholder="Hover and click an element..." value="${suggested || ''}" />
            <div class="info" id="wovly-matches">No element selected</div>
            <div style="margin-top: 15px; display: flex; gap: 8px;">
              <button class="primary" id="wovly-test" style="flex: 1;">Test Selector</button>
              <button class="primary" id="wovly-confirm" style="flex: 1;">✓ Confirm</button>
              <button class="secondary" id="wovly-cancel">Cancel</button>
            </div>
          </div>
        </div>
      `;

        (globalThis as any).document.body.appendChild(overlay);

        // Generate optimal CSS selector
        ((globalThis as any).window as any).generateOptimalSelector = function (el) {
          // Try ID first
          if (el.id) {
            return `#${((globalThis as any).CSS as any).escape(el.id)}`;
          }

          // Try unique class combination
          if (el.className && typeof el.className === 'string') {
            const classes = el.className
              .trim()
              .split(/\s+/)
              .filter((c) => c && !c.startsWith('wovly-'));
            if (classes.length > 0) {
              const classSelector =
                '.' + classes.map((c) => ((globalThis as any).CSS as any).escape(c)).join('.');
              if ((globalThis as any).document.querySelectorAll(classSelector).length === 1) {
                return classSelector;
              }
            }
          }

          // Try name attribute
          if (el.name) {
            const nameSelector = `${el.tagName.toLowerCase()}[name="${((globalThis as any).CSS as any).escape(el.name)}"]`;
            if ((globalThis as any).document.querySelectorAll(nameSelector).length === 1) {
              return nameSelector;
            }
          }

          // Try type attribute for inputs
          if (el.type) {
            const typeSelector = `${el.tagName.toLowerCase()}[type="${((globalThis as any).CSS as any).escape(el.type)}"]`;
            if ((globalThis as any).document.querySelectorAll(typeSelector).length === 1) {
              return typeSelector;
            }
          }

          // Build path using nth-child
          const path = [];
          let current = el;

          while (current && current.nodeType === ((globalThis as any).Node as any).ELEMENT_NODE) {
            let selector = current.tagName.toLowerCase();

            if (current.id) {
              selector = `#${((globalThis as any).CSS as any).escape(current.id)}`;
              path.unshift(selector);
              break;
            }

            // Get sibling index
            let sibling = current;
            let nth = 1;
            while (sibling.previousElementSibling) {
              sibling = sibling.previousElementSibling;
              if (sibling.tagName === current.tagName) nth++;
            }

            if (nth > 1 || current.nextElementSibling) {
              selector += `:nth-child(${nth})`;
            }

            path.unshift(selector);
            current = current.parentElement;

            // Limit depth
            if (path.length > 5) break;
          }

          return path.join(' > ');
        };

        // Hover highlighting
        let currentHighlight = null;
        (globalThis as any).document.addEventListener('mouseover', (e) => {
          if (!e.target.closest('#wovly-selector-overlay')) {
            if (currentHighlight) {
              currentHighlight.classList.remove('wovly-highlight');
            }
            e.target.classList.add('wovly-highlight');
            currentHighlight = e.target;
          }
        });

        (globalThis as any).document.addEventListener('mouseout', (e) => {
          if (!e.target.closest('#wovly-selector-overlay')) {
            e.target.classList.remove('wovly-highlight');
          }
        });

        // Click to select
        let selectedElement = null;
        (globalThis as any).document.addEventListener(
          'click',
          (e) => {
            if (!e.target.closest('#wovly-selector-overlay')) {
              e.preventDefault();
              e.stopPropagation();

              // Remove previous selection
              if (selectedElement) {
                selectedElement.classList.remove('wovly-selected');
              }

              // Select new element
              selectedElement = e.target;
              selectedElement.classList.add('wovly-selected');

              const selector = ((globalThis as any).window as any).generateOptimalSelector(
                e.target
              );
              (globalThis as any).document.getElementById('wovly-css-selector').value = selector;

              // Test selector
              const matches = (globalThis as any).document.querySelectorAll(selector);
              (globalThis as any).document.getElementById('wovly-matches').textContent =
                `Matches ${matches.length} element(s)`;
            }
          },
          true
        );

        // Test button
        (globalThis as any).document.getElementById('wovly-test').addEventListener('click', () => {
          const selector = (globalThis as any).document.getElementById('wovly-css-selector').value;
          try {
            const matches = (globalThis as any).document.querySelectorAll(selector);
            (globalThis as any).document.getElementById('wovly-matches').textContent =
              `✓ Matches ${matches.length} element(s)`;

            // Highlight all matches
            (globalThis as any).document.querySelectorAll('.wovly-highlight').forEach((el) => {
              el.classList.remove('wovly-highlight');
            });
            matches.forEach((el) => {
              el.classList.add('wovly-highlight');
            });
          } catch (error: unknown) {
            (globalThis as any).document.getElementById('wovly-matches').textContent =
              `✗ Invalid selector: ${(error as Error).message}`;
          }
        });

        // Confirm button
        (globalThis as any).document
          .getElementById('wovly-confirm')
          .addEventListener('click', () => {
            const selector = (globalThis as any).document.getElementById(
              'wovly-css-selector'
            ).value;
            if (selector) {
              ((globalThis as any).window as any).confirmSelector(selector);
            }
          });

        // Cancel button
        (globalThis as any).document
          .getElementById('wovly-cancel')
          .addEventListener('click', () => {
            ((globalThis as any).window as any).cancelSelector();
          });
      },
      purpose,
      suggestedSelector
    );
  }

  /**
   * Inject navigation recorder UI
   */
  async injectNavigationRecorder(page, existingSteps = []) {
    await page.evaluate((steps) => {
      // Remove any existing overlay
      const existing = (globalThis as any).document.getElementById('wovly-nav-recorder');
      if (existing) existing.remove();

      // Create recorder container
      const recorder = (globalThis as any).document.createElement('div');
      recorder.id = 'wovly-nav-recorder';
      recorder.innerHTML = `
        <style>
          #wovly-nav-recorder {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            z-index: 2147483647;
            pointer-events: none;
          }

          .wovly-recorder {
            position: fixed;
            top: 20px;
            right: 20px;
            width: 450px;
            background: white;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            padding: 20px;
            pointer-events: all;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 14px;
          }

          .wovly-recorder h3 {
            margin: 0 0 15px 0;
            font-size: 16px;
            font-weight: 600;
          }

          .wovly-recorder .recording-indicator {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 6px 12px;
            background: #ff4444;
            color: white;
            border-radius: 4px;
            font-size: 13px;
            font-weight: 500;
            margin-bottom: 15px;
          }

          .wovly-recorder .recording-dot {
            width: 8px;
            height: 8px;
            background: white;
            border-radius: 50%;
            animation: pulse 1.5s infinite;
          }

          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.3; }
          }

          .wovly-recorder .steps-list {
            max-height: 300px;
            overflow-y: auto;
            margin-bottom: 15px;
            background: #f8f9fa;
            border-radius: 4px;
            padding: 10px;
          }

          .wovly-recorder .step-item {
            padding: 8px;
            background: white;
            border-radius: 4px;
            margin-bottom: 8px;
            font-size: 13px;
          }

          .wovly-recorder .step-number {
            font-weight: 600;
            color: #0066cc;
          }

          .wovly-recorder button {
            padding: 10px 20px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            margin-right: 8px;
          }

          .wovly-recorder button.primary {
            background: #00cc66;
            color: white;
          }

          .wovly-recorder button.secondary {
            background: #f0f0f0;
            color: #333;
          }

          .wovly-click-highlight {
            outline: 2px solid #ff4444 !important;
            outline-offset: 2px !important;
            animation: highlightPulse 0.5s;
          }

          @keyframes highlightPulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.02); }
          }
        </style>

        <div class="wovly-recorder">
          <h3>🎥 Navigation Recorder</h3>
          <div class="recording-indicator">
            <div class="recording-dot"></div>
            Recording
          </div>
          <div class="steps-list" id="wovly-steps">
            <div style="color: #666; font-size: 12px;">Click elements to record navigation steps...</div>
          </div>
          <div>
            <button class="primary" id="wovly-finish">Finish & Save</button>
            <button class="secondary" id="wovly-cancel-recording">Cancel</button>
          </div>
        </div>
      `;

      (globalThis as any).document.body.appendChild(recorder);

      // Store navigation steps (restore existing steps if provided)
      ((globalThis as any).window as any).navigationSteps = steps || [];

      // Display existing steps in UI
      if (((globalThis as any).window as any).navigationSteps.length > 0) {
        const stepsList = (globalThis as any).document.getElementById('wovly-steps');
        stepsList.innerHTML = '';
        ((globalThis as any).window as any).navigationSteps.forEach((step) => {
          const stepDiv = (globalThis as any).document.createElement('div');
          stepDiv.className = 'step-item';
          stepDiv.innerHTML = `
            <span class="step-number">Step ${step.step}:</span>
            ${step.description || `Click ${step.selector}`}
          `;
          stepsList.appendChild(stepDiv);
        });
      }

      // Generate optimal selector (same function as before)
      ((globalThis as any).window as any).generateOptimalSelector = function (el) {
        if (el.id) {
          return `#${((globalThis as any).CSS as any).escape(el.id)}`;
        }

        if (el.className && typeof el.className === 'string') {
          const classes = el.className
            .trim()
            .split(/\s+/)
            .filter((c) => c && !c.startsWith('wovly-'));
          if (classes.length > 0) {
            const classSelector =
              '.' + classes.map((c) => ((globalThis as any).CSS as any).escape(c)).join('.');
            if ((globalThis as any).document.querySelectorAll(classSelector).length === 1) {
              return classSelector;
            }
          }
        }

        // Try href for links
        if (el.tagName === 'A' && el.getAttribute('href')) {
          const href = el.getAttribute('href');
          const hrefSelector = `a[href="${((globalThis as any).CSS as any).escape(href)}"]`;
          if ((globalThis as any).document.querySelectorAll(hrefSelector).length === 1) {
            return hrefSelector;
          }
          // Try partial href match
          if (href.includes('/')) {
            return `a[href*="${((globalThis as any).CSS as any).escape(href.split('/').pop())}"]`;
          }
        }

        const path = [];
        let current = el;

        while (current && current.nodeType === ((globalThis as any).Node as any).ELEMENT_NODE) {
          let selector = current.tagName.toLowerCase();

          if (current.id) {
            selector = `#${((globalThis as any).CSS as any).escape(current.id)}`;
            path.unshift(selector);
            break;
          }

          let sibling = current;
          let nth = 1;
          while (sibling.previousElementSibling) {
            sibling = sibling.previousElementSibling;
            if (sibling.tagName === current.tagName) nth++;
          }

          if (nth > 1 || current.nextElementSibling) {
            selector += `:nth-child(${nth})`;
          }

          path.unshift(selector);
          current = current.parentElement;

          if (path.length > 5) break;
        }

        return path.join(' > ');
      };

      // Capture clicks (but allow them to execute)
      (globalThis as any).document.addEventListener(
        'click',
        (e) => {
          if (!e.target.closest('#wovly-nav-recorder')) {
            // DON'T prevent default - let the click work!
            // Just record it and let navigation happen

            // Highlight the clicked element briefly
            e.target.classList.add('wovly-click-highlight');
            setTimeout(() => {
              e.target.classList.remove('wovly-click-highlight');
            }, 500);

            const selector = ((globalThis as any).window as any).generateOptimalSelector(e.target);
            const stepNumber = ((globalThis as any).window as any).navigationSteps.length + 1;

            const step = {
              step: stepNumber,
              action: 'click',
              selector: selector,
              description: `Click ${e.target.textContent?.trim().substring(0, 30) || e.target.tagName}`,
              waitFor: null, // Can be filled in later
              timestamp: Date.now(),
            };

            // Store locally and send to Puppeteer context
            ((globalThis as any).window as any).navigationSteps.push(step);
            ((globalThis as any).window as any).recordStep(step); // Send to Puppeteer context for persistence

            // Update UI
            const stepsList = (globalThis as any).document.getElementById('wovly-steps');
            const stepItem = (globalThis as any).document.createElement('div');
            stepItem.className = 'step-item';
            stepItem.innerHTML = `
            <span class="step-number">Step ${stepNumber}:</span>
            ${step.description}
            <div style="font-size: 11px; color: #666; margin-top: 4px; font-family: monospace;">${selector}</div>
          `;
            stepsList.appendChild(stepItem);

            // Scroll to bottom
            stepsList.scrollTop = stepsList.scrollHeight;
          }
        },
        true
      );

      // Finish button
      (globalThis as any).document.getElementById('wovly-finish').addEventListener('click', () => {
        ((globalThis as any).window as any).finishRecording(); // Steps are tracked in Puppeteer context
      });

      // Cancel button
      (globalThis as any).document
        .getElementById('wovly-cancel-recording')
        .addEventListener('click', () => {
          ((globalThis as any).window as any).cancelRecording();
        });
    }, existingSteps);
  }

  /**
   * Perform automatic login
   * @param {Page} page - Puppeteer page instance
   * @param {Object} credentials - { username, password }
   * @param {Object} loginSelectors - Login form selectors
   */
  async performLogin(page, credentials, loginSelectors) {
    try {
      // Fill username
      if (loginSelectors.usernameField) {
        await page.waitForSelector(loginSelectors.usernameField, { timeout: 5000 });
        await page.type(loginSelectors.usernameField, credentials.username);
      }

      // Fill password
      if (loginSelectors.passwordField) {
        await page.waitForSelector(loginSelectors.passwordField, { timeout: 5000 });
        await page.type(loginSelectors.passwordField, credentials.password);
      }

      // Click submit
      if (loginSelectors.submitButton) {
        await page.click(loginSelectors.submitButton);
      }

      // Wait for navigation or success indicator
      await Promise.race([
        page.waitForNavigation({ timeout: 10000 }).catch(() => {}),
        page.waitForSelector(loginSelectors.successIndicator, { timeout: 10000 }).catch(() => {}),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);

      // Check for 2FA (extract domain from page URL)
      const pageUrl = page.url();
      const siteDomain = new URL(pageUrl).hostname.replace('www.', '');
      await this.handle2FA(page, siteDomain);

      console.log('[VisualSelector] Auto-login complete');
    } catch (error: unknown) {
      console.error('[VisualSelector] Auto-login failed:', error);
      throw new Error('Auto-login failed. Please login manually.');
    }
  }

  /**
   * Detect and handle 2FA (Two-Factor Authentication)
   * @param {Page} page - Puppeteer page instance
   * @param {string} siteDomain - Domain of the website
   */
  async handle2FA(page, siteDomain) {
    try {
      // Wait a bit for potential 2FA page to load
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Check if we're on a 2FA page
      const is2FAPage = await page.evaluate(() => {
        const pageText = (globalThis as any).document.body.textContent?.toLowerCase() || '';
        const keywords = [
          'verification code',
          'two-factor',
          '2fa',
          '2-factor',
          'authentication code',
          'enter code',
          'verify',
          'security code',
          'one-time password',
          'otp',
        ];
        return keywords.some((keyword) => pageText.includes(keyword));
      });

      if (!is2FAPage) {
        console.log('[VisualSelector] No 2FA detected');
        return;
      }

      console.log(`[VisualSelector] 2FA detected! Attempting to fetch code from ${siteDomain}...`);

      // Try to get 2FA code from email (with retry logic)
      const code = await this.get2FACodeFromEmail(siteDomain);

      if (code) {
        // Check if this is a separate-digit input scenario (e.g., 6 separate single-digit fields)
        const separateDigits = await page.evaluate((codeLength) => {
          const inputs = Array.from(
            (globalThis as any).document.querySelectorAll(
              'input[type="text"], input[type="number"], input[type="tel"], input:not([type])'
            )
          );

          // Filter to visible inputs
          const visibleInputs = inputs.filter((input) => {
            const rect = input.getBoundingClientRect();
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              ((globalThis as any).window as any).getComputedStyle(input).visibility !== 'hidden' &&
              ((globalThis as any).window as any).getComputedStyle(input).display !== 'none'
            );
          });

          // Check if there are exactly N small inputs (likely separate digit fields)
          const smallInputs = visibleInputs.filter((input) => {
            const maxLength = input.getAttribute('maxlength') || input.maxLength;
            return maxLength == 1; // Single character inputs
          });

          if (smallInputs.length === codeLength) {
            console.log(`[VisualSelector] Detected ${smallInputs.length} separate digit fields`);
            return true;
          }

          return false;
        }, code.length);

        console.log(`[VisualSelector] Separate digits mode: ${separateDigits}`);
        console.log(`[VisualSelector] Code to enter: "${code}" (${code.length} chars)`);
        console.log(
          `[VisualSelector] Code char codes: ${code
            .split('')
            .map((c) => `${c}(${c.charCodeAt(0)})`)
            .join(' ')}`
        );

        if (separateDigits) {
          // Handle separate digit inputs
          console.log('[VisualSelector] ✓ Using separate digit input mode');

          const success = await page.evaluate((codeStr) => {
            const inputs = Array.from(
              (globalThis as any).document.querySelectorAll(
                'input[type="text"], input[type="number"], input[type="tel"], input:not([type])'
              )
            );

            const visibleInputs = inputs.filter((input) => {
              const rect = input.getBoundingClientRect();
              return (
                rect.width > 0 &&
                rect.height > 0 &&
                ((globalThis as any).window as any).getComputedStyle(input).visibility !==
                  'hidden' &&
                ((globalThis as any).window as any).getComputedStyle(input).display !== 'none'
              );
            });

            const digitInputs = visibleInputs.filter((input) => {
              const maxLength = input.getAttribute('maxlength') || input.maxLength;
              return maxLength == 1;
            });

            if (digitInputs.length !== codeStr.length) {
              console.log(
                `[VisualSelector] Mismatch: ${digitInputs.length} fields vs ${codeStr.length} digits`
              );
              return false;
            }

            // Fill each digit field
            for (let i = 0; i < codeStr.length; i++) {
              const input = digitInputs[i];
              const digit = codeStr[i];

              input.value = digit;
              input.focus();

              // Trigger all relevant events
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
              input.dispatchEvent(new KeyboardEvent('keydown', { key: digit, bubbles: true }));
              input.dispatchEvent(new KeyboardEvent('keyup', { key: digit, bubbles: true }));

              console.log(
                `[VisualSelector] Filled digit ${i + 1}: expected="${digit}", actual="${input.value}"`
              );
            }

            // Verify all fields are filled correctly
            const allValues = digitInputs.map((input) => input.value).join('');
            console.log(`[VisualSelector] Combined value: "${allValues}" (expected: "${codeStr}")`);
            console.log(`[VisualSelector] Match: ${allValues === codeStr}`);

            return true;
          }, code);

          if (success) {
            console.log('[VisualSelector] ✓ All digit fields filled');

            // Wait for validation
            console.log('[VisualSelector] Waiting 5 seconds before clicking verify...');
            await new Promise((resolve) => setTimeout(resolve, 5000));
          } else {
            console.log('[VisualSelector] ⚠ Failed to fill digit fields');
          }
        } else {
          // Original single-field logic
          const inputSelector = await page.evaluate(() => {
            // First, try to find input field with 2FA-related keywords
            const inputs = Array.from(
              (globalThis as any).document.querySelectorAll(
                'input[type="text"], input[type="number"], input[type="tel"], input:not([type])'
              )
            );

            // Filter to visible inputs only
            const visibleInputs = inputs.filter((input) => {
              const rect = input.getBoundingClientRect();
              return (
                rect.width > 0 &&
                rect.height > 0 &&
                ((globalThis as any).window as any).getComputedStyle(input).visibility !==
                  'hidden' &&
                ((globalThis as any).window as any).getComputedStyle(input).display !== 'none'
              );
            });

            console.log(`[VisualSelector] Found ${visibleInputs.length} visible input fields`);

            // Helper to generate selector for an element
            function getSelector(el) {
              if (el.id) return `#${el.id}`;
              if (el.name) return `input[name="${el.name}"]`;
              if (el.className) {
                const classes = el.className
                  .split(' ')
                  .filter((c) => c)
                  .join('.');
                if (classes) return `input.${classes}`;
              }
              // Fallback: nth-of-type
              const parent = el.parentElement;
              const index = Array.from(parent.children).indexOf(el) + 1;
              return `input:nth-child(${index})`;
            }

            // Try to find input with 2FA keywords first
            for (const input of visibleInputs) {
              const placeholder = input.placeholder?.toLowerCase() || '';
              const label = input.labels?.[0]?.textContent?.toLowerCase() || '';
              const ariaLabel = input.getAttribute('aria-label')?.toLowerCase() || '';
              const name = input.name?.toLowerCase() || '';
              const id = input.id?.toLowerCase() || '';

              const combined = `${placeholder} ${label} ${ariaLabel} ${name} ${id}`;

              if (
                combined.includes('code') ||
                combined.includes('verification') ||
                combined.includes('otp') ||
                combined.includes('token') ||
                combined.includes('2fa') ||
                combined.includes('auth')
              ) {
                console.log(
                  `[VisualSelector] Found 2FA input by keyword: ${combined.substring(0, 50)}`
                );
                return getSelector(input);
              }
            }

            // If no keyword match and there's only 1 visible input, use it
            if (visibleInputs.length === 1) {
              console.log('[VisualSelector] Only one input found - using it for 2FA code');
              return getSelector(visibleInputs[0]);
            }

            // If multiple inputs but no keyword match, try to find the first empty one
            if (visibleInputs.length > 1) {
              console.log('[VisualSelector] Multiple inputs found - trying first empty one');
              for (const input of visibleInputs) {
                if (!input.value) {
                  return getSelector(input);
                }
              }
            }

            return null;
          });

          if (inputSelector) {
            console.log(`[VisualSelector] Using selector: ${inputSelector}`);

            // Log the exact code we're about to type
            console.log(
              `[VisualSelector] Code to type: "${code}" (length: ${code.length}, chars: ${JSON.stringify(code.split(''))})`
            );

            // Clear the field first
            await page.click(inputSelector, { clickCount: 3 }); // Triple-click to select all
            await page.keyboard.press('Backspace');
            await new Promise((resolve) => setTimeout(resolve, 200)); // Wait for clear to complete

            // Type the code character by character (more reliable for React/Vue)
            await page.type(inputSelector, code, { delay: 50 });

            // Wait for typing to complete and events to propagate
            await new Promise((resolve) => setTimeout(resolve, 500));

            // Verify the value was set
            const valueSet = await page.evaluate(
              (sel, expectedCode) => {
                const input = (globalThis as any).document.querySelector(sel);
                const actualValue = input?.value || '';

                // Log with character codes
                const expectedChars = expectedCode
                  .split('')
                  .map((c) => `${c}(${c.charCodeAt(0)})`)
                  .join(' ');
                const actualChars = actualValue
                  .split('')
                  .map((c) => `${c}(${c.charCodeAt(0)})`)
                  .join(' ');

                console.log(
                  `[VisualSelector] Expected: "${expectedCode}" (${expectedCode.length} chars)`
                );
                console.log(`[VisualSelector] Expected char codes: ${expectedChars}`);
                console.log(
                  `[VisualSelector] Actual: "${actualValue}" (${actualValue.length} chars)`
                );
                console.log(`[VisualSelector] Actual char codes: ${actualChars}`);
                console.log(`[VisualSelector] Match: ${actualValue === expectedCode}`);

                return actualValue === expectedCode;
              },
              inputSelector,
              code
            );

            if (valueSet) {
              console.log('[VisualSelector] ✓ 2FA code entered and verified successfully');

              // Wait 5 seconds for validation to complete and button to become enabled
              console.log('[VisualSelector] Waiting 5 seconds before clicking verify...');
              await new Promise((resolve) => setTimeout(resolve, 5000));
            } else {
              console.log('[VisualSelector] ⚠ Code was typed but value verification failed');
            }
          } else {
            console.log('[VisualSelector] ⚠ Could not find 2FA input field');
          }
        } // End of else (single-field mode)

        // Try to find and click submit button (for both separate-digit and single-field modes)
        const submitResult = await page.evaluate(() => {
          const buttons = (globalThis as any).document.querySelectorAll(
            'button, input[type="submit"], a[role="button"]'
          );

          // Log all buttons found
          console.log(`[VisualSelector] Found ${buttons.length} buttons on page`);
          const buttonDetails = [];
          buttons.forEach((btn, idx) => {
            const text = btn.textContent?.trim() || '';
            const value = btn.value || '';
            const disabled = btn.disabled;
            const type = btn.tagName;
            buttonDetails.push({
              index: idx,
              type,
              text: text.substring(0, 30),
              value,
              disabled,
            });
          });
          console.log('[VisualSelector] Buttons:', JSON.stringify(buttonDetails, null, 2));

          // Try to find button with matching text
          const patterns = [
            'verify',
            'submit',
            'continue',
            'next',
            'confirm',
            'log in',
            'sign in',
            'enter',
            'ok',
          ];

          for (const btn of buttons) {
            if (btn.disabled) continue; // Skip disabled buttons

            const text = btn.textContent?.toLowerCase() || '';
            const value = btn.value?.toLowerCase() || '';
            const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase() || '';
            const combined = `${text} ${value} ${ariaLabel}`;

            for (const pattern of patterns) {
              if (combined.includes(pattern)) {
                console.log(
                  `[VisualSelector] Found matching button: "${text.trim() || value}" (pattern: ${pattern})`
                );
                btn.click();
                return { success: true, method: 'pattern', text: text.trim() || value };
              }
            }
          }

          // If no pattern match, try clicking the first visible enabled button
          for (const btn of buttons) {
            if (btn.disabled) continue;

            const rect = btn.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              const text = btn.textContent?.trim() || btn.value || 'unnamed button';
              console.log(
                `[VisualSelector] No pattern match - clicking first visible button: "${text}"`
              );
              btn.click();
              return { success: true, method: 'first-visible', text };
            }
          }

          return { success: false, method: 'none' };
        });

        if (submitResult.success) {
          console.log(
            `[VisualSelector] ✓ Submit button clicked (${submitResult.method}): ${submitResult.text}`
          );
        } else {
          console.log(
            '[VisualSelector] ⚠ No submit button found - user may need to click manually'
          );
        }

        // Wait for 2FA to complete
        await new Promise((resolve) => setTimeout(resolve, 3000));
      } else {
        console.log('[VisualSelector] Could not fetch 2FA code from email');
      }
    } catch (error: unknown) {
      console.error('[VisualSelector] 2FA handling error:', error);
      // Don't throw - continue anyway
    }
  }

  /**
   * Fetch 2FA code from Gmail with retry logic
   * @param {string} siteDomain - Domain of the website (e.g., "brightwheel.com")
   * @returns {Promise<string|null>} 2FA code or null
   */
  async get2FACodeFromEmail(siteDomain) {
    const maxAttempts = 24; // 24 attempts * 5 seconds = 2 minutes
    const delayBetweenAttempts = 5000; // 5 seconds

    // Record when we START looking, with a 30-second buffer for emails that arrived just before
    // (2FA emails often arrive within seconds of login, before we detect the 2FA page)
    const searchStartTime = Date.now() - 30 * 1000; // 30 seconds ago
    const searchStartTimestamp = new Date(searchStartTime).toISOString();

    console.log(`[VisualSelector] Waiting for 2FA email from ${siteDomain} (up to 2 minutes)...`);
    console.log(
      `[VisualSelector] Accepting emails received after: ${searchStartTimestamp} (30s buffer)`
    );

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        console.log(`[VisualSelector] Attempt ${attempt}/${maxAttempts} - Checking Gmail...`);

        const code = await this.fetchLatest2FACode(siteDomain, searchStartTime);

        if (code) {
          console.log(`[VisualSelector] Found 2FA code: ${code}`);
          return code;
        }

        if (attempt < maxAttempts) {
          console.log(`[VisualSelector] No code found yet, waiting 5 seconds...`);
          await new Promise((resolve) => setTimeout(resolve, delayBetweenAttempts));
        }
      } catch (error: unknown) {
        console.error(`[VisualSelector] Error on attempt ${attempt}:`, (error as Error).message);
      }
    }

    console.log('[VisualSelector] Timeout: No 2FA code received after 2 minutes');
    return null;
  }

  /**
   * Fetch latest 2FA code from Gmail
   * @param {string} siteDomain - Domain to match sender
   * @param {number} searchStartTime - Timestamp when search started (ms) - only accept emails after this
   * @returns {Promise<string|null>} 2FA code or null
   */
  async fetchLatest2FACode(siteDomain, searchStartTime) {
    try {
      // Get Google access token
      const accessToken = await this.getGoogleAccessToken();
      if (!accessToken) {
        console.log('[VisualSelector] No Google access token available');
        return null;
      }

      console.log('[VisualSelector] ✓ Got Google access token, querying Gmail API...');

      // Extract domain from site URL (e.g., "schools.mybrightwheel.com" -> "mybrightwheel.com")
      const siteParts = siteDomain.split('.');
      const expectedDomain = siteParts.slice(-2).join('.');

      // Search for emails from the domain after our search start time
      // Use searchStartTime for the Gmail query (in seconds)
      const searchStartSeconds = Math.floor(searchStartTime / 1000);
      const query = `after:${searchStartSeconds} from:@${expectedDomain}`;

      console.log(`[VisualSelector] Gmail search query: ${query}`);

      const url = new URL('https://www.googleapis.com/gmail/v1/users/me/messages');
      url.searchParams.set('q', query);
      url.searchParams.set('maxResults', '5');

      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        console.error(`[VisualSelector] Gmail API error: ${response.status} - ${errorText}`);
        return null;
      }

      console.log('[VisualSelector] ✓ Gmail API call successful');

      const data = await response.json();
      const messageIds = data.messages || [];

      if (messageIds.length === 0) {
        console.log(`[VisualSelector] No emails from @${expectedDomain} in last minute`);
        return null;
      }

      console.log(
        `[VisualSelector] Found ${messageIds.length} emails from @${expectedDomain}, checking each...`
      );

      // Fetch and check each message
      for (const msg of messageIds) {
        const msgUrl = `https://www.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`;
        const msgResponse = await fetch(msgUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!msgResponse.ok) continue;

        const msgData = await msgResponse.json();
        const headers = msgData.payload.headers;

        // Check email timestamp - only process emails received after our search started
        const emailTimestamp = parseInt(msgData.internalDate); // Gmail timestamp in ms
        const emailDate = new Date(emailTimestamp).toISOString();

        if (emailTimestamp < searchStartTime) {
          console.log(
            `[VisualSelector] Skipping old email from ${emailDate} (before search start)`
          );
          continue;
        }

        const from = headers.find((h) => h.name === 'From')?.value || '';
        console.log(`[VisualSelector] Checking email from: ${from} (received: ${emailDate})`);

        // Extract body
        let body = '';
        const payload = msgData.payload;

        if (payload.body?.data) {
          body = Buffer.from(payload.body.data, 'base64').toString('utf8');
        } else if (payload.parts) {
          for (const part of payload.parts) {
            if (part.mimeType === 'text/plain' || part.mimeType === 'text/html') {
              if (part.body?.data) {
                body += Buffer.from(part.body.data, 'base64').toString('utf8');
              }
            }
          }
        }

        console.log(`[VisualSelector] Email body preview: ${body.substring(0, 200)}...`);

        // Use LLM to extract code from email body
        const code = await this.extractCodeWithLLM(body);
        if (code) {
          console.log(`[VisualSelector] ✓ LLM extracted 2FA code: ${code}`);
          return code;
        } else {
          console.log('[VisualSelector] LLM did not find a 2FA code in this email');
        }
      }

      return null;
    } catch (error: unknown) {
      console.error('[VisualSelector] Error fetching from Gmail:', (error as Error).message);
      return null;
    }
  }

  /**
   * Extract 2FA code using LLM
   * @param {string} emailBody - Email body text
   * @returns {Promise<string|null>} Extracted code or null
   */
  async extractCodeWithLLM(emailBody) {
    try {
      // Get Anthropic API key
      const apiKeys = await this.getApiKeys();
      if (!apiKeys.anthropic) {
        console.log('[VisualSelector] No Anthropic API key available, using regex fallback');
        return this.extractCodeFromText(emailBody);
      }

      console.log('[VisualSelector] Using LLM to extract 2FA code...');

      // Clean email body (remove HTML tags if present, limit length)
      let cleanBody = emailBody
        .replace(/<[^>]*>/g, ' ') // Remove HTML tags
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim()
        .substring(0, 2000); // Limit to 2000 chars for token budget

      const prompt = `Extract the verification/2FA code from this email.

Email content:
${cleanBody}

Instructions:
- Look for any verification code, authentication code, 2FA code, security code, or one-time password
- The code is usually 4-8 digits or alphanumeric characters
- Return ONLY the code itself, nothing else
- If no code is found, respond with "NONE"

Example:
Email: "Your brightwheel verification code is 701216. This code expires in 30 minutes."
Response: 701216`;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKeys.anthropic,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001', // Use Haiku for speed and cost
          max_tokens: 100,
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        console.error(`[VisualSelector] LLM API error: ${response.status} - ${errorText}`);
        console.log('[VisualSelector] Falling back to regex extraction');
        return this.extractCodeFromText(emailBody);
      }

      const data = await response.json();
      const result = data.content?.[0]?.text?.trim() || '';

      // Log raw response with character codes
      const rawChars = result
        .split('')
        .map((c) => `${c}(${c.charCodeAt(0)})`)
        .join(' ');
      console.log(`[VisualSelector] LLM response: "${result}"`);
      console.log(`[VisualSelector] Raw chars: ${rawChars}`);

      if (result === 'NONE' || !result) {
        return null;
      }

      // Clean up the result - extract just the code (remove all whitespace and non-alphanumeric)
      const cleanCode = result.replace(/\s+/g, '').replace(/[^A-Z0-9]/gi, '');

      // Log cleaned code with character codes
      const cleanChars = cleanCode
        .split('')
        .map((c) => `${c}(${c.charCodeAt(0)})`)
        .join(' ');
      console.log(`[VisualSelector] Cleaned code: "${cleanCode}" (length: ${cleanCode.length})`);
      console.log(`[VisualSelector] Clean chars: ${cleanChars}`);

      // Verify it's the right length (4-8 characters)
      if (cleanCode.length >= 4 && cleanCode.length <= 8) {
        return cleanCode;
      }

      console.log(`[VisualSelector] Code length invalid: ${cleanCode.length}`);
      return null;
    } catch (error: unknown) {
      console.error('[VisualSelector] Error with LLM extraction:', (error as Error).message);
      console.log('[VisualSelector] Falling back to regex extraction');
      return this.extractCodeFromText(emailBody);
    }
  }

  /**
   * Extract 2FA code from email text using regex (fallback)
   * @param {string} text - Email body text
   * @returns {string|null} Extracted code or null
   */
  extractCodeFromText(text) {
    // Common 2FA code patterns (prioritize more specific patterns first)
    const patterns = [
      /verification code:\s*(\d{4,8})/i,
      /authentication code:\s*(\d{4,8})/i,
      /security code:\s*(\d{4,8})/i,
      /code:\s*(\d{4,8})/i,
      /enter code:\s*(\d{4,8})/i,
      /your code:\s*(\d{4,8})/i,
      /code is:\s*(\d{4,8})/i,
      /\b(\d{6})\b/, // 6-digit code (most common)
      /\b(\d{4})\b/, // 4-digit code
      /\b(\d{8})\b/, // 8-digit code
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    return null;
  }

  /**
   * Get API keys for LLM calls
   * @returns {Promise<Object>} API keys object
   */
  async getApiKeys() {
    try {
      const fs = require('fs').promises;
      const { getSettingsPath } = require('../utils/helpers');

      const settingsPath = await getSettingsPath(this.username);
      const settingsData = await fs.readFile(settingsPath, 'utf8');
      const settings = JSON.parse(settingsData);

      return {
        anthropic: settings.apiKeys?.anthropic || process.env.ANTHROPIC_API_KEY,
      };
    } catch (error: unknown) {
      return {
        anthropic: process.env.ANTHROPIC_API_KEY,
      };
    }
  }

  /**
   * Get Google access token
   * @returns {Promise<string|null>} Access token or null
   */
  async getGoogleAccessToken() {
    if (this.googleAccessToken) {
      return this.googleAccessToken;
    }
    console.log('[VisualSelector] No Google access token available');
    console.log('[VisualSelector] Please ensure Google/Gmail integration is set up');
    return null;
  }

  /**
   * Combined navigation recording and message selection
   * User clicks through navigation, then selects the final messages area
   * @param {string} url - URL to navigate to
   * @param {Object} credentials - Login credentials
   * @param {Object} loginSelectors - Login form selectors
   * @returns {Promise<Object>} { navigationSteps, messageSelector }
   */
  async recordNavigationAndSelectMessages(url, credentials = null, loginSelectors = null) {
    const sessionId = `nav-and-select-${Date.now()}`;
    const page = await this.browserController.getPage(sessionId);

    try {
      // Navigate to page
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      } catch (err: unknown) {
        if ((err as Error).message.includes('timeout')) {
          await page.goto(url, { waitUntil: 'load', timeout: 10000 }).catch(() => {});
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Inject initial status banner
      await this.injectStatusBanner(page, 'Loading page...');

      // Auto-login if credentials provided
      if (credentials && loginSelectors) {
        console.log('[VisualSelector] Auto-logging in...');
        await this.updateStatusBanner(page, '🔐 Logging in... Please wait, do not touch anything.');
        await this.performLogin(page, credentials, loginSelectors);
      }

      // Show instructions
      await this.updateStatusBanner(
        page,
        '✅ Ready! Click through navigation, then click the messages area.',
        'success'
      );
      await new Promise((resolve) => setTimeout(resolve, 2000));
      await this.updateStatusBanner(
        page,
        '👆 Click elements to navigate (e.g., "Messaging" → "Conversation"), then click the messages area.',
        'success'
      );

      // Set up combined recorder
      let finished = false;
      let cancelled = false;
      let resolveRecording, rejectRecording;
      let navigationSteps = [];
      let messageSelector = null;

      const recordingPromise = new Promise((resolve, reject) => {
        resolveRecording = resolve;
        rejectRecording = reject;
      });

      // Expose functions for recording
      await page.exposeFunction('recordNavigationStep', (step) => {
        navigationSteps.push(step);
        console.log(`[VisualSelector] Navigation step ${step.step}: ${step.description}`);
      });

      await page.exposeFunction('setMessageSelector', (selector) => {
        messageSelector = selector;
        console.log(`[VisualSelector] Message selector captured: ${selector}`);
      });

      await page.exposeFunction('finishCombinedRecording', () => {
        finished = true;
        resolveRecording({ navigationSteps, messageSelector });
      });

      await page.exposeFunction('cancelCombinedRecording', () => {
        cancelled = true;
        rejectRecording(new Error('User cancelled'));
      });

      // Inject combined recorder UI
      await this.injectCombinedRecorderUI(page);

      // Handle page navigations - preserve state
      page.on('load', async () => {
        if (!finished && !cancelled) {
          try {
            console.log('[VisualSelector] Page navigated, re-injecting recorder...');
            // Wait for page to settle and ensure it's ready
            await new Promise((resolve) => setTimeout(resolve, 1500));

            // Check if page is still valid before injecting
            if (!page.isClosed()) {
              await this.injectCombinedRecorderUI(page);
            }
          } catch (error: unknown) {
            console.log('[VisualSelector] Error re-injecting recorder:', (error as Error).message);
            // Continue anyway - user can still use the previous recorder state
          }
        }
      });

      const result = await recordingPromise;
      return result;
    } catch (error: unknown) {
      console.error('[VisualSelector] Combined recording error:', error);
      throw error;
    } finally {
      // Don't close page automatically - let user see the result
    }
  }

  /**
   * Inject combined recorder UI (navigation + message selection)
   */
  async injectCombinedRecorderUI(page) {
    try {
      await page.evaluate(() => {
        // Remove existing recorder if present
        const existing = (globalThis as any).document.getElementById('wovly-combined-recorder');
        if (existing) existing.remove();

        let stepCount = 0;
        let mode = 'navigation'; // 'navigation' or 'message'

        const panel = (globalThis as any).document.createElement('div');
        panel.id = 'wovly-combined-recorder';
        panel.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: white;
        border: 2px solid #2196F3;
        border-radius: 12px;
        padding: 20px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        z-index: 999998;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        min-width: 300px;
        max-width: 400px;
      `;

        panel.innerHTML = `
        <div style="margin-bottom: 16px;">
          <h3 style="margin: 0 0 8px 0; font-size: 16px; font-weight: 600; color: #1976D2;">
            🎯 Setup Wizard
          </h3>
          <div id="mode-indicator" style="font-size: 14px; color: #666; margin-bottom: 12px;">
            Step 1: Click navigation elements
          </div>
        </div>

        <div id="steps-list" style="max-height: 200px; overflow-y: auto; margin-bottom: 16px;">
          <div style="color: #999; font-size: 13px; font-style: italic;">No steps recorded yet</div>
        </div>

        <div style="display: flex; gap: 8px; flex-direction: column;">
          <button id="switch-to-message" style="
            padding: 10px 16px;
            background: #4CAF50;
            color: white;
            border: none;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            display: none;
          ">
            ✓ Done - Now Select Messages Area
          </button>
          <button id="finish-combined" style="
            padding: 10px 16px;
            background: #2196F3;
            color: white;
            border: none;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            display: none;
          ">
            ✓ Finish Setup
          </button>
          <button id="cancel-combined" style="
            padding: 8px 16px;
            background: transparent;
            color: #666;
            border: 1px solid #ddd;
            border-radius: 6px;
            font-size: 13px;
            cursor: pointer;
          ">
            ✕ Cancel
          </button>
        </div>
      `;

        (globalThis as any).document.body.appendChild(panel);

        const stepsList = (globalThis as any).document.getElementById('steps-list');
        const modeIndicator = (globalThis as any).document.getElementById('mode-indicator');
        const switchBtn = (globalThis as any).document.getElementById('switch-to-message');
        const finishBtn = (globalThis as any).document.getElementById('finish-combined');
        const cancelBtn = (globalThis as any).document.getElementById('cancel-combined');

        // Show switch button initially
        switchBtn.style.display = 'block';

        // Switch to message selection mode
        switchBtn.addEventListener('click', () => {
          mode = 'message';
          modeIndicator.textContent = 'Step 2: Click the messages area';
          modeIndicator.style.color = '#4CAF50';
          switchBtn.style.display = 'none';
        });

        // Finish button
        finishBtn.addEventListener('click', () => {
          ((globalThis as any).window as any).finishCombinedRecording();
          panel.remove();
        });

        // Cancel button
        cancelBtn.addEventListener('click', () => {
          ((globalThis as any).window as any).cancelCombinedRecording();
          panel.remove();
        });

        // Highlight elements on hover (with debouncing)
        let currentHighlight = null;
        (globalThis as any).document.addEventListener('mouseover', (e) => {
          if (
            !e.target.closest('#wovly-combined-recorder') &&
            !e.target.closest('#wovly-status-banner')
          ) {
            if (currentHighlight) {
              currentHighlight.style.outline = '';
            }
            e.target.style.outline = '2px solid #2196F3';
            e.target.style.outlineOffset = '2px';
            currentHighlight = e.target;
          }
        });

        (globalThis as any).document.addEventListener('mouseout', (e) => {
          if (currentHighlight === e.target) {
            e.target.style.outline = '';
            currentHighlight = null;
          }
        });

        // Track if we're processing a click to prevent duplicates
        let isProcessingClick = false;

        // Capture clicks
        (globalThis as any).document.addEventListener(
          'click',
          (e) => {
            // Ignore clicks on recorder UI
            if (
              e.target.closest('#wovly-combined-recorder') ||
              e.target.closest('#wovly-status-banner')
            ) {
              return;
            }

            // Prevent duplicate processing
            if (isProcessingClick) {
              return;
            }
            isProcessingClick = true;

            const selector = generateOptimalSelector(e.target);
            const rawText = e.target.textContent?.trim() || e.target.tagName;
            const cleanText = cleanTextForDescription(rawText);

            if (mode === 'navigation') {
              // Record as navigation step
              stepCount++;
              const step = {
                step: stepCount,
                action: 'click',
                selector: selector,
                description: `Click ${cleanText}`,
                waitFor: null,
                delay: 1500,
              };

              ((globalThis as any).window as any).recordNavigationStep(step);

              // Update UI
              if (stepsList.querySelector('div[style*="italic"]')) {
                stepsList.innerHTML = '';
              }

              const stepDiv = (globalThis as any).document.createElement('div');
              stepDiv.style.cssText =
                'padding: 8px; margin-bottom: 4px; background: #f5f5f5; border-radius: 4px; font-size: 13px;';
              stepDiv.innerHTML = `<strong>Step ${stepCount}:</strong> ${cleanText}`;
              stepsList.appendChild(stepDiv);

              // Let the click happen naturally - don't prevent it!
              console.log('[Recorder] Recorded navigation click:', cleanText);

              // Reset processing flag after a short delay
              setTimeout(() => {
                isProcessingClick = false;
              }, 500);
            } else {
              // In message selection mode, prevent the click
              e.preventDefault();
              e.stopPropagation();

              // Record as message selector
              ((globalThis as any).window as any).setMessageSelector(selector);

              // Update UI
              stepsList.innerHTML += `
            <div style="padding: 8px; margin-top: 8px; background: #e8f5e9; border-radius: 4px; font-size: 13px; border: 1px solid #4CAF50;">
              <strong>✓ Messages area:</strong> Selected
            </div>
          `;

              finishBtn.style.display = 'block';
              modeIndicator.textContent = '✓ All set! Click Finish when ready.';

              setTimeout(() => {
                isProcessingClick = false;
              }, 500);
            }
          },
          true
        );

        // Helper function to generate CSS selector
        function generateOptimalSelector(element) {
          // Try ID first
          if (element.id) {
            return `#${element.id}`;
          }

          // Try class selector (but verify it's unique)
          if (element.className && typeof element.className === 'string') {
            const classes = element.className.trim().split(/\s+/);
            if (classes.length > 0 && classes[0]) {
              const classSelector = `.${classes[0]}`;
              // Check if it's unique
              const matches = (globalThis as any).document.querySelectorAll(classSelector);
              if (matches.length === 1) {
                return classSelector;
              }
            }
          }

          // Fall back to path-based selector with nth-child
          const path = [];
          let current = element;
          while (current && current !== (globalThis as any).document.body) {
            let selector = current.tagName.toLowerCase();
            if (current.parentElement) {
              const siblings = Array.from(current.parentElement.children);
              const index = siblings.indexOf(current);
              if (siblings.length > 1) {
                selector += `:nth-child(${index + 1})`;
              }
            }
            path.unshift(selector);
            current = current.parentElement;
          }
          return path.join(' > ');
        }

        // Helper function to clean text for description
        function cleanTextForDescription(text) {
          if (!text) return '';
          // Remove arrows, pipes, and extra content
          let cleaned = text.split(/[⇆→←↔|]/)[0].trim();
          cleaned = cleaned.split(/\s{2,}/)[0].trim();
          return cleaned.substring(0, 50);
        }
      });
    } catch (error: unknown) {
      console.log(
        '[VisualSelector] Error injecting combined recorder UI:',
        (error as Error).message
      );
      throw error; // Re-throw to be handled by caller
    }
  }

  /**
   * Inject status banner into the page
   * @param {Page} page - Puppeteer page
   * @param {string} message - Status message to display
   * @param {string} type - Banner type: 'info', 'success', 'warning'
   */
  async injectStatusBanner(page, message, type = 'info') {
    await page.evaluate(
      (msg, bannerType) => {
        // Remove existing banner if present
        const existing = (globalThis as any).document.getElementById('wovly-status-banner');
        if (existing) {
          existing.remove();
        }

        // Create banner
        const banner = (globalThis as any).document.createElement('div');
        banner.id = 'wovly-status-banner';

        const colors = {
          info: { bg: '#2196F3', text: '#ffffff' },
          success: { bg: '#4CAF50', text: '#ffffff' },
          warning: { bg: '#FF9800', text: '#ffffff' },
        };

        const color = colors[bannerType] || colors.info;

        banner.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        background: ${color.bg};
        color: ${color.text};
        padding: 16px 24px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 16px;
        font-weight: 500;
        text-align: center;
        z-index: 999999;
        box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        animation: slideDown 0.3s ease-out;
      `;

        banner.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; gap: 12px;">
          <div class="wovly-spinner" style="
            width: 20px;
            height: 20px;
            border: 3px solid rgba(255,255,255,0.3);
            border-top-color: white;
            border-radius: 50%;
            animation: spin 1s linear infinite;
          "></div>
          <span>${msg}</span>
        </div>
      `;

        // Add animation styles
        const style = (globalThis as any).document.createElement('style');
        style.textContent = `
        @keyframes slideDown {
          from {
            transform: translateY(-100%);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `;
        document.head.appendChild(style);

        (globalThis as any).document.body.appendChild(banner);
      },
      message,
      type
    );
  }

  /**
   * Update status banner message
   * @param {Page} page - Puppeteer page
   * @param {string} message - New status message
   * @param {string} type - Banner type: 'info', 'success', 'warning'
   */
  async updateStatusBanner(page, message, type = 'info') {
    await page.evaluate(
      (msg, bannerType) => {
        const banner = (globalThis as any).document.getElementById('wovly-status-banner');
        if (!banner) return;

        const colors = {
          info: { bg: '#2196F3', text: '#ffffff' },
          success: { bg: '#4CAF50', text: '#ffffff' },
          warning: { bg: '#FF9800', text: '#ffffff' },
        };

        const color = colors[bannerType] || colors.info;

        // Update colors
        banner.style.background = color.bg;
        banner.style.color = color.text;

        // Update message
        const spinner =
          bannerType === 'success'
            ? ''
            : `
        <div class="wovly-spinner" style="
          width: 20px;
          height: 20px;
          border: 3px solid rgba(255,255,255,0.3);
          border-top-color: white;
          border-radius: 50%;
          animation: spin 1s linear infinite;
        "></div>
      `;

        banner.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: center; gap: 12px;">
          ${spinner}
          <span>${msg}</span>
        </div>
      `;
      },
      message,
      type
    );
  }

  /**
   * Analyze URL and generate selectors using AI
   * Extracted from main.js webscraper:analyzeUrl handler
   *
   * @param url - Website URL to analyze
   * @param siteType - Type of site (e.g., 'messaging', 'email')
   * @param apiKeys - API keys for AI providers
   * @returns Analysis result with selectors and confidence
   */
  async analyzeUrl(
    url: string,
    siteType: string | null,
    apiKeys: any
  ): Promise<{
    ok: boolean;
    success?: boolean;
    selectors?: any;
    confidence?: string;
    loginPageUrl?: string;
    originalUrl?: string;
    error?: string;
  }> {
    try {
      const { ai } = await import('./index');

      // Create a temporary page to analyze
      const sessionId = `analyze-${Date.now()}`;
      const page = await this.browserController.getPage(sessionId);

      // Navigate with more lenient options
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      } catch (err: any) {
        // If navigation fails, try with load event only
        if (err.message?.includes('timeout')) {
          console.log('[VisualSelector] Navigation timeout, trying with load event...');
          await page.goto(url, { waitUntil: 'load', timeout: 10000 }).catch(() => {
            // If still fails, we'll work with whatever loaded
            console.log('[VisualSelector] Using partially loaded page');
          });
        } else {
          throw err;
        }
      }

      // Show banner to user
      await this.injectStatusBanner(
        page,
        '🔍 Analyzing page... Please wait, do not touch anything.'
      );

      // Wait a bit for any dynamic content
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Check if we're already on a login page (has password field)
      const hasPasswordField = await page.evaluate(() => {
        return !!document.querySelector('input[type="password"]');
      });

      // If not on login page, try to find and click a login button/link
      if (!hasPasswordField) {
        console.log('[VisualSelector] Not on login page, looking for login button...');

        const loginClicked = await page.evaluate(() => {
          // Look for login/sign in buttons or links
          const patterns = [
            /log\s*in/i,
            /sign\s*in/i,
            /login/i,
            /signin/i,
            /log-in/i,
            /sign-in/i,
            /member\s*login/i,
            /account\s*login/i,
          ];

          // Check buttons
          const buttons = Array.from(document.querySelectorAll('button, a, [role="button"]'));
          for (const btn of buttons) {
            const text = (btn as HTMLElement).textContent?.trim() || '';
            const ariaLabel = btn.getAttribute('aria-label') || '';
            const href = btn.getAttribute('href') || '';

            const combined = `${text} ${ariaLabel} ${href}`.toLowerCase();

            for (const pattern of patterns) {
              if (pattern.test(combined)) {
                console.log('Found login button:', text || href);
                (btn as HTMLElement).click();
                return true;
              }
            }
          }
          return false;
        });

        if (loginClicked) {
          console.log('[VisualSelector] Clicked login button, waiting for login page...');

          // Wait for navigation or new content
          await Promise.race([
            page.waitForNavigation({ timeout: 5000 }).catch(() => {}),
            new Promise((resolve) => setTimeout(resolve, 3000)),
          ]);

          // Wait for password field to appear
          await page.waitForSelector('input[type="password"]', { timeout: 5000 }).catch(() => {
            console.log('[VisualSelector] Password field not found after clicking login button');
          });
        } else {
          console.log('[VisualSelector] No login button found on page');
        }
      }

      // Use AI to generate selectors (with fallback if it fails)
      let selectors = null;
      let confidence = 'low';

      try {
        selectors = await ai.generateSelectorsWithAI(page, siteType, apiKeys);
        confidence = selectors.confidence;
        console.log(`[VisualSelector] AI analysis complete with ${confidence} confidence`);
      } catch (aiError: any) {
        console.log('[VisualSelector] AI analysis failed, falling back to manual setup');
        console.log('[VisualSelector] Error:', aiError.message);

        // Provide empty selectors for manual setup
        selectors = {
          login: {
            usernameField: '',
            passwordField: '',
            submitButton: '',
            successIndicator: '',
          },
          navigation: [],
          messages: {
            container: '',
            messageItem: '',
            sender: '',
            content: '',
            timestamp: '',
          },
          confidence: 'low',
        };
      }

      // Get the final URL after any navigation (this is the actual login page URL)
      const finalUrl = page.url();
      console.log(`[VisualSelector] Analysis complete. Final URL: ${finalUrl}`);

      // Close the page
      await page.close();

      return {
        ok: true,
        success: true,
        selectors: selectors,
        confidence: confidence,
        loginPageUrl: finalUrl, // The actual URL where the login form is
        originalUrl: url, // The URL the user entered
      };
    } catch (err: any) {
      console.error('[VisualSelector] Error analyzing URL:', err);
      return { ok: false, error: err.message };
    }
  }
}

export { VisualSelectorTool };
export default VisualSelectorTool;
