/**
 * Anthropic API Helper
 * Utilities for working with Anthropic Claude API with prompt caching support
 */

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | Array<{ type: string; text?: string; cache_control?: { type: 'ephemeral' } }>;
}

export interface AnthropicRequest {
  model: string;
  max_tokens: number;
  messages: AnthropicMessage[];
  system?: string | Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }>;
  temperature?: number;
}

export interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{ type: string; text: string }>;
  model: string;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

/**
 * Build an Anthropic request with prompt caching support
 *
 * Prompt caching reduces costs by up to 90% for repeated prompts!
 * https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
 *
 * @param options - Request options
 * @returns Formatted request ready for Anthropic API
 */
export function buildAnthropicRequest(options: {
  model: string;
  systemPrompt?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  maxTokens?: number;
  temperature?: number;
  enableCaching?: boolean;
}): AnthropicRequest {
  const {
    model,
    systemPrompt,
    messages,
    maxTokens = 2048,
    temperature = 0.7,
    enableCaching = true,
  } = options;

  const request: AnthropicRequest = {
    model,
    max_tokens: maxTokens,
    messages: messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    })),
    temperature,
  };

  // Add system prompt with caching if provided
  if (systemPrompt && enableCaching) {
    // Cache the system prompt - this is usually static and long
    request.system = [
      {
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral' },
      },
    ];
  } else if (systemPrompt) {
    request.system = systemPrompt;
  }

  // Cache the last few user messages if they're long enough (>1024 tokens ~= 750 words)
  // This is useful for conversation context that gets reused
  if (enableCaching && messages.length > 0) {
    const messagesToCache = messages.slice(-3); // Cache last 3 messages
    request.messages = messages.slice(0, -3).map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    // Add cached messages
    for (const msg of messagesToCache) {
      if (msg.content.length > 750) {
        // Only cache if substantial
        request.messages.push({
          role: msg.role,
          content: [
            {
              type: 'text',
              text: msg.content,
              cache_control: { type: 'ephemeral' },
            },
          ],
        });
      } else {
        request.messages.push({
          role: msg.role,
          content: msg.content,
        });
      }
    }
  }

  return request;
}

/**
 * Call Anthropic API with prompt caching
 *
 * @param apiKey - Anthropic API key
 * @param request - Request object from buildAnthropicRequest
 * @returns API response
 */
export async function callAnthropicWithCaching(
  apiKey: string,
  request: AnthropicRequest
): Promise<AnthropicResponse> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Anthropic API error: ${error}`);
  }

  const data = (await response.json()) as AnthropicResponse;

  // Log cache statistics
  if (data.usage.cache_read_input_tokens) {
    console.log(
      `[Anthropic Cache] Read ${data.usage.cache_read_input_tokens} cached tokens (saved ${
        ((data.usage.cache_read_input_tokens / data.usage.input_tokens) * 100).toFixed(1)
      }%)`
    );
  }
  if (data.usage.cache_creation_input_tokens) {
    console.log(
      `[Anthropic Cache] Created cache with ${data.usage.cache_creation_input_tokens} tokens`
    );
  }

  return data;
}

/**
 * Simple helper for quick Claude calls with smart caching
 *
 * @param apiKey - API key
 * @param prompt - User prompt
 * @param systemPrompt - Optional system prompt (will be cached)
 * @param model - Model to use (default: claude-3-5-haiku)
 * @returns Response text
 */
export async function callClaude(
  apiKey: string,
  prompt: string,
  systemPrompt?: string,
  model: string = 'claude-3-5-haiku-20241022' // Default to cheap Haiku
): Promise<string> {
  const request = buildAnthropicRequest({
    model,
    systemPrompt,
    messages: [{ role: 'user', content: prompt }],
    maxTokens: 2048,
    enableCaching: !!systemPrompt, // Only cache if system prompt exists
  });

  const response = await callAnthropicWithCaching(apiKey, request);
  return response.content[0].text;
}

/**
 * Model recommendations based on task type
 */
export const CLAUDE_MODELS = {
  // Use for: Complex reasoning, code generation, analysis
  OPUS: 'claude-opus-4-20250514', // $15 per 1M input tokens

  // Use for: General tasks, chat, most queries
  SONNET: 'claude-sonnet-4-20250514', // $3 per 1M input tokens

  // Use for: Simple tasks, classification, extraction, quick responses
  HAIKU: 'claude-3-5-haiku-20241022', // $0.25 per 1M input tokens (60x cheaper than Opus!)
} as const;

/**
 * Determine appropriate model based on task complexity
 *
 * @param task - Task description or user query
 * @returns Recommended model
 */
export function selectModelForTask(task: string): string {
  const lowerTask = task.toLowerCase();

  // Simple tasks → Haiku (super cheap)
  if (
    /^(what|when|where|who|how many|list|show|get|find|search|check|is|are|do|does)/i.test(
      task.trim()
    ) ||
    lowerTask.includes('extract') ||
    lowerTask.includes('classify') ||
    lowerTask.includes('summarize') ||
    lowerTask.includes('translate')
  ) {
    return CLAUDE_MODELS.HAIKU;
  }

  // Complex reasoning → Opus
  if (
    lowerTask.includes('analyze deeply') ||
    lowerTask.includes('complex') ||
    lowerTask.includes('detailed analysis') ||
    lowerTask.includes('comprehensive')
  ) {
    return CLAUDE_MODELS.OPUS;
  }

  // Default to Sonnet (good balance)
  return CLAUDE_MODELS.SONNET;
}
