/**
 * CDP Browser Controller - Direct Chrome DevTools Protocol control
 * Provides low-latency browser automation with visual snapshots
 */

import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { exec } from 'child_process';
import { BrowserWindow } from 'electron';
import type {
  Browser,
  BrowserContext,
  Page,
  PuppeteerNode,
  LaunchOptions,
  ScreenshotOptions,
  SerializedAXNode,
  KeyInput,
} from 'puppeteer-core';

let puppeteer: PuppeteerNode | null = null; // Lazy-loaded puppeteer-core

/**
 * Element reference stored for click/type operations
 */
interface ElementRefData {
  name: string;
  role: string;
  selector: string | null;
}

/**
 * Browser context and page pair
 */
interface ContextData {
  context: BrowserContext;
  page: Page;
}

/**
 * Snapshot element representation
 */
export interface SnapshotElement {
  ref: string;
  role: string;
  name: string;
  value?: string;
  focused: boolean;
  disabled: boolean;
}

/**
 * Snapshot result containing screenshot and interactive elements
 */
export interface SnapshotResult {
  screenshot: string;
  elements: SnapshotElement[];
  url: string;
  title: string;
  elementCount: number;
}

/**
 * Click operation result
 */
export interface ClickResult {
  success: boolean;
  clicked: string;
}

/**
 * Type operation result
 */
export interface TypeResult {
  success: boolean;
  typed: string;
  focused: boolean;
}

/**
 * Press operation result
 */
export interface PressResult {
  success: boolean;
  pressed: string;
}

/**
 * Scroll operation result
 */
export interface ScrollResult {
  success: boolean;
  scrolled: string;
}

/**
 * Counter object for element reference numbering
 */
interface RefCounter {
  value: number;
}

/**
 * Check if puppeteer-core is installed
 */
export function checkPuppeteerCoreInstalled(): boolean {
  try {
    require.resolve('puppeteer-core');
    return true;
  } catch {
    return false;
  }
}

/**
 * Auto-install puppeteer-core if not present
 */
export async function ensurePuppeteerCoreInstalled(): Promise<boolean> {
  if (checkPuppeteerCoreInstalled()) {
    return true;
  }

  console.log('[BrowserController] puppeteer-core not found, installing...');

  return new Promise((resolve) => {
    const desktopDir = path.join(__dirname, '..', '..');
    exec('npm install puppeteer-core@^22.0.0', { cwd: desktopDir, timeout: 120000 }, (err) => {
      if (err) {
        console.error('[BrowserController] Failed to install puppeteer-core:', err.message);
        resolve(false);
      } else {
        console.log('[BrowserController] puppeteer-core installed successfully');
        try {
          delete require.cache[require.resolve('puppeteer-core')];
        } catch {
          /* ignore */
        }
        resolve(true);
      }
    });
  });
}

/**
 * Load puppeteer-core, installing if necessary
 */
export async function loadPuppeteer(): Promise<PuppeteerNode> {
  if (puppeteer) return puppeteer;

  const installed = await ensurePuppeteerCoreInstalled();
  if (!installed) {
    throw new Error(
      'puppeteer-core is not installed and auto-install failed. Please run: npm install puppeteer-core'
    );
  }

  puppeteer = require('puppeteer-core') as PuppeteerNode;
  return puppeteer;
}

/**
 * BrowserController manages a persistent Chromium instance via CDP
 */
export class BrowserController {
  private browser: Browser | null = null;
  private contexts: Map<string, ContextData> = new Map();
  private chromiumPath: string | null = null;
  private initialized: boolean = false;
  private initializing: Promise<void> | null = null;
  private elementRefs: Map<string, Map<string, ElementRefData>> = new Map();
  private username: string | null = null;

