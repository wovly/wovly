/**
 * Task Execution Engine
 *
 * Executes tasks using three execution modes:
 * 1. Follow-up mode: Handles wait_for_reply follow-ups
 * 2. Direct execution mode: Executes structured plans with tool calls
 * 3. LLM-based execution mode: Uses LLM to interpret and execute steps
 *
 * NOTE: This file is intentionally large (~1200 lines) due to the complexity
 * of task execution logic. Future refactoring could split this into smaller modules.
 */

import { promises as fs } from 'fs';

// Types
interface Task {
  id: string;
  title: string;
  status: string;
  originalRequest: string;
  plan: string[];
  structuredPlan?: any[];
  currentStep: {
    step: number;
    description?: string;
    state?: string;
    pollInterval?: number | null;
  };
  contextMemory?: Record<string, any>;
  executionLog: Array<{ timestamp: string; message: string }>;
  pendingMessages?: any[];
  autoSend?: boolean;
  notificationsDisabled?: boolean;
  taskType?: string;
  messagingChannel?: string;
  pollFrequency?: { value: number; label: string };
  nextCheck?: number;
}

interface ExecutionResult {
  success?: boolean;
  error?: string;
  skipped?: boolean;
  reason?: string;
  completed?: boolean;
  waitingForReply?: boolean;
  waitingForInput?: boolean;
  pendingMessage?: boolean;
  action?: string;
  [key: string]: any;
}

interface ApiKeys {
  anthropic?: string;
  openai?: string;
  google?: string;
}

// Dependency injection callbacks
type GetTaskCallback = (taskId: string, username?: string) => Promise<Task | null>;
type UpdateTaskCallback = (taskId: string, updates: any, username?: string) => Promise<void>;
type LoadIntegrationsCallback = (options?: any) => Promise<any>;
type AddTaskUpdateCallback = (taskId: string, message: string, options?: any) => void;
type GetSettingsPathCallback = (username?: string) => Promise<string>;
type ExecuteToolCallback = (toolName: string, toolInput: any, taskContext?: any) => Promise<any>;
type InternalExecuteTaskStepCallback = (taskId: string) => Promise<void>;

export class TaskExecutionEngine {
  private static getTask: GetTaskCallback;
  private static updateTask: UpdateTaskCallback;
  private static loadIntegrationsAndBuildTools: LoadIntegrationsCallback;
  private static addTaskUpdate: AddTaskUpdateCallback;
  private static getSettingsPath: GetSettingsPathCallback;
  private static executeTool: ExecuteToolCallback;
  private static internalExecuteTaskStep: InternalExecuteTaskStepCallback;
  private static mainWindow: any = null;
  private static currentUser: { username: string } | null = null;

  /**
   * Set dependency injection callbacks
   */
  static setGetTaskCallback(callback: GetTaskCallback): void {
    this.getTask = callback;
  }

  static setUpdateTaskCallback(callback: UpdateTaskCallback): void {
    this.updateTask = callback;
  }

  static setLoadIntegrationsCallback(callback: LoadIntegrationsCallback): void {
    this.loadIntegrationsAndBuildTools = callback;
  }

  static setAddTaskUpdateCallback(callback: AddTaskUpdateCallback): void {
    this.addTaskUpdate = callback;
  }

  static setGetSettingsPathCallback(callback: GetSettingsPathCallback): void {
    this.getSettingsPath = callback;
  }

  static setExecuteToolCallback(callback: ExecuteToolCallback): void {
    this.executeTool = callback;
  }

  static setExecuteTaskStepCallback(callback: InternalExecuteTaskStepCallback): void {
    this.internalExecuteTaskStep = callback;
  }

  static setMainWindow(window: any): void {
    this.mainWindow = window;
  }

  static setCurrentUser(user: { username: string } | null): void {
    this.currentUser = user;
  }

  /**
   * Main task execution entry point
   * Determines execution mode and delegates to appropriate handler
   */
  static async executeTaskStep(taskId: string): Promise<ExecutionResult> {
    console.log(`[Tasks] Executing step for task: ${taskId}`);

    const task = await this.getTask(taskId, this.currentUser?.username);
    if (!task) {
      console.error(`[Tasks] Task ${taskId} not found`);
      return { error: 'Task not found' };
    }

    // Skip if task is not in an executable state
    if (task.status !== 'active' && task.status !== 'waiting') {
      console.log(`[Tasks] Task ${taskId} is not in executable state: ${task.status}`);
      return { skipped: true, reason: `Task status is ${task.status}` };
    }

    // Get settings for API keys
    const settingsPath = await this.getSettingsPath(this.currentUser?.username);
    let apiKeys: ApiKeys = {};
    try {
      const settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
      apiKeys = settings.apiKeys || {};
    } catch {
      console.error('[Tasks] No API keys configured');
      await this.updateTask(
        taskId,
        {
          status: 'failed',
          logEntry: 'No API keys configured',
        },
        this.currentUser?.username
      );
      return { error: 'No API keys configured' };
    }

    if (!apiKeys.anthropic) {
      await this.updateTask(
        taskId,
        {
          status: 'failed',
          logEntry: 'Anthropic API key required for task execution',
        },
        this.currentUser?.username
      );
      return { error: 'Anthropic API key required' };
    }

    // ────────────────────────────────────────────────────────────────────────────
    // MODE 1: WAIT_FOR_REPLY FOLLOW-UP MODE
    // ────────────────────────────────────────────────────────────────────────────

    if (task.contextMemory?.needs_followup && task.contextMemory?.wait_for_reply_active) {
      return await this.executeFollowUpMode(taskId, task, apiKeys);
    }

    // ────────────────────────────────────────────────────────────────────────────
    // MODE 2: DIRECT EXECUTION MODE
    // ────────────────────────────────────────────────────────────────────────────

    if (task.structuredPlan && task.structuredPlan.length > 0 && task.structuredPlan[0].tool) {
      return await this.executeDirectMode(taskId, task);
    }

    // ────────────────────────────────────────────────────────────────────────────
    // MODE 3: STANDARD LLM-BASED EXECUTION
    // ────────────────────────────────────────────────────────────────────────────

    return await this.executeLLMMode(taskId, task, apiKeys);
  }

  /**
   * EXECUTION MODE 1: Follow-up mode
   * Handles wait_for_reply follow-ups when needs_followup is set
   */
  private static async executeFollowUpMode(
    taskId: string,
    task: Task,
    apiKeys: ApiKeys
  ): Promise<ExecutionResult> {
    console.log(`[Tasks] Handling wait_for_reply follow-up for task ${taskId}`);

    const ctx = task.contextMemory!;
    const isTimeout = ctx.followup_is_timeout || false;
    const currentFollowupCount = ctx.followup_count || 0;

    try {
      // Generate the follow-up message using LLM
      const followupMessage = await this.generateFollowupMessage(
        {
          originalRequest: ctx.original_request,
          previousReply: ctx.last_reply_content || '',
          reason: ctx.followup_reason || 'No specific information provided',
          followupCount: currentFollowupCount,
          isTimeout: isTimeout,
        },
        apiKeys
      );

      console.log(`[Tasks] Generated follow-up message: "${followupMessage.substring(0, 100)}..."`);

      // Send the follow-up message
      const sendResult = await this.sendFollowupMessage({
        platform: ctx.waiting_via,
        contact: ctx.waiting_for_contact,
        message: followupMessage,
        conversationId: ctx.conversation_id,
        task: task,
      });

      if (sendResult.success) {
        console.log(`[Tasks] Follow-up sent successfully to ${ctx.waiting_for_contact}`);

        // Update task - clear needs_followup, update timing, increment counter
        const pollIntervalMs = (ctx.poll_interval_minutes || 5) * 60000;
        await this.updateTask(
          taskId,
          {
            status: 'waiting',
            nextCheck: Date.now() + pollIntervalMs,
            contextMemory: {
              ...ctx,
              needs_followup: false,
              followup_is_timeout: false,
              followup_count: currentFollowupCount + 1,
              last_followup_time: new Date().toISOString(),
              last_followup_message: followupMessage,
            },
            logEntry: `Sent follow-up #${currentFollowupCount + 1} to ${ctx.waiting_for_contact}: "${followupMessage.substring(0, 100)}..."`,
          },
          this.currentUser?.username
        );

        // Notify user
        if (this.mainWindow && !task.notificationsDisabled) {
          this.mainWindow.webContents.send('chat:newMessage', {
            role: 'assistant',
            content: `📨 **Task: ${task.title}**\n\nSent follow-up #${currentFollowupCount + 1} to ${ctx.waiting_for_contact} via ${ctx.waiting_via}:\n\n> ${followupMessage}\n\nContinuing to wait for reply...`,
            source: 'task',
          });
        }

        return { success: true, action: 'followup_sent', contact: ctx.waiting_for_contact };
      } else {
        console.error(`[Tasks] Failed to send follow-up: ${sendResult.error}`);

        await this.updateTask(
          taskId,
          {
            contextMemory: {
              ...ctx,
              needs_followup: false,
              followup_send_error: sendResult.error,
            },
            logEntry: `Failed to send follow-up: ${sendResult.error}`,
          },
          this.currentUser?.username
        );

        return { error: sendResult.error };
      }
    } catch (err: any) {
      console.error(`[Tasks] Error handling follow-up: ${err.message}`);
      await this.updateTask(
        taskId,
        {
          contextMemory: {
            ...task.contextMemory,
            needs_followup: false,
            followup_error: err.message,
          },
          logEntry: `Error handling follow-up: ${err.message}`,
        },
        this.currentUser?.username
      );
      return { error: err.message };
    }
  }

