/**
 * Chat Execution Service
 *
 * Handles inline execution of decomposed chat tasks, supporting both:
 * 1. Direct tool execution mode (pre-planned tools from Builder)
 * 2. LLM-based execution mode (step-by-step with Anthropic/OpenAI)
 *
 * Extracted from main.js to improve maintainability and testability.
 */

import { promises as fs } from 'fs';

// Types will be imported from their modules
type BrowserWindow = any;
type Decomposition = any;
type ToolExecutor = any;

/**
 * Execution request parameters
 */
export interface ExecutionRequest {
  decomposition: Decomposition;
  originalMessage: string;
}

/**
 * Execution result
 */
export interface ExecutionResult {
  ok: boolean;
  response?: string;
  executedInline?: boolean;
  stepResults?: any[];
  goalAchievedEarly?: boolean;
  error?: string;
}

/**
 * Step result for LLM-based execution
 */
export interface StepResult {
  step: number;
  action: string;
  response?: string;
  error?: string;
  success: boolean;
}

/**
 * Execution context with all dependencies
 */
export interface ExecutionContext {
  win: BrowserWindow | null;
  currentUser: { username?: string } | null;
  processChatQuery: (messages: any[], options?: any) => Promise<any>;
  getGoogleAccessToken: (username?: string) => Promise<string | null>;
  getSlackAccessToken: (username?: string) => Promise<string | null>;
  getSettingsPath: (username?: string) => Promise<string>;
  buildToolsAndExecutor: (options: any) => ToolExecutor;
  getAvailableCredentialDomains: () => Promise<string[]>;
  checkSkillDemoCompletionShared: (
    originalMessage: string,
    response: string,
    username?: string,
    win?: BrowserWindow
  ) => Promise<void>;
  fs: typeof fs;
}

/**
 * ChatExecutionService - Handles inline execution of decomposed tasks
 */
export class ChatExecutionService {
  // Token budget tracking - rough estimate
  private static readonly MAX_CONTEXT_CHARS = 15000; // ~3750 tokens, leave room for system prompt

  /**
   * Execute a decomposed task inline
   *
   * @param request - Execution request with decomposition and original message
   * @param context - Execution context with all dependencies
   * @returns Execution result with success status and response
   */
  static async executeInline(
    request: ExecutionRequest,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    const { decomposition, originalMessage } = request;

    try {
      console.log(`[Chat] ========== INLINE EXECUTION STARTED ==========`);
      console.log(`[Chat] Title: ${decomposition.title}`);
      console.log(`[Chat] Steps: ${decomposition.steps?.length || 0}`);
      console.log(`[Chat] Plan: ${decomposition.plan?.length || 0} tool calls`);
      console.log(`[Chat] Original message: ${originalMessage?.substring(0, 100)}...`);

      // Check if we have a structured plan from the Builder (with tool + args)
      // If so, execute tools directly without LLM calls for each step
      if (decomposition.plan && decomposition.plan.length > 0 && decomposition.plan[0].tool) {
        return await this.executeDirectMode(request, context);
      }

      // Fallback to LLM-based execution for complex tasks without pre-planned tools
      return await this.executeLLMMode(request, context);
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      console.error('[Chat] Inline execution error:', error);
      return { ok: false, error };
    }
  }

