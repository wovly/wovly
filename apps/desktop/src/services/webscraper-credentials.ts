/**
 * WebScraper Credential Service
 *
 * Handles credential management for custom website integrations.
 * SECURITY: Ensures credentials are NEVER sent to LLMs and only stored locally.
 *
 * Flow:
 * 1. Check if credentials exist for domain
 * 2. If exist, allow user to reuse them
 * 3. If not, prompt user to enter credentials
 * 4. Save to encrypted credential store
 * 5. Retrieve for browser automation (local only)
 */

import { CredentialsService } from './credentials';
import type { FullCredential } from './credentials';

/**
 * Credential prompt result
 */
export interface CredentialPromptResult {
  action: 'use_existing' | 'enter_new' | 'cancel';
  credential?: {
    username: string;
    password: string;
  };
}

/**
 * Credential check result
 */
export interface CredentialCheckResult {
  exists: boolean;
  domain: string;
  credential?: {
    username: string;
    displayName: string;
    hasPassword: boolean;
  };
}

/**
 * Credential save request
 */
export interface SaveCredentialRequest {
  domain: string;
  displayName?: string;
  username: string;
  password: string;
  notes?: string;
}

/**
 * Service response
 */
export interface WebScraperCredentialResponse {
  ok: boolean;
  message?: string;
  error?: string;
}

/**
 * WebScraperCredentialService - Manages credentials for custom website integrations
 *
 * CRITICAL SECURITY RULES:
 * - Credentials are ONLY stored in encrypted local storage
 * - Credentials are NEVER sent to LLMs
 * - Credentials are ONLY retrieved for local browser automation
 * - User must explicitly consent to saving credentials
 */
export class WebScraperCredentialService {
  /**
   * Check if credentials exist for a domain
   * Returns basic info (username, domain) but NOT the password
   *
   * @param username - Current user's username
   * @param domain - Website domain (e.g., "example.com")
   * @returns Check result with existence and basic info
   */
  static async checkCredentials(
    username: string | null | undefined,
    domain: string
  ): Promise<CredentialCheckResult> {
    try {
      if (!username) {
        return {
          exists: false,
          domain: this.normalizeDomain(domain)
        };
      }

      const normalizedDomain = this.normalizeDomain(domain);

      // Try to get credential (without password)
      const result = await CredentialsService.getCredential(username, normalizedDomain, false);

      if (result.ok && result.credential) {
        return {
          exists: true,
          domain: normalizedDomain,
          credential: {
            username: result.credential.username,
            displayName: result.credential.displayName,
            hasPassword: true // We know it exists, but don't expose the value
          }
        };
      }

      return {
        exists: false,
        domain: normalizedDomain
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      console.error('[WebScraperCredentials] Error checking credentials:', error);
      return {
        exists: false,
        domain: this.normalizeDomain(domain)
      };
    }
  }

  /**
   * Save credentials for a domain
   * User has explicitly entered credentials during onboarding
   *
   * @param username - Current user's username
   * @param request - Credential save request
   * @returns Success/error response
   */
  static async saveCredentials(
    username: string | null | undefined,
    request: SaveCredentialRequest
  ): Promise<WebScraperCredentialResponse> {
    try {
      if (!username) {
        return { ok: false, error: 'Not logged in' };
      }

      if (!request.username || !request.password) {
        return { ok: false, error: 'Username and password are required' };
      }

      const normalizedDomain = this.normalizeDomain(request.domain);

      // Save to encrypted credential store
      const result = await CredentialsService.saveCredential(
        username,
        normalizedDomain,
        request.displayName || normalizedDomain,
        request.username,
        request.password,
        request.notes || 'Custom website integration'
      );

      if (!result.ok) {
        return { ok: false, error: result.error };
      }

      console.log(`[WebScraperCredentials] Saved credentials for ${normalizedDomain}`);
      return {
        ok: true,
        message: 'Credentials saved securely (local only, not sent to LLM)'
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      console.error('[WebScraperCredentials] Error saving credentials:', error);
      return { ok: false, error };
    }
  }

  /**
   * Get credentials for browser automation
   * SECURITY: Only call this from local browser automation code, NEVER send to LLM
   *
   * @param username - Current user's username
   * @param domain - Website domain
   * @returns Credential with username and password (for LOCAL use only)
   */
  static async getCredentialsForAutomation(
    username: string | null | undefined,
    domain: string
  ): Promise<{
    ok: boolean;
    credential?: { username: string; password: string };
    error?: string;
  }> {
    try {
      if (!username) {
        return { ok: false, error: 'Not logged in' };
      }

      const normalizedDomain = this.normalizeDomain(domain);

      // Get credential WITH password (for automation only)
      const result = await CredentialsService.getCredential(username, normalizedDomain, true);

      if (!result.ok || !result.credential) {
        return {
          ok: false,
          error: result.error || 'Credential not found'
        };
      }

      // Update last used timestamp
      await CredentialsService.updateLastUsed(username, normalizedDomain);

      // Return ONLY what's needed for browser automation
      return {
        ok: true,
        credential: {
          username: result.credential.username,
          password: result.credential.password || ''
        }
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      console.error('[WebScraperCredentials] Error retrieving credentials:', error);
      return { ok: false, error };
    }
  }

  /**
   * Delete credentials for a domain
   *
   * @param username - Current user's username
   * @param domain - Website domain
   * @returns Success/error response
   */
  static async deleteCredentials(
    username: string | null | undefined,
    domain: string
  ): Promise<WebScraperCredentialResponse> {
    try {
      if (!username) {
        return { ok: false, error: 'Not logged in' };
      }

      const normalizedDomain = this.normalizeDomain(domain);

      const result = await CredentialsService.deleteCredential(username, normalizedDomain);

      if (!result.ok) {
        return { ok: false, error: result.error };
      }

      console.log(`[WebScraperCredentials] Deleted credentials for ${normalizedDomain}`);
      return { ok: true, message: 'Credentials deleted' };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      console.error('[WebScraperCredentials] Error deleting credentials:', error);
      return { ok: false, error };
    }
  }

  /**
   * Normalize domain name (remove protocol, www, trailing slash)
   * @param domain - Domain to normalize
   * @returns Normalized domain
   */
  private static normalizeDomain(domain: string): string {
    try {
      // If it's a full URL, extract hostname
      if (domain.startsWith('http://') || domain.startsWith('https://')) {
        const url = new URL(domain);
        domain = url.hostname;
      }

      // Remove www. prefix
      domain = domain.replace(/^www\./, '');

      // Remove trailing slash
      domain = domain.replace(/\/$/, '');

      return domain.toLowerCase();
    } catch {
      // If URL parsing fails, just clean up the string
      return domain
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .replace(/\/.*$/, '');
    }
  }
}