  /**
   * EXECUTION MODE 2: Direct execution mode
   * Executes structured plans with direct tool calls (no LLM interpretation)
   */
  private static async executeDirectMode(taskId: string, task: Task): Promise<ExecutionResult> {
    console.log(`[Tasks] Using DIRECT EXECUTION mode for task ${taskId}`);
    console.log(`[Tasks] Structured plan has ${task.structuredPlan!.length} steps`);

    // Use shared tool builder - ensures tasks have same tools as chat
    const { tools: directExecTools, executeTool: directExecExecuteTool } =
      await this.loadIntegrationsAndBuildTools({
        includeProfileTools: false,
        includeTaskTools: false,
        includeMemoryTools: false,
      });

    const toolsByName: Record<string, any> = {};
    for (const t of directExecTools) {
      toolsByName[t.name] = t;
    }

    const results: Record<string, any> = {};
    let lastResult: any = null;
    let lastScreenshot: any = null;

    try {
      // Determine which step to resume from (skip already-completed steps)
      const resumeFromStep = task.currentStep?.step || 1;
      const isResuming = resumeFromStep > 1;
      if (isResuming) {
        console.log(`[Tasks] Resuming direct execution from step ${resumeFromStep}`);
      }

      // Execute each step in the structured plan
      for (const planStep of task.structuredPlan!) {
        const { step_id, tool, args, output_var, description } = planStep;

        // Skip already-completed steps when resuming
        if (step_id < resumeFromStep) {
          console.log(`[Tasks] Skipping already-completed step ${step_id}`);
          continue;
        }

        console.log(`[Tasks] Direct exec step ${step_id}: [${tool}] ${description}`);

        // Log step to task
        await this.updateTask(
          taskId,
          {
            currentStep: { step: step_id, description, state: 'executing' },
            logEntry: `Executing step ${step_id}: ${description}`,
          },
          this.currentUser?.username
        );

        // Skip internal control tools for tasks (they don't make sense in direct mode)
        if (tool === 'complete_task' || tool === 'goto_step' || tool === 'update_task_state') {
          console.log(`[Tasks] Skipping control tool: ${tool}`);
          continue;
        }

        // Check if tool exists
        if (!toolsByName[tool]) {
          console.log(`[Tasks] Unknown tool: ${tool}, skipping step`);
          results[`step_${step_id}`] = { error: `Unknown tool: ${tool}` };
          continue;
        }

        // Substitute variables from previous results
        let resolvedArgs = { ...args };
        if (args) {
          const argsStr = JSON.stringify(args);
          const substituted = argsStr.replace(
            /\{\{step_(\d+)\.(\w+)\}\}/g,
            (match: string, stepNum: string, field: string) => {
              const prevResult = results[`step_${stepNum}`];
              if (prevResult && prevResult[field] !== undefined) {
                const value = prevResult[field];
                // Handle arrays and objects by stringifying them nicely
                if (Array.isArray(value)) {
                  // For message arrays, format them readably
                  if (value.length > 0 && typeof value[0] === 'object') {
                    return value
                      .map((item: any) => {
                        if (item.text && item.from && item.date) {
                          // Format message objects
                          return `[${item.date}] ${item.from}: ${item.text}`;
                        }
                        return JSON.stringify(item);
                      })
                      .join('\\n');
                  }
                  return value.join(', ');
                } else if (typeof value === 'object' && value !== null) {
                  return JSON.stringify(value);
                }
                return String(value);
              }
              // Try common field name variations (messages vs recent_messages, etc.)
              // This handles LLM generating templates with slightly different field names
              const fieldVariations: Record<string, string> = {
                recent_messages: 'messages',
                imessages: 'messages',
                slack_messages: 'messages',
                email_messages: 'messages',
                telegram_messages: 'messages',
                discord_messages: 'messages',
                text_messages: 'messages',
                sms_messages: 'messages',
                messages: 'recent_messages',
                formatted_messages: 'formatted',
                formatted: 'formatted_messages',
                result: 'message',
                message: 'result',
                content: 'text',
                text: 'content',
                body: 'text',
                data: 'result',
              };

              // Helper to format value for string substitution
              const formatValueForSubstitution = (value: any): string => {
                if (Array.isArray(value)) {
                  if (value.length > 0 && typeof value[0] === 'object') {
                    return value
                      .map((item: any) => {
                        if (item.text && item.from && item.date) {
                          return `[${item.date}] ${item.from}: ${item.text}`;
                        }
                        return JSON.stringify(item);
                      })
                      .join('\\n');
                  }
                  return value.join(', ');
                } else if (typeof value === 'object' && value !== null) {
                  return JSON.stringify(value);
                }
                return String(value);
              };

              // Try direct variation mapping first
              if (
                prevResult &&
                fieldVariations[field] &&
                prevResult[fieldVariations[field]] !== undefined
              ) {
                const value = prevResult[fieldVariations[field]];
                console.log(`[Tasks] Using field variation: ${field} -> ${fieldVariations[field]}`);
                return formatValueForSubstitution(value);
              }

              // Fallback: if field ends with "_messages" or "messages", try just "messages"
              if (
                prevResult &&
                (field.endsWith('_messages') || field.endsWith('messages')) &&
                prevResult.messages !== undefined
              ) {
                console.log(`[Tasks] Using fallback: ${field} -> messages`);
                return formatValueForSubstitution(prevResult.messages);
              }

              // Last resort: try the first array field in the result
              if (prevResult) {
                const arrayField = Object.entries(prevResult).find(([k, v]) => Array.isArray(v));
                if (arrayField) {
                  console.log(`[Tasks] Using first array field: ${field} -> ${arrayField[0]}`);
                  return formatValueForSubstitution(arrayField[1]);
                }
              }

              // Generic fallback for ANY unknown field name (like custom output_var names)
              // Try standard output fields that tools typically return
              if (prevResult) {
                const standardFields = [
                  'formatted',
                  'result',
                  'analysis',
                  'message',
                  'data',
                  'output',
                  'content',
                  'text',
                ];
                for (const tryField of standardFields) {
                  if (prevResult[tryField] !== undefined) {
                    console.log(
                      `[Tasks] Using standard field fallback: ${field} -> ${tryField} (custom output_var not found)`
                    );
                    return formatValueForSubstitution(prevResult[tryField]);
                  }
                }
              }

              console.log(
                `[Tasks] Template variable not found: step_${stepNum}.${field}, available:`,
                prevResult ? Object.keys(prevResult) : 'no result'
              );
              return match;
            }
          );
          try {
            resolvedArgs = JSON.parse(substituted);
          } catch (e: any) {
            console.log(`[Tasks] Failed to parse substituted args: ${e.message}`);
            console.log(`[Tasks] Substituted string was: ${substituted.slice(0, 500)}`);
          }
        }

        console.log(
          `[Tasks] Direct exec tool ${tool} with args:`,
          JSON.stringify(resolvedArgs).slice(0, 200)
        );

        // Execute the tool
        const taskContext = {
          taskId,
          autoSend: task.autoSend || false,
          contextMemory: task.contextMemory || {},
        };

        const toolResult = await directExecExecuteTool(tool, resolvedArgs, taskContext);

        // Store result
        if (output_var) {
          results[output_var] = toolResult;
        }
        results[`step_${step_id}`] = toolResult;
        lastResult = toolResult;

        // Capture screenshot if browser tool returned one
        if (toolResult && toolResult.screenshot) {
          lastScreenshot = toolResult.screenshot;
        }

        // Capture conversation_id from ANY messaging tool for later use by wait_for_reply
        // Each platform returns its own identifier: threadId (email), chatId (iMessage), channel (Slack), chat_id (Telegram), channel_id (Discord)
        const conversationIdFromResult =
          toolResult?.threadId ||
          toolResult?.chatId ||
          toolResult?.channel ||
          toolResult?.chat_id ||
          toolResult?.channel_id;
        const isMessagingTool = [
          'send_email',
          'send_imessage',
          'send_slack_message',
          'send_telegram_message',
          'send_discord_message',
        ].includes(tool);

        // Debug logging for messaging tools
        if (isMessagingTool) {
          console.log(`[Tasks] DEBUG: ${tool} result:`, JSON.stringify(toolResult).slice(0, 300));
          console.log(`[Tasks] DEBUG: conversationIdFromResult = ${conversationIdFromResult}`);
        }

        if (toolResult && conversationIdFromResult && isMessagingTool) {
          console.log(`[Tasks] Captured conversation_id from ${tool}: ${conversationIdFromResult}`);
          task.contextMemory = {
            ...task.contextMemory,
            conversation_id: conversationIdFromResult,
            // Also store platform-specific fields for debugging
            [`last_${tool.replace('send_', '')}_conversation_id`]: conversationIdFromResult,
            last_message_id: toolResult.messageId || toolResult.message_id,
            // Store original subject for email threading (strip "Re: " prefix if present)
            ...(tool === 'send_email' && resolvedArgs?.subject
              ? {
                  original_subject: resolvedArgs.subject.replace(/^Re:\s*/i, ''),
                }
              : {}),
          };
          // Persist to database immediately so it's available for wait_for_reply
          await this.updateTask(
            taskId,
            {
              contextMemory: task.contextMemory,
            },
            this.currentUser?.username
          );
        }

        // Handle special tool results
        if (toolResult && toolResult.pending) {
          console.log(`[Tasks] Message pending approval in task ${taskId}`);
          return { success: true, pendingMessage: true, message: toolResult.message };
        }

        if (toolResult && toolResult.action === 'wait_for_user_input') {
          console.log(`[Tasks] Task ${taskId} waiting for user input: ${toolResult.question}`);
          await this.updateTask(
            taskId,
            {
              status: 'waiting_for_input',
              contextMemory: {
                ...task.contextMemory,
                pendingClarification: toolResult.question,
                clarificationTimestamp: new Date().toISOString(),
                saveResponseAs: toolResult.save_response_as || null,
              },
              logEntry: `Asked user: "${toolResult.question}" - waiting for response`,
            },
            this.currentUser?.username
          );
          return { success: true, waitingForInput: true, question: toolResult.question };
        }

        // Handle wait_for_reply action - sets up polling for message replies
        if (toolResult && toolResult.action === 'wait_for_reply') {
          const pollIntervalMs = (toolResult.poll_interval_minutes || 5) * 60000;

          // Helper to check if a value is an unresolved template
          const isUnresolvedTemplate = (val: any): boolean =>
            typeof val === 'string' && val.startsWith('{{') && val.endsWith('}}');

          // Check if conversation_id is an unresolved template variable (e.g., "{{step_1.threadId}}")
          // If so, fall back to the captured value in contextMemory (also checking if THAT is valid)
          let effectiveConversationId = toolResult.conversation_id;

          if (!effectiveConversationId || isUnresolvedTemplate(effectiveConversationId)) {
            // Fall back to contextMemory, but ONLY if contextMemory value is also valid
            const ctxConvId = task.contextMemory?.conversation_id;
            if (ctxConvId && !isUnresolvedTemplate(ctxConvId)) {
              effectiveConversationId = ctxConvId;
              console.log(
                `[Tasks] conversation_id "${toolResult.conversation_id}" not valid, using captured value: ${effectiveConversationId}`
              );
            } else {
              // Both are invalid - use null (will match any message from contact)
              effectiveConversationId = null;
              console.log(
                `[Tasks] No valid conversation_id available (from tool: "${toolResult.conversation_id}", from context: "${ctxConvId}") - will match any message from contact`
              );
            }
          }

          console.log(
            `[Tasks] Task ${taskId} waiting for reply from ${toolResult.contact} via ${toolResult.platform}`
          );
          console.log(
            `[Tasks] Poll interval: ${pollIntervalMs}ms, Followup after: ${toolResult.followup_after_hours}h, Max: ${toolResult.max_followups}`
          );
          console.log(
            `[Tasks] Using conversation_id: ${effectiveConversationId || '(none - will match any email from contact)'}`
          );

          await this.updateTask(
            taskId,
            {
              status: 'waiting',
              nextCheck: Date.now() + pollIntervalMs,
              currentStep: {
                step: step_id,
                description: `Waiting for reply from ${toolResult.contact}`,
                state: 'waiting',
              },
              contextMemory: {
                ...task.contextMemory,
                // Core wait_for_reply context
                wait_for_reply_active: true,
                waiting_via: toolResult.platform,
                waiting_for_contact: toolResult.contact,
                original_request: toolResult.original_request,
                success_criteria: toolResult.success_criteria,
                conversation_id: effectiveConversationId,
                // Timing
                first_message_time:
                  task.contextMemory?.first_message_time || new Date().toISOString(),
                last_message_time: new Date().toISOString(),
                poll_interval_minutes: toolResult.poll_interval_minutes || 5,
                followup_after_hours: toolResult.followup_after_hours || 24,
                last_followup_time: null,
                // Follow-up tracking
                max_followups: toolResult.max_followups || 3,
                followup_count: task.contextMemory?.followup_count || 0,
                // Reply tracking
                new_reply_detected: false,
              },
              logEntry: `Waiting for reply from ${toolResult.contact} via ${toolResult.platform} (poll: ${toolResult.poll_interval_minutes || 5}min, followup: ${toolResult.followup_after_hours || 24}h)`,
            },
            this.currentUser?.username
          );

          return {
            success: true,
            waitingForReply: true,
            contact: toolResult.contact,
            platform: toolResult.platform,
          };
        }

        // Small delay between browser operations to let pages render
        if (tool.startsWith('browser_')) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }

      // All steps completed - mark task as done
      console.log(`[Tasks] Direct execution completed for task ${taskId}`);

      await this.updateTask(
        taskId,
        {
          status: 'completed',
          currentStep: { step: task.structuredPlan!.length, state: 'completed' },
          logEntry: `Task completed via direct execution (${task.structuredPlan!.length} steps)`,
        },
        this.currentUser?.username
      );

      // Notify user
      if (this.mainWindow && !this.mainWindow.isDestroyed() && !task.notificationsDisabled) {
        this.addTaskUpdate(taskId, `✅ Task completed!`, {
          toChat: true,
          emoji: '✅',
          taskTitle: task.title,
        });
      }

      return { success: true, completed: true, directExecution: true };
    } catch (err: any) {
      console.error(`[Tasks] Direct execution error for ${taskId}:`, err.message);
      await this.updateTask(
        taskId,
        {
          status: 'failed',
          logEntry: `Direct execution failed: ${err.message}`,
        },
        this.currentUser?.username
      );
      return { error: err.message };
    }
  }

