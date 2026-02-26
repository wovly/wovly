/**
 * Task Messaging Service
 * Handles message approval, rejection, and sending for tasks
 */

import * as path from 'path';
import { promises as fs } from 'fs';
import {
  getTask,
  updateTask,
  getTasksDir,
  serializeTask,
  addTaskUpdate,
  type Task,
} from '../tasks';

export interface ApprovalResult {
  ok: boolean;
  error?: string;
  sendResult?: any;
  waiting?: boolean;
}

export interface RejectionResult {
  ok: boolean;
  error?: string;
}

export interface PendingMessage {
  id: string;
  toolName: string;
  toolInput?: string;
  recipient: string;
  message: string;
  subject?: string;
  platform: string;
}

/**
 * TaskMessagingService - Handles task message approval and sending
 */
export class TaskMessagingService {
  private static toolsRequiringConfirmation: string[] = [];
  private static executeTaskStepCallback:
    | ((taskId: string, username: string) => Promise<void>)
    | null = null;
  private static loadIntegrationsCallback: (() => Promise<any>) | null = null;

  /**
   * Set the callback for executing task steps (injected from main.js)
   */
  static setExecuteTaskStepCallback(
    callback: (taskId: string, username: string) => Promise<void>
  ): void {
    this.executeTaskStepCallback = callback;
  }

  /**
   * Set the callback for loading integrations (injected from main.js)
   */
  static setLoadIntegrationsCallback(callback: () => Promise<any>): void {
    this.loadIntegrationsCallback = callback;
  }

  /**
   * Set the list of tools requiring confirmation
   */
  static setToolsRequiringConfirmation(tools: string[]): void {
    this.toolsRequiringConfirmation = tools;
  }

