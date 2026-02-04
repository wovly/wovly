/**
 * Task Updates - Tracking and notification system
 */

// Track task updates for notifications
let taskUpdates = [];
let mainWindow = null;

// Set the main window reference for notifications
const setMainWindow = (win) => {
  mainWindow = win;
};

/**
 * Add a task update and optionally send to main chat
 * @param {string} taskId - The task ID
 * @param {string} message - Update message
 * @param {Object} options - Optional settings
 * @param {boolean} options.toChat - Also send to main chat (default: false)
 * @param {string} options.emoji - Emoji prefix for chat message (default: 📋)
 * @param {string} options.taskTitle - Task title for chat display
 */
const addTaskUpdate = (taskId, message, options = {}) => {
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

const getTaskUpdates = () => {
  const updates = [...taskUpdates];
  taskUpdates = []; // Clear after reading
  return updates;
};

module.exports = {
  setMainWindow,
  addTaskUpdate,
  getTaskUpdates
};