  /**
   * EXECUTION MODE 3: LLM-based execution mode
   * Uses LLM to interpret and execute steps when no structured plan is available
   */
  private static async executeLLMMode(
    taskId: string,
    task: Task,
    apiKeys: ApiKeys
  ): Promise<ExecutionResult> {
    // Task state management tool (specific to task executor)
    const taskStateManagementTool = {
      name: 'update_task_state',
      description:
        'Update the task state after completing actions. ALWAYS call this at the end of execution to report what happened and set the next state.',
      input_schema: {
        type: 'object',
        properties: {
          logMessage: {
            type: 'string',
            description: 'What happened during this execution (be specific)',
          },
          nextStatus: {
            type: 'string',
            enum: ['active', 'waiting', 'waiting_for_input', 'completed', 'failed'],
            description:
              'active=continue to next step now, waiting=wait for external event (set pollIntervalMs), waiting_for_input=need user clarification (ask in logMessage), completed=all done, failed=error',
          },
          nextStep: {
            type: 'number',
            description: 'The next step number (current step + 1 if advancing)',
          },
          pollIntervalMs: {
            type: 'number',
            description:
              'If waiting, milliseconds until next check. Use 3600000 for 1 hour, 86400000 for 1 day',
          },
          contextUpdates: {
            type: 'object',
            description: 'Key-value pairs to remember for future steps',
          },
          notifyUser: {
            type: 'string',
            description: 'Message to show the user in chat (optional)',
          },
          clarificationQuestion: {
            type: 'string',
            description: 'If waiting_for_input, the specific question to ask the user',
          },
          modifyPlan: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Optional: New steps to replace the remaining plan based on new information',
          },
        },
        required: ['logMessage', 'nextStatus'],
      },
    };

