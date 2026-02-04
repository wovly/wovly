/**
 * Time Tools - get_current_time and send_reminder
 */

// Time-related tools for task scheduling
const timeTools = [
  {
    name: "get_current_time",
    description: "Get the current date and time. Use this to check if it's time for a scheduled action.",
    schema: {
      type: "object",
      properties: {
        timezone: {
          type: "string",
          description: "Timezone (e.g., 'America/New_York'). Defaults to local timezone."
        }
      },
      required: []
    }
  },
  {
    name: "send_reminder",
    description: "Send a reminder message to the user in the chat. Use this for time-based reminders.",
    schema: {
      type: "object",
      properties: {
        message: {
          type: "string",
          description: "The reminder message to display to the user"
        }
      },
      required: ["message"]
    }
  }
];

/**
 * Execute time-related tools
 */
async function executeTimeTool(toolName, toolInput, context = {}) {
  const { mainWindow } = context;
  
  switch (toolName) {
    case "get_current_time": {
      const now = new Date();
      const timezone = toolInput.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
      
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });
      
      return {
        success: true,
        timestamp: now.toISOString(),
        formatted: formatter.format(now),
        timezone: timezone,
        hour: now.getHours(),
        minute: now.getMinutes(),
        dayOfWeek: now.toLocaleDateString('en-US', { weekday: 'long' })
      };
    }
    
    case "send_reminder": {
      const message = toolInput.message;
      
      if (!message) {
        return { success: false, error: "No message provided" };
      }
      
      // Send to main chat window
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("chat:newMessage", {
          role: "assistant",
          content: `⏰ **Reminder**\n\n${message}`,
          source: "reminder"
        });
      }
      
      console.log(`[Reminder] Sent: ${message}`);
      return { success: true, message: "Reminder sent to user" };
    }
    
    default:
      return { success: false, error: `Unknown time tool: ${toolName}` };
  }
}

module.exports = {
  timeTools,
  executeTimeTool
};
