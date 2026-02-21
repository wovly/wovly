/**
 * Secure Credential Storage System
 * Uses Electron's safeStorage API for OS-level encryption (Keychain/DPAPI/libsecret)
 * Credentials are NEVER sent to LLMs - only used locally for browser automation
 */

import path from 'path';
import fs from 'fs/promises';
import { getUserDataDir } from '../utils/helpers';
import type { SafeStorage } from 'electron';

/**
 * Credential object structure
 */
export interface Credential {
  username?: string;
  password?: string;
  email?: string;
  [key: string]: string | undefined;
}

/**
 * Credentials storage structure (domain -> credential)
 */
export interface Credentials {
  [domain: string]: Credential;
}

/**
 * Result of credential placeholder resolution
 */
export interface CredentialResolutionResult {
  resolved: unknown;
  usedCredentials: Array<{ domain: string; field: string }>;
}

// Lazy-load safeStorage to avoid issues with module loading order
let _safeStorage: SafeStorage | null = null;
const getSafeStorage = (): SafeStorage => {
  if (!_safeStorage) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _safeStorage = require('electron').safeStorage as SafeStorage;
  }
  return _safeStorage!; // Assert non-null after assignment
};

// In-memory cache of decrypted credentials (per user)
const credentialsCache = new Map<string, Credentials>();

/**
 * Get the path to the encrypted credentials file
 */
export const getCredentialsPath = async (username: string): Promise<string> => {
  const dir = await getUserDataDir(username);
  return path.join(dir, 'credentials.enc');
};

/**
 * Load and decrypt credentials from storage
 * @param username - Username for user-specific credentials
 * @returns Credentials object keyed by domain
 */
export const loadCredentials = async (username: string): Promise<Credentials> => {
  // Return cached if available
  if (credentialsCache.has(username)) {
    return credentialsCache.get(username)!;
  }

  const credentialsPath = await getCredentialsPath(username);

  try {
    // Check if safeStorage is available
    if (!getSafeStorage().isEncryptionAvailable()) {
      console.warn('[Credentials] Encryption not available on this system');
      // Fall back to checking for unencrypted file (migration case)
      try {
        const userDir = await getUserDataDir(username);
        const plainPath = path.join(userDir, 'credentials.json');
        const data = await fs.readFile(plainPath, 'utf8');
        const creds = JSON.parse(data) as Credentials;
        credentialsCache.set(username, creds);
        // Migrate to encrypted storage
        await saveCredentials(creds, username);
        await fs.unlink(plainPath).catch(() => {}); // Delete plain file
        console.log('[Credentials] Migrated from unencrypted to encrypted storage');
        return creds;
      } catch {
        credentialsCache.set(username, {});
        return {};
      }
    }

    // Read encrypted file
    const encryptedBuffer = await fs.readFile(credentialsPath);
    const decryptedString = getSafeStorage().decryptString(encryptedBuffer);
    const creds = JSON.parse(decryptedString) as Credentials;
    credentialsCache.set(username, creds);
    console.log(`[Credentials] Loaded ${Object.keys(creds).length} credentials for ${username}`);
    return creds;
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'ENOENT') {
      // File doesn't exist yet - start fresh
      credentialsCache.set(username, {});
      return {};
    }
    console.error('[Credentials] Error loading credentials:', (err as Error).message);
    credentialsCache.set(username, {});
    return {};
  }
};

/**
 * Get list of domains that have saved credentials
 * This allows the LLM to know which sites have credentials available
 * @param username - Username for user-specific credentials
 * @returns Array of domain names
 */
export const getAvailableCredentialDomains = async (username: string): Promise<string[]> => {
  try {
    const credentials = await loadCredentials(username);
    return Object.keys(credentials);
  } catch {
    return [];
  }
};

/**
 * Encrypt and save credentials to storage
 * @param credentials - Credentials object to save
 * @param username - Username for user-specific credentials
 */
export const saveCredentials = async (credentials: Credentials, username: string): Promise<void> => {
  const credentialsPath = await getCredentialsPath(username);

  try {
    if (!getSafeStorage().isEncryptionAvailable()) {
      console.warn('[Credentials] Encryption not available - storing with basic protection');
      // Fallback: store as JSON but with restricted permissions
      await fs.writeFile(credentialsPath + '.json', JSON.stringify(credentials, null, 2), {
        mode: 0o600 // Owner read/write only
      });
      credentialsCache.set(username, credentials);
      return;
    }

    const jsonString = JSON.stringify(credentials);
    const encryptedBuffer = getSafeStorage().encryptString(jsonString);
    await fs.writeFile(credentialsPath, encryptedBuffer);
    credentialsCache.set(username, credentials);
    console.log(
      `[Credentials] Saved ${Object.keys(credentials).length} credentials for ${username} (encrypted)`
    );
  } catch (err) {
    console.error('[Credentials] Error saving credentials:', (err as Error).message);
    throw err;
  }
};