    // Use shared tool builder - ensures tasks have same tools as chat
    const { tools: integrationTools, executeTool } = await this.loadIntegrationsAndBuildTools({
      includeProfileTools: false, // Tasks don't need profile tools
      includeTaskTools: false, // Tasks don't create other tasks
      includeMemoryTools: false, // Tasks don't need memory search
    });

    // Combine task-specific tool with integration tools
    const executorTools = [taskStateManagementTool, ...integrationTools];

    // Build system prompt with current date
    const now = new Date();
    const currentDateStr = now.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    // Determine messaging channel for this task
    const taskMessagingChannel = task.messagingChannel || task.contextMemory?.messaging_channel;
    const channelTools: Record<string, string> = {
      imessage: 'send_imessage (for text/SMS)',
      email: 'send_email (for email/Gmail)',
      slack: 'send_slack_message (for Slack)',
      telegram: 'send_telegram_message (for Telegram)',
      discord: 'send_discord_message (for Discord)',
      x: 'post_tweet or send_x_dm (for X/Twitter)',
    };

    // Check for skill constraints
    const skillName = task.contextMemory?.skill_name;
    const skillConstraints = task.contextMemory?.skill_constraints;

    const systemPrompt = `You are an autonomous Task Executor Agent. You execute tasks step by step on behalf of the user.

CURRENT DATE/TIME: ${currentDateStr} at ${now.toLocaleTimeString()}
(Use this date for all scheduling - do NOT use dates from old context data)

TASK INFORMATION:
- Task ID: ${task.id}
- Title: ${task.title}
- Original Request: "${task.originalRequest}"
- Current Step: ${task.currentStep.step} of ${task.plan.length}
${
  taskMessagingChannel
    ? `\n*** MESSAGING CHANNEL: ${taskMessagingChannel.toUpperCase()} ***
YOU MUST USE: ${channelTools[taskMessagingChannel] || taskMessagingChannel}
DO NOT USE email if the channel is imessage. DO NOT USE imessage if the channel is email.`
    : ''
}
${
  skillName
    ? `\n*** SKILL: ${skillName} ***
CONSTRAINTS YOU MUST FOLLOW:
${
  skillConstraints
    ? skillConstraints
        .split('; ')
        .map((c: string) => `- ${c}`)
        .join('\n')
    : 'None'
}`
    : ''
}

PLAN:
${task.plan.map((step: string, i: number) => `${i + 1}. ${step}${i + 1 === task.currentStep.step ? ' ← CURRENT STEP' : ''}`).join('\n')}

SAVED CONTEXT:
${
  Object.entries(task.contextMemory || {})
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n') || 'None yet'
}

RECENT LOG:
${
  task.executionLog
    .slice(-3)
    .map((e) => `- ${e.message}`)
    .join('\n') || 'Task just started'
}

INSTRUCTIONS:
1. Execute the CURRENT STEP using the available tools
2. ***MANDATORY*** After completing the step's action, you MUST call update_task_state with:
   - logMessage: A DETAILED summary of what you found/did. This is shown to the user!
   - nextStatus: "waiting" if waiting for a response, "active" to continue, "completed" if all done
   - nextStep: current step + 1 if advancing
   - pollIntervalMs: if waiting (e.g., 60000 = 1 minute)
   - contextUpdates: Save any important info for later steps

*** YOU MUST ALWAYS CALL update_task_state - DO NOT END WITHOUT IT ***

CRITICAL - User Notifications:
- The logMessage you provide in update_task_state is shown directly to the user in the chat
- ALWAYS write logMessage as if speaking to the user: "I sent an email to X asking about Y" or "I found the calendar link in Chris's message: [link]"
- Include relevant details, quotes from messages, or findings that the user would want to know
- If you have a question for the user or need their input, include it in the logMessage

CRITICAL - ANALYSIS STEPS (filtering, checking, analyzing):
- When analyzing emails/messages: Report what you found! "I reviewed 5 emails: 2 were spam (newsletter, promotion), 3 were legitimate (from Alice about project X, from Bob asking about Y, from Carol with meeting request)"
- When filtering: Explain your decisions! "Filtered out 3 spam emails. Kept 2 that need attention: Email from John about deadline, Email from Sarah requesting feedback"
- DO NOT just read content and move on - SUMMARIZE your findings for the user
- Save important findings in contextUpdates for later steps

3. CRITICAL - When SENDING a message and waiting for a reply:
   - Set contextUpdates.waiting_via = the messaging channel you used:
     * "email" if you used send_email
     * "imessage" if you used send_imessage
     * "slack" if you used send_slack_message
   - Set contextUpdates.waiting_for_contact = the contact identifier (email address, phone/name, or Slack user)
   - Set contextUpdates.last_message_time = current ISO date ("${new Date().toISOString()}")
   - Use pollIntervalMs: 60000 (1 minute) - all lightweight checks are free
   - Set nextStatus: "waiting" to wait for the reply

4. IMPORTANT - Use the MESSAGING CHANNEL specified above (if any):
   - If MESSAGING CHANNEL says IMESSAGE → use send_imessage (NEVER send_email or send_slack_message)
   - If MESSAGING CHANNEL says EMAIL → use send_email (NEVER send_imessage or send_slack_message)
   - If MESSAGING CHANNEL says SLACK → use send_slack_message (NEVER send_imessage or send_email)
   - If MESSAGING CHANNEL says TELEGRAM → use send_telegram_message
   - If MESSAGING CHANNEL says DISCORD → use send_discord_message
   - If MESSAGING CHANNEL says X → use send_x_dm for DMs or post_tweet for public tweets
   - Use the SAME channel throughout the entire task - NEVER switch channels
   - IGNORE any defaults - strictly follow the MESSAGING CHANNEL
   - CRITICAL: Even if you know the contact on another platform, DO NOT use it. Stay on the specified channel.

5. CRITICAL - REPLY DETECTED: If the SAVED CONTEXT shows "new_reply_detected: true":
   *** A REPLY HAS BEEN RECEIVED - YOU MUST PROCESS IT NOW ***
   - First, use list_emails or get_recent_messages to READ the new message content
   - Process the reply content to determine if it SATISFIES THE CURRENT STEP'S REQUIREMENTS
   - Clear the reply flag: contextUpdates.new_reply_detected = false
   - DECISION POINT:
     a) If the reply SATISFIES the step's requirement (e.g., definitive answer received):
        → Advance: nextStatus: "active", nextStep = current step + 1
     b) If the reply DOES NOT satisfy the requirement (e.g., unclear answer, needs follow-up):
        → STAY on current step: nextStep = current step (same number)
        → Take the appropriate action (send follow-up, ask for clarification)
        → Set nextStatus: "waiting" to wait for the next reply

6. CONDITIONAL STEP HANDLING:
   - Many steps have CONDITIONS that must be met before advancing (e.g., "wait for definitive answer", "until confirmed")
   - DO NOT advance just because you received a reply - evaluate if the CONDITION is satisfied
   - Example: Step "Follow up until definitive answer" → if answer is vague, send follow-up and STAY on this step
   - Example: Step "Wait for confirmation" → if response is "maybe", don't advance, ask for clear yes/no
   - Save evaluation reasoning in logMessage so user understands why you're staying or advancing

7. AUTO-PROGRESSION: After completing each step that doesn't require waiting:
   - ONLY advance to next step if the current step's requirement is FULLY SATISFIED
   - This ensures the task continues immediately without waiting for the scheduler
   - Only use nextStatus: "waiting" when you need to wait for an external response

7. TASK TYPE HANDLING:
   ${
     task.taskType === 'continuous' || task.contextMemory?.task_type === 'continuous'
       ? `
   *** THIS IS A CONTINUOUS/MONITORING TASK ***
   - Monitoring condition: ${task.contextMemory?.monitoring_condition || 'Check context for details'}
   - Trigger action: ${task.contextMemory?.trigger_action || 'Alert user when condition is met'}

