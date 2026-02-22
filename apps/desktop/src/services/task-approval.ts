/**
 * Task Approval Service
 *
 * Handles approval and execution of pending messages in tasks.
 * Extracted from main.js to improve maintainability and testability.
 */

import { promises as fs } from 'fs';
import path from 'path';

// Types will be imported from their modules
type Task = any; // TODO: Import from task types when available
type PendingMessage = any;

/**
 * Approval request parameters
 */
export interface ApprovalRequest {
  taskId: string;
  messageId: string;
  editedMessage?: string;
}

/**
 * Approval result
 */
export interface ApprovalResult {
  ok: boolean;
  sendResult?: any;
  waiting?: boolean;
  error?: string;
}

/**
 * Approval service options
 */
export interface ApprovalServiceOptions {
  username?: string;
  getTask: (taskId: string, username?: string) => Promise<Task | null>;
  updateTask: (taskId: string, updates: Partial<Task>, username?: string) => Promise<void>;
  getTasksDir: (username?: string) => Promise<string>;
  serializeTask: (task: Task) => string;
  loadIntegrationsAndBuildTools: () => Promise<{ executeTool: Function; slackAccessToken: string | null }>;
  executeTaskStep: (taskId: string, username?: string) => void;
  addTaskUpdate: (taskId: string, message: string, options?: any) => void;
  TOOLS_REQUIRING_CONFIRMATION: string[];
}

/**
 * TaskApprovalService - Manages approval and execution of pending task messages
 */
export class TaskApprovalService {
  /**
   * Approve and execute a pending message
   *
   * @param request - Approval request with taskId, messageId, and optional edited content
   * @param options - Service dependencies and configuration
   * @returns Approval result with success status and execution details
   */
  static async approvePendingMessage(
    request: ApprovalRequest,
    options: ApprovalServiceOptions
  ): Promise<ApprovalResult> {
    const { taskId, messageId, editedMessage } = request;
    const {
      username,
      getTask,
      updateTask,
      getTasksDir,
      serializeTask,
      loadIntegrationsAndBuildTools,
      executeTaskStep,
      addTaskUpdate,
      TOOLS_REQUIRING_CONFIRMATION
    } = options;

    try {
      // Load task
      const task = await getTask(taskId, username);
      if (!task) {
        return { ok: false, error: 'Task not found' };
      }

      // Find the pending message
      const messageIndex = task.pendingMessages?.findIndex((m: PendingMessage) => m.id === messageId);
      if (messageIndex === undefined || messageIndex < 0) {
        return { ok: false, error: 'Pending message not found' };
      }

      const pendingMsg = task.pendingMessages[messageIndex];

      // Reconstruct tool input
      let toolInput = await this.reconstructToolInput(pendingMsg);

      // Apply edited message if provided
      if (editedMessage) {
        toolInput = this.applyEditedMessage(toolInput, pendingMsg.toolName, editedMessage);
      }

      // Resolve Slack recipient if needed
      if (pendingMsg.toolName === 'send_slack_message' && toolInput.channel) {
        const slackResult = await this.resolveSlackRecipient(
          toolInput,
          task,
          taskId,
          updateTask,
          username,
          options
        );
        if (!slackResult.ok) {
          return slackResult;
        }
        toolInput = slackResult.toolInput;
      }

      // Execute the tool
      const executionResult = await this.executeTool(
        pendingMsg.toolName,
        toolInput,
        loadIntegrationsAndBuildTools,
        TOOLS_REQUIRING_CONFIRMATION
      );

      // Handle execution failure
      if (!executionResult.sendSuccess) {
        return await this.handleExecutionFailure(
          task,
          taskId,
          pendingMsg,
          executionResult.sendError,
          getTasksDir,
          serializeTask,
          addTaskUpdate,
          username
        );
      }

      // Handle execution success
      return await this.handleExecutionSuccess(
        task,
        taskId,
        messageIndex,
        pendingMsg,
        executionResult.sendResult,
        getTasksDir,
        serializeTask,
        addTaskUpdate,
        executeTaskStep,
        username
      );
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      console.error('[TaskApproval] Error approving message:', error);
      return { ok: false, error };
    }
  }

