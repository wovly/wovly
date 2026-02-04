/**
 * Task Primitive Tools - Fundamental building blocks for programmable tasks
 * 
 * These tools enable the Builder to create sophisticated task workflows with:
 * - Variable management (save/read/check state)
 * - Time comparisons (for polling-based execution)
 * - Control flow (conditions, jumps, completion)
 * - String manipulation (formatting, counters)
 * - Logging and notifications
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tool Definitions
// ─────────────────────────────────────────────────────────────────────────────

const taskPrimitiveTools = [
  // ─────────────────────────────────────────────────────────────────────────────
  // Variable Management Tools
  // ─────────────────────────────────────────────────────────────────────────────
  {
    name: "save_variable",
    description: "Save a named variable to the task's persistent memory. Use for storing values like alarm times, user preferences, counters, flags, or any data needed across poll cycles. Variables persist in the task markdown file.",
    input_schema: {
      type: "object",
      properties: {
        name: { 
          type: "string", 
          description: "Variable name (e.g., 'alarm_time', 'reminder_count', 'last_check_date', 'reminded_today')" 
        },
        value: { 
          type: "string", 
          description: "Value to store (will be stored as string)" 
        },
        description: { 
          type: "string", 
          description: "Optional description of what this variable is for" 
        }
      },
      required: ["name", "value"]
    }
  },
  {
    name: "get_variable",
    description: "Read a previously saved variable from task memory. Returns the value if it exists, or null if the variable hasn't been set yet.",
    input_schema: {
      type: "object",
      properties: {
        name: { 
          type: "string", 
          description: "Variable name to read" 
        }
      },
      required: ["name"]
    }
  },
  {
    name: "check_variable",
    description: "Check if a variable exists and optionally compare its value. Returns exists (boolean) and optionally matches (boolean) if comparison is specified.",
    input_schema: {
      type: "object",
      properties: {
        name: { 
          type: "string", 
          description: "Variable name to check" 
        },
        equals: { 
          type: "string", 
          description: "Optional: check if value equals this" 
        },
        not_equals: { 
          type: "string", 
          description: "Optional: check if value does not equal this" 
        }
      },
      required: ["name"]
    }
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Time Comparison Tools
  // ─────────────────────────────────────────────────────────────────────────────
  {
    name: "parse_time",
    description: "Parse a time string (e.g., '12pm', '14:30', '6:55 PM') into normalized components. Useful for extracting hour/minute from user input.",
    input_schema: {
      type: "object",
      properties: {
        time_string: { 
          type: "string", 
          description: "Time to parse (e.g., '12pm', '2:30 PM', '14:00', '6:55pm')" 
        }
      },
      required: ["time_string"]
    }
  },
  {
    name: "check_time_passed",
    description: "Check if the current time has passed a target time TODAY. Essential for the polling model where we check repeatedly and may overshoot the target. Returns whether the target time has been reached.",
    input_schema: {
      type: "object",
      properties: {
        target_hour: { 
          type: "number", 
          description: "Target hour in 24-hour format (0-23)" 
        },
        target_minute: { 
          type: "number", 
          description: "Target minute (0-59). Defaults to 0 if not specified." 
        },
        tolerance_minutes: { 
          type: "number", 
          description: "How many minutes past target is still considered valid for triggering action (default: 60). After this window, assume we missed it for today." 
        }
      },
      required: ["target_hour"]
    }
  },
  {
    name: "is_new_day",
    description: "Check if it's a new calendar day since the last recorded date. Essential for daily recurring tasks to reset flags at midnight.",
    input_schema: {
      type: "object",
      properties: {
        last_date: { 
          type: "string", 
          description: "Last recorded date in YYYY-MM-DD format (from a saved variable)" 
        }
      },
      required: ["last_date"]
    }
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Control Flow Tools
  // ─────────────────────────────────────────────────────────────────────────────
  {
    name: "evaluate_condition",
    description: "Evaluate a comparison condition and return true/false. Use for decision-making within tasks. Supports numeric and string comparisons.",
    input_schema: {
      type: "object",
      properties: {
        left: { 
          type: "string", 
          description: "Left operand (value or variable reference)" 
        },
        operator: { 
          type: "string",
          enum: ["==", "!=", ">", "<", ">=", "<=", "contains", "starts_with", "ends_with"],
          description: "Comparison operator" 
        },
        right: { 
          type: "string", 
          description: "Right operand (value or variable reference)" 
        }
      },
      required: ["left", "operator", "right"]
    }
  },
  {
    name: "goto_step",
    description: "Set which step to execute next in the task plan. Use for creating loops (go back to step 1) or skipping steps based on conditions. The task executor will jump to this step on the next iteration.",
    input_schema: {
      type: "object",
      properties: {
        step_number: { 
          type: "number", 
          description: "Step number to go to (1-indexed)" 
        },
        reason: { 
          type: "string", 
          description: "Why we're jumping to this step (for logging)" 
        }
      },
      required: ["step_number"]
    }
  },
  {
    name: "complete_task",
    description: "Mark the task as completed successfully. Use when the task's goal has been achieved. For discrete tasks only - continuous tasks should not use this.",
    input_schema: {
      type: "object",
      properties: {
        summary: { 
          type: "string", 
          description: "Summary of what was accomplished" 
        }
      },
      required: ["summary"]
    }
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // String/Data Manipulation Tools
  // ─────────────────────────────────────────────────────────────────────────────
  {
    name: "format_string",
    description: "Format a template string by substituting placeholders with values. Use {placeholder} syntax in the template.",
    input_schema: {
      type: "object",
      properties: {
        template: { 
          type: "string", 
          description: "Template string with {placeholder} syntax (e.g., 'Hello {name}, it is {time}')" 
        },
        variables: { 
          type: "object", 
          description: "Key-value pairs to substitute into the template" 
        }
      },
      required: ["template", "variables"]
    }
  },
  {
    name: "increment_counter",
    description: "Increment a numeric counter variable by a specified amount. Creates the variable with value 0 if it doesn't exist, then increments it.",
    input_schema: {
      type: "object",
      properties: {
        name: { 
          type: "string", 
          description: "Counter variable name" 
        },
        amount: { 
          type: "number", 
          description: "Amount to increment by (default: 1). Use negative for decrement." 
        }
      },
      required: ["name"]
    }
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Logging/Communication Tools
  // ─────────────────────────────────────────────────────────────────────────────
  {
    name: "log_event",
    description: "Add an entry to the task's execution log. Useful for debugging, audit trails, and tracking task progress.",
    input_schema: {
      type: "object",
      properties: {
        message: { 
          type: "string", 
          description: "Log message to record" 
        },
        level: { 
          type: "string",
          enum: ["info", "warning", "error", "debug"],
          description: "Log level (default: info)" 
        }
      },
      required: ["message"]
    }
  },
  {
    name: "notify_user",
    description: "Send a notification message to the user in the chat. Use for status updates, confirmations, or questions. Different from send_reminder which is specifically for time-based alerts.",
    input_schema: {
      type: "object",
      properties: {
        message: { 
          type: "string", 
          description: "Notification message to display" 
        },
        type: { 
          type: "string",
          enum: ["info", "success", "warning", "question"],
          description: "Notification type (affects styling)" 
        }
      },
      required: ["message"]
    }
  },
  {
    name: "send_chat_message",
    description: "Send a general message to the user in the main chat window. Use for task completion messages, progress updates, or any communication that doesn't fit reminder or notification patterns.",
    input_schema: {
      type: "object",
      properties: {
        message: { 
          type: "string", 
          description: "The message to send to the chat" 
        },
        format: {
          type: "string",
          enum: ["plain", "markdown"],
          description: "Message format (default: markdown)"
        }
      },
      required: ["message"]
    }
  },
  {
    name: "ask_user_question",
    description: "Ask the user a question and wait for their response. The task will pause until the user replies. Use when you need user input, clarification, or a decision. The response will be available for subsequent steps.",
    input_schema: {
      type: "object",
      properties: {
        question: { 
          type: "string", 
          description: "The question to ask the user" 
        },
        save_response_as: { 
          type: "string", 
          description: "Variable name to save the user's response (e.g., 'user_choice', 'preferred_time'). The response will be stored in task memory." 
        },
        options: {
          type: "array",
          items: { type: "string" },
          description: "Optional: list of suggested options for the user to choose from"
        }
      },
      required: ["question"]
    }
  }
];

// ─────────────────────────────────────────────────────────────────────────────
// Tool Executor
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute a task primitive tool
 * @param {string} toolName - Name of the tool to execute
 * @param {Object} toolInput - Tool input parameters
 * @param {Object} context - Execution context (taskContext, mainWindow, etc.)
 * @returns {Object} Tool result
 */
