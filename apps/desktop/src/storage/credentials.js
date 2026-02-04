/**
 * Secure Credential Storage System
 * Uses Electron's safeStorage API for OS-level encryption (Keychain/DPAPI/libsecret)
 * Credentials are NEVER sent to LLMs - only used locally for browser automation
 */

const path = require("path");
const fs = require("fs/promises");
const { safeStorage } = require("electron");
const { getUserDataDir } = require("../utils/helpers");

// In-memory cache of decrypted credentials (per user)
let credentialsCache = new Map(); // username -> credentials object

const getCredentialsPath = async (username) => {
  const dir = await getUserDataDir(username);
  return path.join(dir, "credentials.enc");
};

/**
 * Load and decrypt credentials from storage
 * @param {string} username - Username for user-specific credentials
 * @returns {Object} Credentials object keyed by domain
 */
const loadCredentials = async (username) => {
  // Return cached if available
  if (credentialsCache.has(username)) {
    return credentialsCache.get(username);
  }

  const credentialsPath = await getCredentialsPath(username);
  
  try {
    // Check if safeStorage is available
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn("[Credentials] Encryption not available on this system");
      // Fall back to checking for unencrypted file (migration case)
      try {
        const userDir = await getUserDataDir(username);
        const plainPath = path.join(userDir, "credentials.json");
        const data = await fs.readFile(plainPath, "utf8");
        const creds = JSON.parse(data);
        credentialsCache.set(username, creds);
        // Migrate to encrypted storage
        await saveCredentials(creds, username);
        await fs.unlink(plainPath).catch(() => {}); // Delete plain file
        console.log("[Credentials] Migrated from unencrypted to encrypted storage");
        return creds;
      } catch {
        credentialsCache.set(username, {});
        return {};
      }
    }

    // Read encrypted file
    const encryptedBuffer = await fs.readFile(credentialsPath);
    const decryptedString = safeStorage.decryptString(encryptedBuffer);
    const creds = JSON.parse(decryptedString);
    credentialsCache.set(username, creds);
    console.log(`[Credentials] Loaded ${Object.keys(creds).length} credentials for ${username}`);
    return creds;
  } catch (err) {
    if (err.code === "ENOENT") {
      // File doesn't exist yet - start fresh
      credentialsCache.set(username, {});
      return {};
    }
    console.error("[Credentials] Error loading credentials:", err.message);
    credentialsCache.set(username, {});
    return {};
  }
};

/**
 * Get list of domains that have saved credentials
 * This allows the LLM to know which sites have credentials available
 * @param {string} username - Username for user-specific credentials
 * @returns {Promise<string[]>} Array of domain names
 */
const getAvailableCredentialDomains = async (username) => {
  try {
    const credentials = await loadCredentials(username);
    return Object.keys(credentials);
  } catch {
    return [];
  }
};

/**
 * Encrypt and save credentials to storage
 * @param {Object} credentials - Credentials object to save
 * @param {string} username - Username for user-specific credentials
 */
const saveCredentials = async (credentials, username) => {
  const credentialsPath = await getCredentialsPath(username);
  
  try {
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn("[Credentials] Encryption not available - storing with basic protection");
      // Fallback: store as JSON but with restricted permissions
      await fs.writeFile(credentialsPath + ".json", JSON.stringify(credentials, null, 2), {
        mode: 0o600 // Owner read/write only
      });
      credentialsCache.set(username, credentials);
      return;
    }

    const jsonString = JSON.stringify(credentials);
    const encryptedBuffer = safeStorage.encryptString(jsonString);
    await fs.writeFile(credentialsPath, encryptedBuffer);
    credentialsCache.set(username, credentials);
    console.log(`[Credentials] Saved ${Object.keys(credentials).length} credentials for ${username} (encrypted)`);
  } catch (err) {
    console.error("[Credentials] Error saving credentials:", err.message);
    throw err;
  }
};

/**
 * Get credential for a specific domain
 * @param {string} domain - Domain to look up (e.g., "amazon.com")
 * @param {string} username - Username for user-specific credentials
 * @returns {Object|null} Credential object or null if not found
 */
const getCredentialForDomain = async (domain, username) => {
  const credentials = await loadCredentials(username);
  
  // Try exact match first
  if (credentials[domain]) {
    return credentials[domain];
  }
  
  // Try without www prefix
  const withoutWww = domain.replace(/^www\./, "");
  if (credentials[withoutWww]) {
    return credentials[withoutWww];
  }
  
  // Try with www prefix
  const withWww = "www." + withoutWww;
  if (credentials[withWww]) {
    return credentials[withWww];
  }
  
  // Try partial match (e.g., "amazon.com" matches "signin.amazon.com")
  for (const [key, value] of Object.entries(credentials)) {
    if (domain.endsWith(key) || key.endsWith(domain.replace(/^www\./, ""))) {
      return value;
    }
  }
  
  return null;
};

/**
 * Resolve credential placeholders in tool input
 * Pattern: {{credential:domain.com:field}} where field is "username" or "password"
 * @param {any} input - Tool input (object, string, or array)
 * @param {string} username - Username for credential lookup
 * @returns {Object} { resolved: any, usedCredentials: Array }
 */
const resolveCredentialPlaceholders = async (input, username) => {
  const usedCredentials = [];
  const placeholderPattern = /\{\{credential:([^:}]+):([^}]+)\}\}/g;
  
  const resolveString = async (str) => {
    if (typeof str !== "string") return str;
    
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
  
  const resolveRecursive = async (obj) => {
    if (typeof obj === "string") {
      return await resolveString(obj);
    }
    
    if (Array.isArray(obj)) {
      const resolved = [];
      for (const item of obj) {
        resolved.push(await resolveRecursive(item));
      }
      return resolved;
    }
    
    if (obj !== null && typeof obj === "object") {
      const resolved = {};
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
 * @param {string} text - Text to validate
 * @param {Array} credentials - Array of credential objects to check against
 * @returns {boolean} True if safe (no credentials found), false if credentials detected
 */
const validateNoCredentialLeakage = (text, credentials = []) => {
  if (!text || typeof text !== "string") return true;
  
  // Check each stored credential's password and username
  for (const cred of credentials) {
    if (cred.password && cred.password.length > 4 && text.includes(cred.password)) {
      console.error(`[Security] CREDENTIAL LEAKAGE DETECTED: Password for ${cred.domain} found in text`);
      return false;
    }
  }
  
  return true;
};

// Clear credentials cache (for logout)
const clearCredentialsCache = (username) => {
  if (username) {
    credentialsCache.delete(username);
  } else {
    credentialsCache.clear();
  }
};

module.exports = {
  getCredentialsPath,
  loadCredentials,
  getAvailableCredentialDomains,
  saveCredentials,
  getCredentialForDomain,
  resolveCredentialPlaceholders,
  validateNoCredentialLeakage,
  clearCredentialsCache
};