   CONTINUOUS TASK RULES:
   - This task runs INDEFINITELY - it should NEVER be marked as "completed"
   - After completing the final step, LOOP BACK to step 1 by setting nextStep: 1
   - Use nextStatus: "waiting" with pollIntervalMs to wait before the next monitoring cycle
   - Recommended poll intervals: weather (3600000 = 1 hour), emails (60000 = 1 minute), prices (300000 = 5 min)
   - ONLY notify user when the monitoring condition is actually triggered (e.g., rain detected, email received)
   - Keep logMessage brief for routine checks: "Checked weather - no rain expected"
   `
       : `
   *** THIS IS A DISCRETE TASK ***
   - Success criteria: ${task.contextMemory?.success_criteria || 'Complete all steps in the plan'}

   DISCRETE TASK RULES:
   - This task has a clear end goal
   - EACH STEP may have its own success condition - evaluate before advancing
   - Common step conditions to watch for:
     * "until definitive answer" → stay on step until clear answer received
     * "follow up if not responded" → stay on step if no clear response
     * "confirm" → stay until explicit confirmation received
     * "if X then Y" → only advance after condition X is satisfied
   - Mark as "completed" ONLY when all steps are done AND success criteria is met
   - The final step should verify the success criteria before marking complete
   `
   }

8. CREDENTIAL SECURITY (CRITICAL):
   - NEVER include actual passwords or credentials in logMessage or any output
   - When using browser automation to log into websites, use secure placeholders:
     * Username: {{credential:domain.com:username}}
     * Password: {{credential:domain.com:password}}
   - The actual credentials are injected locally and NEVER pass through this task log
   - If login fails, inform user to check their credentials in the Credentials page
   - NEVER ask users for their password or store passwords in task context

9. MID-TASK CLARIFICATION:
   - If a step cannot be completed without user input, use nextStatus: "waiting_for_input"
   - Set clarificationQuestion to the SPECIFIC question you need answered
   - Examples: "Which Igor do you mean? I found: Igor Petrov (work), Igor Santos (personal)", "Which messaging platform should I use: iMessage, Slack, or email?"
   - The user will respond in chat, and the task will resume with their answer
   - After receiving user input, you may need to MODIFY the remaining plan using modifyPlan

10. DYNAMIC PLAN MODIFICATION:
   - If information learned during execution changes what needs to be done, use modifyPlan
   - modifyPlan replaces ALL remaining steps from the current step onwards
   - Example: If step 1 discovers the contact is only on Slack (not iMessage), update remaining steps accordingly
   - Include clear, actionable step descriptions just like the original plan

IMPORTANT: You MUST call update_task_state before finishing. Always advance to the next step after completing the current one.`;

    // Build user message - make it clear if a reply was received or user provided input
    const replyDetected = task.contextMemory?.new_reply_detected;
    const waitingVia = task.contextMemory?.waiting_via;
    const waitingFor = task.contextMemory?.waiting_for_contact;
    const userResponse = task.contextMemory?.userResponse;

    let userPrompt: string;

    // Case 1: User just responded to a clarification question
    if (userResponse) {
      userPrompt = `📝 USER PROVIDED INPUT IN RESPONSE TO YOUR QUESTION!

The user responded: "${userResponse}"

Your current step is ${task.currentStep.step}: "${task.plan[task.currentStep.step - 1]}"

ACTION REQUIRED:
1. Use the user's response to continue with the current step
2. If the response changes what needs to be done, use modifyPlan to update remaining steps
3. Execute the action(s) needed for this step using the new information
4. Call update_task_state with:
   - logMessage describing what you did with the user's input
   - contextUpdates.userResponse = null (clear the response after using it)
   - Set nextStatus and nextStep appropriately

IMPORTANT: The user took the time to respond, so make good use of their input!`;
    }
    // Case 2: External reply detected (email, slack, etc.)
    else if (replyDetected && waitingVia && waitingFor) {
      userPrompt = `🔔 A REPLY HAS BEEN RECEIVED from ${waitingFor} via ${waitingVia}!

Your current step is ${task.currentStep.step}: "${task.plan[task.currentStep.step - 1]}"

ACTION REQUIRED:
1. First, READ the reply using ${waitingVia === 'email' ? 'list_emails with from:' + waitingFor : waitingVia === 'slack' ? 'list_slack_messages' : 'get_recent_messages'}
2. EVALUATE: Does this reply SATISFY the current step's requirements?
   - If step asks for "definitive answer" - is the answer clear and specific?
   - If step asks for "confirmation" - did they clearly confirm?
   - If step asks to "follow up until X" - has X been achieved?
3. Call update_task_state with:
   - logMessage describing what they replied AND your evaluation
   - IF reply SATISFIES step requirement:
     → nextStatus: "active", nextStep: ${task.currentStep.step + 1}
   - IF reply DOES NOT satisfy (vague, unclear, needs follow-up):
     → Send follow-up message
     → nextStatus: "waiting", nextStep: ${task.currentStep.step} (STAY on same step)
   - contextUpdates.new_reply_detected = false

IMPORTANT: Only advance if the step's condition is truly met. A reply alone doesn't mean success.`;
    }
    // Case 3: Normal step execution
    else {
      userPrompt = `Execute step ${task.currentStep.step}: "${task.plan[task.currentStep.step - 1]}"\n\nDo the action required for this step, then call update_task_state with the results.`;
    }

    const messages: Array<{ role: 'user' | 'assistant'; content: any }> = [
      {
        role: 'user',
        content: userPrompt,
      },
    ];

    try {
      let currentMessages: Array<{ role: 'user' | 'assistant'; content: any }> = [...messages];

      // Agentic loop - up to 15 iterations (enough for complex multi-step actions)
      for (let iteration = 0; iteration < 15; iteration++) {
        console.log(`[Tasks] Executor iteration ${iteration + 1} for task ${taskId}`);

        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKeys.anthropic!,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 4096,
            system: systemPrompt,
            messages: currentMessages,
            tools: executorTools,
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`API error: ${errText}`);
        }