  /**
   * Reconstruct tool input from pending message
   */
  private static async reconstructToolInput(pendingMsg: PendingMessage): Promise<any> {
    let toolInput: any;

    try {
      toolInput = JSON.parse(pendingMsg.toolInput || '{}');
    } catch {
      console.log('[TaskApproval] toolInput parse failed, reconstructing from message content');
      toolInput = {};
    }

    // If toolInput is empty, reconstruct from pending message fields
    if (!toolInput || Object.keys(toolInput).length === 0) {
      console.log(`[TaskApproval] Reconstructing toolInput for ${pendingMsg.toolName}`);
      switch (pendingMsg.toolName) {
        case 'send_email':
          toolInput = {
            to: pendingMsg.recipient,
            subject: pendingMsg.subject || '',
            body: pendingMsg.message
          };
          break;
        case 'send_imessage':
          toolInput = {
            recipient: pendingMsg.recipient,
            message: pendingMsg.message
          };
          break;
        case 'send_slack_message':
          toolInput = {
            channel: pendingMsg.recipient,
            message: pendingMsg.message
          };
          break;
        default:
          throw new Error(`Unknown tool type: ${pendingMsg.toolName}`);
      }
    }

    return toolInput;
  }

  /**
   * Apply edited message to tool input
   */
  private static applyEditedMessage(toolInput: any, toolName: string, editedMessage: string): any {
    const updated = { ...toolInput };

    switch (toolName) {
      case 'send_email':
        updated.body = editedMessage;
        break;
      case 'send_imessage':
        updated.message = editedMessage;
        break;
      case 'send_slack_message':
        updated.message = editedMessage;
        break;
    }

    return updated;
  }

  /**
   * Resolve Slack recipient name to user ID
   */
  private static async resolveSlackRecipient(
    toolInput: any,
    task: Task,
    taskId: string,
    updateTask: Function,
    username: string | undefined,
    options: ApprovalServiceOptions
  ): Promise<{ ok: boolean; toolInput?: any; error?: string }> {
    const channel = toolInput.channel;

    // Check if it's already a user/channel ID (starts with U, C, D, or G)
    if (/^[UCDG][A-Z0-9]+$/i.test(channel)) {
      return { ok: true, toolInput };
    }

    console.log(`[TaskApproval] Resolving Slack user name "${channel}" to user ID...`);

    // Check if we have the resolved ID stored in task context
    let storedUserId =
      task.contextMemory?.slack_user_id ||
      task.contextMemory?.[`slack_user_${channel.toLowerCase()}`];

    // If waiting_for_contact matches this recipient, check if we have their ID stored
    const waitingFor = task.contextMemory?.waiting_for_contact;
    if (!storedUserId && waitingFor) {
      const waitingForLower = waitingFor.toLowerCase();
      if (
        waitingForLower.includes(channel.toLowerCase()) ||
        channel.toLowerCase().includes(waitingForLower.split(' ')[0])
      ) {
        storedUserId = task.contextMemory?.waiting_for_user_id;
      }
    }

    if (storedUserId && /^[UCDG][A-Z0-9]+$/i.test(storedUserId)) {
      console.log(`[TaskApproval] Using stored Slack user ID: ${storedUserId}`);
      return { ok: true, toolInput: { ...toolInput, channel: storedUserId } };
    }

    // Need to resolve by searching users
    const { slackAccessToken } = await options.loadIntegrationsAndBuildTools();

    if (!slackAccessToken) {
      return { ok: false, error: 'Slack not connected' };
    }

    try {
      const usersResponse = await fetch('https://slack.com/api/users.list?limit=200', {
        headers: { Authorization: `Bearer ${slackAccessToken}` }
      });
      const usersData: any = await usersResponse.json();

      if (usersData.ok && usersData.members) {
        const searchTerm = channel.toLowerCase();
        const user = usersData.members.find(
          (m: any) =>
            m.name?.toLowerCase() === searchTerm ||
            m.real_name?.toLowerCase() === searchTerm ||
            m.name?.toLowerCase().includes(searchTerm) ||
            m.real_name?.toLowerCase().includes(searchTerm) ||
            m.profile?.display_name?.toLowerCase() === searchTerm ||
            m.profile?.display_name?.toLowerCase().includes(searchTerm)
        );

        if (user) {
          console.log(`[TaskApproval] Resolved "${channel}" to Slack user: ${user.real_name} (${user.id})`);

          // Store for future use
          await updateTask(
            taskId,
            {
              contextMemory: {
                ...task.contextMemory,
                slack_user_id: user.id,
                [`slack_user_${channel.toLowerCase()}`]: user.id
              }
            },
            username
          );

          return { ok: true, toolInput: { ...toolInput, channel: user.id } };
        } else {
          console.error(`[TaskApproval] Could not find Slack user matching "${channel}"`);
          return {
            ok: false,
            error: `Could not find Slack user "${channel}". Please use their exact Slack username or display name.`
          };
        }
      }
    } catch (resolveErr) {
      const error = resolveErr instanceof Error ? resolveErr.message : 'Unknown error';
      console.error('[TaskApproval] Failed to resolve Slack user:', error);
    }

    return { ok: false, error: 'Failed to resolve Slack user' };
  }

