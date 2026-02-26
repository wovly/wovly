/**
 * TaskSchedulerService
 *
 * Manages polling for waiting tasks and checking for new messages/replies.
 * Runs every 60 seconds to check tasks that need execution.
 *
 * Responsibilities:
 * - Poll waiting tasks based on nextCheck timestamps
 * - Check messaging integrations for new messages
 * - Handle wait_for_reply workflows with timeout/follow-up logic
 * - Trigger task execution when conditions are met
 */

// Types for dependency injection
type Task = any;
type MessageCheckResult = {
  hasNew: boolean;
  count?: number;
  messages?: any[];
  snippet?: string;
  text?: string;
};

type MessagingIntegration = {
  name: string;
  checkForNewMessages?: (
    contact: string,
    since: number,
    accessToken: string | null,
    conversationId: string | null
  ) => Promise<MessageCheckResult>;
};

type MainWindow = {
  webContents: {
    send: (channel: string, data: any) => void;
  };
};

type User = {
  username: string;
};

type EvaluationParams = {
  replyContent: string;
  originalRequest: string;
  successCriteria: string;
  contact: string;
};

type EvaluationResult = {
  satisfies: boolean;
  reason: string;
  extractedInfo?: string;
};

// Dependency injection callbacks
type Dependencies = {
  listActiveTasks: (username: string) => Promise<Task[]>;
  getTask: (taskId: string, username: string) => Promise<Task>;
  updateTask: (taskId: string, updates: any, username: string) => Promise<void>;
  executeTaskStep: (taskId: string, username: string) => Promise<void>;
  getGoogleAccessToken: (username: string) => Promise<string | null>;
  getSlackAccessToken: (username: string) => Promise<string | null>;
  getMessagingIntegration: (integrationName: string) => MessagingIntegration | null;
  getIMessageChatId: (phoneNumber: string) => Promise<string | null>;
  getMainWindow: () => MainWindow | null;
  getCurrentUser: () => User | null;
  getSettingsPath: (username: string) => Promise<string>;
  readFile: (path: string, encoding: string) => Promise<string>;
  checkForNewEmails: (
    accessToken: string,
    email: string,
    since: number
  ) => Promise<MessageCheckResult>;
};

/**
 * TaskSchedulerService - Static service for task scheduling
 */
export class TaskSchedulerService {
  private static schedulerInterval: NodeJS.Timeout | null = null;
  private static deps: Dependencies | null = null;

  /**
   * Initialize dependencies for the scheduler
   */
  static setDependencies(dependencies: Dependencies): void {
    this.deps = dependencies;
  }

  /**
   * Start the task scheduler
   * Polls every 60 seconds for tasks that need execution
   */
  static startScheduler(): void {
    if (!this.deps) {
      throw new Error('[TaskScheduler] Dependencies not set. Call setDependencies() first.');
    }

    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
    }

    // Poll every 60 seconds - lightweight checks are cheap, only run LLM when needed
    console.log('[Tasks] Starting task scheduler (checking every 60 seconds)');