        const result: any = await response.json();

        // Check for tool use
        const toolUseBlocks = result.content.filter((b: any) => b.type === 'tool_use');

        // Log any text content (LLM reasoning) - this helps debug what the LLM is thinking
        const textContent = result.content.find((b: any) => b.type === 'text')?.text || '';
        if (textContent) {
          console.log(
            `[Tasks] LLM reasoning: ${textContent.slice(0, 300)}${textContent.length > 300 ? '...' : ''}`
          );
        }

        if (toolUseBlocks.length === 0) {
          // No tools called - check if we got a text response
          console.log(`[Tasks] No tools called, LLM response: ${textContent.slice(0, 200)}`);

          // If the LLM gave a meaningful response without calling update_task_state,
          // save it to the execution log so the user can see it
          if (textContent.length > 10) {
            await this.updateTask(
              taskId,
              {
                logEntry: `Analysis: ${textContent.slice(0, 500)}`,
              },
              this.currentUser?.username
            );
          }
          break;
        }

        // Process tool calls
        const toolResults = [];

        for (const toolUse of toolUseBlocks) {
          console.log(
            `[Tasks] Tool call: ${toolUse.name}`,
            JSON.stringify(toolUse.input).slice(0, 200)
          );
          let toolResult;

          if (toolUse.name === 'update_task_state') {
            // Apply state update
            const input = toolUse.input;
            const updates: any = {
              status: input.nextStatus,
              logEntry: input.logMessage,
            };

            if (input.nextStep) {
              updates.currentStep = {
                step: input.nextStep,
                description: task.plan[input.nextStep - 1] || '',
                state: input.nextStatus,
                pollInterval: input.pollIntervalMs || null,
              };
            }

            if (input.pollIntervalMs && input.nextStatus === 'waiting') {
              updates.nextCheck = Date.now() + input.pollIntervalMs;
            }

            if (input.contextUpdates) {
              updates.contextMemory = { ...task.contextMemory, ...input.contextUpdates };

              // Check if the LLM drafted a message ready for approval
              // This happens when contextUpdates includes ready_for_user_approval: true and drafted_reply
              if (
                input.contextUpdates.ready_for_user_approval &&
                input.contextUpdates.drafted_reply
              ) {
                console.log(
                  `[Tasks] LLM drafted a message ready for approval, creating pendingMessage`
                );

                // Determine the platform and recipient from context
                // IMPORTANT: Use task.messagingChannel as primary source (set at task creation)
                const platform =
                  task.messagingChannel ||
                  input.contextUpdates.messaging_channel ||
                  task.contextMemory?.messaging_channel ||
                  'imessage';
                const recipient =
                  input.contextUpdates.actionable_message_from ||
                  task.contextMemory?.actionable_message_from ||
                  'recipient';

                // Map platform to tool name
                const platformToTool: Record<string, string> = {
                  imessage: 'send_imessage',
                  email: 'send_email',
                  slack: 'send_slack_message',
                  telegram: 'send_telegram_message',
                  discord: 'send_discord_message',
                  x: 'send_x_dm',
                };

                // Create pending message entry
                const pendingMessage = {
                  id: `pending-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                  toolName: platformToTool[platform] || 'send_imessage',
                  platform:
                    platform === 'imessage'
                      ? 'iMessage'
                      : platform.charAt(0).toUpperCase() + platform.slice(1),
                  recipient: recipient,
                  subject: '',
                  message: input.contextUpdates.drafted_reply,
                  created: new Date().toISOString(),
                  toolInput: JSON.stringify({
                    recipient: recipient,
                    message: input.contextUpdates.drafted_reply,
                  }),
                };

                // Initialize pendingMessages if needed
                if (!task.pendingMessages) {
                  task.pendingMessages = [];
                }

                // Add to pending messages
                task.pendingMessages.push(pendingMessage);
                updates.pendingMessages = task.pendingMessages;
                updates.status = 'waiting_approval';

                // Clear the context flags so we don't create duplicate pending messages
                updates.contextMemory.ready_for_user_approval = false;
                updates.contextMemory.draft_pending_id = pendingMessage.id;

                console.log(
                  `[Tasks] Created pending message: ${pendingMessage.id} for ${recipient} via ${platform}`
                );

                // Notify UI about the pending message
                if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                  this.mainWindow.webContents.send('task:pendingMessage', {
                    taskId,
                    message: pendingMessage,
                  });
                }
              }
            }

            // Handle plan modification if provided
            if (
              input.modifyPlan &&
              Array.isArray(input.modifyPlan) &&
              input.modifyPlan.length > 0
            ) {
              // Keep steps before current step, replace the rest with new plan
              const currentStepIndex = task.currentStep.step - 1;
              const existingSteps = task.plan.slice(0, currentStepIndex);
              updates.plan = [...existingSteps, ...input.modifyPlan];
              console.log(
                `[Tasks] Plan modified: ${existingSteps.length} existing steps + ${input.modifyPlan.length} new steps`
              );
            }

            // Handle clarification question
            if (input.clarificationQuestion && input.nextStatus === 'waiting_for_input') {
              updates.contextMemory = {
                ...(updates.contextMemory || task.contextMemory),
                pendingClarification: input.clarificationQuestion,
                clarificationTimestamp: new Date().toISOString(),
              };
            }

            await this.updateTask(taskId, updates, this.currentUser?.username);

            // NOTIFICATIONS - Only alert on final states (completed, failed) unless disabled
            console.log(
              `[Tasks] Notification check: win=${!!this.mainWindow}, status=${input.nextStatus}, notificationsDisabled=${task.notificationsDisabled}`
            );

            // Check if notifications are disabled for this task
            if (this.mainWindow && !task.notificationsDisabled) {
              let notificationMessage: string | null = null;
              let notificationEmoji = '📋';

              // Only send chat notifications for FINAL states
              if (input.nextStatus === 'completed') {
                notificationEmoji = '✅';
                notificationMessage = `Task completed!\n\n${input.logMessage}`;
              } else if (input.nextStatus === 'failed') {
                notificationEmoji = '❌';
                notificationMessage = `Task failed: ${input.logMessage}`;
              }
              // Waiting for user input still needs notification (user action required)
              else if (input.nextStatus === 'waiting_for_input') {
                notificationEmoji = '❓';
                const question =
                  input.clarificationQuestion || 'I need more information to continue.';
                notificationMessage = `${input.logMessage}\n\n**Question:** ${question}\n\nPlease reply in the chat to continue the task.`;
              }
              // Waiting for user approval still needs notification (user action required)
              else if (
                input.nextStatus === 'waiting_approval' ||
                updates.status === 'waiting_approval'
              ) {
                notificationEmoji = '📨';
                const recipient =
                  input.contextUpdates?.actionable_message_from ||
                  task.contextMemory?.actionable_message_from ||
                  'contact';
                notificationMessage = `${input.logMessage}\n\n**Action Required:** I've drafted a reply to ${recipient}. Please review and approve or edit the message in the Tasks panel.`;
              }

              // Send notification to chat only for important states
              if (notificationMessage) {
                console.log(`[Tasks] Notification message: ${notificationMessage.slice(0, 50)}...`);
                this.addTaskUpdate(taskId, notificationMessage);
                this.mainWindow.webContents.send('chat:newMessage', {
                  role: 'assistant',
                  content: `${notificationEmoji} **Task: ${task.title}**\n\n${notificationMessage}`,
                  source: 'task',
                });
                console.log(`[Tasks] Notification SENT to chat`);
              } else {
                // Still log the update for the task panel, just don't send to chat
                if (input.logMessage) {
                  this.addTaskUpdate(taskId, input.logMessage);
                }
              }
            } else if (this.mainWindow && task.notificationsDisabled && input.logMessage) {
              // Notifications disabled but still add to task panel log
              this.addTaskUpdate(taskId, input.logMessage);
              console.log(`[Tasks] Notification SKIPPED - notifications disabled for task`);
            } else {
              console.log(`[Tasks] Notification SKIPPED - no window`);
            }

            console.log(
              `[Tasks] Task ${taskId} state updated: status=${input.nextStatus}, step=${input.nextStep || task.currentStep.step}`
            );
            toolResult = { success: true, message: 'Task state updated' };

            // If status is "active", immediately continue to next step (don't wait for scheduler)
            if (
              input.nextStatus === 'active' &&
              input.nextStep &&
              input.nextStep <= task.plan.length
            ) {
              console.log(`[Tasks] Auto-continuing to step ${input.nextStep} for task ${taskId}`);
              // Schedule immediate continuation (use setTimeout to avoid deep recursion)
              setTimeout(() => this.internalExecuteTaskStep(taskId), 100);
            }

            // State was updated, we can exit the loop
            return { success: true, stateUpdate: input };
          } else {
            // Use shared tool executor for all other tools
            // Pass task context so message confirmations can be stored in the task
            const taskContext = {
              taskId,
              autoSend: task.autoSend || false,
              contextMemory: task.contextMemory || {}, // Include for name lookups in message previews
            };
            toolResult = await executeTool(toolUse.name, toolUse.input, taskContext);

            // Capture conversation_id from ANY messaging tool for later use by wait_for_reply
            const conversationIdFromResult =
              toolResult?.threadId ||
              toolResult?.chatId ||
              toolResult?.channel ||
              toolResult?.chat_id ||
              toolResult?.channel_id;
            const isMessagingTool = [
              'send_email',
              'send_imessage',
              'send_slack_message',
              'send_telegram_message',
              'send_discord_message',
            ].includes(toolUse.name);

            if (toolResult && conversationIdFromResult && isMessagingTool) {
              console.log(
                `[Tasks] Captured conversation_id from ${toolUse.name}: ${conversationIdFromResult}`
              );
              task.contextMemory = {
                ...task.contextMemory,
                conversation_id: conversationIdFromResult,
                [`last_${toolUse.name.replace('send_', '')}_conversation_id`]:
                  conversationIdFromResult,
                last_message_id: toolResult.messageId || toolResult.message_id,
                // Store original subject for email threading (strip "Re: " prefix if present)
                ...(toolUse.name === 'send_email' && toolUse.input?.subject
                  ? {
                      original_subject: toolUse.input.subject.replace(/^Re:\s*/i, ''),
                    }
                  : {}),
              };
              await this.updateTask(
                taskId,
                {
                  contextMemory: task.contextMemory,
                },
                this.currentUser?.username
              );
            }

            // If a message is pending approval, update task status and return
            if (toolResult && toolResult.pending) {
              console.log(`[Tasks] Message pending approval in task ${taskId}`);
              return { success: true, pendingMessage: true, message: toolResult.message };
            }

            // Handle special actions from task primitive tools
            if (toolResult && toolResult.action === 'wait_for_user_input') {
              // Tool asked a question and wants to wait for user response
              console.log(`[Tasks] Task ${taskId} waiting for user input: ${toolResult.question}`);

              await this.updateTask(
                taskId,
                {
                  status: 'waiting_for_input',
                  contextMemory: {
                    ...task.contextMemory,
                    pendingClarification: toolResult.question,
                    clarificationTimestamp: new Date().toISOString(),
                    saveResponseAs: toolResult.save_response_as || null,
                  },
                  logEntry: `Asked user: "${toolResult.question}" - waiting for response`,
                },
                this.currentUser?.username
              );

              return { success: true, waitingForInput: true, question: toolResult.question };
            }

            // Handle wait_for_reply action - sets up polling for message replies
            if (toolResult && toolResult.action === 'wait_for_reply') {
              const pollIntervalMs = (toolResult.poll_interval_minutes || 5) * 60000;

              // Helper to check if a value is an unresolved template
              const isUnresolvedTemplate = (val: any): boolean =>
                typeof val === 'string' && val.startsWith('{{') && val.endsWith('}}');

              // Check if conversation_id is an unresolved template variable (e.g., "{{step_1.threadId}}")
              // If so, fall back to the captured value in contextMemory (also checking if THAT is valid)
              let effectiveConversationId = toolResult.conversation_id;

              if (!effectiveConversationId || isUnresolvedTemplate(effectiveConversationId)) {
                // Fall back to contextMemory, but ONLY if contextMemory value is also valid
                const ctxConvId = task.contextMemory?.conversation_id;
                if (ctxConvId && !isUnresolvedTemplate(ctxConvId)) {
                  effectiveConversationId = ctxConvId;
                  console.log(
                    `[Tasks] conversation_id "${toolResult.conversation_id}" not valid, using captured value: ${effectiveConversationId}`
                  );
                } else {
                  // Both are invalid - use null (will match any message from contact)
                  effectiveConversationId = null;
                  console.log(
                    `[Tasks] No valid conversation_id available (from tool: "${toolResult.conversation_id}", from context: "${ctxConvId}") - will match any message from contact`
                  );
                }
              }

              console.log(
                `[Tasks] Task ${taskId} waiting for reply from ${toolResult.contact} via ${toolResult.platform}`
              );
              console.log(
                `[Tasks] Poll interval: ${pollIntervalMs}ms, Followup after: ${toolResult.followup_after_hours}h, Max: ${toolResult.max_followups}`
              );
              console.log(
                `[Tasks] Using conversation_id: ${effectiveConversationId || '(none - will match any email from contact)'}`
              );

              await this.updateTask(
                taskId,
                {
                  status: 'waiting',
                  nextCheck: Date.now() + pollIntervalMs,
                  currentStep: {
                    step: task.currentStep.step,
                    description: `Waiting for reply from ${toolResult.contact}`,
                    state: 'waiting',
                  },
                  contextMemory: {
                    ...task.contextMemory,
                    wait_for_reply_active: true,
                    waiting_via: toolResult.platform,
                    waiting_for_contact: toolResult.contact,
                    original_request: toolResult.original_request,
                    success_criteria: toolResult.success_criteria,
                    conversation_id: effectiveConversationId,
                    first_message_time:
                      task.contextMemory?.first_message_time || new Date().toISOString(),
                    last_message_time: new Date().toISOString(),
                    poll_interval_minutes: toolResult.poll_interval_minutes || 5,
                    followup_after_hours: toolResult.followup_after_hours || 24,
                    last_followup_time: null,
                    max_followups: toolResult.max_followups || 3,
                    followup_count: task.contextMemory?.followup_count || 0,
                    new_reply_detected: false,
                  },
                  logEntry: `Waiting for reply from ${toolResult.contact} via ${toolResult.platform}`,
                },
                this.currentUser?.username
              );

              return {
                success: true,
                waitingForReply: true,
                contact: toolResult.contact,
                platform: toolResult.platform,
              };
            }

            // Handle save_variable action - update task context memory
            if (toolResult && toolResult.action === 'save_variable') {
              console.log(`[Tasks] Saving variable ${toolResult.name} = ${toolResult.value}`);
              await this.updateTask(
                taskId,
                {
                  contextMemory: {
                    ...task.contextMemory,
                    [toolResult.name]: toolResult.value,
                  },
                },
                this.currentUser?.username
              );
              // Refresh task for next iteration
              const refreshedTask = await this.getTask(taskId, this.currentUser?.username);
              if (refreshedTask) {
                task = refreshedTask;
              }
            }

            // Handle complete_task action
            if (toolResult && toolResult.action === 'complete_task') {
              console.log(`[Tasks] Task ${taskId} completed: ${toolResult.summary}`);
              await this.updateTask(
                taskId,
                {
                  status: 'completed',
                  currentStep: { ...task.currentStep, state: 'completed' },
                  logEntry: `Task completed: ${toolResult.summary}`,
                },
                this.currentUser?.username
              );

              // Notify user
              if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.addTaskUpdate(taskId, `✅ ${toolResult.summary}`, {
                  toChat: true,
                  emoji: '✅',
                  taskTitle: task.title,
                });
              }

              return { success: true, completed: true, summary: toolResult.summary };
            }

            // Handle goto_step action
            if (toolResult && toolResult.action === 'goto_step') {
              console.log(`[Tasks] Task ${taskId} jumping to step ${toolResult.step_number}`);
              await this.updateTask(
                taskId,
                {
                  currentStep: { step: toolResult.step_number, state: 'executing' },
                  logEntry: `Jumped to step ${toolResult.step_number}${toolResult.reason ? `: ${toolResult.reason}` : ''}`,
                },
                this.currentUser?.username
              );
              // Continue execution at new step
              setTimeout(() => this.internalExecuteTaskStep(taskId), 100);
              return { success: true, jumpedToStep: toolResult.step_number };
            }
          }

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify(toolResult),
          });
        }

        // Continue the conversation with tool results
        currentMessages.push({ role: 'assistant', content: result.content });
        currentMessages.push({ role: 'user', content: toolResults });
      }

      // If we exited without updating state, the LLM completed the step but forgot to call update_task_state
      // Auto-advance to the next step to keep the task moving
      console.log(
        `[Tasks] LLM completed without calling update_task_state - auto-advancing task ${taskId}`
      );

      const currentStep = task.currentStep.step;
      const nextStep = currentStep + 1;

      if (nextStep <= task.plan.length) {
        // Advance to next step
        await this.updateTask(
          taskId,
          {
            currentStep: { step: nextStep, state: 'executing' },
            status: 'active',
            logEntry: `Step ${currentStep} completed (auto-advanced). Moving to step ${nextStep}: ${task.plan[nextStep - 1]}`,
          },
          this.currentUser?.username
        );

        console.log(`[Tasks] Auto-advanced from step ${currentStep} to step ${nextStep}`);

        // Log update to task panel (no chat notification for step progress)
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          const notificationMessage = `Step ${currentStep} completed. Moving to step ${nextStep}: ${task.plan[nextStep - 1]}`;
          this.addTaskUpdate(taskId, notificationMessage);
        }

        // Continue to next step after a short delay
        setTimeout(() => this.internalExecuteTaskStep(taskId), 500);
        return { success: true, autoAdvanced: true };
      } else {
        // This was the last step - mark task as completed
        await this.updateTask(
          taskId,
          {
            status: 'completed',
            currentStep: { ...task.currentStep, state: 'completed' },
            logEntry: `Task completed (all ${task.plan.length} steps finished)`,
          },
          this.currentUser?.username
        );

        console.log(`[Tasks] Task ${taskId} completed (auto-completed after last step)`);

        // Notify user of completion
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.addTaskUpdate(taskId, `Task completed! All ${task.plan.length} steps finished.`, {
            toChat: true,
            emoji: '✅',
            taskTitle: task.title,
          });
        }

        return { success: true, completed: true };
      }
    } catch (err: any) {
      console.error(`[Tasks] Execution error for ${taskId}:`, err.message);
      await this.updateTask(
        taskId,
        {
          status: 'failed',
          logEntry: `Execution failed: ${err.message}`,
        },
        this.currentUser?.username
      );
      return { error: err.message };
    }
  }

  /**
   * Helper: Generate a follow-up message using LLM
   */
  private static async generateFollowupMessage(
    params: {
      originalRequest: string;
      previousReply: string;
      reason: string;
      followupCount: number;
      isTimeout: boolean;
    },
    apiKeys: ApiKeys
  ): Promise<string> {
    const { originalRequest, previousReply, reason, followupCount, isTimeout } = params;

    if (!apiKeys?.anthropic) {
      // Fallback message if no API key
      if (isTimeout) {
        return `Hi, I wanted to follow up on my previous message. ${originalRequest} Please let me know when you have a chance.`;
      }
      return `Thanks for your response. Could you please provide more details? ${originalRequest}`;
    }

    const prompt = `You need to write a polite follow-up message.

ORIGINAL REQUEST:
${originalRequest}

${
  isTimeout
    ? `This is follow-up #${followupCount + 1} because the recipient hasn't responded yet.`
    : `
THEIR PREVIOUS REPLY:
${previousReply}

WHY IT'S NOT SATISFACTORY:
${reason}
`
}

