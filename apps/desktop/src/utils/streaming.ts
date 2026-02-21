/**
 * Streaming Response Utility
 * Handles streaming responses from LLM APIs
 */

// ─────────────────────────────────────────────────────────────────────────
// Type Definitions
// ─────────────────────────────────────────────────────────────────────────

export interface SSEChunk {
  type: string;
  content_block?: {
    type: string;
    id?: string;
    name?: string;
    text?: string;
  };
  delta?: {
    type: string;
    text?: string;
    partial_json?: string;
  };
  message?: {
    stop_reason?: string;
  };
  choices?: Array<{
    delta: {
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason?: string;
  }>;
}

export interface TextContentBlock {
  type: 'text';
  text: string;
}

export interface ToolUseContentBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown> | string;
}

export type ContentBlock = TextContentBlock | ToolUseContentBlock;

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface Message {
  role: string;
  content: string;
}

export interface AnthropicStreamParams {
  apiKey: string;
  model: string;
  maxTokens: number;
  system?: string;
  messages: Message[];
  tools?: AnthropicTool[];
}

export interface OpenAIStreamParams {
  apiKey: string;
  model: string;
  maxTokens: number;
  messages: Message[];
  tools?: AnthropicTool[];
}

export interface AnthropicStreamResult {
  text: string;
  contentBlocks: ContentBlock[];
  toolUseBlocks: ToolUseContentBlock[];
  stop_reason?: string;
}

export interface OpenAIStreamResult {
  text: string;
  toolCalls: OpenAIToolCall[];
  finish_reason?: string;
}

// ─────────────────────────────────────────────────────────────────────────
// SSE Stream Parser
// ─────────────────────────────────────────────────────────────────────────

/**
 * Parse Server-Sent Events (SSE) stream
 * @param stream - Response stream
 * @param onChunk - Callback for each chunk
 * @param onComplete - Callback when stream completes
 * @param onError - Callback on error
 */
