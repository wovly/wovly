/**
 * Unit tests for CredentialsService
 * Tests service methods without requiring Electron's safeStorage
 */

import { describe, it, expect } from 'vitest';

// Import the compiled service
const { CredentialsService } = require('../../../dist/services/credentials');

describe('CredentialsService (Unit)', () => {
  describe('listCredentials', () => {
    it('should return empty array for null username', async () => {
      const result = await CredentialsService.listCredentials(null);

      expect(result.ok).toBe(true);
      expect(result.credentials).toEqual([]);
    });

    it('should return empty array for undefined username', async () => {
      const result = await CredentialsService.listCredentials(undefined);

      expect(result.ok).toBe(true);
      expect(result.credentials).toEqual([]);
    });
  });

  describe('getCredential', () => {
    it('should return error for null username', async () => {
      const result = await CredentialsService.getCredential(null, 'test.com');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Not logged in');
    });

    it('should return error for undefined username', async () => {
      const result = await CredentialsService.getCredential(undefined, 'test.com');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Not logged in');
    });
  });

  describe('saveCredential', () => {
    it('should return error for null username', async () => {
      const result = await CredentialsService.saveCredential(null, 'test.com');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Not logged in');
    });

    it('should return error for undefined username', async () => {
      const result = await CredentialsService.saveCredential(undefined, 'test.com');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Not logged in');
    });

    it('should return error for empty domain', async () => {
      const result = await CredentialsService.saveCredential('testuser', '');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Domain is required');
    });

    it('should return error for whitespace-only domain', async () => {
      const result = await CredentialsService.saveCredential('testuser', '   ');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Domain is required');
    });
  });

  describe('deleteCredential', () => {
    it('should return error for null username', async () => {
      const result = await CredentialsService.deleteCredential(null, 'test.com');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Not logged in');
    });

    it('should return error for undefined username', async () => {
      const result = await CredentialsService.deleteCredential(undefined, 'test.com');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Not logged in');
    });
  });

  describe('updateLastUsed', () => {
    it('should return error for null username', async () => {
      const result = await CredentialsService.updateLastUsed(null, 'test.com');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Not logged in');
    });

    it('should return error for undefined username', async () => {
      const result = await CredentialsService.updateLastUsed(undefined, 'test.com');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Not logged in');
    });
  });

  describe('Domain Normalization (validation only)', () => {
    it('should validate domain normalization logic exists', () => {
      // The service has a private normalizeDomain method
      // We can't test it directly, but we can verify the class exists
      expect(CredentialsService).toBeDefined();
      expect(typeof CredentialsService.listCredentials).toBe('function');
      expect(typeof CredentialsService.getCredential).toBe('function');
      expect(typeof CredentialsService.saveCredential).toBe('function');
      expect(typeof CredentialsService.deleteCredential).toBe('function');
      expect(typeof CredentialsService.updateLastUsed).toBe('function');
    });
  });
});