async function executeTaskPrimitiveTool(toolName, toolInput, context = {}) {
  const { taskContext = {}, mainWindow } = context;
  
  console.log(`[TaskPrimitive] Executing ${toolName}:`, JSON.stringify(toolInput));
  
  try {
    switch (toolName) {
      // ─────────────────────────────────────────────────────────────────────────
      // Variable Management
      // ─────────────────────────────────────────────────────────────────────────
      
      case "save_variable": {
        const { name, value, description } = toolInput;
        if (!name) {
          return { success: false, error: "Variable name is required" };
        }
        
        // Store in task context for the executor to persist
        const result = {
          success: true,
          action: "save_variable",
          name,
          value: String(value),
          description: description || null,
          message: `Saved variable '${name}' = '${value}'`
        };
        
        // The executor will read this and update contextMemory
        console.log(`[TaskPrimitive] Saved variable: ${name} = ${value}`);
        return result;
      }
      
      case "get_variable": {
        const { name } = toolInput;
        if (!name) {
          return { success: false, error: "Variable name is required" };
        }
        
        // Read from task context
        const value = taskContext.contextMemory?.[name] ?? null;
        const exists = value !== null && value !== undefined;
        
        console.log(`[TaskPrimitive] Get variable: ${name} = ${value} (exists: ${exists})`);
        return {
          success: true,
          name,
          value,
          exists,
          message: exists ? `Variable '${name}' = '${value}'` : `Variable '${name}' not found`
        };
      }
      
      case "check_variable": {
        const { name, equals, not_equals } = toolInput;
        if (!name) {
          return { success: false, error: "Variable name is required" };
        }
        
        const value = taskContext.contextMemory?.[name] ?? null;
        const exists = value !== null && value !== undefined;
        
        let matches = null;
        if (equals !== undefined) {
          matches = String(value) === String(equals);
        } else if (not_equals !== undefined) {
          matches = String(value) !== String(not_equals);
        }
        
        console.log(`[TaskPrimitive] Check variable: ${name} exists=${exists}, matches=${matches}`);
        return {
          success: true,
          name,
          value,
          exists,
          matches,
          message: exists 
            ? (matches !== null 
                ? `Variable '${name}' = '${value}', matches=${matches}` 
                : `Variable '${name}' exists with value '${value}'`)
            : `Variable '${name}' does not exist`
        };
      }
      
      // ─────────────────────────────────────────────────────────────────────────
      // Time Comparison
      // ─────────────────────────────────────────────────────────────────────────
      
      case "parse_time": {
        const { time_string } = toolInput;
        if (!time_string) {
          return { success: false, error: "time_string is required" };
        }
        
        const parsed = parseTimeString(time_string);
        if (!parsed) {
          return { success: false, error: `Could not parse time: '${time_string}'` };
        }
        
        console.log(`[TaskPrimitive] Parsed time: ${time_string} -> ${parsed.hour}:${parsed.minute}`);
        return {
          success: true,
          ...parsed,
          message: `Parsed '${time_string}' as ${parsed.formatted_12h} (${parsed.formatted_24h})`
        };
      }
      
      case "check_time_passed": {
        const { target_hour, target_minute = 0, tolerance_minutes = 60 } = toolInput;
        if (target_hour === undefined || target_hour === null) {
          return { success: false, error: "target_hour is required" };
        }
        
        const now = new Date();
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        const currentTotalMinutes = currentHour * 60 + currentMinute;
        const targetTotalMinutes = target_hour * 60 + target_minute;
        
        const minutesPast = currentTotalMinutes - targetTotalMinutes;
        const passed = minutesPast >= 0;
        const withinWindow = passed && minutesPast <= tolerance_minutes;
        
        const currentTimeStr = `${String(currentHour).padStart(2, '0')}:${String(currentMinute).padStart(2, '0')}`;
        const targetTimeStr = `${String(target_hour).padStart(2, '0')}:${String(target_minute).padStart(2, '0')}`;
        
        console.log(`[TaskPrimitive] Check time: current=${currentTimeStr}, target=${targetTimeStr}, passed=${passed}, withinWindow=${withinWindow}`);
        return {
          success: true,
          passed,
          within_window: withinWindow,
          current_time: currentTimeStr,
          target_time: targetTimeStr,
          minutes_past: minutesPast,
          tolerance_minutes,
          message: passed 
            ? (withinWindow 
                ? `Target time ${targetTimeStr} passed ${minutesPast} minutes ago (within ${tolerance_minutes}min window)` 
                : `Target time ${targetTimeStr} passed ${minutesPast} minutes ago (outside window)`)
            : `Target time ${targetTimeStr} not reached yet (${-minutesPast} minutes remaining)`
        };
      }
      
      case "is_new_day": {
        const { last_date } = toolInput;
        if (!last_date) {
          return { success: false, error: "last_date is required" };
        }
        
        const now = new Date();
        const currentDate = now.toISOString().split('T')[0]; // YYYY-MM-DD
        const isNewDay = currentDate !== last_date;
        
        console.log(`[TaskPrimitive] Is new day: current=${currentDate}, last=${last_date}, isNew=${isNewDay}`);
        return {
          success: true,
          is_new_day: isNewDay,
          current_date: currentDate,
          last_date,
          message: isNewDay 
            ? `New day detected: ${currentDate} (was ${last_date})` 
            : `Same day: ${currentDate}`
        };
      }
      
      // ─────────────────────────────────────────────────────────────────────────
      // Control Flow
      // ─────────────────────────────────────────────────────────────────────────
      
      case "evaluate_condition": {
        const { left, operator, right } = toolInput;
        if (!operator) {
          return { success: false, error: "operator is required" };
        }
        
        let result = false;
        const leftStr = String(left ?? '');
        const rightStr = String(right ?? '');
        
        // Try numeric comparison first
        const leftNum = parseFloat(left);
        const rightNum = parseFloat(right);
        const bothNumeric = !isNaN(leftNum) && !isNaN(rightNum);
        
        switch (operator) {
          case "==":
            result = bothNumeric ? leftNum === rightNum : leftStr === rightStr;
            break;
          case "!=":
            result = bothNumeric ? leftNum !== rightNum : leftStr !== rightStr;
            break;
          case ">":
            result = bothNumeric ? leftNum > rightNum : leftStr > rightStr;
            break;
          case "<":
            result = bothNumeric ? leftNum < rightNum : leftStr < rightStr;
            break;
          case ">=":
            result = bothNumeric ? leftNum >= rightNum : leftStr >= rightStr;
            break;
          case "<=":
            result = bothNumeric ? leftNum <= rightNum : leftStr <= rightStr;
            break;
          case "contains":
            result = leftStr.includes(rightStr);
            break;
          case "starts_with":
            result = leftStr.startsWith(rightStr);
            break;
          case "ends_with":
            result = leftStr.endsWith(rightStr);
            break;
          default:
            return { success: false, error: `Unknown operator: ${operator}` };
        }
        
        const expression = `${left} ${operator} ${right}`;
        console.log(`[TaskPrimitive] Evaluate: ${expression} = ${result}`);
        return {
          success: true,
          result,
          expression,
          message: `Condition '${expression}' evaluated to ${result}`
        };
      }
      
      case "goto_step": {
        const { step_number, reason } = toolInput;
        if (!step_number || step_number < 1) {
          return { success: false, error: "Valid step_number is required (must be >= 1)" };
        }
        
        console.log(`[TaskPrimitive] Goto step: ${step_number} (reason: ${reason || 'not specified'})`);
        return {
          success: true,
          action: "goto_step",
          step_number,
          reason: reason || null,
          message: `Will jump to step ${step_number}${reason ? `: ${reason}` : ''}`
        };
      }
      
      case "complete_task": {
        const { summary } = toolInput;
        if (!summary) {
          return { success: false, error: "summary is required" };
        }
        
        console.log(`[TaskPrimitive] Complete task: ${summary}`);
        return {
          success: true,
          action: "complete_task",
          summary,
          message: `Task completed: ${summary}`
        };
      }
      
      // ─────────────────────────────────────────────────────────────────────────
      // String/Data Manipulation
      // ─────────────────────────────────────────────────────────────────────────
      
      case "format_string": {
        const { template, variables } = toolInput;
        if (!template) {
          return { success: false, error: "template is required" };
        }
        
        let result = template;
        if (variables && typeof variables === 'object') {
          for (const [key, value] of Object.entries(variables)) {
            const placeholder = new RegExp(`\\{${key}\\}`, 'g');
            result = result.replace(placeholder, String(value ?? ''));
          }
        }
        
        console.log(`[TaskPrimitive] Format string: "${template}" -> "${result}"`);
        return {
          success: true,
          result,
          template,
          variables_used: Object.keys(variables || {}),
          message: `Formatted string: "${result}"`
        };
      }
      
      case "increment_counter": {
        const { name, amount = 1 } = toolInput;
        if (!name) {
          return { success: false, error: "name is required" };
        }
        
        // Get current value from context
        const currentValue = taskContext.contextMemory?.[name];
        const previous = currentValue !== undefined ? parseFloat(currentValue) : 0;
        const previousNum = isNaN(previous) ? 0 : previous;
        const current = previousNum + amount;
        
        console.log(`[TaskPrimitive] Increment counter: ${name} ${previousNum} -> ${current}`);
        return {
          success: true,
          action: "save_variable",
          name,
          value: String(current),
          previous: previousNum,
          current,
          amount,
          message: `Counter '${name}' incremented: ${previousNum} -> ${current}`
        };
      }
      
      // ─────────────────────────────────────────────────────────────────────────
      // Logging/Communication
      // ─────────────────────────────────────────────────────────────────────────
      
      case "log_event": {
        const { message, level = "info" } = toolInput;
        if (!message) {
          return { success: false, error: "message is required" };
        }
        
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
        
        console.log(`[TaskPrimitive] Log event: ${logEntry}`);
        return {
          success: true,
          action: "log_event",
          timestamp,
          level,
          message,
          log_entry: logEntry
        };
      }
      
      case "notify_user": {
        const { message, type = "info" } = toolInput;
        if (!message) {
          return { success: false, error: "message is required" };
        }
        
        // Get emoji based on type
        const typeEmoji = {
          info: "ℹ️",
          success: "✅",
          warning: "⚠️",
          question: "❓"
        }[type] || "ℹ️";
        
        // Send to main window if available
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("chat:newMessage", {
            role: "assistant",
            content: `${typeEmoji} ${message}`,
            source: "task_notification"
          });
        }
        
        console.log(`[TaskPrimitive] Notify user [${type}]: ${message}`);
        return {
          success: true,
          type,
          message,
          notified: !!(mainWindow && !mainWindow.isDestroyed())
        };
      }
      
      case "send_chat_message": {
        const { message, format = "markdown" } = toolInput;
        if (!message) {
          return { success: false, error: "message is required" };
        }
        
        // Send to main window if available
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("chat:newMessage", {
            role: "assistant",
            content: message,
            source: "task"
          });
          console.log(`[TaskPrimitive] Send chat message: ${message.slice(0, 100)}...`);
          return {
            success: true,
            message,
            sent: true
          };
        } else {
          console.log(`[TaskPrimitive] Cannot send chat message - window not available`);
          return {
            success: false,
            error: "Main window not available",
            message,
            sent: false
          };
        }
      }
      
      case "ask_user_question": {
        const { question, save_response_as, options } = toolInput;
        if (!question) {
          return { success: false, error: "question is required" };
        }
        
        // Format the question with options if provided
        let formattedQuestion = `❓ **Question from Task**\n\n${question}`;
        if (options && Array.isArray(options) && options.length > 0) {
          formattedQuestion += `\n\n**Options:**\n${options.map((opt, i) => `${i + 1}. ${opt}`).join('\n')}`;
        }
        
        // Send question to main window
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("chat:newMessage", {
            role: "assistant",
            content: formattedQuestion,
            source: "task_question",
            expectsResponse: true
          });
          
          console.log(`[TaskPrimitive] Ask user question: ${question}`);
          console.log(`[TaskPrimitive] Will save response as: ${save_response_as || '(not specified)'}`);
          
          // Return special action to signal waiting for user input
          return {
            success: true,
            action: "wait_for_user_input",
            question,
            save_response_as: save_response_as || null,
            options: options || null,
            message: `Asked user: "${question}" - waiting for response`
          };
        } else {
          console.log(`[TaskPrimitive] Cannot ask question - window not available`);
          return {
            success: false,
            error: "Main window not available",
            question,
            sent: false
          };
        }
      }
      
      default:
        console.log(`[TaskPrimitive] Unknown tool: ${toolName}`);
        return { success: false, error: `Unknown task primitive tool: ${toolName}` };
    }
  } catch (err) {
    console.error(`[TaskPrimitive] Error executing ${toolName}:`, err.message);
    return { success: false, error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a time string into hour and minute components
 * Supports: "12pm", "2:30 PM", "14:00", "6:55pm", etc.
 */
function parseTimeString(timeString) {
  if (!timeString) return null;
  
  const str = timeString.trim().toLowerCase();
  
  // Try 24-hour format first (14:00, 14:30)
  const match24 = str.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    const hour = parseInt(match24[1], 10);
    const minute = parseInt(match24[2], 10);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return formatTimeResult(hour, minute);
    }
  }
  
  // Try 12-hour format with colon (2:30 PM, 12:00 am)
  const match12Colon = str.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/);
  if (match12Colon) {
    let hour = parseInt(match12Colon[1], 10);
    const minute = parseInt(match12Colon[2], 10);
    const isPM = match12Colon[3] === 'pm';
    
    if (hour >= 1 && hour <= 12 && minute >= 0 && minute <= 59) {
      if (isPM && hour !== 12) hour += 12;
      if (!isPM && hour === 12) hour = 0;
      return formatTimeResult(hour, minute);
    }
  }
  
  // Try simple format (12pm, 6am, 2pm)
  const matchSimple = str.match(/^(\d{1,2})\s*(am|pm)$/);
  if (matchSimple) {
    let hour = parseInt(matchSimple[1], 10);
    const isPM = matchSimple[2] === 'pm';
    
    if (hour >= 1 && hour <= 12) {
      if (isPM && hour !== 12) hour += 12;
      if (!isPM && hour === 12) hour = 0;
      return formatTimeResult(hour, 0);
    }
  }
  
  // Try with minutes but no space (6:55pm, 2:30am)
  const matchNoSpace = str.match(/^(\d{1,2}):(\d{2})(am|pm)$/);
  if (matchNoSpace) {
    let hour = parseInt(matchNoSpace[1], 10);
    const minute = parseInt(matchNoSpace[2], 10);
    const isPM = matchNoSpace[3] === 'pm';
    
    if (hour >= 1 && hour <= 12 && minute >= 0 && minute <= 59) {
      if (isPM && hour !== 12) hour += 12;
      if (!isPM && hour === 12) hour = 0;
      return formatTimeResult(hour, minute);
    }
  }
  
  return null;
}

/**
 * Format time result object
 */
function formatTimeResult(hour, minute) {
  const hour12 = hour === 0 ? 12 : (hour > 12 ? hour - 12 : hour);
  const ampm = hour < 12 ? 'AM' : 'PM';
  
  return {
    hour,
    minute,
    formatted_24h: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    formatted_12h: `${hour12}:${String(minute).padStart(2, '0')} ${ampm}`
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  taskPrimitiveTools,
  executeTaskPrimitiveTool,
  parseTimeString
};