  async getChromiumPath(): Promise<string> {
    if (this.chromiumPath) return this.chromiumPath;

    const wovlyDir = path.join(os.homedir(), '.wovly');
    const chromiumDir = path.join(wovlyDir, 'chromium');

    try {
      await fs.mkdir(chromiumDir, { recursive: true });
    } catch {
      /* ignore */
    }

    const possiblePaths = [
      path.join(os.homedir(), '.cache', 'puppeteer', 'chrome'),
      path.join(os.homedir(), 'Library', 'Caches', 'puppeteer', 'chrome'),
      path.join(os.homedir(), '.cache', 'ms-playwright', 'chromium-1148'),
      path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright', 'chromium-1148'),
    ];

    if (process.platform === 'darwin') {
      possiblePaths.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
      possiblePaths.push('/Applications/Chromium.app/Contents/MacOS/Chromium');
    }

    for (const basePath of possiblePaths) {
      try {
        const stat = await fs.stat(basePath);
        if (stat.isFile()) {
          this.chromiumPath = basePath;
          console.log(`[BrowserController] Using Chromium at: ${basePath}`);
          return basePath;
        }
        if (stat.isDirectory()) {
          const chromePaths = [
            path.join(basePath, 'chrome'),
            path.join(basePath, 'chrome.exe'),
            path.join(
              basePath,
              'Google Chrome for Testing.app',
              'Contents',
              'MacOS',
              'Google Chrome for Testing'
            ),
          ];
          for (const chromePath of chromePaths) {
            try {
              await fs.access(chromePath);
              this.chromiumPath = chromePath;
              console.log(`[BrowserController] Using Chromium at: ${chromePath}`);
              return chromePath;
            } catch {
              /* continue */
            }
          }
        }
      } catch {
        /* continue */
      }
    }

    console.log('[BrowserController] Downloading Chromium...');
    try {
      if (!puppeteer) {
        puppeteer = await loadPuppeteer();
      }

      // Type assertion for createBrowserFetcher (exists at runtime but not in types)
      const browserFetcher = (puppeteer as any).createBrowserFetcher({
        path: chromiumDir,
        product: 'chrome',
      });

      const revisionInfo = await browserFetcher.download('stable');
      this.chromiumPath = revisionInfo.executablePath;
      console.log(`[BrowserController] Downloaded Chromium to: ${this.chromiumPath}`);
      return this.chromiumPath!;
    } catch (err) {
      console.error('[BrowserController] Failed to download Chromium:', (err as Error).message);
      if (process.platform === 'darwin') {
        const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
        try {
          await fs.access(systemChrome);
          this.chromiumPath = systemChrome;
          console.log('[BrowserController] Falling back to system Chrome');
          return systemChrome;
        } catch {
          /* continue */
        }
      }
      throw new Error('No Chromium/Chrome installation found. Please install Chrome or Chromium.');
    }
  }

  async initialize(username: string): Promise<void> {
    if (!username) {
      throw new Error('[BrowserController] Username required for initialization');
    }

    if (this.initialized && this.username !== username) {
      console.log(
        `[BrowserController] User changed from ${this.username} to ${username}, reinitializing...`
      );
      await this.cleanup();
      this.initialized = false;
    }

    if (this.initialized) return;
    if (this.initializing) return this.initializing;

    this.username = username;
    this.initializing = this._doInitialize();
    try {
      await this.initializing;
      this.initialized = true;
    } finally {
      this.initializing = null;
    }
  }

  private async _doInitialize(): Promise<void> {
    console.log(`[BrowserController] Initializing for user: ${this.username}...`);

    if (!puppeteer) {
      puppeteer = await loadPuppeteer();
    }

    const chromiumPath = await this.getChromiumPath();

    const userDataDir = path.join(
      os.homedir(),
      '.wovly-assistant',
      'users',
      this.username!,
      'browser-data'
    );
    try {
      await fs.mkdir(userDataDir, { recursive: true });
    } catch {
      /* ignore */
    }
    console.log(`[BrowserController] Using per-user browser data: ${userDataDir}`);

    const args = [
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-site-isolation-trials',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--window-size=1200,900', // Smaller window: 1200x900 (about 60% of typical screen width)
      '--window-position=700,80', // Position to the right, leaving space for the app on the left
      '--disable-infobars',
      '--disable-extensions',
      '--disable-gpu',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-sync',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-popup-blocking',
      '--autoplay-policy=no-user-gesture-required',
    ];

    this.browser = await puppeteer.launch({
      executablePath: chromiumPath,
      headless: false,
      defaultViewport: { width: 1200, height: 900 },
      args,
      userDataDir,
      ignoreDefaultArgs: ['--enable-automation'],
    } as LaunchOptions);

    this.browser.on('disconnected', () => {
      console.log('[BrowserController] Browser disconnected');
      this.initialized = false;
      this.browser = null;
      this.contexts.clear();
    });

    console.log('[BrowserController] Browser launched successfully');

    // Keep the main app window in focus (don't let browser steal focus)
    try {
      const mainWindow = BrowserWindow.getAllWindows().find(
        (win) => !win.isDestroyed() && win.webContents.getURL().includes('index.html')
      );
      if (mainWindow) {
        // Give browser a moment to open, then refocus main window
        setTimeout(() => {
          if (!mainWindow.isDestroyed()) {
            mainWindow.focus();
            mainWindow.moveTop();
          }
        }, 500);
      }
    } catch (err) {
      console.log('[BrowserController] Could not refocus main window:', err);
    }
  }