    this.schedulerInterval = setInterval(async () => {
      await this.schedulerTick();
    }, 60000); // Check every 60 seconds
  }

  /**
   * Stop the task scheduler
   */
  static stopScheduler(): void {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
      console.log('[Tasks] Stopped task scheduler');
    }
  }

  /**
   * Single scheduler tick - checks all waiting tasks
   */
  private static async schedulerTick(): Promise<void> {
    if (!this.deps) {
      return;
    }

    try {
      const currentUser = this.deps.getCurrentUser();

      // Skip scheduler tick if no user is logged in
      if (!currentUser?.username) {
        return;
      }

      const tasks = await this.deps.listActiveTasks(currentUser.username);
      const googleAccessToken = await this.deps.getGoogleAccessToken(currentUser.username);
      const slackAccessToken = await this.deps.getSlackAccessToken(currentUser.username);

      const waitingTasks = tasks.filter((t) => t.status === 'waiting');
      if (waitingTasks.length > 0) {
        console.log(`[Tasks] Scheduler tick: ${waitingTasks.length} waiting tasks`);
      }

      for (let task of tasks) {
        // Skip event-based tasks - they only run on specific events like login
        if (task.pollFrequency?.type === 'event') {
          continue;
        }

        // Check if task needs execution
        if (task.status === 'waiting' && task.nextCheck && Date.now() >= task.nextCheck) {
          console.log(
            `[Tasks] Processing task ${task.id}: nextCheck was ${new Date(task.nextCheck).toISOString()}`
          );

          // Check for unified messaging context (new system)
          const waitingVia = task.contextMemory?.waiting_via;
          const waitingForContact = task.contextMemory?.waiting_for_contact;
          const lastMessageTime = task.contextMemory?.last_message_time;

          console.log(
            `[Tasks] Task context: via=${waitingVia}, contact=${waitingForContact}, lastMsg=${lastMessageTime}`
          );

          // Also support legacy email context for backward compatibility
          const legacyWaitingForEmail =
            task.contextMemory?.waiting_for_email || task.contextMemory?.email;
          const legacyLastCheckTime =
            task.contextMemory?.last_email_check || task.contextMemory?.email_sent_time;

          // Try unified messaging first
          if (waitingVia && waitingForContact && lastMessageTime) {
            task = await this.handleUnifiedMessaging(
              task,
              waitingVia,
              waitingForContact,
              lastMessageTime,
              googleAccessToken,
              slackAccessToken,
              currentUser.username
            );

            // If task was updated and needs execution, it will fall through to executeTaskStep
          }
          // Fall back to legacy email check
          else if (legacyWaitingForEmail && googleAccessToken && legacyLastCheckTime) {
            const shouldExecute = await this.handleLegacyEmail(
              task,
              legacyWaitingForEmail,
              googleAccessToken,
              legacyLastCheckTime,
              currentUser.username
            );

            if (!shouldExecute) {
              continue;
            }
          }

          console.log(`[Tasks] Executing scheduled check for task: ${task.id}`);
          await this.deps.executeTaskStep(task.id, currentUser.username);
        }
      }
    } catch (err: any) {
      console.error('[Tasks] Scheduler error:', err.message);
    }
  }

  /**
   * Handle unified messaging integration (email, Slack, iMessage, etc.)
   */
  private static async handleUnifiedMessaging(
    task: Task,
    waitingVia: string,
    waitingForContact: string,
    lastMessageTime: string,
    googleAccessToken: string | null,
    slackAccessToken: string | null,
    username: string
  ): Promise<Task> {
    if (!this.deps) {
      return task;
    }

    const integration = this.deps.getMessagingIntegration(waitingVia);

    if (!integration || !integration.checkForNewMessages) {
      return task;
    }

    // Get the appropriate access token for this integration
    const accessToken =
      waitingVia === 'email' ? googleAccessToken : waitingVia === 'slack' ? slackAccessToken : null;

    // Get conversation/thread ID if available (for filtering to specific conversation)
    // This ensures we only see replies in the SAME thread, not from group chats or other conversations
    let conversationId = task.contextMemory?.conversation_id || task.contextMemory?.chat_id || null;

    // For iMessage tasks without a conversation_id, try to capture it now
    // This handles tasks created before the conversation tracking fix
    if (!conversationId && waitingVia === 'imessage') {
      const phoneNumber =
        task.contextMemory?.adaira_phone ||
        task.contextMemory?.[`${waitingForContact.toLowerCase()}_phone`] ||
        waitingForContact;
      console.log(
        `[Tasks] No conversation_id for iMessage task, attempting to capture for ${phoneNumber}`
      );
      try {
        conversationId = await this.deps.getIMessageChatId(phoneNumber);
        if (conversationId) {
          console.log(`[Tasks] Captured missing conversation_id: ${conversationId}`);
          // Store it for future checks
          await this.deps.updateTask(
            task.id,
            {
              contextMemory: { ...task.contextMemory, conversation_id: conversationId },
            },
            username
          );
        }
      } catch (err: any) {
        console.error(`[Tasks] Failed to capture conversation_id: ${err.message}`);
      }
    }

    // Check if we have a valid conversation ID (not null, string "null", or unresolved template)
    const isUnresolvedTemplate =
      typeof conversationId === 'string' &&
      conversationId.startsWith('{{') &&
      conversationId.endsWith('}}');
    const hasValidConversationId =
      conversationId &&
      conversationId !== 'null' &&
      conversationId !== 'undefined' &&
      !isUnresolvedTemplate;

    if (isUnresolvedTemplate) {
      console.log(
        `[Tasks] WARNING: conversation_id is unresolved template "${conversationId}" - will match any thread`
      );
    }
    console.log(
      `[Tasks] Checking ${integration.name} for reply from ${waitingForContact}${hasValidConversationId ? ` (thread: ${conversationId})` : ' (any thread)'}`
    );

    // Normalize: pass null if conversationId is invalid string
    const threadIdToPass = hasValidConversationId ? conversationId : null;
    const check = await integration.checkForNewMessages(
      waitingForContact,
      new Date(lastMessageTime).getTime(),
      accessToken,
      threadIdToPass // Pass null if no valid thread ID, so it matches ANY email from contact
    );

    if (!check.hasNew) {
      // No new messages - check if this is a wait_for_reply workflow with timeout
      if (task.contextMemory?.wait_for_reply_active) {
        const shouldContinue = await this.handleWaitForReplyTimeout(
          task,
          waitingForContact,
          username
        );
        if (shouldContinue) {
          // Timeout follow-up needed, refresh task and return it for execution
          return await this.deps.getTask(task.id, username);
        }
      } else {
        // Not a wait_for_reply workflow - standard reschedule
        const pollInterval =
          task.pollFrequency?.type === 'event' ? null : task.pollFrequency?.value || 60000;
        console.log(
          `[Tasks] No new ${integration.name} from ${waitingForContact}, rescheduling in ${pollInterval ? pollInterval / 1000 + 's' : 'event-based'}`
        );
        if (pollInterval) {
          await this.deps.updateTask(
            task.id,
            {
              nextCheck: Date.now() + pollInterval,
              contextMemory: { ...task.contextMemory, last_check_time: new Date().toISOString() },
            },
            username
          );
        }
      }
      return task;
    }

    console.log(`[Tasks] New ${integration.name} from ${waitingForContact}! Running executor.`);

    // Extract message preview from check result if available
    let messagePreview = '';
    let messages: any[] = [];
    if (check.messages && Array.isArray(check.messages)) {
      messages = check.messages;
      // Get preview of first/latest message
      const latestMsg = messages[0];
      if (latestMsg) {
        messagePreview = latestMsg.snippet || latestMsg.text || latestMsg.body || '';
        if (messagePreview.length > 200) {
          messagePreview = messagePreview.substring(0, 200) + '...';
        }
      }
    } else if (check.snippet) {
      messagePreview = check.snippet;
    } else if (check.text) {
      messagePreview = check.text;
    }

    // Log the received message in execution log
    const logMessage = messagePreview
      ? `Received reply from ${waitingForContact} via ${integration.name}: "${messagePreview}"`
      : `Received reply from ${waitingForContact} via ${integration.name}`;

    // Update task context with info about new messages so executor knows a reply was received
    await this.deps.updateTask(
      task.id,
      {
        contextMemory: {
          ...task.contextMemory,
          new_reply_detected: true,
          new_reply_count: check.count || 1,
          last_check_time: new Date().toISOString(),
          last_reply_preview: messagePreview,
          recent_messages: messages.slice(0, 5), // Store up to 5 recent messages
        },
        logEntry: logMessage,
      },
      username
    );

    // Proactively notify user that a reply was received
    const win = this.deps.getMainWindow();
    if (win) {
      const displayMessage = messagePreview
        ? `📬 **Task: ${task.title}**\n\nReceived a reply from ${waitingForContact} via ${integration.name}:\n\n> ${messagePreview}\n\nProcessing now...`
        : `📬 **Task: ${task.title}**\n\nReceived a reply from ${waitingForContact} via ${integration.name}! Processing now...`;

      win.webContents.send('chat:newMessage', {
        role: 'assistant',
        content: displayMessage,
        source: 'task',
      });
    }

    // If this is a wait_for_reply workflow, evaluate the reply with LLM
    if (task.contextMemory?.wait_for_reply_active) {
      console.log(`[Tasks] wait_for_reply active - evaluating reply for task ${task.id}`);

      // Get API keys from settings
      const settingsPath = await this.deps.getSettingsPath(username);
      let apiKeys: any = {};
      try {
        const settings = JSON.parse(await this.deps.readFile(settingsPath, 'utf8'));
        apiKeys = settings.apiKeys || {};
      } catch {
        console.error('[Tasks] Could not load API keys for reply evaluation');
      }

      // Get full reply content (prefer full content over snippet)
      let fullReplyContent = messagePreview;
      if (messages[0]) {
        fullReplyContent =
          messages[0].body || messages[0].text || messages[0].snippet || messagePreview;
      }

      const evaluation = await this.evaluateReplyWithLLM(
        {
          replyContent: fullReplyContent,
          originalRequest: task.contextMemory.original_request,
          successCriteria: task.contextMemory.success_criteria,
          contact: waitingForContact,
        },
        apiKeys
      );

      if (evaluation.satisfies) {
        // Reply satisfies criteria - complete the task!
        console.log(`[Tasks] Reply satisfies criteria - completing task ${task.id}`);

        await this.deps.updateTask(
          task.id,
          {
            status: 'completed',
            contextMemory: {
              ...task.contextMemory,
              wait_for_reply_active: false,
              reply_satisfied: true,
              extracted_info: evaluation.extractedInfo,
              completed_at: new Date().toISOString(),
            },
            logEntry: `Reply from ${waitingForContact} satisfied criteria: ${evaluation.reason}`,
          },
          username
        );

        // Notify user of completion
        if (win && !task.notificationsDisabled) {
          const completionMsg = evaluation.extractedInfo
            ? `✅ **Task Completed: ${task.title}**\n\nReceived satisfactory reply from ${waitingForContact}.\n\n**Extracted Information:**\n${evaluation.extractedInfo}`
            : `✅ **Task Completed: ${task.title}**\n\nReceived satisfactory reply from ${waitingForContact}.`;

          win.webContents.send('chat:newMessage', {
            role: 'assistant',
            content: completionMsg,
            source: 'task',
          });
        }

        return task; // Task complete, will be skipped in next iteration
      } else {
        // Reply doesn't satisfy criteria - handle follow-up
        console.log(`[Tasks] Reply doesn't satisfy criteria: ${evaluation.reason}`);
        const currentFollowupCount = task.contextMemory.followup_count || 0;
        const maxFollowups = task.contextMemory.max_followups || 3;

        if (currentFollowupCount >= maxFollowups) {
          // Max follow-ups reached - notify user and pause
          console.log(`[Tasks] Max follow-ups (${maxFollowups}) reached - notifying user`);

          await this.deps.updateTask(
            task.id,
            {
              status: 'waiting_for_input',
              contextMemory: {
                ...task.contextMemory,
                wait_for_reply_active: false,
                max_followups_reached: true,
                last_evaluation_reason: evaluation.reason,
                pendingClarification: `I've sent ${maxFollowups} follow-ups to ${waitingForContact} but haven't received a satisfactory reply. What would you like me to do?`,
              },
              logEntry: `Max follow-ups (${maxFollowups}) reached - asking user for guidance`,
            },
            username
          );

          if (win) {
            win.webContents.send('chat:newMessage', {
              role: 'assistant',
              content: `⚠️ **Task: ${task.title}**\n\nI've sent ${maxFollowups} follow-up messages to ${waitingForContact}, but their responses haven't contained the requested information (${task.contextMemory.original_request}).\n\nLast response: "${messagePreview}"\n\nWhat would you like me to do?\n1. Keep trying\n2. Try a different approach\n3. Cancel this task`,
              source: 'task_question',
              expectsResponse: true,
            });
          }

          return task; // Waiting for user input
        }

        // Send a follow-up message asking for the missing info
        console.log(
          `[Tasks] Sending follow-up #${currentFollowupCount + 1} to ${waitingForContact}`
        );

        // Store that we need to send a follow-up - the actual sending will happen in executeTaskStep
        await this.deps.updateTask(
          task.id,
          {
            contextMemory: {
              ...task.contextMemory,
              followup_count: currentFollowupCount + 1,
              last_followup_time: new Date().toISOString(),
              needs_followup: true,
              followup_reason: evaluation.reason,
              last_reply_content: fullReplyContent,
            },
            logEntry: `Reply from ${waitingForContact} didn't satisfy criteria - preparing follow-up #${currentFollowupCount + 1}: ${evaluation.reason}`,
          },
          username
        );

        // Refresh task and return it for execution
        return await this.deps.getTask(task.id, username);
      }
    }

    return task;
  }

  /**
   * Handle wait_for_reply timeout logic
   * @returns true if follow-up needed (should continue to execution), false if should skip
   */
  private static async handleWaitForReplyTimeout(
    task: Task,
    waitingForContact: string,
    username: string
  ): Promise<boolean> {
    if (!this.deps) {
      return false;
    }

    const waitStartTime = task.contextMemory.wait_started_at;
    const followupAfterMs = (task.contextMemory.followup_after_hours || 24) * 60 * 60 * 1000;
    const lastFollowupTime = task.contextMemory.last_followup_time;
    const timeSinceStart = Date.now() - new Date(waitStartTime).getTime();
    const timeSinceLastFollowup = lastFollowupTime
      ? Date.now() - new Date(lastFollowupTime).getTime()
      : timeSinceStart;

    // Check if we've waited long enough since last followup/start
    if (timeSinceLastFollowup >= followupAfterMs) {
      const currentFollowupCount = task.contextMemory.followup_count || 0;
      const maxFollowups = task.contextMemory.max_followups || 3;

      if (currentFollowupCount >= maxFollowups) {
        // Max follow-ups reached with no reply - notify user
        console.log(
          `[Tasks] wait_for_reply timeout: max follow-ups (${maxFollowups}) reached for task ${task.id}`
        );

        await this.deps.updateTask(
          task.id,
          {
            status: 'waiting_for_input',
            contextMemory: {
              ...task.contextMemory,
              wait_for_reply_active: false,
              max_followups_reached: true,
              timeout_reached: true,
              pendingClarification: `I've sent ${maxFollowups} follow-ups to ${waitingForContact} over the past ${Math.round(timeSinceStart / (1000 * 60 * 60))} hours but haven't received a reply. What would you like me to do?`,
            },
            logEntry: `Timeout: No reply after ${maxFollowups} follow-ups - asking user for guidance`,
          },
          username
        );

        const win = this.deps.getMainWindow();
        if (win) {
          win.webContents.send('chat:newMessage', {
            role: 'assistant',
            content: `⚠️ **Task: ${task.title}**\n\nI've sent ${maxFollowups} follow-up messages to ${waitingForContact} over the past ${Math.round(timeSinceStart / (1000 * 60 * 60))} hours, but haven't received a reply.\n\nOriginal request: "${task.contextMemory.original_request}"\n\nWhat would you like me to do?\n1. Keep trying\n2. Try a different approach\n3. Cancel this task`,
            source: 'task_question',
            expectsResponse: true,
          });
        }

        return false; // Don't execute, waiting for user input
      }

      // Send timeout follow-up
      console.log(
        `[Tasks] wait_for_reply timeout - sending follow-up #${currentFollowupCount + 1} to ${waitingForContact}`
      );

      // Mark that we need to send a follow-up due to timeout
      await this.deps.updateTask(
        task.id,
        {
          contextMemory: {
            ...task.contextMemory,
            needs_followup: true,
            followup_is_timeout: true,
            followup_reason: `No reply received after ${Math.round(timeSinceLastFollowup / (1000 * 60 * 60))} hours`,
          },
          logEntry: `No reply in ${Math.round(timeSinceLastFollowup / (1000 * 60 * 60))} hours - preparing timeout follow-up #${currentFollowupCount + 1}`,
        },
        username
      );

      return true; // Continue to executeTaskStep to handle the follow-up
    } else {
      // Not yet time for follow-up - reschedule
      const pollInterval =
        task.pollFrequency?.type === 'event' ? null : task.pollFrequency?.value || 60000;
      console.log(
        `[Tasks] No new messages from ${waitingForContact}, rescheduling in ${pollInterval ? pollInterval / 1000 + 's' : 'event-based'}`
      );
      if (pollInterval) {
        await this.deps.updateTask(
          task.id,
          {
            nextCheck: Date.now() + pollInterval,
            contextMemory: { ...task.contextMemory, last_check_time: new Date().toISOString() },
          },
          username
        );
      }
      return false; // Don't execute yet
    }
  }

  /**
   * Handle legacy email checking (backward compatibility)
   * @returns true if should execute task, false if should skip
   */
  private static async handleLegacyEmail(
    task: Task,
    waitingForEmail: string,
    googleAccessToken: string,
    lastCheckTime: string,
    username: string
  ): Promise<boolean> {
    if (!this.deps) {
      return false;
    }

    console.log(`[Tasks] Legacy email check for task ${task.id}: waiting for ${waitingForEmail}`);
    const emailCheck = await this.deps.checkForNewEmails(
      googleAccessToken,
      waitingForEmail,
      new Date(lastCheckTime).getTime()
    );

    if (!emailCheck.hasNew) {
      // Reschedule using task's poll frequency
      const pollInterval =
        task.pollFrequency?.type === 'event' ? null : task.pollFrequency?.value || 60000;
      console.log(
        `[Tasks] No new emails from ${waitingForEmail}, rescheduling in ${pollInterval ? pollInterval / 1000 + 's' : 'event-based'}`
      );
      if (pollInterval) {
        await this.deps.updateTask(
          task.id,
          {
            nextCheck: Date.now() + pollInterval,
            contextMemory: { ...task.contextMemory, last_email_check: new Date().toISOString() },
          },
          username
        );
      }
      return false;
    }

    console.log(`[Tasks] New email found from ${waitingForEmail}! Running task executor.`);
    return true;
  }

  /**
   * Use LLM to evaluate if a reply satisfies the success criteria
   */
  private static async evaluateReplyWithLLM(
    params: EvaluationParams,
    apiKeys: any
  ): Promise<EvaluationResult> {
    const { replyContent, originalRequest, successCriteria, contact } = params;

    const prompt = `You are evaluating whether a reply satisfies specific success criteria.

**Original Request:** ${originalRequest}

**Success Criteria:** ${successCriteria}

**Reply from ${contact}:**
${replyContent}

Determine:
1. Does this reply satisfy the success criteria? (yes/no)
2. Why or why not?
3. If yes, extract any key information requested in the original request.

Respond in JSON format:
{
  "satisfies": true/false,
  "reason": "explanation",
  "extractedInfo": "key information if satisfies=true, otherwise null"
}`;

    try {
      if (!apiKeys.anthropic) {
        throw new Error('No Anthropic API key available');
      }

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKeys.anthropic,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1000,
          temperature: 0.1,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }

      const data: any = await response.json();
      const content = data.content?.[0]?.text || '';
      const jsonMatch = content.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          satisfies: parsed.satisfies || false,
          reason: parsed.reason || 'No reason provided',
          extractedInfo: parsed.extractedInfo || undefined,
        };
      }

      // Fallback if no JSON found
      return {
        satisfies: false,
        reason: 'Could not parse LLM response',
      };
    } catch (err: any) {
      console.error('[Tasks] Error evaluating reply with LLM:', err.message);
      return {
        satisfies: false,
        reason: `Error evaluating reply: ${err.message}`,
      };
    }
  }
}
