/**
 * Element Detector
 *
 * Improved DOM extraction that replaces the restrictive accessibility tree approach.
 * Supports Shadow DOM, iframes, and generates robust CSS/XPath selectors.
 *
 * Note: This file uses page.evaluate() which runs in browser context.
 * Browser APIs (document, Element, CSS, etc.) are available there but not type-checked.
 */

// @ts-nocheck - Browser context code with DOM APIs

import type { Page } from 'puppeteer-core';

// ─────────────────────────────────────────────────────────────────────────
// Type Definitions
// ─────────────────────────────────────────────────────────────────────────

export interface ExtractPageElementsOptions {
  includeHidden?: boolean;
  includeShadowDOM?: boolean;
  includeIframes?: boolean;
  maxElements?: number;
}

export interface ElementRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ElementInfo {
  tagName: string;
  type: string | null;
  text: string;
  placeholder: string | null;
  ariaLabel: string | null;
  name: string | null;
  value: string | null;
  cssSelector: string;
  xpathSelector: string;
  visible: boolean;
  context: string;
  rect: ElementRect;
}

export interface ElementCriteria {
  tagName?: string;
  type?: string;
  text?: string;
  placeholder?: string;
  name?: string;
  visible?: boolean;
}

export interface ElementDetail {
  tagName: string;
  text?: string;
  visible: boolean;
}

export interface SelectorTestResult {
  valid: boolean;
  count: number;
  error?: string;
  details?: ElementDetail[];
  sample?: ElementDetail;
}

// ─────────────────────────────────────────────────────────────────────────
// Element Extraction
// ─────────────────────────────────────────────────────────────────────────

/**
 * Extract all interactive elements from a page
 * @param page - Puppeteer page instance
 * @param options - Extraction options
 * @returns Array of element descriptors
 */
export async function extractPageElements(
  page: Page,
  options: ExtractPageElementsOptions = {}
): Promise<ElementInfo[]> {
  const defaultOptions: Required<ExtractPageElementsOptions> = {
    includeHidden: false,
    includeShadowDOM: true,
    includeIframes: true,
    maxElements: 500,
  };

  const opts = { ...defaultOptions, ...options };

  // Browser context code - DOM APIs available

  const elements = (await page.evaluate(
    ((opts: any) => {
      const results: any[] = [];

      /**
       * Generate optimal CSS selector for an element
       * Prioritizes: ID > unique class > nth-child
       */

      function generateCSSSelector(el: any): any {
        // Try ID first
        if (el.id) {
          return `#${CSS.escape(el.id)}`;
        }

        // Try unique class combination
        if (el.className && typeof el.className === 'string') {
          const classes = el.className
            .trim()
            .split(/\s+/)
            .filter((c) => c);
          if (classes.length > 0) {
            const classSelector = '.' + classes.map((c) => CSS.escape(c)).join('.');
            if (document.querySelectorAll(classSelector).length === 1) {
              return classSelector;
            }
          }
        }

        // Build path using nth-child
        const path: string[] = [];
        let current: Element | null = el;

        while (current && current.nodeType === Node.ELEMENT_NODE) {
          let selector = current.tagName.toLowerCase();

          if (current.id) {
            selector = `#${CSS.escape(current.id)}`;
            path.unshift(selector);
            break;
          }

          // Get sibling index
          let sibling: Element | null = current;
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
        }

        return path.join(' > ');
      }

      /**
       * Generate XPath for an element
       */
      function generateXPath(el) {
        if (el.id) {
          return `//*[@id="${el.id}"]`;
        }

        const path: string[] = [];
        let current: Element | null = el;

        while (current && current.nodeType === Node.ELEMENT_NODE) {
          let index = 1;
          let sibling: Node | null = current.previousSibling;

          while (sibling) {
            if (
              sibling.nodeType === Node.ELEMENT_NODE &&
              (sibling as Element).tagName === current.tagName
            ) {
              index++;
            }
            sibling = sibling.previousSibling;
          }

          const tagName = current.tagName.toLowerCase();
          path.unshift(`${tagName}[${index}]`);
          current = current.parentElement;
        }

        return '/' + path.join('/');
      }

      /**
       * Extract elements from a document or shadow root
       */
      function extractFromRoot(root, context = 'main') {
        const selectors = [
          'input:not([type="hidden"])',
          'button',
          'a',
          'select',
          'textarea',
          '[role="button"]',
          '[role="link"]',
          '[onclick]',
          '[contenteditable="true"]',
          '[tabindex]:not([tabindex="-1"])',
        ];

        selectors.forEach((selector) => {
          try {
            root.querySelectorAll(selector).forEach((el) => {
              const element = el as HTMLElement;
              const rect = element.getBoundingClientRect();
              const isVisible = rect.width > 0 && rect.height > 0;

              if (!opts.includeHidden && !isVisible) return;

              // Get computed style for additional visibility checks
              const style = window.getComputedStyle(element);
              const actuallyVisible =
                isVisible &&
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                style.opacity !== '0';

              const elementInfo = {
                tagName: element.tagName.toLowerCase(),
                type: (element as HTMLInputElement).type || null,
                text: element.textContent?.trim().substring(0, 100) || '',
                placeholder: (element as HTMLInputElement).placeholder || null,
                ariaLabel: element.getAttribute('aria-label'),
                name: (element as HTMLInputElement).name || null,
                value: (element as HTMLInputElement).value || null,
                cssSelector: generateCSSSelector(element),
                xpathSelector: generateXPath(element),
                visible: actuallyVisible,
                context,
                rect: {
                  x: Math.round(rect.x),
                  y: Math.round(rect.y),
                  width: Math.round(rect.width),
                  height: Math.round(rect.height),
                },
              };

              results.push(elementInfo);
            });
          } catch (e) {
            console.warn(`Error extracting elements with selector ${selector}:`, e);
          }
        });
      }

      // Extract from main document
      extractFromRoot(document, 'main');

      // Extract from Shadow DOM
      if (opts.includeShadowDOM) {
        document.querySelectorAll('*').forEach((el) => {
          if (el.shadowRoot) {
            extractFromRoot(el.shadowRoot, 'shadow');
          }
        });
      }

      // Extract from iframes (same-origin only)
      if (opts.includeIframes) {
        document.querySelectorAll('iframe').forEach((iframe, idx) => {
          try {
            if (iframe.contentDocument) {
              extractFromRoot(iframe.contentDocument, `iframe-${idx}`);
            }
          } catch {
            // Cross-origin iframe, skip
          }
        });
      }

      return results.slice(0, opts.maxElements);
    }) as any,
    opts
  )) as ElementInfo[];

  return elements;
}

