/**
 * Tests for WhatsAppService
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { WhatsAppConnector, WhatsAppStatus } from '../../../src/services/whatsapp';

// Import the compiled service
const { WhatsAppService } = require('../../../dist/services/whatsapp');

describe('WhatsAppService', () => {
  let mockConnector: WhatsAppConnector;
  let mockSocket: any;
  let mockFs: any;

  beforeEach(() => {
    // Create mock socket
    mockSocket = {
      sendMessage: vi.fn().mockResolvedValue(undefined),
      logout: vi.fn().mockResolvedValue(undefined)
    };

    // Create mock connector
    mockConnector = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockReturnValue('disconnected' as WhatsAppStatus),
      getQR: vi.fn().mockReturnValue(null),
      getSocket: vi.fn().mockReturnValue(null),
      getSelfChatJid: vi.fn().mockReturnValue(null),
      getAuthDir: vi.fn().mockResolvedValue('/test/auth')
    };

    // Create mock fs
    mockFs = {
      readdir: vi.fn().mockResolvedValue([])
    };
  });

  describe('connect', () => {
    it('should call connector.connect and return success', async () => {
      const result = await WhatsAppService.connect(mockConnector);

      expect(result.ok).toBe(true);
      expect(mockConnector.connect).toHaveBeenCalled();
    });

    it('should handle connection errors', async () => {
      mockConnector.connect = vi.fn().mockRejectedValue(new Error('Connection failed'));

      const result = await WhatsAppService.connect(mockConnector);

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Connection failed');
    });
  });

  describe('disconnect', () => {
    it('should call connector.disconnect and return success', async () => {
      const result = await WhatsAppService.disconnect(mockConnector);

      expect(result.ok).toBe(true);
      expect(mockConnector.disconnect).toHaveBeenCalled();
    });

    it('should handle disconnection errors', async () => {
      mockConnector.disconnect = vi.fn().mockRejectedValue(new Error('Disconnect failed'));

      const result = await WhatsAppService.disconnect(mockConnector);

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Disconnect failed');
    });
  });

  describe('getStatus', () => {
    it('should return current status and QR code', async () => {
      mockConnector.getStatus = vi.fn().mockReturnValue('qr_ready');
      mockConnector.getQR = vi.fn().mockReturnValue('qr-code-data');

      const result = await WhatsAppService.getStatus(mockConnector);

      expect(result.ok).toBe(true);
      expect(result.status).toBe('qr_ready');
      expect(result.qr).toBe('qr-code-data');
    });

    it('should return status without QR when not available', async () => {
      mockConnector.getStatus = vi.fn().mockReturnValue('connected');
      mockConnector.getQR = vi.fn().mockReturnValue(null);

      const result = await WhatsAppService.getStatus(mockConnector);

      expect(result.ok).toBe(true);
      expect(result.status).toBe('connected');
      expect(result.qr).toBeUndefined();
    });
  });

  describe('checkAuth', () => {
    it('should return hasAuth true when creds file exists', async () => {
      mockFs.readdir = vi.fn().mockResolvedValue(['creds.json', 'app-state-sync.json']);

      const result = await WhatsAppService.checkAuth(mockConnector, mockFs);

      expect(result.ok).toBe(true);
      expect(result.hasAuth).toBe(true);
      expect(result.connected).toBe(false);
    });

    it('should return hasAuth false when no creds file', async () => {
      mockFs.readdir = vi.fn().mockResolvedValue(['other-file.json']);

      const result = await WhatsAppService.checkAuth(mockConnector, mockFs);

      expect(result.ok).toBe(true);
      expect(result.hasAuth).toBe(false);
    });

    it('should return connected status', async () => {
      mockFs.readdir = vi.fn().mockResolvedValue(['creds.json']);
      mockConnector.getStatus = vi.fn().mockReturnValue('connected');

      const result = await WhatsAppService.checkAuth(mockConnector, mockFs);

      expect(result.ok).toBe(true);
      expect(result.hasAuth).toBe(true);
      expect(result.connected).toBe(true);
    });

    it('should handle auth directory not existing', async () => {
      mockFs.readdir = vi.fn().mockRejectedValue(new Error('ENOENT'));

      const result = await WhatsAppService.checkAuth(mockConnector, mockFs);

      expect(result.ok).toBe(true);
      expect(result.hasAuth).toBe(false);
      expect(result.connected).toBe(false);
    });
  });

  describe('sendMessage', () => {
    beforeEach(() => {
      mockConnector.getSocket = vi.fn().mockReturnValue(mockSocket);
      mockConnector.getStatus = vi.fn().mockReturnValue('connected');
    });

    it('should send message successfully', async () => {
      const result = await WhatsAppService.sendMessage(
        mockConnector,
        '1234567890',
        'Hello World'
      );

      expect(result.ok).toBe(true);
      expect(mockSocket.sendMessage).toHaveBeenCalledWith(
        '1234567890@s.whatsapp.net',
        { text: 'Hello World' }
      );
    });

    it('should handle recipient with @ already included', async () => {
      const result = await WhatsAppService.sendMessage(
        mockConnector,
        '1234567890@s.whatsapp.net',
        'Hello'
      );

      expect(result.ok).toBe(true);
      expect(mockSocket.sendMessage).toHaveBeenCalledWith(
        '1234567890@s.whatsapp.net',
        { text: 'Hello' }
      );
    });

    it('should return error when not connected', async () => {
      mockConnector.getStatus = vi.fn().mockReturnValue('disconnected');

      const result = await WhatsAppService.sendMessage(
        mockConnector,
        '1234567890',
        'Hello'
      );

      expect(result.ok).toBe(false);
      expect(result.error).toBe('WhatsApp is not connected');
      expect(mockSocket.sendMessage).not.toHaveBeenCalled();
    });

    it('should return error when socket is null', async () => {
      mockConnector.getSocket = vi.fn().mockReturnValue(null);

      const result = await WhatsAppService.sendMessage(
        mockConnector,
        '1234567890',
        'Hello'
      );

      expect(result.ok).toBe(false);
      expect(result.error).toBe('WhatsApp is not connected');
    });

    it('should handle send errors', async () => {
      mockSocket.sendMessage = vi.fn().mockRejectedValue(new Error('Send failed'));

      const result = await WhatsAppService.sendMessage(
        mockConnector,
        '1234567890',
        'Hello'
      );

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Send failed');
    });
  });

  describe('syncToSelfChat', () => {
    beforeEach(() => {
      mockConnector.getSocket = vi.fn().mockReturnValue(mockSocket);
      mockConnector.getStatus = vi.fn().mockReturnValue('connected');
      mockConnector.getSelfChatJid = vi.fn().mockReturnValue('1234567890@s.whatsapp.net');
    });

    it('should sync user message to self-chat', async () => {
      const result = await WhatsAppService.syncToSelfChat(
        mockConnector,
        'User message',
        true
      );

      expect(result.ok).toBe(true);
      expect(mockSocket.sendMessage).toHaveBeenCalledWith(
        '1234567890@s.whatsapp.net',
        { text: 'User message' }
      );
    });

    it('should prefix AI messages with [Wovly]', async () => {
      const result = await WhatsAppService.syncToSelfChat(
        mockConnector,
        'AI response',
        false
      );

      expect(result.ok).toBe(true);
      expect(mockSocket.sendMessage).toHaveBeenCalledWith(
        '1234567890@s.whatsapp.net',
        { text: '[Wovly] AI response' }
      );
    });

    it('should return error when not connected', async () => {
      mockConnector.getStatus = vi.fn().mockReturnValue('disconnected');

      const result = await WhatsAppService.syncToSelfChat(
        mockConnector,
        'Message',
        true
      );

      expect(result.ok).toBe(false);
      expect(result.error).toBe('WhatsApp is not connected');
    });

    it('should return error when self-chat JID not initialized', async () => {
      mockConnector.getSelfChatJid = vi.fn().mockReturnValue(null);

      const result = await WhatsAppService.syncToSelfChat(
        mockConnector,
        'Message',
        true
      );

      expect(result.ok).toBe(false);
      expect(result.error).toContain('Self-chat not initialized');
    });

    it('should handle sync errors', async () => {
      mockSocket.sendMessage = vi.fn().mockRejectedValue(new Error('Sync failed'));

      const result = await WhatsAppService.syncToSelfChat(
        mockConnector,
        'Message',
        true
      );

      expect(result.ok).toBe(false);
      expect(result.error).toBe('Sync failed');
    });
  });

  describe('isSyncReady', () => {
    it('should return ready true when connected and has self-chat JID', async () => {
      mockConnector.getStatus = vi.fn().mockReturnValue('connected');
      mockConnector.getSelfChatJid = vi.fn().mockReturnValue('1234567890@s.whatsapp.net');

      const result = await WhatsAppService.isSyncReady(mockConnector);

      expect(result.ok).toBe(true);
      expect(result.ready).toBe(true);
    });

    it('should return ready false when not connected', async () => {
      mockConnector.getStatus = vi.fn().mockReturnValue('disconnected');
      mockConnector.getSelfChatJid = vi.fn().mockReturnValue('1234567890@s.whatsapp.net');

      const result = await WhatsAppService.isSyncReady(mockConnector);

      expect(result.ok).toBe(true);
      expect(result.ready).toBe(false);
    });

    it('should return ready false when no self-chat JID', async () => {
      mockConnector.getStatus = vi.fn().mockReturnValue('connected');
      mockConnector.getSelfChatJid = vi.fn().mockReturnValue(null);

      const result = await WhatsAppService.isSyncReady(mockConnector);

      expect(result.ok).toBe(true);
      expect(result.ready).toBe(false);
    });

    it('should return ready false when neither condition met', async () => {
      mockConnector.getStatus = vi.fn().mockReturnValue('disconnected');
      mockConnector.getSelfChatJid = vi.fn().mockReturnValue(null);

      const result = await WhatsAppService.isSyncReady(mockConnector);

      expect(result.ok).toBe(true);
      expect(result.ready).toBe(false);
    });
  });
});