  async getPage(sessionId: string = 'default'): Promise<Page> {
    if (!this.initialized || !this.username) {
      throw new Error(
        '[BrowserController] Browser not initialized. Call getBrowserController(username) first.'
      );
    }

    if (this.contexts.has(sessionId)) {
      const { page } = this.contexts.get(sessionId)!;
      try {
        await page.evaluate(() => true);
        return page;
      } catch {
        this.contexts.delete(sessionId);
      }
    }

    const context = await this.browser!.createBrowserContext();
    const page = await context.newPage();

    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    await page.evaluateOnNewDocument(() => {
      Object.defineProperty((globalThis as any).navigator, 'webdriver', { get: () => undefined });
    });

    this.contexts.set(sessionId, { context, page });
    this.elementRefs.set(sessionId, new Map());

    console.log(`[BrowserController] Created new page for session: ${sessionId}`);
    return page;
  }

  async navigate(sessionId: string, url: string): Promise<SnapshotResult> {
    console.log(`[BrowserController] Navigating to: ${url}`);
    const page = await this.getPage(sessionId);

    try {
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
    } catch (err) {
      if ((err as Error).message.includes('timeout')) {
        console.log('[BrowserController] Navigation timeout, continuing anyway');
      } else {
        throw err;
      }
    }

    return this.snapshot(sessionId);
  }

  async screenshot(sessionId: string = 'default'): Promise<string> {
    const page = await this.getPage(sessionId);
    const screenshot = await page.screenshot({
      encoding: 'base64',
      type: 'jpeg',
      quality: 80,
      fullPage: false,
    } as ScreenshotOptions);
    return `data:image/jpeg;base64,${screenshot}`;
  }

  async snapshot(sessionId: string = 'default'): Promise<SnapshotResult> {
    const page = await this.getPage(sessionId);

    const screenshot = await page.screenshot({
      encoding: 'base64',
      type: 'jpeg',
      quality: 80,
    } as ScreenshotOptions);

    let elements: SnapshotElement[] = [];
    try {
      const accessibilityTree = await page.accessibility.snapshot({
        interestingOnly: true,
      });
      elements = this.parseAccessibilityTree(accessibilityTree, sessionId);
    } catch (err) {
      console.error(
        '[BrowserController] Failed to get accessibility tree:',
        (err as Error).message
      );
    }

    const url = page.url();
    const title = await page.title();

    return {
      screenshot: `data:image/jpeg;base64,${screenshot}`,
      elements,
      url,
      title,
      elementCount: elements.length,
    };
  }

