/**
 * Browser Integration
 *
 * Provides CDP-based browser automation tools:
 * - Navigate to URLs
 * - Click elements by ref
 * - Type text into inputs
 * - Press keyboard keys
 * - Take page snapshots
 * - Scroll pages
 * - Navigate browser history
 * - Fill credentials securely
 */

import { Integration, Tool, IntegrationContext } from '../base';
// @ts-ignore
import { getBrowserController, loadCredentials } from '../../../main';

// ─────────────────────────────────────────────────────────────────────────────
// Tool Definitions
// ─────────────────────────────────────────────────────────────────────────────

const browserTools: Tool[] = [
  {
    name: 'browser_navigate',
    description:
      'Navigate to a URL in the browser. Returns a visual snapshot with clickable element refs. Use this to open websites, search pages, etc.',
    input_schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description:
            "The URL to navigate to (e.g., 'https://google.com' or 'https://zillow.com/homes/palo-alto')",
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'browser_click',
    description:
      "Click an element on the page by its ref (e.g., 'e23'). Get refs from browser_snapshot. After clicking, a new snapshot is returned.",
    input_schema: {
      type: 'object',
      properties: {
        ref: {
          type: 'string',
          description: "Element ref from the snapshot (e.g., 'e5', 'e23')",
        },
      },
      required: ['ref'],
    },
  },
  {
    name: 'browser_type',
    description:
      'Type text into an input field. Optionally specify a ref to focus that element first. If no ref, types into the currently focused element.',
    input_schema: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'The text to type',
        },
        ref: {
          type: 'string',
          description: 'Optional: Element ref to focus first before typing',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'browser_press',
    description:
      "Press a keyboard key (e.g., 'Enter', 'Tab', 'Escape', 'ArrowDown'). Use after typing to submit forms.",
    input_schema: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description: "Key to press (e.g., 'Enter', 'Tab', 'Escape', 'ArrowDown', 'ArrowUp')",
        },
      },
      required: ['key'],
    },
  },
  {
    name: 'browser_snapshot',
    description:
      "Get a visual snapshot of the current page. Returns a screenshot and list of clickable elements with refs. Use this to see what's on the page and get element refs for clicking/typing.",
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'browser_scroll',
    description: 'Scroll the page up or down to see more content.',
    input_schema: {
      type: 'object',
      properties: {
        direction: {
          type: 'string',
          enum: ['up', 'down'],
          description: 'Direction to scroll',
        },
        amount: {
          type: 'number',
          description: 'Pixels to scroll (default: 500)',
        },
      },
      required: ['direction'],
    },
  },
  {
    name: 'browser_back',
    description: 'Go back to the previous page in browser history.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'browser_fill_credential',
    description:
      'Securely fill a login form field with a saved credential. Use this for login forms when the user has saved credentials for the domain. The actual credential value is never exposed.',
    input_schema: {
      type: 'object',
      properties: {
        domain: {
          type: 'string',
          description:
            "The domain to get credentials for (e.g., 'mybrightwheel.com', 'amazon.com')",
        },
        field: {
          type: 'string',
          enum: ['username', 'password'],
          description: "Which credential field to fill: 'username' or 'password'",
        },
        ref: {
          type: 'string',
          description: "Element ref of the input field to fill (e.g., 'e5')",
        },
      },
      required: ['domain', 'field', 'ref'],
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Tool Execution
// ─────────────────────────────────────────────────────────────────────────────

async function executeBrowserTool(
  toolName: string,
  toolInput: any,
  context: IntegrationContext
): Promise<any> {
  try {
    if (!context.currentUser?.username) {
      return { error: 'Not logged in - browser automation requires authentication' };
    }

    const controller = await getBrowserController(context.currentUser.username);
    const sessionId = toolInput.sessionId || 'default';

    switch (toolName) {
      case 'browser_navigate': {
        if (!toolInput.url) {
          return { error: 'URL is required' };
        }
        const snapshot = await controller.navigate(sessionId, toolInput.url);
        return {
          success: true,
          url: snapshot.url,
          title: snapshot.title,
          elementCount: snapshot.elementCount,
          elements: snapshot.elements.slice(0, 50), // Limit elements to save tokens
          screenshotDataUrl: snapshot.screenshot,
          message: `Navigated to ${snapshot.url}. Found ${snapshot.elementCount} interactive elements. A screenshot is attached.`,
        };
      }

      case 'browser_click': {
        if (!toolInput.ref) {
          return { error: "Element ref is required (e.g., 'e5')" };
        }
        await controller.click(sessionId, toolInput.ref);
        // Wait for any navigation/updates
        await new Promise((resolve) => setTimeout(resolve, 500));
        // Return new snapshot
        const snapshot = await controller.snapshot(sessionId);
        return {
          success: true,
          clicked: toolInput.ref,
          url: snapshot.url,
          title: snapshot.title,
          elementCount: snapshot.elementCount,
          elements: snapshot.elements.slice(0, 50),
          screenshotDataUrl: snapshot.screenshot,
          message: `Clicked ${toolInput.ref}. Page updated. Screenshot attached.`,
        };
      }

      case 'browser_type': {
        if (!toolInput.text) {
          return { error: 'Text is required' };
        }
        const typeResult = await controller.type(sessionId, toolInput.text, toolInput.ref);

        // Get a snapshot to verify typing worked
        await new Promise((resolve) => setTimeout(resolve, 300));
        const snapshot = await controller.snapshot(sessionId);

        return {
          success: true,
          typed: toolInput.text.substring(0, 50) + (toolInput.text.length > 50 ? '...' : ''),
          focused: typeResult.focused,
          url: snapshot.url,
          elements: snapshot.elements.slice(0, 50),
          screenshotDataUrl: snapshot.screenshot,
          message: typeResult.focused
            ? `Typed "${toolInput.text.substring(0, 30)}..." into the input. Screenshot shows current state. Use browser_press with 'Enter' to submit.`
            : `Warning: Could not confirm focus on input element. Text may not have been typed. Check the screenshot and try clicking the input field first with browser_click.`,
        };
      }

      case 'browser_press': {
        if (!toolInput.key) {
          return { error: "Key is required (e.g., 'Enter')" };
        }
        await controller.press(sessionId, toolInput.key);
        // Wait for any updates after key press
        await new Promise((resolve) => setTimeout(resolve, 500));
        // Return snapshot if Enter was pressed (likely form submission)
        if (toolInput.key === 'Enter') {
          const snapshot = await controller.snapshot(sessionId);
          return {
            success: true,
            pressed: toolInput.key,
            url: snapshot.url,
            title: snapshot.title,
            elementCount: snapshot.elementCount,
            elements: snapshot.elements.slice(0, 50),
            screenshotDataUrl: snapshot.screenshot,
            message: `Pressed ${toolInput.key}. Page may have updated. Screenshot attached.`,
          };
        }
        return {
          success: true,
          pressed: toolInput.key,
          message: `Pressed ${toolInput.key}`,
        };
      }

      case 'browser_snapshot': {
        const snapshot = await controller.snapshot(sessionId);
        return {
          success: true,
          url: snapshot.url,
          title: snapshot.title,
          elementCount: snapshot.elementCount,
          elements: snapshot.elements.slice(0, 50),
          screenshotDataUrl: snapshot.screenshot,
          message: `Current page: ${snapshot.title}. Found ${snapshot.elementCount} interactive elements. Screenshot attached.`,
        };
      }

      case 'browser_scroll': {
        const direction = toolInput.direction || 'down';
        const amount = toolInput.amount || 500;
        await controller.scroll(sessionId, direction, amount);
        // Return snapshot after scroll
        const snapshot = await controller.snapshot(sessionId);
        return {
          success: true,
          scrolled: direction,
          url: snapshot.url,
          elementCount: snapshot.elementCount,
          elements: snapshot.elements.slice(0, 50),
          screenshotDataUrl: snapshot.screenshot,
          message: `Scrolled ${direction}. Screenshot attached.`,
        };
      }

      case 'browser_back': {
        const snapshot = await controller.goBack(sessionId);
        return {
          success: true,
          url: snapshot.url,
          title: snapshot.title,
          elementCount: snapshot.elementCount,
          elements: snapshot.elements.slice(0, 50),
          screenshotDataUrl: snapshot.screenshot,
          message: `Went back to ${snapshot.url}. Screenshot attached.`,
        };
      }

      case 'browser_fill_credential': {
        const { domain, field, ref } = toolInput;
        if (!domain || !field || !ref) {
          return { error: 'domain, field, and ref are all required' };
        }

        // Load credentials for this domain
        const credentials = await loadCredentials();
        const cred = credentials[domain];

        if (!cred) {
          return {
            error: `No credentials found for domain: ${domain}`,
            suggestion: `The user needs to add credentials for ${domain} in the Credentials page of the app.`,
          };
        }

        let valueToFill;
        if (field === 'username') {
          valueToFill = cred.username;
          if (!valueToFill) {
            return { error: `No username saved for ${domain}` };
          }
        } else if (field === 'password') {
          valueToFill = cred.password;
          if (!valueToFill) {
            return { error: `No password saved for ${domain}` };
          }
        } else {
          return { error: `Invalid field: ${field}. Must be 'username' or 'password'` };
        }

        // Use the controller to type the credential value
        // First click the ref to focus, then type
        // Pass sensitive=true for passwords to mask in logs
        await controller.click(sessionId, ref);
        await controller.type(sessionId, valueToFill, null, field === 'password');

        console.log(`[BrowserController] Filled ${field} credential for ${domain} into ${ref}`);

        return {
          success: true,
          message: `Securely filled ${field} for ${domain} into field ${ref}. The actual credential value is not shown for security.`,
        };
      }

      default:
        return { error: `Unknown browser tool: ${toolName}` };
    }
  } catch (err: any) {
    console.error(`[BrowserController] Error executing ${toolName}:`, err.message);
    return {
      error: err.message,
      suggestion:
        'Try browser_snapshot to see the current page state, or browser_navigate to a new URL.',
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Integration Export
// ─────────────────────────────────────────────────────────────────────────────

export const browserIntegration: Integration = {
  name: 'browser',
  category: 'utilities',
  tools: browserTools,
  execute: executeBrowserTool,
  isAvailable: async (context) => !!context.settings?.browserEnabled,
};