TASK:
Write a brief, friendly follow-up message that:
1. Is polite and professional
2. ${isTimeout ? 'Gently reminds them about the original request' : 'Thanks them for their response and asks for the specific missing information'}
3. Is concise (2-3 sentences max)
4. Doesn't sound pushy or demanding

Respond with ONLY the message text, no quotes or explanations.`;

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKeys.anthropic!,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 300,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!response.ok) {
        console.error('[WaitForReply] Follow-up generation API error:', response.status);
        return isTimeout
          ? `Hi, just following up on my previous message. ${originalRequest}`
          : `Thanks for your response. Could you please provide: ${originalRequest}`;
      }

      const data: any = await response.json();
      return data.content?.[0]?.text?.trim() || `Following up: ${originalRequest}`;
    } catch (err: any) {
      console.error('[WaitForReply] Follow-up generation error:', err.message);
      return isTimeout
        ? `Hi, just following up on my previous message. ${originalRequest}`
        : `Thanks for your response. Could you please provide: ${originalRequest}`;
    }
  }

  /**
   * Helper: Send a follow-up message via the appropriate platform
   */
  private static async sendFollowupMessage(params: {
    platform: string;
    contact: string;
    message: string;
    conversationId: string;
    task: Task;
  }): Promise<{ success: boolean; error?: string; result?: any; message?: string }> {
    const { platform, contact, message, conversationId, task } = params;

    console.log(`[WaitForReply] Sending follow-up via ${platform} to ${contact}`);

    try {
      // This function needs access to the messaging integration helpers
      // which are defined in main.js. For now, we'll use the executeTool callback
      // to send messages using the same tools as the task executor.

      const toolContext = {
        taskId: task.id,
        autoSend: true, // Follow-ups should auto-send
        contextMemory: task.contextMemory || {},
      };

      switch (platform) {
        case 'email': {
          const result = await this.executeTool(
            'send_email',
            {
              recipient: contact,
              subject: task.contextMemory?.original_subject
                ? `Re: ${task.contextMemory.original_subject}`
                : 'Follow-up',
              message: message,
              threadId: conversationId,
            },
            toolContext
          );

          if (result.error) {
            return { success: false, error: result.error };
          }

          return {
            success: true,
            result,
            message: `Follow-up email sent to ${contact}`,
          };
        }

        case 'imessage': {
          const result = await this.executeTool(
            'send_imessage',
            {
              recipient: contact,
              message: message,
            },
            toolContext
          );

          if (result.error) {
            return { success: false, error: result.error };
          }

          return {
            success: true,
            result,
            message: `Follow-up iMessage sent to ${contact}`,
          };
        }

        case 'slack': {
          const result = await this.executeTool(
            'send_slack_message',
            {
              recipient: contact,
              message: message,
              channel: conversationId,
            },
            toolContext
          );

          if (result.error) {
            return { success: false, error: result.error };
          }

          return {
            success: true,
            result,
            message: `Follow-up Slack message sent to ${contact}`,
          };
        }

        case 'telegram': {
          const result = await this.executeTool(
            'send_telegram_message',
            {
              recipient: contact,
              message: message,
              chat_id: conversationId,
            },
            toolContext
          );

          if (result.error) {
            return { success: false, error: result.error };
          }

          return {
            success: true,
            result,
            message: `Follow-up Telegram message sent to ${contact}`,
          };
        }

        case 'discord': {
          const result = await this.executeTool(
            'send_discord_message',
            {
              recipient: contact,
              message: message,
              channel_id: conversationId,
            },
            toolContext
          );

          if (result.error) {
            return { success: false, error: result.error };
          }

          return {
            success: true,
            result,
            message: `Follow-up Discord message sent to ${contact}`,
          };
        }

        default:
          return { success: false, error: `Unknown platform: ${platform}` };
      }
    } catch (err: any) {
      console.error(`[WaitForReply] Error sending follow-up via ${platform}:`, err.message);
      return { success: false, error: err.message };
    }
  }
}