  private parseAccessibilityTree(
    node: SerializedAXNode | null,
    sessionId: string,
    refs: SnapshotElement[] = [],
    counter: RefCounter = { value: 0 }
  ): SnapshotElement[] {
    if (!node) return refs;

    const refMap = this.elementRefs.get(sessionId) || new Map<string, ElementRefData>();

    const interactiveRoles = [
      'button',
      'link',
      'textbox',
      'checkbox',
      'radio',
      'combobox',
      'menuitem',
      'tab',
      'searchbox',
      'slider',
      'spinbutton',
      'switch',
    ];

    if (node.role && (interactiveRoles.includes(node.role) || node.focused)) {
      const ref = `e${counter.value++}`;
      const element: SnapshotElement = {
        ref,
        role: node.role,
        name: node.name || '',
        value: node.value !== undefined ? String(node.value) : undefined,
        focused: node.focused || false,
        disabled: node.disabled || false,
      };
      refs.push(element);

      refMap.set(ref, {
        name: node.name || '',
        role: node.role,
        selector: this.buildSelector(node),
      });
    }

    if (node.children) {
      for (const child of node.children) {
        this.parseAccessibilityTree(child, sessionId, refs, counter);
      }
    }

    this.elementRefs.set(sessionId, refMap);
    return refs;
  }

  private buildSelector(node: SerializedAXNode): string | null {
    if (!node) return null;

    const roleMap: Record<string, string> = {
      button: 'button',
      link: 'a',
      textbox: 'input, textarea',
      checkbox: 'input[type="checkbox"]',
      radio: 'input[type="radio"]',
      combobox: 'select',
      searchbox: 'input[type="search"]',
    };

    const baseSelector = roleMap[node.role] || '*';

    if (node.name) {
      return `${baseSelector}:has-text("${node.name.replace(/"/g, '\\"').substring(0, 50)}")`;
    }

    return baseSelector;
  }

  async click(sessionId: string, ref: string): Promise<ClickResult> {
    console.log(`[BrowserController] Clicking: ${ref}`);
    const page = await this.getPage(sessionId);

    const refMap = this.elementRefs.get(sessionId);
    if (!refMap || !refMap.has(ref)) {
      throw new Error(`Element ref "${ref}" not found. Take a new snapshot first.`);
    }

    const element = refMap.get(ref)!;

    // Strategy 1: Use page.evaluate with flexible text matching
    try {
      const clicked = await page.evaluate(
        (name: string, role: string) => {
          const searchName = name.toLowerCase().replace(/\*+$/, '').trim();
          const simplifiedSearch = searchName.replace(/[^a-z0-9]/g, '');

          let selector =
            'button, a, input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"]';
          if (role === 'textbox') {
            selector = 'input, textarea, [contenteditable="true"]';
          } else if (role === 'button') {
            selector = 'button, [role="button"], input[type="submit"], input[type="button"]';
          } else if (role === 'link') {
            selector = 'a, [role="link"]';
          }

          const doc = (globalThis as any).document;
          const elements = doc.querySelectorAll(selector);
          for (const el of elements) {
            const text = (el.textContent || '').trim().toLowerCase();
            const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
            const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
            const value = (el.value || '').toLowerCase();
            const title = (el.getAttribute('title') || '').toLowerCase();
            const attrName = (el.getAttribute('name') || '').toLowerCase();
            const id = (el.id || '').toLowerCase();

            const allText = [text, ariaLabel, placeholder, value, title, attrName, id];

            const exactMatch = allText.some((t: string) => t.includes(searchName));
            const fuzzyMatch = allText.some((t: string) => {
              const simplifiedT = t.replace(/[^a-z0-9]/g, '');
              return (
                simplifiedT.includes(simplifiedSearch) || simplifiedSearch.includes(simplifiedT)
              );
            });

            const keywords = searchName.split(/\s+/).filter((w: string) => w.length > 3);
            const keywordMatch =
              keywords.length > 0 &&
              keywords.every((kw: string) => allText.some((t: string) => t.includes(kw)));

            if (exactMatch || fuzzyMatch || keywordMatch) {
              if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                el.focus();
              } else {
                el.click();
              }
              return true;
            }
          }
          return false;
        },
        element.name,
        element.role
      );

      if (clicked) {
        return { success: true, clicked: ref };
      }
    } catch (err) {
      console.log(`[BrowserController] Click strategy 1 failed: ${(err as Error).message}`);
    }

