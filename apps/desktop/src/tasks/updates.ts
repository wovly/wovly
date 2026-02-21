/**
 * Task Updates - Tracking and notification system
 */

import type { BrowserWindow } from 'electron';

/**
 * Task update entry
 */
export interface TaskUpdate {
  taskId: string;
  message: string;
  timestamp: string;
}

/**
 * Options for adding task updates
 */
export interface AddTaskUpdateOptions {
  toChat?: boolean;
  emoji?: string;
  taskTitle?: string | null;
}

// Track task updates for notifications
let taskUpdates: TaskUpdate[] = [];
let mainWindow: BrowserWindow | null = null;

/**
 * Set the main window reference for notifications
 */
export const setMainWindow = (win: BrowserWindow): void => {
  mainWindow = win;
};

/**
 * Add a task update and optionally send to main chat
 */
export const addTaskUpdate = (
  taskId: string,
  message: string,
  options: AddTaskUpdateOptions = {}
): void => {
  const { toChat = false, emoji = "📋", taskTitle = null } = options;

  taskUpdates.push({
    taskId,
    message,
    timestamp: new Date().toISOString()
  });

  // Keep only last 50 updates
  if (taskUpdates.length > 50) {
    taskUpdates = taskUpdates.slice(-50);
  }

  // Notify renderer - tasks panel
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("task:update", { taskId, message });

    // Also send to main chat if requested
    if (toChat) {
      const chatMessage = taskTitle
        ? `${emoji} **Task: ${taskTitle}**\n\n${message}`
        : `${emoji} **Task Update**\n\n${message}`;

      console.log(`[Tasks] Sending to chat: ${chatMessage.slice(0, 100)}...`);
      mainWindow.webContents.send("chat:newMessage", {
        role: "assistant",
        content: chatMessage,
        source: "task",
        taskId
      });
    }
  } else {
    console.log(`[Tasks] Cannot send update - window not available`);
  }
};

/**
 * Get all task updates and clear the list
 */
export const getTaskUpdates = (): TaskUpdate[] => {
  const updates = [...taskUpdates];
  taskUpdates = []; // Clear after reading
  return updates;
};