/**
 * Get credential for a specific domain
 * @param domain - Domain to look up (e.g., "amazon.com")
 * @param username - Username for user-specific credentials
 * @returns Credential object or null if not found
 */
export const getCredentialForDomain = async (
  domain: string,
  username: string
): Promise<Credential | null> => {
  const credentials = await loadCredentials(username);

  // Try exact match first
  if (credentials[domain]) {
    return credentials[domain];
  }

  // Try without www prefix
  const withoutWww = domain.replace(/^www\./, '');
  if (credentials[withoutWww]) {
    return credentials[withoutWww];
  }

  // Try with www prefix
  const withWww = 'www.' + withoutWww;
  if (credentials[withWww]) {
    return credentials[withWww];
  }

  // Try partial match (e.g., "amazon.com" matches "signin.amazon.com")
  for (const [key, value] of Object.entries(credentials)) {
    if (domain.endsWith(key) || key.endsWith(domain.replace(/^www\./, ''))) {
      return value;
    }
  }

  return null;
};

/**
 * Resolve credential placeholders in tool input
 * Pattern: {{credential:domain.com:field}} where field is "username" or "password"
 * @param input - Tool input (object, string, or array)
 * @param username - Username for credential lookup
 * @returns Object with resolved input and array of used credentials
 */
export const resolveCredentialPlaceholders = async (
  input: unknown,
  username: string
): Promise<CredentialResolutionResult> => {
  const usedCredentials: Array<{ domain: string; field: string }> = [];
  const placeholderPattern = /\{\{credential:([^:}]+):([^}]+)\}\}/g;

  const resolveString = async (str: unknown): Promise<unknown> => {
    if (typeof str !== 'string') return str;

    let result = str;
    let match;

    // Reset regex state
    placeholderPattern.lastIndex = 0;

    while ((match = placeholderPattern.exec(str)) !== null) {
      const [fullMatch, domain, field] = match;
      const credential = await getCredentialForDomain(domain, username);

      if (credential) {
        const value = credential[field];
        if (value !== undefined) {
          result = result.replace(fullMatch, value);
          usedCredentials.push({ domain, field });
          console.log(`[Credentials] Resolved placeholder for ${domain}:${field}`);
          // IMPORTANT: Never log the actual value!
        } else {
          console.warn(`[Credentials] Field "${field}" not found for domain "${domain}"`);
        }
      } else {
        console.warn(`[Credentials] No credential found for domain "${domain}"`);
      }
    }

    return result;
  };

  const resolveRecursive = async (obj: unknown): Promise<unknown> => {
    if (typeof obj === 'string') {
      return await resolveString(obj);
    }

    if (Array.isArray(obj)) {
      const resolved = [];
      for (const item of obj) {
        resolved.push(await resolveRecursive(item));
      }
      return resolved;
    }

    if (obj !== null && typeof obj === 'object') {
      const resolved: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        resolved[key] = await resolveRecursive(value);
      }
      return resolved;
    }

    return obj;
  };

  const resolved = await resolveRecursive(input);
  return { resolved, usedCredentials };
};

/**
 * Validate that text doesn't contain actual credential values
 * Used to prevent credential leakage in LLM responses
 * @param text - Text to validate
 * @param credentials - Array of credential objects to check against
 * @returns True if safe (no credentials found), false if credentials detected
 */
export const validateNoCredentialLeakage = (text: string, credentials: Credential[] = []): boolean => {
  if (!text || typeof text !== 'string') return true;

  // Check each stored credential's password and username
  for (const cred of credentials) {
    if (cred.password && cred.password.length > 4 && text.includes(cred.password)) {
      console.error(`[Security] CREDENTIAL LEAKAGE DETECTED: Password found in text`);
      return false;
    }
  }

  return true;
};

/**
 * Clear credentials cache (for logout)
 * @param username - Optional username to clear specific user's cache, or undefined to clear all
 */
export const clearCredentialsCache = (username?: string): void => {
  if (username) {
    credentialsCache.delete(username);
  } else {
    credentialsCache.clear();
  }
};
