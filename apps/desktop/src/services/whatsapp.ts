/**
 * WhatsApp Service
 * Handles WhatsApp connection management via Baileys
 *
 * Note: Uses dependency injection for socket management functions
 * since WhatsApp requires persistent socket state in main process
 */

/**
 * WhatsApp status type
 */
export type WhatsAppStatus = 'disconnected' | 'connecting' | 'qr_ready' | 'connected';

/**
 * Service response interface
 */
export interface WhatsAppResponse {
  ok: boolean;
  error?: string;
  status?: WhatsAppStatus;
  qr?: string;
  hasAuth?: boolean;
  connected?: boolean;
  ready?: boolean;
}

/**
 * WhatsApp connection functions interface (injected from main.js)
 */
export interface WhatsAppConnector {
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  getStatus: () => WhatsAppStatus;
  getQR: () => string | null;
  getSocket: () => any;
  getSelfChatJid: () => string | null;
  getAuthDir: () => Promise<string>;
}

/**
 * WhatsAppService - Manages WhatsApp integration via Baileys
 */
export class WhatsAppService {
  /**
   * Connect to WhatsApp (initiates QR code flow)
   * @param connector - WhatsApp connection functions
   * @returns Success/error response
   */
  static async connect(
    connector: WhatsAppConnector
  ): Promise<WhatsAppResponse> {
    try {
      await connector.connect();
      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      console.error('[WhatsApp] Error connecting:', error);
      return { ok: false, error };
    }
  }

  /**
   * Disconnect from WhatsApp
   * @param connector - WhatsApp connection functions
   * @returns Success/error response
   */
  static async disconnect(
    connector: WhatsAppConnector
  ): Promise<WhatsAppResponse> {
    try {
      await connector.disconnect();
      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      console.error('[WhatsApp] Error disconnecting:', error);
      return { ok: false, error };
    }
  }

  /**
   * Get current WhatsApp connection status and QR code
   * @param connector - WhatsApp connection functions
   * @returns Status and QR code (if available)
   */
  static async getStatus(
    connector: WhatsAppConnector
  ): Promise<WhatsAppResponse> {
    return {
      ok: true,
      status: connector.getStatus(),
      qr: connector.getQR() || undefined
    };
  }

  /**
   * Check if WhatsApp has saved auth state
   * @param connector - WhatsApp connection functions
   * @returns Auth status and connection state
   */
  static async checkAuth(
    connector: WhatsAppConnector,
    fs: any
  ): Promise<WhatsAppResponse> {
    try {
      const authDir = await connector.getAuthDir();
      const files = await fs.readdir(authDir);
      const hasAuth = files.some((f: string) => f.includes('creds'));

      return {
        ok: true,
        hasAuth,
        connected: connector.getStatus() === 'connected'
      };
    } catch {
      return {
        ok: true,
        hasAuth: false,
        connected: false
      };
    }
  }

  /**
   * Send a message via WhatsApp
   * @param connector - WhatsApp connection functions
   * @param recipient - Phone number or JID
   * @param message - Message text
   * @returns Success/error response
   */
  static async sendMessage(
    connector: WhatsAppConnector,
    recipient: string,
    message: string
  ): Promise<WhatsAppResponse> {
    const socket = connector.getSocket();
    const status = connector.getStatus();

    if (!socket || status !== 'connected') {
      return { ok: false, error: 'WhatsApp is not connected' };
    }

    try {
      // Ensure recipient ends with @s.whatsapp.net for individual chats
      let jid = recipient;
      if (!jid.includes('@')) {
        jid = jid.replace(/[^0-9]/g, '') + '@s.whatsapp.net';
      }

      await socket.sendMessage(jid, { text: message });
      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      console.error('[WhatsApp] Error sending message:', error);
      return { ok: false, error };
    }
  }

  /**
   * Sync a message to WhatsApp self-chat (for chat window sync)
   * @param connector - WhatsApp connection functions
   * @param message - Message text
   * @param isFromUser - Whether message is from user or AI
   * @returns Success/error response
   */
  static async syncToSelfChat(
    connector: WhatsAppConnector,
    message: string,
    isFromUser: boolean
  ): Promise<WhatsAppResponse> {
    const socket = connector.getSocket();
    const status = connector.getStatus();
    const selfChatJid = connector.getSelfChatJid();

    if (!socket || status !== 'connected') {
      return { ok: false, error: 'WhatsApp is not connected' };
    }

    if (!selfChatJid) {
      return {
        ok: false,
        error: 'Self-chat not initialized. Send a message from WhatsApp first.'
      };
    }

    try {
      // Prefix AI responses with [Wovly] to distinguish from user messages
      const text = isFromUser ? message : `[Wovly] ${message}`;
      await socket.sendMessage(selfChatJid, { text });
      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      console.error('[WhatsApp] Error syncing to self-chat:', error);
      return { ok: false, error };
    }
  }

  /**
   * Check if WhatsApp sync is ready (connected and has self-chat JID)
   * @param connector - WhatsApp connection functions
   * @returns Ready status
   */
  static async isSyncReady(
    connector: WhatsAppConnector
  ): Promise<WhatsAppResponse> {
    const status = connector.getStatus();
    const selfChatJid = connector.getSelfChatJid();

    return {
      ok: true,
      ready: status === 'connected' && !!selfChatJid
    };
  }
}