export async function parseSSEStream(
  stream: ReadableStream<Uint8Array>,
  onChunk: ((chunk: SSEChunk) => void) | null,
  onComplete: (() => void) | null,
  onError: ((error: Error) => void) | null
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        if (onComplete) onComplete();
        break;
      }

      // Decode chunk
      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE messages
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6); // Remove 'data: ' prefix

          if (data === '[DONE]') {
            if (onComplete) onComplete();
            return;
          }

          try {
            const parsed = JSON.parse(data) as SSEChunk;
            if (onChunk) onChunk(parsed);
          } catch (e) {
            const error = e as Error;
            console.warn('[Streaming] Failed to parse SSE chunk:', error.message);
          }
        }
      }
    }
  } catch (error) {
    if (onError) onError(error as Error);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Anthropic Streaming
// ─────────────────────────────────────────────────────────────────────────

/**
 * Stream response from Anthropic API
 * @param params - Request parameters
 * @param onDelta - Callback for each text delta
 * @param onToolUse - Callback for tool use blocks
 * @param onComplete - Callback when complete
 * @returns Final response
 */
export async function streamAnthropicResponse(
  params: AnthropicStreamParams,
  onDelta: ((delta: string, fullText: string) => void) | null,
  onToolUse: ((toolBlock: ToolUseContentBlock) => void) | null,
  onComplete: ((result: AnthropicStreamResult) => void) | null
): Promise<AnthropicStreamResult> {
  const { apiKey, model, maxTokens, system, messages, tools } = params;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages,
      tools,
      stream: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API error: ${response.status} ${await response.text()}`);
  }

  let fullText = '';
  const contentBlocks: ContentBlock[] = []; // Full ordered array of all content blocks (text + tool_use)
  const toolUseBlocks: ToolUseContentBlock[] = []; // Separate array for tool_use blocks only (for convenience)

  await parseSSEStream(
    response.body!,
    (chunk) => {
      const { type } = chunk;

      switch (type) {
        case 'message_start':
          // Message started
          break;

        case 'content_block_start':
          // New content block
          if (chunk.content_block) {
            if (chunk.content_block.type === 'text') {
              contentBlocks.push({ type: 'text', text: '' });
            } else if (chunk.content_block.type === 'tool_use') {
              const toolBlock: ToolUseContentBlock = {
                type: 'tool_use',
                id: chunk.content_block.id!,
                name: chunk.content_block.name!,
                input: '',
              };
              contentBlocks.push(toolBlock); // Add to ordered content blocks
              toolUseBlocks.push(toolBlock); // Also add to separate tool use array
              if (onToolUse) onToolUse(toolBlock);
            }
          }
          break;

        case 'content_block_delta':
          if (chunk.delta?.type === 'text_delta') {
            const text = chunk.delta.text || '';
            fullText += text;

            // Update last text content block
            for (let i = contentBlocks.length - 1; i >= 0; i--) {
              if (contentBlocks[i].type === 'text') {
                (contentBlocks[i] as TextContentBlock).text += text;
                break;
              }
            }

            // Send delta to callback
            if (onDelta) onDelta(text, fullText);
          } else if (chunk.delta?.type === 'input_json_delta') {
            // Tool input being streamed
            const jsonDelta = chunk.delta.partial_json || '';
            // Update last tool_use content block
            for (let i = contentBlocks.length - 1; i >= 0; i--) {
              if (contentBlocks[i].type === 'tool_use') {
                const toolBlock = contentBlocks[i] as ToolUseContentBlock;
                toolBlock.input = (toolBlock.input as string) + jsonDelta;
                break;
              }
            }
          }
          break;

        case 'content_block_stop':
          // Content block completed - parse tool input JSON if it's a tool_use block
          if (contentBlocks.length > 0) {
            const lastBlock = contentBlocks[contentBlocks.length - 1];
            if (lastBlock.type === 'tool_use') {
              const toolBlock = lastBlock as ToolUseContentBlock;
              // Parse the accumulated JSON string into an object
              if (typeof toolBlock.input === 'string' && toolBlock.input.trim()) {
                try {
                  toolBlock.input = JSON.parse(toolBlock.input) as Record<string, unknown>;
                  // Tool input parsed successfully
                } catch (e) {
                  const error = e as Error;
                  console.error(
                    '[Streaming] Failed to parse tool input JSON:',
                    error.message,
                    'Input:',
                    toolBlock.input
                  );
                  // Set to empty object if parsing fails
                  toolBlock.input = {};
                }
              } else if (!toolBlock.input || typeof toolBlock.input === 'string') {
                // If input is empty or still a string, default to empty object
                toolBlock.input = {};
              }
            }
          }
          break;

        case 'message_delta':
          // Message metadata updates
          break;

        case 'message_stop':
          // Message completed
          if (onComplete) {
            onComplete({
              text: fullText,
              contentBlocks, // Full ordered content array
              toolUseBlocks, // Separate tool use array for convenience
              stop_reason: chunk.message?.stop_reason,
            });
          }
          break;
      }
    },
    () => {
      // Stream complete
    },
    (error) => {
      console.error('[Streaming] Anthropic stream error:', error);
      throw error;
    }
  );

  return {
    text: fullText,
    contentBlocks,
    toolUseBlocks,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// OpenAI Streaming
// ─────────────────────────────────────────────────────────────────────────

/**
 * Stream response from OpenAI API
 * @param params - Request parameters
 * @param onDelta - Callback for each text delta
 * @param onToolCall - Callback for tool calls
 * @param onComplete - Callback when complete
 * @returns Final response
 */
export async function streamOpenAIResponse(
  params: OpenAIStreamParams,
  onDelta: ((delta: string, fullText: string) => void) | null,
  onToolCall: ((toolCall: OpenAIToolCall) => void) | null,
  onComplete: ((result: OpenAIStreamResult) => void) | null
): Promise<OpenAIStreamResult> {
  const { apiKey, model, maxTokens, messages, tools } = params;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages,
      tools: tools
        ? tools.map((t) => ({
            type: 'function',
            function: {
              name: t.name,
              description: t.description,
              parameters: t.input_schema,
            },
          }))
        : undefined,
      stream: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status} ${await response.text()}`);
  }

  let fullText = '';
  const toolCalls: OpenAIToolCall[] = [];

  await parseSSEStream(
    response.body!,
    (chunk) => {
      const choice = chunk.choices?.[0];
      if (!choice) return;

      const delta = choice.delta;

      // Text delta
      if (delta.content) {
        fullText += delta.content;
        if (onDelta) onDelta(delta.content, fullText);
      }

      // Tool calls
      if (delta.tool_calls) {
        for (const toolCall of delta.tool_calls) {
          const index = toolCall.index;

          // Initialize tool call if needed
          if (!toolCalls[index]) {
            toolCalls[index] = {
              id: toolCall.id!,
              type: 'function',
              function: {
                name: toolCall.function?.name || '',
                arguments: '',
              },
            };
          }

          // Append function arguments
          if (toolCall.function?.arguments) {
            toolCalls[index].function.arguments += toolCall.function.arguments;
          }
        }
      }

      // Completion
      if (choice.finish_reason) {
        if (onComplete) {
          onComplete({
            text: fullText,
            toolCalls,
            finish_reason: choice.finish_reason,
          });
        }
      }
    },
    () => {
      // Stream complete - notify about tool calls
      if (onToolCall && toolCalls.length > 0) {
        for (const toolCall of toolCalls) {
          onToolCall(toolCall);
        }
      }
    },
    (error) => {
      console.error('[Streaming] OpenAI stream error:', error);
      throw error;
    }
  );

  return {
    text: fullText,
    toolCalls,
  };
}
