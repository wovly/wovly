/**
 * Chat Service
 * Handles chat message processing, decomposition, and execution
 * 
 * This service consolidates the complex chat processing logic that was previously
 * scattered across main.js. It handles:
 * - Message processing and routing
 * - Skill creation detection
 * - Input type detection
 * - Fact extraction
 * - Query understanding
 * - Task decomposition
 * - Tutorial/onboarding flow
 */

export interface ChatContext {
  username: string;
  apiKeys: any;
  models: any;
  activeProvider: string;
  profile: any;
  conversationContext: any;
  todayCalendarEvents: any[];
}

export interface ChatOptions {
  skipDecomposition?: boolean;
  stepContext?: any;
  workflowContext?: any;
}

export interface ChatResponse {
  ok: boolean;
  error?: string;
  response?: string;
  [key: string]: any;
}

export class ChatService {
  // This service will be populated with the extracted chat processing logic
  // For now, it's a placeholder that will delegate to functions in main.js
  // In the next iteration, we'll move the actual functions here
  
  static async processQuery(
    messages: any[],
    context: ChatContext,
    options: ChatOptions = {}
  ): Promise<ChatResponse> {
    // This will be implemented by moving processChatQuery from main.js
    throw new Error('Not yet implemented - will be moved from main.js');
  }
}
