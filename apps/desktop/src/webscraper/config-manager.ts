/**
 * Configuration Manager
 *
 * Handles CRUD operations for web integration configurations.
 * Storage: ~/.wovly-assistant/users/{username}/web-integrations/
 */

import { promises as fs } from 'fs';
import path from 'path';
import { getUserDataDir } from '../utils/helpers';

// ─────────────────────────────────────────────────────────────────────────
// Type Definitions
// ─────────────────────────────────────────────────────────────────────────

export interface IntegrationStatus {
  lastCheck: string | null;
  lastSuccess: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  paused: boolean;
}

export interface SiteMetadata {
  id: string;
  name: string;
  enabled: boolean;
}

export interface WebIntegrationConfig {
  version: string;
  sites: SiteMetadata[];
  lastUpdated: string;
}

export interface SiteConfigSelectors {
  login: {
    usernameField: string;
    passwordField?: string;
    submitButton?: string;
    successIndicator?: string;
  };
  navigation?: Array<{
    step: number;
    action: string;
    selector: string;
    waitFor?: string;
    description?: string;
    delay?: number;
    value?: string;
  }>;
  messages?: {
    container: string;
    messageItem: string;
    sender: string;
    content: string;
    timestamp: string;
  };
  oauth?: {
    successDetectionSelector?: string;
    loginDetectionSelector?: string;
  };
}

