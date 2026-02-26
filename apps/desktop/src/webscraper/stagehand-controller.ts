/**
 * Stagehand Browser Controller
 *
 * AI-powered browser automation wrapper that provides:
 * - Natural language actions (act)
 * - Multi-step workflows (agent)
 * - Structured data extraction (extract)
 * - Self-healing when selectors break
 */

import { Stagehand } from '@browserbasehq/stagehand';
import type { Page } from 'puppeteer-core';
import type { z } from 'zod';

export interface StagehandConfig {
  apiKey?: string;
  modelName?: string;
  headless?: boolean;
  verbose?: 0 | 1 | 2;
}

/**
 * Enhanced browser controller with AI capabilities
 * Uses Stagehand for intelligent automation when deterministic selectors fail
 */
export class StagehandController {
  private stagehand: Stagehand | null = null;
  private config: StagehandConfig;
  private initialized = false;

  constructor(config: StagehandConfig = {}) {
    this.config = {
      headless: false,
      verbose: 1,
      modelName: 'anthropic/claude-sonnet-4-5-20250929',
      ...config,
    };
  }

  /**
   * Initialize Stagehand instance
   * Call this before using any AI features
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      console.log('[Stagehand] Already initialized');
      return;
    }

    try {
      console.log('[Stagehand] Initializing with config:', {
        model: this.config.modelName,
        headless: this.config.headless,
      });

      this.stagehand = new Stagehand({
        env: 'LOCAL',
        model: this.config.modelName,
        localBrowserLaunchOptions: {
          headless: this.config.headless,
        },
        verbose: this.config.verbose,
        serverCache: true, // Enable action caching for cost reduction
        selfHeal: true, // Enable self-healing when selectors break
      });

      await this.stagehand.init();
      this.initialized = true;
      console.log('[Stagehand] ✅ Initialized successfully');
    } catch (err: any) {
      console.error('[Stagehand] Initialization failed:', err.message);
      throw new Error(`Failed to initialize Stagehand: ${err.message}`);
    }
  }

  /**
   * Execute a single action using natural language
   * Example: "Click the login button", "Type 'test@email.com' in the email field"
   *
   * @param instruction - Natural language description of the action
   * @returns Promise that resolves when action completes
   */
  async act(instruction: string): Promise<void> {
    this.ensureInitialized();

    try {
      console.log(`[Stagehand] Acting: "${instruction}"`);
      await this.stagehand!.act(instruction);
      console.log('[Stagehand] ✅ Action completed');
    } catch (err: any) {
      console.error('[Stagehand] Action failed:', err.message);
      throw new Error(`Stagehand action failed: ${err.message}`);
    }
  }

  /**
   * Execute a multi-step task using an autonomous agent
   * The agent will break down the task and execute multiple actions
   *
   * @param task - High-level task description
   * @returns Promise that resolves when task completes
   */
  async executeTask(task: string): Promise<void> {
    this.ensureInitialized();

    try {
      console.log(`[Stagehand] Executing task: "${task}"`);
      const agent = this.stagehand!.agent();
      await agent.execute(task);
      console.log('[Stagehand] ✅ Task completed');
    } catch (err: any) {
      console.error('[Stagehand] Task execution failed:', err.message);
      throw new Error(`Stagehand task failed: ${err.message}`);
    }
  }

  /**
   * Extract structured data from the current page
   * Uses Zod schema for type-safe extraction
   *
   * @param instruction - What to extract
   * @param schema - Zod schema defining the structure
   * @returns Extracted data matching the schema
   */
  async extract<T extends z.ZodTypeAny>(instruction: string, schema: T): Promise<z.infer<T>> {
    this.ensureInitialized();

    try {
      console.log(`[Stagehand] Extracting: "${instruction}"`);
      const result = await this.stagehand!.extract(instruction, schema);
      console.log('[Stagehand] ✅ Extraction completed');
      return result;
    } catch (err: any) {
      console.error('[Stagehand] Extraction failed:', err.message);
      throw new Error(`Stagehand extraction failed: ${err.message}`);
    }
  }

  /**
   * Get the underlying Puppeteer-like page for direct manipulation
   * Useful for mixing AI actions with traditional Puppeteer code
   */
  async getPage(): Promise<Page | null> {
    if (!this.initialized || !this.stagehand) {
      return null;
    }

    try {
      const context = this.stagehand.context;
      const pages = context.pages();
      return pages.length > 0 ? (pages[0] as unknown as Page) : null;
    } catch (err: any) {
      console.error('[Stagehand] Error getting page:', err.message);
      return null;
    }
  }

  /**
   * Navigate to a URL
   * @param url - URL to navigate to
   */
  async goto(url: string): Promise<void> {
    this.ensureInitialized();

    try {
      const page = await this.getPage();
      if (page) {
        console.log(`[Stagehand] Navigating to ${url}`);
        await page.goto(url, { waitUntil: 'networkidle0' });
      } else {
        throw new Error('No page available');
      }
    } catch (err: any) {
      console.error('[Stagehand] Navigation failed:', err.message);
      throw new Error(`Navigation failed: ${err.message}`);
    }
  }

  /**
   * Take a screenshot of the current page
   * @returns Base64 encoded screenshot
   */
  async screenshot(): Promise<string> {
    this.ensureInitialized();

    try {
      const page = await this.getPage();
      if (!page) {
        throw new Error('No page available');
      }

      const screenshot = await page.screenshot({ encoding: 'base64' });
      return screenshot as string;
    } catch (err: any) {
      console.error('[Stagehand] Screenshot failed:', err.message);
      throw new Error(`Screenshot failed: ${err.message}`);
    }
  }

  /**
   * Close the browser and cleanup
   */
  async close(): Promise<void> {
    if (this.stagehand) {
      try {
        console.log('[Stagehand] Closing browser');
        await this.stagehand.close();
        this.initialized = false;
        this.stagehand = null;
      } catch (err: any) {
        console.error('[Stagehand] Error closing:', err.message);
      }
    }
  }

  /**
   * Check if Stagehand is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Ensure Stagehand is initialized before operations
   */
  private ensureInitialized(): void {
    if (!this.initialized || !this.stagehand) {
      throw new Error('Stagehand not initialized. Call initialize() first.');
    }
  }
}

/**
 * Factory function to create a Stagehand controller
 * @param apiKey - Anthropic API key for LLM calls
 * @returns Initialized Stagehand controller
 */
export async function createStagehandController(apiKey: string): Promise<StagehandController> {
  const controller = new StagehandController({
    apiKey,
    headless: false,
    verbose: 1,
  });

  await controller.initialize();
  return controller;
}