  /**
   * Execute the tool with confirmation bypass
   */
  private static async executeTool(
    toolName: string,
    toolInput: any,
    loadIntegrationsAndBuildTools: Function,
    TOOLS_REQUIRING_CONFIRMATION: string[]
  ): Promise<{ sendSuccess: boolean; sendResult?: any; sendError?: string }> {
    console.log(`[TaskApproval] Sending approved message: ${toolName}`);

    const { executeTool } = await loadIntegrationsAndBuildTools();

    // Temporarily remove the tool from confirmation list to bypass the check
    const toolIndex = TOOLS_REQUIRING_CONFIRMATION.indexOf(toolName);
    if (toolIndex > -1) {
      TOOLS_REQUIRING_CONFIRMATION.splice(toolIndex, 1);
    }

    let sendResult: any;
    let sendSuccess = false;
    let sendError: string | undefined;

    try {
      sendResult = await executeTool(toolName, toolInput);

      // Check if the send was actually successful
      if (sendResult) {
        if (typeof sendResult === 'object') {
          // Check various success indicators
          if (sendResult.ok === true || sendResult.success === true) {
            sendSuccess = true;
          } else if (sendResult.error || sendResult.ok === false) {
            sendError = sendResult.error || sendResult.message || 'Send failed';
          } else if (sendResult.messageId || sendResult.id || sendResult.ts) {
            // Slack returns ts, email might return messageId
            sendSuccess = true;
          } else {
            // If no clear error, assume success
            sendSuccess = true;
          }
        } else if (typeof sendResult === 'string') {
          // String result - check if it contains error indicators
          if (
            sendResult.toLowerCase().includes('error') ||
            sendResult.toLowerCase().includes('failed')
          ) {
            sendError = sendResult;
          } else {
            sendSuccess = true;
          }
        } else {
          sendSuccess = true;
        }
      }

      console.log(`[TaskApproval] Send result: success=${sendSuccess}, error=${sendError}`, sendResult);
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      sendError = error;
      console.error('[TaskApproval] Send failed with exception:', error);
    } finally {
      // Re-add the tool to confirmation list
      if (toolIndex > -1 && !TOOLS_REQUIRING_CONFIRMATION.includes(toolName)) {
        TOOLS_REQUIRING_CONFIRMATION.push(toolName);
      }
    }

    return { sendSuccess, sendResult, sendError };
  }

  /**
   * Handle execution failure
   */
  private static async handleExecutionFailure(
    task: Task,
    taskId: string,
    pendingMsg: PendingMessage,
    sendError: string | undefined,
    getTasksDir: Function,
    serializeTask: Function,
    addTaskUpdate: Function,
    username: string | undefined
  ): Promise<ApprovalResult> {
    task.lastUpdated = new Date().toISOString();
    task.executionLog.push({
      timestamp: new Date().toISOString(),
      message: `FAILED to send ${pendingMsg.platform} message to ${pendingMsg.recipient}: ${sendError || 'Unknown error'}`
    });

    // Save task with the failure logged (but keep pending message for retry)
    const tasksDir = await getTasksDir(username);
    const taskPath = path.join(tasksDir, `${taskId}.md`);
    await fs.writeFile(taskPath, serializeTask(task), 'utf8');

    addTaskUpdate(taskId, `Failed to send message to ${pendingMsg.recipient}: ${sendError}`, {
      toChat: true,
      emoji: '❌',
      taskTitle: task.title
    });

    return { ok: false, error: sendError || 'Failed to send message. Please try again.' };
  }

