/**
 * Multi-Turn Clarification Utility
 * Handles clarification requests and responses for ambiguous queries
 */

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ClarificationContext {
  originalQuery: string;
  clarificationQuestion: string;
  isClarificationResponse: true;
}

export interface ClarificationQuestion {
  question: string;
}

export interface ClarificationResult {
  needed: boolean;
  questions: Array<string | ClarificationQuestion>;
  confidence: number;
}

export interface QueryUnderstanding {
  clarification_needed?: boolean;
  clarification_questions?: Array<string | ClarificationQuestion>;
  confidence?: number;
}

/**
 * Check if the current message is a clarification response
 * @param messages - Conversation messages
 * @returns Clarification context if this is a response, null otherwise
 */
export function detectClarificationResponse(
  messages: Message[]
): ClarificationContext | null {
  if (!messages || messages.length < 2) {
    return null;
  }

  // Get the last assistant message
  const lastAssistantMessage = [...messages]
    .reverse()
    .find((m) => m.role === 'assistant');

  if (!lastAssistantMessage) {
    return null;
  }

  // Check if the last assistant message was asking for clarification
  const content = lastAssistantMessage.content || '';

  // Look for clarification markers
  const isClarificationRequest =
    content.includes('Before I proceed, I need to clarify') ||
    content.includes('need to clarify a few things') ||
    content.includes('Please provide these details') ||
    content.includes('Could you clarify') ||
    (content.includes('?') &&
      (content.toLowerCase().includes('which') ||
        content.toLowerCase().includes('who') ||
        content.toLowerCase().includes('when') ||
        content.toLowerCase().includes('where')));

  if (!isClarificationRequest) {
    return null;
  }

  // Extract the original query if present in the conversation
  // Look back through messages to find the original query before clarification
  const messagesBeforeLast = messages.slice(0, -1);
  const originalUserMessage = [...messagesBeforeLast]
    .reverse()
    .find((m) => m.role === 'user');

  if (!originalUserMessage) {
    return null;
  }

  return {
    originalQuery: originalUserMessage.content,
    clarificationQuestion: content,
    isClarificationResponse: true,
  };
}

/**
 * Build enriched query from original query and clarification
 * @param originalQuery - Original user query
 * @param clarificationResponse - User's clarification response
 * @param clarificationQuestion - The question that was asked
 * @returns Enriched query
 */
export function buildEnrichedQueryFromClarification(
  originalQuery: string,
  clarificationResponse: string,
  _clarificationQuestion: string = ''
): string {
  return `Original request: ${originalQuery}\n\nClarification: ${clarificationResponse}`;
}

/**
 * Extract clarification from query understanding result
 * @param understanding - Query understanding result
 * @returns Clarification object or null
 */
export function extractClarification(
  understanding: QueryUnderstanding | null | undefined
): ClarificationResult | null {
  if (!understanding || !understanding.clarification_needed) {
    return null;
  }

  return {
    needed: true,
    questions: understanding.clarification_questions || [],
    confidence: understanding.confidence || 0,
  };
}

/**
 * Format clarification questions for user
 * @param questions - Clarification questions
 * @returns Formatted questions
 */
export function formatClarificationQuestions(
  questions: Array<string | ClarificationQuestion>
): string {
  if (!questions || questions.length === 0) {
    return '';
  }

  if (questions.length === 1) {
    const q = questions[0];
    return typeof q === 'string' ? q : q.question;
  }

  return (
    'Before I proceed, I need to clarify a few things:\n\n' +
    questions
      .map((q, i) => {
        const question = typeof q === 'string' ? q : q.question;
        return `${i + 1}. ${question}`;
      })
      .join('\n') +
    '\n\nPlease provide these details so I can help you better.'
  );
}

/**
 * Check if query needs clarification based on understanding result
 * @param understanding - Query understanding result
 * @param confidenceThreshold - Minimum confidence to skip clarification (default: 0.7)
 * @returns True if clarification needed
 */
export function needsClarification(
  understanding: QueryUnderstanding | null | undefined,
  confidenceThreshold: number = 0.7
): boolean {
  if (!understanding) {
    return false;
  }

  // Explicit clarification flag
  if (understanding.clarification_needed === true) {
    return true;
  }

  // Low confidence in understanding
  if (
    understanding.confidence !== undefined &&
    understanding.confidence < confidenceThreshold
  ) {
    return true;
  }

  // Has clarification questions
  if (
    understanding.clarification_questions &&
    understanding.clarification_questions.length > 0
  ) {
    return true;
  }

  return false;
}

/**
 * Filter out security-sensitive clarification questions
 * @param questions - Clarification questions
 * @returns Filtered questions
 */
export function filterSensitiveQuestions(
  questions: Array<string | ClarificationQuestion>
): Array<string | ClarificationQuestion> {
  const credentialPatterns = [
    /password/i,
    /username/i,
    /login\s*credential/i,
    /api\s*key/i,
    /secret/i,
    /authentication/i,
    /log\s*in\s*(details|info)/i,
    /sign\s*in\s*(details|info)/i,
    /\bcredential/i,
  ];

  return questions.filter((q) => {
    const questionText = (typeof q === 'string' ? q : q.question || '').toLowerCase();
    const isCredentialQuestion = credentialPatterns.some((pattern) =>
      pattern.test(questionText)
    );

    if (isCredentialQuestion) {
      console.warn('[Clarification] BLOCKED credential question:', questionText);
    }

    return !isCredentialQuestion;
  });
}