  /**
   * Approve and send a pending message
   */
  static async approvePendingMessage(
    taskId: string,
    messageId: string,
    editedMessage: string | undefined,
    username: string
  ): Promise<ApprovalResult> {
    try {
      const task = await getTask(taskId, username);
      if (!task) {
        return { ok: false, error: 'Task not found' };
      }

      // Find the pending message
      const messageIndex = task.pendingMessages?.findIndex((m: any) => m.id === messageId);
      if (messageIndex === undefined || messageIndex < 0) {
        return { ok: false, error: 'Pending message not found' };
      }

      const pendingMsg: PendingMessage = task.pendingMessages![messageIndex];
      let toolInput: any;

      try {
        toolInput = JSON.parse(pendingMsg.toolInput || '{}');
      } catch {
        console.log(`[TaskMessaging] toolInput parse failed, reconstructing from message content`);
        toolInput = {};
      }

      // If toolInput is empty, reconstruct from pending message fields
      if (!toolInput || Object.keys(toolInput).length === 0) {
        console.log(`[TaskMessaging] Reconstructing toolInput for ${pendingMsg.toolName}`);
        toolInput = this.reconstructToolInput(pendingMsg);
        if (!toolInput) {
          return { ok: false, error: `Unknown tool type: ${pendingMsg.toolName}` };
        }
      }

      // If message was edited, update the content
      if (editedMessage) {
        this.applyEditedMessage(pendingMsg.toolName, toolInput, editedMessage);
      }

      // Execute the actual send
      console.log(
        `[TaskMessaging] Sending approved message: ${pendingMsg.toolName} to ${pendingMsg.recipient}`
      );

      const sendResult = await this.sendMessage(
        pendingMsg.toolName,
        toolInput,
        username,
        task,
        taskId,
        pendingMsg.recipient
      );

      if (!sendResult.success) {
        // Send failed - keep message for retry
        task.lastUpdated = new Date().toISOString();
        task.executionLog.push({
          timestamp: new Date().toISOString(),
          message: `FAILED to send ${pendingMsg.platform} message to ${pendingMsg.recipient}: ${sendResult.error || 'Unknown error'}`,
        });

        const tasksDir = await getTasksDir(username);
        const taskPath = path.join(tasksDir, `${taskId}.md`);
        await fs.writeFile(taskPath, serializeTask(task), 'utf8');

        addTaskUpdate(
          taskId,
          `Failed to send message to ${pendingMsg.recipient}: ${sendResult.error}`,
          {
            toChat: true,
            emoji: '❌',
            taskTitle: task.title,
          }
        );

        return {
          ok: false,
          error: sendResult.error || 'Failed to send message. Please try again.',
        };
      }

      // Send succeeded - remove the pending message
      task.pendingMessages!.splice(messageIndex, 1);

      // Log the successful send
      task.lastUpdated = new Date().toISOString();
      task.executionLog.push({
        timestamp: new Date().toISOString(),
        message: `Sent ${pendingMsg.platform} message to ${pendingMsg.recipient}`,
      });

      // Check if current step requires waiting for a response
      const currentStepDesc = task.plan[task.currentStep.step - 1]?.toLowerCase() || '';
      const isWaitingStep =
        currentStepDesc.includes('wait') ||
        currentStepDesc.includes('response') ||
        currentStepDesc.includes('reply') ||
        currentStepDesc.includes('follow up') ||
        currentStepDesc.includes('until');

      console.log(
        `[TaskMessaging] currentStepDesc = "${currentStepDesc}", isWaitingStep = ${isWaitingStep}`
      );

      // Capture conversation/thread ID from send result
      const conversationId =
        sendResult.result?.chatId ||
        sendResult.result?.channel ||
        sendResult.result?.threadId ||
        null;

      console.log(`[TaskMessaging] captured conversationId = ${conversationId}`);

      if (task.pendingMessages!.length === 0) {
        if (isWaitingStep) {
          // This step requires waiting for a response
          task.status = 'waiting';
          task.currentStep.state = 'waiting';

          const pollInterval = Number(task.pollFrequency?.value || 300000); // Default 5 minutes
          task.nextCheck = Date.now() + pollInterval;

          // Store context about what we're waiting for
          task.contextMemory = {
            ...task.contextMemory,
            waiting_via: pendingMsg.platform as any,
            waiting_for_contact: pendingMsg.recipient as any,
            last_message_time: new Date().toISOString() as any,
            new_reply_detected: false as any,
            ...(conversationId ? { conversation_id: conversationId } : {}),
            ...(pendingMsg.platform === 'email' && pendingMsg.subject
              ? {
                  original_subject: pendingMsg.subject.replace(/^Re:\s*/i, ''),
                }
              : {}),
            ...(sendResult.result?.messageId
              ? { last_message_id: sendResult.result.messageId }
              : {}),
          };

          console.log(
            `[TaskMessaging] Message sent for waiting step - staying on step ${task.currentStep.step}, waiting for response, next check in ${Number(pollInterval) / 1000}s`
          );

          task.executionLog.push({
            timestamp: new Date().toISOString(),
            message: `Waiting for response from ${pendingMsg.recipient} via ${pendingMsg.platform}`,
          });
        } else {
          // Non-waiting step - can advance
          task.status = 'active';

          // Still capture conversation_id for subsequent steps
          if (conversationId || pendingMsg.platform === 'email') {
            task.contextMemory = {
              ...task.contextMemory,
              ...(conversationId ? { conversation_id: conversationId } : {}),
              last_message_time: new Date().toISOString(),
              ...(pendingMsg.platform === 'email' && pendingMsg.subject
                ? {
                    original_subject: pendingMsg.subject.replace(/^Re:\s*/i, ''),
                  }
                : {}),
              ...(sendResult.result?.messageId
                ? { last_message_id: sendResult.result.messageId }
                : {}),
            };
            console.log(`[TaskMessaging] Captured conversation_id ${conversationId} for next step`);
          }

          const currentStep = task.currentStep.step;
          const nextStep = currentStep + 1;

          if (nextStep <= task.plan.length) {
            task.currentStep.step = nextStep;
            task.currentStep.state = 'executing';
            console.log(
              `[TaskMessaging] Message sent on non-waiting step, advancing from step ${currentStep} to step ${nextStep}`
            );
          } else {
            task.status = 'completed';
            task.currentStep.state = 'completed';
            console.log(`[TaskMessaging] Message sent on final step, marking task as completed`);
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
        taskTitle: task.title,
      });

      // Continue execution if task is active (not waiting)
      if (task.status === 'active' && this.executeTaskStepCallback) {
        setTimeout(() => this.executeTaskStepCallback!(taskId, username), 100);
      }

      return { ok: true, sendResult: sendResult.result, waiting: task.status === 'waiting' };
    } catch (err: any) {
      console.error(`[TaskMessaging] Error approving message:`, err.message);
      return { ok: false, error: err.message };
    }
  }

  /**
   * Reject and discard a pending message
   */
  static async rejectPendingMessage(
    taskId: string,
    messageId: string,
    username: string
  ): Promise<RejectionResult> {
    try {
      const task = await getTask(taskId, username);
      if (!task) {
        return { ok: false, error: 'Task not found' };
      }

      // Find and remove the pending message
      const messageIndex = task.pendingMessages?.findIndex((m: any) => m.id === messageId);
      if (messageIndex === undefined || messageIndex < 0) {
        return { ok: false, error: 'Pending message not found' };
      }

      const pendingMsg = task.pendingMessages![messageIndex];
      task.pendingMessages!.splice(messageIndex, 1);

      // Update task status - advance to next step even when discarded
      if (task.pendingMessages!.length === 0) {
        task.status = 'active'; // Resume but message was skipped

        const currentStep = task.currentStep.step;
        const nextStep = currentStep + 1;

        if (nextStep <= task.plan.length) {
          task.currentStep.step = nextStep;
          task.currentStep.state = 'executing';
          console.log(
            `[TaskMessaging] Message discarded, advancing from step ${currentStep} to step ${nextStep}`
          );
        } else {
          // This was the last step
          task.status = 'completed';
          task.currentStep.state = 'completed';
          console.log(`[TaskMessaging] Message discarded on final step, marking task as completed`);
        }
      }

      task.lastUpdated = new Date().toISOString();
      task.executionLog.push({
        timestamp: new Date().toISOString(),
        message: `Discarded ${pendingMsg.platform} message to ${pendingMsg.recipient} (user rejected)`,
      });

      // Save task
      const tasksDir = await getTasksDir(username);
      const taskPath = path.join(tasksDir, `${taskId}.md`);
      await fs.writeFile(taskPath, serializeTask(task), 'utf8');

      // Notify UI
      const discardMessage =
        task.status === 'completed'
          ? `Task completed (message was skipped).`
          : `Message to ${pendingMsg.recipient} was discarded. Continuing to next step...`;

      addTaskUpdate(taskId, discardMessage, {
        toChat: true,
        emoji: '⏭️',
        taskTitle: task.title,
      });

      // Continue task execution on the next step
      if (task.status === 'active' && this.executeTaskStepCallback) {
        setTimeout(() => this.executeTaskStepCallback!(taskId, username), 100);
      }

      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  /**
   * Reconstruct tool input from pending message fields
   */
  private static reconstructToolInput(pendingMsg: PendingMessage): any | null {
    switch (pendingMsg.toolName) {
      case 'send_email':
        return {
          to: pendingMsg.recipient,
          subject: pendingMsg.subject || '',
          body: pendingMsg.message,
        };
      case 'send_imessage':
        return {
          recipient: pendingMsg.recipient,
          message: pendingMsg.message,
        };
      case 'send_slack_message':
        return {
          channel: pendingMsg.recipient,
          message: pendingMsg.message,
        };
      default:
        return null;
    }
  }

  /**
   * Apply edited message to tool input
   */
  private static applyEditedMessage(toolName: string, toolInput: any, editedMessage: string): void {
    switch (toolName) {
      case 'send_email':
        toolInput.body = editedMessage;
        break;
      case 'send_imessage':
      case 'send_slack_message':
        toolInput.message = editedMessage;
        break;
    }
  }

  /**
   * Send a message via the appropriate integration
   */
  private static async sendMessage(
    toolName: string,
    toolInput: any,
    username: string,
    task: Task,
    taskId: string,
    recipient: string
  ): Promise<{ success: boolean; error?: string; result?: any }> {
    if (!this.loadIntegrationsCallback) {
      return { success: false, error: 'Integrations not initialized' };
    }

    const { executeTool, slackAccessToken } = await this.loadIntegrationsCallback();

    // For Slack: resolve recipient name to user ID if needed
    if (toolName === 'send_slack_message' && toolInput.channel) {
      const resolveResult = await this.resolveSlackRecipient(
        toolInput.channel,
        task,
        taskId,
        username,
        slackAccessToken
      );

      if (!resolveResult.success) {
        return resolveResult;
      }

      toolInput.channel = resolveResult.userId;
    }

    // Temporarily remove tool from confirmation list
    const toolIndex = this.toolsRequiringConfirmation.indexOf(toolName);
    if (toolIndex > -1) {
      this.toolsRequiringConfirmation.splice(toolIndex, 1);
    }

    let sendResult: any;
    let sendSuccess = false;
    let sendError: string | null = null;

    try {
      sendResult = await executeTool(toolName, toolInput);

      // Check if send was successful
      if (sendResult) {
        if (typeof sendResult === 'object') {
          if (sendResult.ok === true || sendResult.success === true) {
            sendSuccess = true;
          } else if (sendResult.error || sendResult.ok === false) {
            sendError = sendResult.error || sendResult.message || 'Send failed';
          } else if (sendResult.messageId || sendResult.id || sendResult.ts) {
            sendSuccess = true;
          } else {
            sendSuccess = true;
          }
        } else if (typeof sendResult === 'string') {
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

      console.log(
        `[TaskMessaging] Send result: success=${sendSuccess}, error=${sendError}`,
        sendResult
      );
    } catch (err: any) {
      sendError = err.message;
      console.error(`[TaskMessaging] Send failed with exception:`, err.message);
    } finally {
      // Re-add tool to confirmation list
      if (toolIndex > -1 && !this.toolsRequiringConfirmation.includes(toolName)) {
        this.toolsRequiringConfirmation.push(toolName);
      }
    }

    if (!sendSuccess) {
      return { success: false, error: sendError || 'Unknown error' };
    }

    return { success: true, result: sendResult };
  }

  /**
   * Resolve Slack recipient name to user ID
   */
  private static async resolveSlackRecipient(
    channel: string,
    task: Task,
    taskId: string,
    username: string,
    slackAccessToken?: string
  ): Promise<{ success: boolean; userId?: string; error?: string }> {
    // Check if already a user/channel ID
    if (/^[UCDG][A-Z0-9]+$/i.test(channel)) {
      return { success: true, userId: channel };
    }

    console.log(`[TaskMessaging] Resolving Slack user name "${channel}" to user ID...`);

    // Check for stored ID in task context
    let storedUserId =
      task.contextMemory?.slack_user_id ||
      task.contextMemory?.[`slack_user_${channel.toLowerCase()}`];

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
      console.log(`[TaskMessaging] Using stored Slack user ID: ${storedUserId}`);
      return { success: true, userId: storedUserId };
    }

    if (!slackAccessToken) {
      return { success: false, error: 'No Slack access token available' };
    }

    // Resolve by searching users
    try {
      const usersResponse = await fetch(`https://slack.com/api/users.list?limit=200`, {
        headers: { Authorization: `Bearer ${slackAccessToken}` },
      });
      const usersData = (await usersResponse.json()) as any;

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
          console.log(
            `[TaskMessaging] Resolved "${channel}" to Slack user: ${user.real_name} (${user.id})`
          );

          // Store for future use
          await updateTask(
            taskId,
            {
              contextMemory: {
                ...task.contextMemory,
                slack_user_id: user.id,
                [`slack_user_${channel.toLowerCase()}`]: user.id,
              },
            },
            username
          );

          return { success: true, userId: user.id };
        } else {
          return {
            success: false,
            error: `Could not find Slack user "${channel}". Please use their exact Slack username or display name.`,
          };
        }
      }
    } catch (resolveErr: any) {
      console.error(`[TaskMessaging] Failed to resolve Slack user:`, resolveErr.message);
      return { success: false, error: resolveErr.message };
    }

    return { success: false, error: 'Failed to resolve Slack user' };
  }
}