/**
 * Find elements matching specific criteria
 * @param page - Puppeteer page instance
 * @param criteria - Search criteria
 * @returns Matching elements
 */
export async function findElements(page: Page, criteria: ElementCriteria): Promise<ElementInfo[]> {
  const allElements = await extractPageElements(page);

  return allElements.filter((el) => {
    if (criteria.tagName && el.tagName !== criteria.tagName.toLowerCase()) return false;
    if (criteria.type && el.type !== criteria.type) return false;
    if (criteria.text && !el.text.toLowerCase().includes(criteria.text.toLowerCase())) return false;
    if (
      criteria.placeholder &&
      !el.placeholder?.toLowerCase().includes(criteria.placeholder.toLowerCase())
    )
      return false;
    if (criteria.name && el.name !== criteria.name) return false;
    if (criteria.visible !== undefined && el.visible !== criteria.visible) return false;
    return true;
  });
}

/**
 * Test if a selector is valid and returns elements
 * @param page - Puppeteer page instance
 * @param selector - CSS selector to test
 * @returns Test results
 */
export async function testSelector(page: Page, selector: string): Promise<SelectorTestResult> {
  try {
    const elements = await page.$$(selector);
    const count = elements.length;

    if (count === 0) {
      return { valid: false, count: 0, error: 'No elements found' };
    }

    // Get details about found elements (browser context code)

    const details = await page.evaluate((sel: any) => {
      const els = document.querySelectorAll(sel);
      return Array.from(els)
        .slice(0, 5)
        .map((el) => ({
          tagName: el.tagName.toLowerCase(),
          text: el.textContent?.trim().substring(0, 50),
          visible: el.offsetParent !== null,
        }));
    }, selector);

    return {
      valid: true,
      count,
      details,
      sample: details[0],
    };
  } catch (error) {
    const err = error as Error;
    return {
      valid: false,
      count: 0,
      error: err.message,
    };
  }
}