export interface SiteConfig {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  credentialDomain: string;
  selectors: SiteConfigSelectors;
  sessionManagement?: {
    saveSession: boolean;
    sessionTimeout: number;
  };
  status: IntegrationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface FileSystemError extends Error {
  code?: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Directory Management
// ─────────────────────────────────────────────────────────────────────────

/**
 * Get the web integrations directory for a user
 * @param username - User's username
 * @returns Path to web integrations directory
 */
export async function getWebIntegrationsDir(username: string): Promise<string> {
  const userDataDir = await getUserDataDir(username);
  return path.join(userDataDir, 'web-integrations');
}

/**
 * Get the sites configuration directory
 * @param username - User's username
 * @returns Path to sites directory
 */
export async function getSitesDir(username: string): Promise<string> {
  const integrationsDir = await getWebIntegrationsDir(username);
  return path.join(integrationsDir, 'sites');
}

/**
 * Get the sessions directory
 * @param username - User's username
 * @returns Path to sessions directory
 */
export async function getSessionsDir(username: string): Promise<string> {
  const integrationsDir = await getWebIntegrationsDir(username);
  return path.join(integrationsDir, 'sessions');
}

/**
 * Ensure directories exist
 * @param username - User's username
 */
export async function ensureDirectories(username: string): Promise<void> {
  const dirs = [
    await getWebIntegrationsDir(username),
    await getSitesDir(username),
    await getSessionsDir(username),
  ];

  for (const dir of dirs) {
    await fs.mkdir(dir, { recursive: true });
  }
}

/**
 * Get the main config file path
 * @param username - User's username
 * @returns Path to config file
 */
async function getConfigFilePath(username: string): Promise<string> {
  const integrationsDir = await getWebIntegrationsDir(username);
  return path.join(integrationsDir, 'config.json');
}

/**
 * Initialize config if it doesn't exist
 * @param username - User's username
 */
async function initializeConfig(username: string): Promise<void> {
  await ensureDirectories(username);

  const configPath = await getConfigFilePath(username);

  try {
    await fs.access(configPath);
  } catch {
    // Config doesn't exist, create it
    const initialConfig: WebIntegrationConfig = {
      version: '1.0.0',
      sites: [],
      lastUpdated: new Date().toISOString(),
    };
    await fs.writeFile(configPath, JSON.stringify(initialConfig, null, 2));
  }
}

/**
 * Load main configuration
 * @param username - User's username
 * @returns Web integration configuration
 */
async function loadConfig(username: string): Promise<WebIntegrationConfig> {
  await initializeConfig(username);
  const configPath = await getConfigFilePath(username);
  const content = await fs.readFile(configPath, 'utf-8');
  return JSON.parse(content) as WebIntegrationConfig;
}

/**
 * Save main configuration
 * @param username - User's username
 * @param config - Configuration to save
 */
async function saveConfig(username: string, config: WebIntegrationConfig): Promise<void> {
  await ensureDirectories(username);
  const configPath = await getConfigFilePath(username);
  config.lastUpdated = new Date().toISOString();
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
}

/**
 * Get site configuration file path
 * @param username - User's username
 * @param siteId - Site identifier
 * @returns Path to site config file
 */
async function getSiteConfigPath(username: string, siteId: string): Promise<string> {
  const sitesDir = await getSitesDir(username);
  return path.join(sitesDir, `${siteId}.json`);
}

// ─────────────────────────────────────────────────────────────────────────
// CRUD Operations
// ─────────────────────────────────────────────────────────────────────────

/**
 * List all web integrations
 * @param username - User's username
 * @returns Array of site metadata
 */
export async function listIntegrations(username: string): Promise<SiteMetadata[]> {
  const config = await loadConfig(username);
  return config.sites;
}

/**
 * Get a specific integration by ID
 * @param username - User's username
 * @param siteId - Site identifier
 * @returns Site configuration or null if not found
 */
export async function getIntegration(username: string, siteId: string): Promise<SiteConfig | null> {
  const sitePath = await getSiteConfigPath(username, siteId);

  try {
    const content = await fs.readFile(sitePath, 'utf-8');
    return JSON.parse(content) as SiteConfig;
  } catch (error) {
    const err = error as FileSystemError;
    if (err.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

/**
 * Create a new web integration
 * @param username - User's username
 * @param siteConfig - Partial site configuration
 * @returns Complete site configuration
 */
export async function createIntegration(
  username: string,
  siteConfig: Partial<SiteConfig> & { name: string; url: string; selectors: SiteConfigSelectors }
): Promise<SiteConfig> {
  await ensureDirectories(username);

  // Generate ID from name if not provided
  const id =
    siteConfig.id ||
    siteConfig.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

  // Add metadata
  const fullConfig: SiteConfig = {
    id,
    name: siteConfig.name,
    url: siteConfig.url,
    credentialDomain: siteConfig.credentialDomain || new URL(siteConfig.url).hostname,
    selectors: siteConfig.selectors,
    sessionManagement: siteConfig.sessionManagement,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    enabled: siteConfig.enabled !== false,
    status: {
      lastCheck: null,
      lastSuccess: null,
      lastError: null,
      consecutiveFailures: 0,
      paused: false,
    },
  };

  // Save site config
  const sitePath = await getSiteConfigPath(username, fullConfig.id);
  await fs.writeFile(sitePath, JSON.stringify(fullConfig, null, 2));

  // Update main config
  const config = await loadConfig(username);
  config.sites.push({
    id: fullConfig.id,
    name: fullConfig.name,
    enabled: fullConfig.enabled,
  });
  await saveConfig(username, config);

  return fullConfig;
}

/**
 * Update an existing web integration
 * @param username - User's username
 * @param siteId - Site identifier
 * @param updates - Fields to update
 * @returns Updated site configuration
 */
export async function updateIntegration(
  username: string,
  siteId: string,
  updates: Partial<SiteConfig>
): Promise<SiteConfig> {
  const sitePath = await getSiteConfigPath(username, siteId);

  // Load existing config
  const existing = await getIntegration(username, siteId);
  if (!existing) {
    throw new Error(`Integration ${siteId} not found`);
  }

  // Merge updates
  const updated: SiteConfig = {
    ...existing,
    ...updates,
    id: siteId, // Prevent ID changes
    updatedAt: new Date().toISOString(),
  };

  // Save updated config
  await fs.writeFile(sitePath, JSON.stringify(updated, null, 2));

  // Update main config if name or enabled status changed
  if (updates.name !== undefined || updates.enabled !== undefined) {
    const config = await loadConfig(username);
    const index = config.sites.findIndex((s) => s.id === siteId);
    if (index !== -1) {
      config.sites[index] = {
        id: siteId,
        name: updated.name,
        enabled: updated.enabled,
      };
      await saveConfig(username, config);
    }
  }

  return updated;
}

/**
 * Delete a web integration
 * @param username - User's username
 * @param siteId - Site identifier
 */
export async function deleteIntegration(username: string, siteId: string): Promise<void> {
  const sitePath = await getSiteConfigPath(username, siteId);

  // Delete site config file
  try {
    await fs.unlink(sitePath);
  } catch (error) {
    const err = error as FileSystemError;
    if (err.code !== 'ENOENT') {
      throw error;
    }
  }

  // Delete session file if exists
  const sessionsDir = await getSessionsDir(username);
  const sessionPath = path.join(sessionsDir, `${siteId}.session`);
  try {
    await fs.unlink(sessionPath);
  } catch {
    // Ignore if doesn't exist
  }

  // Update main config
  const config = await loadConfig(username);
  config.sites = config.sites.filter((s) => s.id !== siteId);
  await saveConfig(username, config);
}

/**
 * Update integration status
 * @param username - User's username
 * @param siteId - Site identifier
 * @param status - Status fields to update
 * @returns Updated site configuration
 */
export async function updateStatus(
  username: string,
  siteId: string,
  status: Partial<IntegrationStatus>
): Promise<SiteConfig> {
  const existing = await getIntegration(username, siteId);
  if (!existing) {
    throw new Error(`Integration ${siteId} not found`);
  }

  existing.status = {
    ...existing.status,
    ...status,
    lastCheck: new Date().toISOString(),
  };

  const sitePath = await getSiteConfigPath(username, siteId);
  await fs.writeFile(sitePath, JSON.stringify(existing, null, 2));

  return existing;
}

/**
 * Get enabled integrations (not paused, not disabled)
 * @param username - User's username
 * @returns Array of enabled site configurations
 */
export async function getEnabledIntegrations(username: string): Promise<SiteConfig[]> {
  const config = await loadConfig(username);
  const enabled: SiteConfig[] = [];

  for (const site of config.sites) {
    if (!site.enabled) continue;

    const fullConfig = await getIntegration(username, site.id);
    if (fullConfig && !fullConfig.status?.paused) {
      enabled.push(fullConfig);
    }
  }

  return enabled;
}