    // Strategy 2: Try by index
    try {
      const refIndex = parseInt(ref.replace('e', ''), 10);

      const clicked = await page.evaluate(
        (role: string, targetIndex: number) => {
          let selector =
            'button, a, input, select, textarea, [role="button"], [role="link"], [role="tab"], [role="menuitem"]';
          if (role === 'textbox') {
            selector = 'input:not([type="hidden"]), textarea, [contenteditable="true"]';
          }

          const doc = (globalThis as any).document;
          const elements = Array.from(doc.querySelectorAll(selector));
          const visible = elements.filter((el: any) => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });

          if (targetIndex < visible.length) {
            const el = visible[targetIndex] as any;
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
              el.focus();
            } else {
              el.click();
            }
            return true;
          }
          return false;
        },
        element.role,
        refIndex
      );

      if (clicked) {
        console.log(`[BrowserController] Click strategy 2 succeeded`);
        return { success: true, clicked: ref };
      }
    } catch (err) {
      console.log(`[BrowserController] Click strategy 2 failed: ${(err as Error).message}`);
    }

    throw new Error(
      `Failed to click element "${ref}" (${element.name}). Try a different element or take a new snapshot.`
    );
  }

  async type(
    sessionId: string,
    text: string,
    ref: string | null = null,
    sensitive: boolean = false
  ): Promise<TypeResult> {
    const logText = sensitive ? '********' : `${text.substring(0, 10)}...`;
    console.log(`[BrowserController] Typing: "${logText}" into ${ref || 'focused element'}`);
    const page = await this.getPage(sessionId);

    let focusSucceeded = false;

    if (ref) {
      try {
        await this.click(sessionId, ref);
        await new Promise((r) => setTimeout(r, 100));
        focusSucceeded = true;
      } catch (err) {
        console.log(`[BrowserController] Click-to-focus failed: ${(err as Error).message}`);
      }
    }

    const isMac = process.platform === 'darwin';
    const modifier = isMac ? 'Meta' : 'Control';

    await page.keyboard.down(modifier);
    await page.keyboard.press('KeyA');
    await page.keyboard.up(modifier);
    await page.keyboard.type(text, { delay: 30 });

    return { success: true, typed: text.substring(0, 50), focused: focusSucceeded };
  }

  async press(sessionId: string, key: string): Promise<PressResult> {
    console.log(`[BrowserController] Pressing key: ${key}`);
    const page = await this.getPage(sessionId);
    await page.keyboard.press(key as KeyInput);
    return { success: true, pressed: key };
  }

  async scroll(
    sessionId: string,
    direction: 'up' | 'down' = 'down',
    amount: number = 500
  ): Promise<ScrollResult> {
    const page = await this.getPage(sessionId);
    const delta = direction === 'up' ? -amount : amount;
    await page.mouse.wheel({ deltaY: delta });
    return { success: true, scrolled: direction };
  }

  async goBack(sessionId: string): Promise<SnapshotResult> {
    const page = await this.getPage(sessionId);
    await page.goBack();
    return this.snapshot(sessionId);
  }

  async goForward(sessionId: string): Promise<SnapshotResult> {
    const page = await this.getPage(sessionId);
    await page.goForward();
    return this.snapshot(sessionId);
  }

  async reload(sessionId: string): Promise<SnapshotResult> {
    const page = await this.getPage(sessionId);
    await page.reload();
    return this.snapshot(sessionId);
  }

  async getUrl(sessionId: string = 'default'): Promise<string> {
    const page = await this.getPage(sessionId);
    return page.url();
  }

  async cleanup(): Promise<void> {
    console.log('[BrowserController] Cleaning up...');

    for (const [sessionId, { context }] of this.contexts) {
      try {
        await context.close();
      } catch {
        /* ignore */
      }
    }
    this.contexts.clear();
    this.elementRefs.clear();

    if (this.browser) {
      try {
        await this.browser.close();
      } catch {
        /* ignore */
      }
      this.browser = null;
    }

    this.initialized = false;
    console.log('[BrowserController] Cleanup complete');
  }
}

// Global browser controller instance
let browserController: BrowserController | null = null;

/**
 * Get or create the browser controller with per-user isolation
 */
export async function getBrowserController(username: string): Promise<BrowserController> {
  if (!username) {
    throw new Error('[BrowserController] Username required to get browser controller');
  }
  if (!browserController) {
    browserController = new BrowserController();
  }
  await browserController.initialize(username);
  return browserController;
}