  /**
   * Execute in DIRECT mode - using pre-planned tools without LLM
   */
  private static async executeDirectMode(
    request: ExecutionRequest,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    const { decomposition, originalMessage } = request;
    const { win, currentUser, checkSkillDemoCompletionShared } = context;

    console.log(`[Chat] Using DIRECT execution mode - executing tools without LLM`);

    // Send initial progress message
    if (win && win.webContents) {
      win.webContents.send('chat:newMessage', {
        role: 'assistant',
        content: `🚀 **${decomposition.title}**\n\nExecuting...`,
        source: 'decomposed'
      });
    }

    // Build tool executor with all available tools
    const toolExecutor = await this.buildToolExecutor(context);

    const results: Record<string, any> = {};
    let lastResult: any = null;

    // Execute each tool in the plan directly
    for (const planStep of decomposition.plan) {
      const { tool, args, output_var, description } = planStep;
      console.log(`[Chat] Direct exec: ${tool} - ${description}`);

      // Substitute variables from previous results using object-level substitution
      const resolvedArgs = this.substituteTemplateVariables(args, results);

      try {
        // Execute the tool
        const result = await toolExecutor.executeTool(tool, resolvedArgs);

        // Store result for variable substitution - use step index from loop
        const stepIndex = decomposition.plan.indexOf(planStep) + 1;
        results[`step_${stepIndex}`] = result;
        if (output_var) {
          results[output_var] = result;
        }
        lastResult = result;

        // Capture screenshots for display
        if (result.screenshotDataUrl) {
          if (win && !win.isDestroyed()) {
            win.webContents.send('chat:screenshot', { dataUrl: result.screenshotDataUrl });
          }
        }

        console.log(`[Chat] Direct exec ${tool}: success=${result.success !== false}`);

        // Small delay between browser operations to let pages load
        if (tool.startsWith('browser_')) {
          await new Promise((r) => setTimeout(r, 500));
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Unknown error';
        console.error(`[Chat] Direct exec ${tool} error:`, error);
        // Continue with other steps even if one fails
      }
    }

    // Generate summary response
    let response = `✅ **${decomposition.title}** - Done!`;
    if (lastResult?.summary) {
      response = `✅ ${lastResult.summary}`;
    } else if (lastResult?.url) {
      response = `✅ **${decomposition.title}**\n\nNavigated to: ${lastResult.url}`;
    }

    // Substitute any remaining template variables in the final response
    response = this.substituteTemplateInResponse(response, results);

    // Check for skill demo completion (Marco/Polo test) after inline execution
    await checkSkillDemoCompletionShared(originalMessage, response, currentUser?.username, win);

    return { ok: true, response };
  }

  /**
   * Execute in LLM mode - step-by-step with Anthropic/OpenAI
   */
  private static async executeLLMMode(
    request: ExecutionRequest,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    const { decomposition, originalMessage } = request;
    const { win, currentUser, checkSkillDemoCompletionShared } = context;

    console.log(`[Chat] Using LLM execution mode`);

    const { steps, title } = decomposition;
    const stepResults: StepResult[] = [];
    let accumulatedContext: Record<string, any> = {};
    let goalAchieved = false;

    // Send initial progress message - don't promise to walk through all steps
    if (win && win.webContents) {
      win.webContents.send('chat:newMessage', {
        role: 'assistant',
        content: `🚀 **Working on: ${title}**\n\nLet me handle this for you...`,
        source: 'decomposed'
      });
    }

    // Execute each step through the FULL chat processing pipeline
    for (let i = 0; i < steps.length; i++) {
      // Check if goal was already achieved
      if (goalAchieved) {
        console.log(`[Chat] Goal achieved in previous step, skipping remaining steps`);
        break;
      }

      const step = steps[i];
      const stepNum = i + 1;

      console.log(`[Chat] Executing step ${stepNum}/${steps.length}: ${step.action}`);

      // Don't send individual step progress - just work on it silently
      // Only send progress for first step or long-running tasks
      if (stepNum === 1) {
        if (win && win.webContents) {
          win.webContents.send('chat:newMessage', {
            role: 'assistant',
            content: `⏳ Working on it...`,
            source: 'decomposed'
          });
        }
      }

      try {
        const stepResult = await this.executeStep(
          step,
          stepNum,
          steps.length,
          originalMessage,
          accumulatedContext,
          context,
          title
        );

        stepResults.push(stepResult);

        if (stepResult.success && stepResult.response) {
          // Send the result to the user
          if (win && win.webContents) {
            const isLastStep = stepNum === steps.length;
            const responseHasGoal = stepResult.response.includes('[GOAL_ACHIEVED]');

            // If goal achieved or this is the last step, just show the answer
            if (responseHasGoal || isLastStep) {
              win.webContents.send('chat:newMessage', {
                role: 'assistant',
                content: stepResult.response,
                source: 'decomposed'
              });
            } else {
              // For intermediate steps, show progress
              win.webContents.send('chat:newMessage', {
                role: 'assistant',
                content: `✅ **Step ${stepNum} complete**: ${step.action}\n\n${stepResult.response}`,
                source: 'decomposed'
              });
            }
          }

          // Check if goal was achieved
          if (stepResult.response.includes('[GOAL_ACHIEVED]')) {
            console.log(`[Chat] Goal achieved at step ${stepNum}, stopping execution`);
            goalAchieved = true;
          }
        } else if (!stepResult.success) {
          if (win && win.webContents) {
            win.webContents.send('chat:newMessage', {
              role: 'assistant',
              content: `❌ **Step ${stepNum} failed**: ${stepResult.error}`,
              source: 'decomposed'
            });
          }
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : 'Unknown error';
        console.error(`[Chat] Step ${stepNum} error:`, error);
        stepResults.push({
          step: stepNum,
          action: step.action,
          error,
          success: false
        });

        if (win && win.webContents) {
          win.webContents.send('chat:newMessage', {
            role: 'assistant',
            content: `❌ **Step ${stepNum} failed**: ${error}`,
            source: 'decomposed'
          });
        }
      }
    }

    // Generate final summary - only if not already sent via goal achievement
    const successfulSteps = stepResults.filter((r) => r.success).length;
    const lastResult = stepResults[stepResults.length - 1];

    // Don't send another summary if goal was achieved (already sent the answer)
    let finalResponse = '';
    if (!goalAchieved && lastResult?.response) {
      finalResponse = lastResult.response;
    } else if (goalAchieved) {
      finalResponse = lastResult?.response || 'Task completed.';
    }

    // Check for skill demo completion (Marco/Polo test) after LLM inline execution
    await checkSkillDemoCompletionShared(originalMessage, finalResponse, currentUser?.username, win);

    return {
      ok: true,
      response: finalResponse,
      executedInline: true,
      stepResults,
      goalAchievedEarly: goalAchieved && successfulSteps < steps.length
    };
  }

  /**
   * Execute a single step in LLM mode
   */
  private static async executeStep(
    step: any,
    stepNum: number,
    totalSteps: number,
    originalMessage: string,
    accumulatedContext: Record<string, any>,
    context: ExecutionContext,
    title: string
  ): Promise<StepResult> {
    const {
      processChatQuery,
      getSlackAccessToken,
      getSettingsPath,
      buildToolsAndExecutor,
      getAvailableCredentialDomains,
      fs,
      currentUser
    } = context;

    // Compress accumulated context to stay within token budget
    const compressedContext = this.compressContext(accumulatedContext);

    // Build the step message with COMPRESSED context
    const contextSummary = this.buildContextSummary(compressedContext);

    // Create messages array for this step - using a single user message for clarity
    const stepMessages = [
      {
        role: 'user',
        content: `Original request: "${originalMessage}"

Current step ${stepNum}/${totalSteps}: "${step.action}"
${contextSummary}
INSTRUCTIONS:
1. Execute this step using available tools
2. If you can FULLY ANSWER the original request with information you already have or will retrieve, DO IT NOW
3. At the end of your response, add one of these tags:
   - [GOAL_ACHIEVED] if the user's original request has been fully answered
   - [CONTINUE] if more steps are needed

Be concise. Execute the step and provide the answer.`
      }
    ];

    // Use processChatQuery to get the full context (profile, memory, skills, system prompt)
    const contextResult = await processChatQuery(stepMessages, {
      skipDecomposition: true, // Don't re-decompose individual steps
      stepContext:
        Object.keys(accumulatedContext).length > 0
          ? JSON.stringify(accumulatedContext, null, 2)
          : null
    });

    // If there was an error getting context, handle it
    if (!contextResult.ok && !contextResult.continueWithFullFlow) {
      throw new Error(contextResult.error || 'Failed to get context');
    }

    // Now execute the step using the enriched system prompt
    const { apiKeys, models, activeProvider, systemPrompt, accessToken } = contextResult;

    // Get Slack token
    const slackAccessToken = await getSlackAccessToken(currentUser?.username).catch(() => null);

    // Get settings for weather and browser
    const settingsPath = await getSettingsPath(currentUser?.username);
    let weatherEnabled = true;
    let hasBrowserTools = false;
    try {
      const settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
      weatherEnabled = settings.weatherEnabled !== false;
      hasBrowserTools = settings.browserEnabled === true;
      if (hasBrowserTools) {
        console.log(`[Chat] Step ${stepNum}: Browser tools enabled`);
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[Chat] Step ${stepNum}: Error loading settings:`, error);
    }

    // Build tool executor with all tools
    const { executeTool, tools: allTools } = buildToolsAndExecutor({
      googleAccessToken: accessToken,
      slackAccessToken,
      weatherEnabled,
      iMessageEnabled: process.platform === 'darwin',
      browserEnabled: hasBrowserTools,
      apiKeys
    });

    console.log(
      `[Chat] Step ${stepNum} tools available: ${allTools.length}`,
      allTools.map((t: any) => t.name)
    );

    // Build complete system prompt with ALL tool instructions (matching chat:send)
    const fullSystemPrompt = await this.buildFullSystemPrompt(
      systemPrompt,
      slackAccessToken,
      weatherEnabled,
      hasBrowserTools,
      accessToken,
      getAvailableCredentialDomains
    );

    // Enhanced system prompt for this specific step - focused on EFFICIENCY
    const stepSystemPrompt = await this.buildStepSystemPrompt(
      fullSystemPrompt,
      title,
      compressedContext,
      hasBrowserTools
    );

    // Execute LLM call for this step
    let stepResponse: string | null = null;

    if (activeProvider === 'anthropic' && apiKeys.anthropic) {
      stepResponse = await this.executeAnthropicStep(
        stepMessages,
        stepSystemPrompt,
        allTools,
        apiKeys.anthropic,
        models.anthropic || 'claude-sonnet-4-20250514',
        executeTool,
        stepNum,
        accumulatedContext,
        context
      );
    } else if (activeProvider === 'openai' && apiKeys.openai) {
      stepResponse = await this.executeOpenAIStep(
        stepMessages,
        stepSystemPrompt,
        allTools,
        apiKeys.openai,
        models.openai || 'gpt-4o',
        executeTool,
        stepNum,
        accumulatedContext,
        context
      );
    } else {
      throw new Error(`No LLM provider available (active: ${activeProvider})`);
    }

    // Store result
    if (stepResponse) {
      // Check for goal achievement markers
      const cleanResponse = stepResponse
        .replace(/\[GOAL_ACHIEVED\]/g, '')
        .replace(/\[CONTINUE\]/g, '')
        .trim();

      accumulatedContext[`step${stepNum}_result`] = this.truncateResult(cleanResponse, 2000);

      return {
        step: stepNum,
        action: step.action,
        response: cleanResponse,
        success: true
      };
    } else {
      throw new Error('No response from LLM');
    }
  }

  /**
   * Execute a step using Anthropic API
   */
  private static async executeAnthropicStep(
    stepMessages: any[],
    stepSystemPrompt: string,
    allTools: any[],
    apiKey: string,
    model: string,
    executeTool: Function,
    stepNum: number,
    accumulatedContext: Record<string, any>,
    context: ExecutionContext
  ): Promise<string | null> {
    const { win } = context;
    let iterationMessages = stepMessages.map((m) => ({ role: m.role, content: m.content }));

    for (let iteration = 0; iteration < 20; iteration++) {
      // Increased for browser automation
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          system: stepSystemPrompt,
          tools: allTools,
          messages: iterationMessages
        })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`API error: ${error}`);
      }

      const data: any = await response.json();

      console.log(
        `[Chat] Step ${stepNum} iteration ${iteration}/20: stop_reason=${data.stop_reason}, content types=${data.content?.map((b: any) => b.type).join(',')}`
      );

      if (data.stop_reason === 'end_turn' || !data.content.some((b: any) => b.type === 'tool_use')) {
        const textBlock = data.content.find((b: any) => b.type === 'text');
        const stepResponse = textBlock?.text || '';
        console.log(
          `[Chat] Step ${stepNum} completed without tool use, response length: ${stepResponse.length}`
        );
        return stepResponse;
      }

      // Handle tool calls
      const toolUseBlocks = data.content.filter((b: any) => b.type === 'tool_use');
      const toolResults = [];

      console.log(`[Chat] Step ${stepNum} has ${toolUseBlocks.length} tool calls`);

      for (const toolUse of toolUseBlocks) {
        console.log(
          `[Chat] Step ${stepNum} executing tool: ${toolUse.name} with input:`,
          JSON.stringify(toolUse.input).substring(0, 200)
        );
        const result = await executeTool(toolUse.name, toolUse.input);
        console.log(
          `[Chat] Step ${stepNum} tool ${toolUse.name} result:`,
          JSON.stringify(result).substring(0, 300)
        );

        // Handle CDP browser tool screenshots - send to UI for display
        if (result.screenshotDataUrl && win && !win.isDestroyed()) {
          win.webContents.send('chat:screenshot', { dataUrl: result.screenshotDataUrl });
        }

        // For browser tools with screenshots, send image to LLM
        const { screenshotDataUrl, ...resultForLLM } = result;

        // Truncate large results (especially browser_snapshot) to save tokens
        const truncatedResult = this.truncateResult(
          resultForLLM,
          toolUse.name.includes('snapshot') ? 4000 : 3000
        );
        accumulatedContext[`step${stepNum}_${toolUse.name}`] = truncatedResult;

        if (screenshotDataUrl && screenshotDataUrl.startsWith('data:image/')) {
          // Extract base64 data from data URL for Anthropic's image format
          const base64Match = screenshotDataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
          if (base64Match) {
            const mediaType = `image/${base64Match[1]}`;
            const base64Data = base64Match[2];

            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: [
                { type: 'text', text: JSON.stringify(resultForLLM) },
                { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } }
              ]
            });
          } else {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolUse.id,
              content: JSON.stringify(resultForLLM)
            });
          }
        } else {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify(resultForLLM)
          });
        }
      }

      iterationMessages.push({ role: 'assistant', content: data.content });
      iterationMessages.push({ role: 'user', content: toolResults });
    }

    return null;
  }

  /**
   * Execute a step using OpenAI API
   */
  private static async executeOpenAIStep(
    stepMessages: any[],
    stepSystemPrompt: string,
    allTools: any[],
    apiKey: string,
    model: string,
    executeTool: Function,
    stepNum: number,
    accumulatedContext: Record<string, any>,
    context: ExecutionContext
  ): Promise<string | null> {
    const { win } = context;
    const openaiTools = allTools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.input_schema }
    }));

    let iterationMessages = [
      { role: 'system', content: stepSystemPrompt },
      ...stepMessages.map((m) => ({ role: m.role, content: m.content }))
    ];

    for (let iteration = 0; iteration < 20; iteration++) {
      // Increased for browser automation
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: iterationMessages,
          tools: openaiTools
        })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`API error: ${error}`);
      }

      const data: any = await response.json();
      const choice = data.choices[0];

      if (choice.finish_reason === 'stop' || !choice.message.tool_calls) {
        return choice.message.content || '';
      }

      iterationMessages.push(choice.message);

      let pendingScreenshots: string[] = [];

      for (const toolCall of choice.message.tool_calls) {
        const toolInput = JSON.parse(toolCall.function.arguments);
        console.log(`[Chat] Step ${stepNum} tool: ${toolCall.function.name}`);
        const result = await executeTool(toolCall.function.name, toolInput);

        // Handle CDP browser tool screenshots - send to UI for display
        if (result.screenshotDataUrl && win && !win.isDestroyed()) {
          win.webContents.send('chat:screenshot', { dataUrl: result.screenshotDataUrl });
        }

        // For OpenAI, collect screenshots to add as a user message
        const { screenshotDataUrl, ...resultForLLM } = result;
        if (screenshotDataUrl) {
          pendingScreenshots.push(screenshotDataUrl);
          resultForLLM.screenshotAttached = true;
        }

        // Truncate large results to save tokens
        const truncatedResult = this.truncateResult(
          resultForLLM,
          toolCall.function.name.includes('snapshot') ? 4000 : 3000
        );
        accumulatedContext[`step${stepNum}_${toolCall.function.name}`] = truncatedResult;

        iterationMessages.push({
          role: 'tool' as any,
          tool_call_id: toolCall.id,
          content:
            typeof resultForLLM === 'string' ? resultForLLM : JSON.stringify(resultForLLM)
        } as any);
      }

      // For OpenAI, add screenshots as a user message (vision models can see these)
      if (pendingScreenshots.length > 0) {
        const imageContent = pendingScreenshots.map((dataUrl) => ({
          type: 'image_url',
          image_url: { url: dataUrl, detail: 'low' }
        }));
        iterationMessages.push({
          role: 'user',
          content: [
            { type: 'text', text: 'Browser screenshot attached. Analyze it and continue.' },
            ...imageContent
          ]
        });
      }
    }

    return null;
  }

  /**
   * Build tool executor with all available tools
   */
  private static async buildToolExecutor(context: ExecutionContext): Promise<any> {
    const {
      getGoogleAccessToken,
      getSlackAccessToken,
      getSettingsPath,
      buildToolsAndExecutor,
      currentUser,
      fs
    } = context;

    const accessToken = await getGoogleAccessToken(currentUser?.username).catch(() => null);
    const slackAccessToken = await getSlackAccessToken(currentUser?.username).catch(() => null);
    const settingsPath = await getSettingsPath(currentUser?.username);
    let hasBrowserTools = false;
    let apiKeys: any = {};
    try {
      const settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
      hasBrowserTools = settings.browserEnabled === true;
      apiKeys = settings.apiKeys || {};
    } catch {
      /* default */
    }

    return buildToolsAndExecutor({
      googleAccessToken: accessToken,
      slackAccessToken,
      weatherEnabled: true,
      iMessageEnabled: process.platform === 'darwin',
      browserEnabled: hasBrowserTools,
      apiKeys
    });
  }

  /**
   * Substitute template variables in arguments
   */
  private static substituteTemplateVariables(args: any, results: Record<string, any>): any {
    if (!args) return args;

    // Helper to resolve a template variable
    const resolveVariable = (match: string, stepNum: string, field: string): any => {
      const prevResult = results[`step_${stepNum}`];
      if (!prevResult) {
        console.log(`[Chat] Template variable not found: step_${stepNum} (no result)`);
        return null;
      }

      // Handle nested field access (e.g., "retrieved_emails.messages")
      const fields = field.split('.');
      let value = prevResult;

      for (let i = 0; i < fields.length; i++) {
        const f = fields[i];

        if (!value) {
          console.log(
            `[Chat] Template variable path failed at ${f}: step_${stepNum}.${fields.slice(0, i + 1).join('.')}`
          );
          return null;
        }

        // Direct field match
        if (value[f] !== undefined) {
          value = value[f];
          continue;
        }

        // Field name variations (only for first level)
        if (i === 0) {
          const fieldVariations: Record<string, string> = {
            recent_messages: 'messages',
            imessages: 'messages',
            slack_messages: 'messages',
            email_messages: 'messages',
            text_messages: 'messages',
            retrieved_emails: 'messages',
            retrieved_messages: 'messages',
            email_results: 'messages',
            todays_events: 'events',
            formatted_messages: 'formatted',
            formatted: 'formatted_messages',
            result: 'message',
            message: 'result',
            summary_report: 'formatted',
            report: 'formatted',
            summary: 'formatted',
            output: 'formatted',
            content: 'formatted'
          };

          if (fieldVariations[f] && value[fieldVariations[f]] !== undefined) {
            console.log(`[Chat] Using field variation: ${f} -> ${fieldVariations[f]}`);
            value = value[fieldVariations[f]];
            continue;
          }

          // Fallback for any *_messages field
          if (
            (f.endsWith('_messages') ||
              f.endsWith('messages') ||
              f.endsWith('_results') ||
              f.endsWith('results')) &&
            value.messages !== undefined
          ) {
            console.log(`[Chat] Using fallback: ${f} -> messages`);
            value = value.messages;
            continue;
          }

          // Fallback for output variable names (summary_report, report, etc.) - try common output fields
          if (
            f.includes('summary') ||
            f.includes('report') ||
            f.includes('output') ||
            f.includes('content')
          ) {
            // Try formatted first, then result, then message
            const tryFields = ['formatted', 'result', 'message', 'formatted_messages'];
            let found = false;
            for (const tryField of tryFields) {
              if (value[tryField] !== undefined) {
                console.log(`[Chat] Using output fallback: ${f} -> ${tryField}`);
                value = value[tryField];
                found = true;
                break;
              }
            }
            if (found) continue;
          }

          // Last resort: use first array field if this looks like a messages field
          if (
            f.includes('message') ||
            f.includes('email') ||
            f.includes('event') ||
            f.includes('result')
          ) {
            const arrayField = Object.entries(value).find(([k, v]) => Array.isArray(v));
            if (arrayField) {
              console.log(`[Chat] Using first array field: ${f} -> ${arrayField[0]}`);
              value = arrayField[1];
              continue;
            }
          }

          // Generic fallback for ANY unknown field name (like custom output_var names)
          // Try standard output fields that tools typically return
          if (i === 0) {
            // Only for top-level access
            const standardFields = [
              'formatted',
              'result',
              'analysis',
              'message',
              'data',
              'output',
              'content'
            ];
            let found = false;
            for (const tryField of standardFields) {
              if (value[tryField] !== undefined) {
                console.log(
                  `[Chat] Using standard field fallback: ${f} -> ${tryField} (custom output_var not found)`
                );
                value = value[tryField];
                found = true;
                break;
              }
            }
            if (found) continue;
          }
        }

        // If we couldn't resolve this field, give up
        console.log(
          `[Chat] Template variable not found: step_${stepNum}.${field}, available at level ${i}:`,
          value ? Object.keys(value) : 'no value'
        );
        return null;
      }

      return value;
    };

    // Recursively substitute templates in the args object
    const substituteInObject = (obj: any): any => {
      if (typeof obj === 'string') {
        // Check if entire string is a template variable
        const fullMatch = obj.match(/^\{\{step_(\d+)\.(\w+(?:\.\w+)?)\}\}$/);
        if (fullMatch) {
          const value = resolveVariable(fullMatch[0], fullMatch[1], fullMatch[2]);
          return value !== null ? value : obj; // Keep original if resolution fails
        }

        // Otherwise do string substitution for embedded templates
        return obj.replace(/\{\{step_(\d+)\.(\w+(?:\.\w+)?)\}\}/g, (match, stepNum, field) => {
          const value = resolveVariable(match, stepNum, field);
          if (value === null) return match;

          // Format for string embedding
          if (Array.isArray(value)) {
            if (value.length > 0 && typeof value[0] === 'object') {
              return value
                .map((item) => {
                  if (item.text && item.from && item.date) {
                    return `[${item.date}] ${item.from}: ${item.text}`;
                  }
                  return JSON.stringify(item);
                })
                .join('\n');
            }
            return value.join(', ');
          } else if (typeof value === 'object' && value !== null) {
            return JSON.stringify(value);
          }
          return String(value);
        });
      } else if (Array.isArray(obj)) {
        return obj.map((item) => substituteInObject(item));
      } else if (typeof obj === 'object' && obj !== null) {
        const result: any = {};
        for (const [key, value] of Object.entries(obj)) {
          result[key] = substituteInObject(value);
        }
        return result;
      }
      return obj;
    };

    return substituteInObject(args);
  }

  /**
   * Substitute template variables in final response
   */
  private static substituteTemplateInResponse(
    response: string,
    results: Record<string, any>
  ): string {
    return response.replace(/\{\{step_(\d+)\.(\w+(?:\.\w+)?)\}\}/g, (match, stepNum, field) => {
      const prevResult = results[`step_${stepNum}`];

      if (!prevResult) {
        console.log(`[Chat] Template variable not found in response: step_${stepNum} (no result)`);
        return '0';
      }

      // Handle nested field access (e.g., "messages.length")
      const fields = field.split('.');
      let value = prevResult;

      for (const f of fields) {
        if (value && value[f] !== undefined) {
          value = value[f];
        } else {
          // Try field variations
          const fieldVariations: Record<string, string> = {
            retrieved_emails: 'messages',
            retrieved_messages: 'messages',
            todays_events: 'events',
            recent_messages: 'messages',
            imessages: 'messages',
            emails: 'messages'
          };

          if (value && fieldVariations[f] && value[fieldVariations[f]] !== undefined) {
            console.log(`[Chat] Using field variation in response: ${f} -> ${fieldVariations[f]}`);
            value = value[fieldVariations[f]];
          } else {
            console.log(
              `[Chat] Template variable not found in response: step_${stepNum}.${field}, available:`,
              prevResult ? Object.keys(prevResult) : 'no result'
            );
            return '0';
          }
        }
      }

      // Return the value (number, string, or array length)
      if (Array.isArray(value)) {
        return String(value.length);
      }
      return String(value);
    });
  }

  /**
   * Truncate/summarize large results (especially browser snapshots)
   */
  private static truncateResult(result: any, maxChars: number = 3000): string {
    const str = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    if (str.length <= maxChars) return str;

    // For browser snapshots, try to extract just the meaningful content
    if (str.includes('accessibility tree') || str.includes('browser_snapshot')) {
      // Extract key info and truncate
      return (
        str.substring(0, maxChars) +
        `\n\n[... truncated ${str.length - maxChars} chars for token efficiency ...]`
      );
    }
    return str.substring(0, maxChars) + `\n\n[... truncated ...]`;
  }

  /**
   * Compress accumulated context if too large
   */
  private static compressContext(ctx: Record<string, any>): Record<string, any> {
    const compressed: Record<string, any> = {};
    let totalChars = 0;

    // Prioritize recent results, truncate old ones more aggressively
    const entries = Object.entries(ctx).reverse(); // Most recent first

    for (const [key, value] of entries) {
      const valueStr = this.truncateResult(value, 2000);
      if (totalChars + valueStr.length > this.MAX_CONTEXT_CHARS) {
        // Skip or heavily truncate old results
        const shortened = valueStr.substring(0, 500) + '... [truncated for efficiency]';
        compressed[key] = shortened;
        totalChars += shortened.length;
      } else {
        compressed[key] = valueStr;
        totalChars += valueStr.length;
      }
    }

    return compressed;
  }

  /**
   * Build context summary for step message
   */
  private static buildContextSummary(compressedContext: Record<string, any>): string {
    if (Object.keys(compressedContext).length === 0) {
      return '';
    }

    const contextEntries = Object.entries(compressedContext);
    let contextSummary = '\n\n## DATA FROM PREVIOUS STEPS:\n';
    for (const [key, value] of contextEntries) {
      const valueStr = typeof value === 'string' ? value : JSON.stringify(value);
      contextSummary += `\n### ${key}:\n${valueStr}\n`;
    }

    // Also extract and highlight any URLs
    const allText = JSON.stringify(compressedContext);
    const urls = allText.match(/https?:\/\/[^\s"',\]\\]+/g) || [];
    if (urls.length > 0) {
      contextSummary += `\n### IMPORTANT URLS FOUND:\n${[...new Set(urls)].map((u) => `- ${u}`).join('\n')}\n`;
    }

    return contextSummary;
  }

  /**
   * Build full system prompt with tool instructions
   */
  private static async buildFullSystemPrompt(
    systemPrompt: string,
    slackAccessToken: string | null,
    weatherEnabled: boolean,
    hasBrowserTools: boolean,
    accessToken: string | null,
    getAvailableCredentialDomains: () => Promise<string[]>
  ): Promise<string> {
    let fullSystemPrompt = systemPrompt;

    // Add Slack system prompt if connected
    if (slackAccessToken) {
      fullSystemPrompt += `\n\nYou have access to Slack tools:
- get_slack_messages: Get recent messages from a Slack channel or DM. For DMs, you can pass a person's name and it will find their DM channel automatically.
- send_slack_message: Send a message to a Slack channel or DM
- list_slack_channels: List available Slack channels
- search_slack_users: Search for Slack users by name

When getting DMs from a specific person, use get_slack_messages with their name (e.g., "Chris Gorog").`;
    }

    // Add Weather system prompt
    if (weatherEnabled) {
      fullSystemPrompt += `\n\nYou have access to weather tools. You can look up weather forecasts, current conditions, and find location coordinates.`;
    }

    // Add browser automation system prompt
    if (hasBrowserTools) {
      const stepCredentials = await getAvailableCredentialDomains();
      let browserStepPrompt = `\n\n## WEB RESEARCH CAPABILITY - BROWSER TOOLS

You have browser automation via browser_* tools:
- \`browser_navigate\`: Go to URL, returns snapshot with element refs
- \`browser_click\`: Click element by ref (e.g., "e5")
- \`browser_type\`: Type text, optionally specify ref to focus
- \`browser_press\`: Press keys like "Enter"
- \`browser_snapshot\`: Get current page screenshot + elements
- \`browser_scroll\`: Scroll page up/down

**DO NOT SAY you cannot access websites. USE THE BROWSER TOOLS.**`;

      if (stepCredentials.length > 0) {
        browserStepPrompt += `

**SAVED CREDENTIALS:** ${stepCredentials.join(', ')}
If logging into these sites, use the saved credentials. **NEVER ask the user for passwords.**`;
      } else {
        browserStepPrompt += `

**NO SAVED CREDENTIALS.** If login is needed, tell user to add credentials in the Credentials page. **NEVER ask for passwords.**`;
      }

      fullSystemPrompt += browserStepPrompt;
    }

    // Add Google tools system prompt
    if (accessToken) {
      fullSystemPrompt += `\n\nYou have access to Google Workspace tools (calendar, email, drive). Use them when relevant.`;
    }

    // Add iMessage system prompt
    if (process.platform === 'darwin') {
      fullSystemPrompt += `\n\nYou have access to iMessage/SMS tools for sending and reading text messages.`;
    }

    return fullSystemPrompt;
  }

  /**
   * Build step-specific system prompt
   */
  private static async buildStepSystemPrompt(
    fullSystemPrompt: string,
    title: string,
    compressedContext: Record<string, any>,
    hasBrowserTools: boolean
  ): Promise<string> {
    const contextStr = JSON.stringify(compressedContext);
    const urlMatches = contextStr.match(/https?:\/\/[^\s"',\]]+/g) || [];
    const uniqueUrls = [...new Set(urlMatches)];

    return `${fullSystemPrompt}

## Task: ${title}

## EFFICIENCY RULES:
1. **ANSWER THE USER'S QUESTION AS SOON AS POSSIBLE** - If you have enough information to fully answer the original request, do it NOW. Don't wait for more steps.
2. **Be concise** - Provide the answer directly, no need for step-by-step narration.
3. **Use tools only when needed** - If you already have the data, don't make redundant tool calls.
4. **Use data from previous steps** - Don't re-fetch what's already available in context.

## BROWSER AUTOMATION REMINDER:
${hasBrowserTools ? `- Use browser_navigate to go to websites - it automatically returns a screenshot
- Use browser_snapshot to see the current page state
- All browser tools return visual snapshots - you can SEE what's on the page` : `- Browser automation is not enabled`}

${uniqueUrls.length > 0 ? `## URLs available:
${uniqueUrls.slice(0, 5).map((url) => `- ${url}`).join('\n')}
` : ''}## Response format:
- Give a direct, helpful answer
- End with [GOAL_ACHIEVED] if user's original request is now fully answered
- End with [CONTINUE] if more steps are genuinely needed`;
  }
}
