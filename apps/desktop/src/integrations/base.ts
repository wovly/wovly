/**
 * Base Integration Interface
 *
 * All integration modules must implement this structure.
 * This provides a consistent pattern for tool definitions and execution.
 */

/**
 * Claude API tool definition
 */
export interface Tool {
  /** Tool name (must be unique across all integrations) */
  name: string;

  /** Human-readable description of what the tool does */
  description: string;

  /** JSON schema for tool input parameters */
  input_schema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

/**
 * Integration module definition
 *
 * Each integration (Slack, Google, etc.) exports an object implementing this interface
 */
export interface Integration {
  /** Integration name (e.g., "slack", "github") */
  name: string;

  /** Category for organization and filtering */
  category: 'messaging' | 'productivity' | 'social' | 'utilities' | 'core';

  /** Array of tool definitions provided by this integration */
  tools: Tool[];

  /**
   * Execute a tool from this integration
   *
   * @param toolName - Name of the tool to execute
   * @param toolInput - Input parameters for the tool
   * @param context - Runtime context (user, tokens, settings, etc.)
   * @returns Tool execution result
   */
  execute: (toolName: string, toolInput: any, context: IntegrationContext) => Promise<any>;

  /**
   * Check if integration is available for current user
   *
   * Used to filter tools based on authentication status, settings, etc.
   * If not provided, integration is always considered available.
   */
  isAvailable?: (context: IntegrationContext) => Promise<boolean>;
}

/**
 * Runtime context passed to integrations
 *
 * Contains all dependencies needed for tool execution
 */
export interface IntegrationContext {
  /** Current logged-in user */
  currentUser?: {
    username: string;
    [key: string]: any;
  };

  /** Electron main window (for sending IPC messages to renderer) */
  mainWindow?: any;

  /** User settings/preferences */
  settings?: {
    weatherEnabled?: boolean;
    browserEnabled?: boolean;
    [key: string]: any;
  };

  /** OAuth access tokens for external services */
  accessTokens?: {
    google?: string;
    slack?: string;
    discord?: string;
    reddit?: string;
    spotify?: string;
    github?: string;
    asana?: string;
    notion?: string;
    [key: string]: string | undefined;
  };

  /** Additional context as needed */
  [key: string]: any;
}

/**
 * Standard response format for integration tool execution
 */
export interface IntegrationResponse {
  /** Whether the operation succeeded */
  success?: boolean;

  /** Error message if operation failed */
  error?: string;

  /** Additional response data */
  [key: string]: any;
}