  /**
   * Handle execution success
   */
  private static async handleExecutionSuccess(
    task: Task,
    taskId: string,
    messageIndex: number,
    pendingMsg: PendingMessage,
    sendResult: any,
    getTasksDir: Function,
    serializeTask: Function,
    addTaskUpdate: Function,
    executeTaskStep: Function,
    username: string | undefined
  ): Promise<ApprovalResult> {
    // Send succeeded - remove the pending message
    task.pendingMessages.splice(messageIndex, 1);

    // Log the successful send
    task.lastUpdated = new Date().toISOString();
    task.executionLog.push({
      timestamp: new Date().toISOString(),
      message: `Sent ${pendingMsg.platform} message to ${pendingMsg.recipient}`
    });

    // Check if the current step involves waiting for a response
    const currentStepDesc = task.plan[task.currentStep.step - 1]?.toLowerCase() || '';
    const isWaitingStep =
      currentStepDesc.includes('wait') ||
      currentStepDesc.includes('response') ||
      currentStepDesc.includes('reply') ||
      currentStepDesc.includes('follow up') ||
      currentStepDesc.includes('until');

    console.log(`[TaskApproval] currentStepDesc = "${currentStepDesc}", isWaitingStep = ${isWaitingStep}`);

    // Capture conversation/thread ID from send result
    const conversationId =
      sendResult?.chatId || // iMessage chat_id
      sendResult?.channel || // Slack channel
      sendResult?.threadId || // Email thread
      null;

    console.log(`[TaskApproval] sendResult =`, JSON.stringify(sendResult).slice(0, 300));
    console.log(`[TaskApproval] captured conversationId = ${conversationId}`);

    // Handle task state based on whether all pending messages are cleared
    if (task.pendingMessages.length === 0) {
      if (isWaitingStep) {
        // This step requires waiting for a response - don't advance
        task.status = 'waiting';
        task.currentStep.state = 'waiting';

        // Set nextCheck to prevent immediate re-execution by scheduler
        const pollInterval = task.pollFrequency?.value || 300000; // Default 5 minutes
        task.nextCheck = Date.now() + pollInterval;

        // Store context about what we're waiting for
        task.contextMemory = {
          ...task.contextMemory,
          waiting_via: pendingMsg.platform,
          waiting_for_contact: pendingMsg.recipient,
          last_message_time: new Date().toISOString(),
          new_reply_detected: false,
          ...(conversationId ? { conversation_id: conversationId } : {}),
          ...(pendingMsg.platform === 'email' && pendingMsg.subject
            ? {
                original_subject: pendingMsg.subject.replace(/^Re:\s*/i, '')
              }
            : {}),
          ...(sendResult?.messageId ? { last_message_id: sendResult.messageId } : {})
        };

        console.log(`[TaskApproval] contextMemory.conversation_id = ${task.contextMemory.conversation_id}`);
        console.log(
          `[TaskApproval] Message sent for waiting step "${currentStepDesc}" - staying on step ${task.currentStep.step}, waiting for response${conversationId ? ` (conversation: ${conversationId})` : ''}, next check in ${pollInterval / 1000}s`
        );

        task.executionLog.push({
          timestamp: new Date().toISOString(),
          message: `Waiting for response from ${pendingMsg.recipient} via ${pendingMsg.platform}`
        });
      } else {
        // Non-waiting step - can advance
        task.status = 'active';

        // Still capture the conversation_id for any subsequent wait_for_reply steps
        if (conversationId || pendingMsg.platform === 'email') {
          task.contextMemory = {
            ...task.contextMemory,
            ...(conversationId ? { conversation_id: conversationId } : {}),
            last_message_time: new Date().toISOString(),
            ...(pendingMsg.platform === 'email' && pendingMsg.subject
              ? {
                  original_subject: pendingMsg.subject.replace(/^Re:\s*/i, '')
                }
              : {}),
            ...(sendResult?.messageId ? { last_message_id: sendResult.messageId } : {})
          };
          console.log(`[TaskApproval] Captured conversation_id ${conversationId} for next step`);
        }

        const currentStep = task.currentStep.step;
        const nextStep = currentStep + 1;

        if (nextStep <= task.plan.length) {
          task.currentStep.step = nextStep;
          task.currentStep.state = 'executing';
          console.log(
            `[TaskApproval] Message sent on non-waiting step, advancing from step ${currentStep} to step ${nextStep}`
          );
        } else {
          task.status = 'completed';
          task.currentStep.state = 'completed';
          console.log('[TaskApproval] Message sent on final step, marking task as completed');
        }
      }
    }

    // Save task
    const tasksDir = await getTasksDir(username);
    const taskPath = path.join(tasksDir, `${taskId}.md`);
    await fs.writeFile(taskPath, serializeTask(task), 'utf8');

    // Notify UI
    const updateMessage =
      task.status === 'completed'
        ? `Task completed! Final message sent to ${pendingMsg.recipient}.`
        : isWaitingStep
          ? `Message sent to ${pendingMsg.recipient}. Waiting for their response...`
          : `Message sent to ${pendingMsg.recipient}.`;

    const updateEmoji = task.status === 'completed' ? '✅' : '📤';

    addTaskUpdate(taskId, updateMessage, {
      toChat: true,
      emoji: updateEmoji,
      taskTitle: task.title
    });

    // Only continue execution if task is active (not waiting)
    if (task.status === 'active') {
      setTimeout(() => executeTaskStep(taskId, username), 100);
    }

    return { ok: true, sendResult, waiting: task.status === 'waiting' };
  }
}
