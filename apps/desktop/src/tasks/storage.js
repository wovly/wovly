/**
 * Task Storage Functions - CRUD operations and markdown serialization
 */

const path = require("path");
const fs = require("fs/promises");
const crypto = require("crypto");
const { getUserDataDir } = require("../utils/helpers");
const { loadAllSkills, findBestSkill } = require("../storage/skills");

// Poll frequency presets
const POLL_FREQUENCY_PRESETS = {
  "1min": { type: "preset", value: 60000, label: "Every 1 minute" },
  "5min": { type: "preset", value: 300000, label: "Every 5 minutes" },
  "15min": { type: "preset", value: 900000, label: "Every 15 minutes" },
  "30min": { type: "preset", value: 1800000, label: "Every 30 minutes" },
  "1hour": { type: "preset", value: 3600000, label: "Every hour" },
  "daily": { type: "preset", value: 86400000, label: "Daily" },
  "on_login": { type: "event", value: "on_login", label: "On login only" }
};

const DEFAULT_POLL_FREQUENCY = { type: "preset", value: 60000, label: "Every 1 minute" };

const getTasksDir = async (username) => {
  const dir = await getUserDataDir(username);
  const tasksDir = path.join(dir, "tasks");
  await fs.mkdir(tasksDir, { recursive: true });
  return tasksDir;
};

// Parse task markdown into structured object
const parseTaskMarkdown = (markdown, taskId) => {
  const task = {
    id: taskId,
    title: "",
    status: "pending",
    created: "",
    lastUpdated: "",
    nextCheck: null,
    hidden: false,
    autoSend: false,
    pollFrequency: { ...DEFAULT_POLL_FREQUENCY },
    originalRequest: "",
    plan: [],
    structuredPlan: null, // Array of {step_id, tool, args, description, output_var, dependencies}
    currentStep: {
      step: 1,
      description: "",
      state: "pending",
      pollInterval: null
    },
    executionLog: [],
    contextMemory: {},
    pendingMessages: []
  };

  const lines = markdown.split("\n");
  let currentSection = null;
  let currentPendingMessage = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("## ")) {
      if (currentPendingMessage && currentSection === "pending messages") {
        task.pendingMessages.push(currentPendingMessage);
        currentPendingMessage = null;
      }
      currentSection = line.replace("## ", "").trim().toLowerCase();
      continue;
    }

    if (line.startsWith("# Task:")) {
      task.title = line.replace("# Task:", "").trim();
      continue;
    }

    if (currentSection === "metadata") {
      const match = line.match(/^\s*-\s*\*\*([^*]+)\*\*:\s*(.*)$/);
      if (match) {
        const key = match[1].trim().toLowerCase();
        const value = match[2].trim();
        switch (key) {
          case "status": task.status = value; break;
          case "created": task.created = value; break;
          case "last updated": task.lastUpdated = value; break;
          case "next check": task.nextCheck = value ? new Date(value.split(" ")[0]).getTime() : null; break;
          case "hidden": task.hidden = value.toLowerCase() === "true"; break;
          case "auto-send": task.autoSend = value.toLowerCase() === "true"; break;
          case "poll frequency": {
            const parts = value.split(":");
            if (parts.length >= 3) {
              task.pollFrequency = {
                type: parts[0],
                value: parts[0] === "event" ? parts[1] : parseInt(parts[1]) || 60000,
                label: parts.slice(2).join(":")
              };
            } else if (parts.length === 1 && POLL_FREQUENCY_PRESETS[value]) {
              task.pollFrequency = { ...POLL_FREQUENCY_PRESETS[value] };
            }
            break;
          }
        }
      }
    }

    if (currentSection === "original request") {
      if (line.trim() && !line.startsWith("#")) {
        task.originalRequest += (task.originalRequest ? "\n" : "") + line;
      }
    }

    if (currentSection === "plan") {
      const planMatch = line.match(/^\d+\.\s+(.+)$/);
      if (planMatch) {
        task.plan.push(planMatch[1]);
      }
    }

    if (currentSection === "structured plan") {
      // Structured plan is stored as JSON
      if (line.trim().startsWith("[") || (task._structuredPlanBuffer && !line.startsWith("##"))) {
        task._structuredPlanBuffer = (task._structuredPlanBuffer || "") + line + "\n";
      }
    }

    if (currentSection === "current step") {
      if (line.startsWith("Step:")) {
        task.currentStep.step = parseInt(line.replace("Step:", "").trim()) || 1;
      } else if (line.startsWith("Description:")) {
        task.currentStep.description = line.replace("Description:", "").trim();
      } else if (line.startsWith("State:")) {
        task.currentStep.state = line.replace("State:", "").trim();
      } else if (line.startsWith("Poll Interval:")) {
        task.currentStep.pollInterval = parseInt(line.replace("Poll Interval:", "").trim()) || null;
      }
    }

    if (currentSection === "execution log") {
      const logMatch = line.match(/^\s*-\s*\[([^\]]+)\]\s*(.+)$/);
      if (logMatch) {
        task.executionLog.push({
          timestamp: logMatch[1],
          message: logMatch[2]
        });
      }
    }

    if (currentSection === "context memory") {
      const contextMatch = line.match(/^\s*-\s*([^:]+):\s*(.+)$/);
      if (contextMatch) {
        task.contextMemory[contextMatch[1].trim()] = contextMatch[2].trim();
      }
    }

    if (currentSection === "pending messages") {
      if (line.startsWith("### Message")) {
        if (currentPendingMessage) {
          task.pendingMessages.push(currentPendingMessage);
        }
        currentPendingMessage = {
          id: "", toolName: "", platform: "", recipient: "",
          subject: "", message: "", created: "", toolInput: "{}"
        };
      } else if (currentPendingMessage) {
        const fieldMatch = line.match(/^\s*-\s*\*\*([^*]+)\*\*:\s*(.*)$/);
        if (fieldMatch) {
          const key = fieldMatch[1].trim().toLowerCase();
          const value = fieldMatch[2].trim();
          switch (key) {
            case "id": currentPendingMessage.id = value; break;
            case "tool": currentPendingMessage.toolName = value; break;
            case "platform": currentPendingMessage.platform = value; break;
            case "recipient": currentPendingMessage.recipient = value; break;
            case "subject": currentPendingMessage.subject = value; break;
            case "created": currentPendingMessage.created = value; break;
            case "toolinput": currentPendingMessage.toolInput = value; break;
          }
        } else if (!line.startsWith("```") && !line.startsWith("-") && line.trim()) {
          currentPendingMessage.message += (currentPendingMessage.message ? "\n" : "") + line;
        }
      }
    }
  }

  if (currentPendingMessage && currentSection === "pending messages") {
    task.pendingMessages.push(currentPendingMessage);
  }

  // Parse structured plan JSON if present
  if (task._structuredPlanBuffer) {
    try {
      const jsonMatch = task._structuredPlanBuffer.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        task.structuredPlan = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.error(`[Tasks] Failed to parse structured plan for ${taskId}:`, e.message);
    }
    delete task._structuredPlanBuffer;
  }

  return task;
};

// Serialize task object to markdown
const serializeTask = (task) => {
  const pollFreq = task.pollFrequency || DEFAULT_POLL_FREQUENCY;
  const pollFreqStr = `${pollFreq.type}:${pollFreq.value}:${pollFreq.label}`;
  
  let markdown = `# Task: ${task.title || task.id}

## Metadata
- **Status**: ${task.status || "pending"}
- **Created**: ${task.created || new Date().toISOString()}
- **Last Updated**: ${task.lastUpdated || new Date().toISOString()}
- **Next Check**: ${task.nextCheck ? new Date(task.nextCheck).toISOString() : ""}
- **Hidden**: ${task.hidden ? "true" : "false"}
- **Auto-Send**: ${task.autoSend ? "true" : "false"}
- **Poll Frequency**: ${pollFreqStr}

## Original Request
${task.originalRequest || ""}

## Plan
`;

  if (task.plan && task.plan.length > 0) {
    task.plan.forEach((step, index) => {
      markdown += `${index + 1}. ${step}\n`;
    });
  }

  // Add structured plan if available (for direct execution)
  if (task.structuredPlan && task.structuredPlan.length > 0) {
    markdown += `
## Structured Plan
\`\`\`json
${JSON.stringify(task.structuredPlan, null, 2)}
\`\`\`
`;
  }

  markdown += `
## Current Step
Step: ${task.currentStep?.step || 1}
Description: ${task.currentStep?.description || ""}
State: ${task.currentStep?.state || "pending"}
Poll Interval: ${task.currentStep?.pollInterval || ""}

## Execution Log
`;

  if (task.executionLog && task.executionLog.length > 0) {
    task.executionLog.forEach(entry => {
      markdown += `- [${entry.timestamp}] ${entry.message}\n`;
    });
  }

  markdown += `
## Context Memory
`;

  if (task.contextMemory) {
    for (const [key, value] of Object.entries(task.contextMemory)) {
      markdown += `- ${key}: ${value}\n`;
    }
  }

  markdown += `
## Pending Messages
`;

  if (task.pendingMessages && task.pendingMessages.length > 0) {
    task.pendingMessages.forEach((msg, index) => {
      markdown += `
### Message ${index + 1}
- **ID**: ${msg.id}
- **Tool**: ${msg.toolName}
- **Platform**: ${msg.platform}
- **Recipient**: ${msg.recipient}
${msg.subject ? `- **Subject**: ${msg.subject}\n` : ''}- **Created**: ${msg.created}
- **ToolInput**: ${msg.toolInput || '{}'}

\`\`\`
${msg.message}
\`\`\`
`;
    });
  }

  return markdown;
};

// Create a new task
const createTask = async (taskData, username) => {
  const tasksDir = await getTasksDir(username);
  const taskId = `${taskData.title?.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30) || "task"}-${crypto.randomUUID().slice(0, 8)}`;
  
  // Auto-detect messaging channel
  let messagingChannel = taskData.messagingChannel;
  if (!messagingChannel && taskData.originalRequest) {
    const request = taskData.originalRequest.toLowerCase();
    if (request.includes("slack")) messagingChannel = "slack";
    else if (request.includes("telegram")) messagingChannel = "telegram";
    else if (request.includes("discord")) messagingChannel = "discord";
    else if (request.includes("tweet") || request.match(/\bx\b/) || request.includes("twitter")) messagingChannel = "x";
    else if (request.includes("email") || request.includes("mail") || request.includes("gmail")) messagingChannel = "email";
    else if (request.includes("text") || request.includes("imessage") || request.includes("sms") || request.match(/\bmessage\b/)) messagingChannel = "imessage";
  }
  
  // Try to match a skill
  let matchedSkill = null;
  let skillPlan = taskData.plan && taskData.plan.length > 0 ? taskData.plan : [];
  let skillContext = {};
  
  if (skillPlan.length === 0 && taskData.originalRequest) {
    const request = taskData.originalRequest.toLowerCase();
    if (request.includes("email") || request.includes("mail")) {
      skillPlan = ["Send initial email with the request", "Wait for response", "If no response, send follow-up email", "Process response and complete task"];
    } else if (request.includes("slack")) {
      skillPlan = ["Send initial Slack message", "Wait for response", "If no response, send follow-up", "Process response and complete task"];
    } else if (request.includes("text") || request.includes("imessage") || request.includes("sms")) {
      skillPlan = ["Send initial text message", "Wait for response", "If no response, send follow-up", "Process response and complete task"];
    } else {
      skillPlan = ["Execute the requested action", "Verify completion", "Report results"];
    }
  }
  
  try {
    const skills = await loadAllSkills(username);
    if (skills.length > 0 && taskData.originalRequest) {
      const result = await findBestSkill(taskData.originalRequest, username, skills);
      if (result && result.confidence >= 0.3) {
        matchedSkill = result.skill;
        if (matchedSkill.procedure && matchedSkill.procedure.length > 0) {
          skillPlan = matchedSkill.procedure;
        }
        skillContext = {
          skill_name: matchedSkill.name,
          skill_constraints: matchedSkill.constraints.join("; ")
        };
      }
    }
  } catch (err) {
    console.error(`[Tasks] Error matching skill:`, err.message);
  }
  
  const taskType = taskData.taskType || taskData.task_type || "discrete";
  
  let pollFrequency = { ...DEFAULT_POLL_FREQUENCY };
  if (taskData.pollFrequency) {
    if (typeof taskData.pollFrequency === 'string' && POLL_FREQUENCY_PRESETS[taskData.pollFrequency]) {
      pollFrequency = { ...POLL_FREQUENCY_PRESETS[taskData.pollFrequency] };
    } else if (typeof taskData.pollFrequency === 'object') {
      pollFrequency = taskData.pollFrequency;
    }
  }
  
  const task = {
    id: taskId,
    title: taskData.title || "Untitled Task",
    status: "active",
    taskType: taskType,
    created: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    nextCheck: null,
    pollFrequency: pollFrequency,
    originalRequest: taskData.originalRequest || "",
    messagingChannel: messagingChannel || null,
    plan: skillPlan,
    // Store structured plan with tool calls for direct execution
    structuredPlan: taskData.structuredPlan || null,
    currentStep: {
      step: 1,
      description: skillPlan[0] || "",
      state: "active",
      pollInterval: null
    },
    executionLog: [{
      timestamp: new Date().toISOString(),
      message: `Task created${messagingChannel ? ` (using ${messagingChannel})` : ""}${matchedSkill ? ` (skill: ${matchedSkill.name})` : ""}${taskType === "continuous" ? " (continuous monitoring)" : ""}${taskData.structuredPlan ? " (direct execution)" : ""} [Poll: ${pollFrequency.label}]`
    }],
    contextMemory: {
      ...taskData.context,
      ...(messagingChannel ? { messaging_channel: messagingChannel } : {}),
      ...skillContext,
      ...(taskType === "continuous" ? {
        task_type: "continuous",
        monitoring_condition: taskData.monitoringCondition || taskData.monitoring_condition || null,
        trigger_action: taskData.triggerAction || taskData.trigger_action || null
      } : {
        task_type: "discrete",
        success_criteria: taskData.successCriteria || taskData.success_criteria || null
      })
    }
  };

  const markdown = serializeTask(task);
  const taskPath = path.join(tasksDir, `${taskId}.md`);
  await fs.writeFile(taskPath, markdown, "utf8");
  
  console.log(`[Tasks] Created task: ${taskId}`);
  return task;
};

// Get a single task by ID
const getTask = async (taskId, username) => {
  const tasksDir = await getTasksDir(username);
  const taskPath = path.join(tasksDir, `${taskId}.md`);
  
  try {
    const markdown = await fs.readFile(taskPath, "utf8");
    return parseTaskMarkdown(markdown, taskId);
  } catch (err) {
    console.error(`[Tasks] Failed to read task ${taskId}:`, err.message);
    return null;
  }
};

// Update a task
const updateTask = async (taskId, updates, username) => {
  const task = await getTask(taskId, username);
  if (!task) {
    return { error: `Task ${taskId} not found` };
  }

  if (updates.status !== undefined) task.status = updates.status;
  if (updates.nextCheck !== undefined) task.nextCheck = updates.nextCheck;
  if (updates.hidden !== undefined) task.hidden = updates.hidden;
  if (updates.currentStep) {
    task.currentStep = { ...task.currentStep, ...updates.currentStep };
  }
  if (updates.contextMemory) {
    task.contextMemory = { ...task.contextMemory, ...updates.contextMemory };
  }
  if (updates.plan) {
    task.plan = updates.plan;
  }
  
  if (updates.logEntry) {
    task.executionLog.push({
      timestamp: new Date().toISOString(),
      message: updates.logEntry
    });
  }

  task.lastUpdated = new Date().toISOString();

  const tasksDir = await getTasksDir(username);
  const taskPath = path.join(tasksDir, `${taskId}.md`);
  await fs.writeFile(taskPath, serializeTask(task), "utf8");
  
  console.log(`[Tasks] Updated task: ${taskId}`);
  return task;
};

// List all tasks
const listTasks = async (username) => {
  const tasksDir = await getTasksDir(username);
  
  try {
    const files = await fs.readdir(tasksDir);
    const tasks = [];
    
    for (const file of files) {
      if (file.endsWith(".md")) {
        const taskId = file.replace(".md", "");
        const task = await getTask(taskId, username);
        if (task) tasks.push(task);
      }
    }
    
    const visibleTasks = tasks.filter(t => !t.hidden);
    visibleTasks.sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated));
    return visibleTasks;
  } catch (err) {
    console.error("[Tasks] Failed to list tasks:", err.message);
    return [];
  }
};

// List only active/waiting tasks
const listActiveTasks = async (username) => {
  const tasks = await listTasks(username);
  return tasks.filter(t => t.status === "active" || t.status === "waiting");
};

// Get tasks waiting for user input
const getTasksWaitingForInput = async (username) => {
  const tasks = await listTasks(username);
  return tasks.filter(t => t.status === "waiting_for_input");
};

// Cancel a task
const cancelTask = async (taskId, username) => {
  const task = await getTask(taskId, username);
  if (!task) {
    return { error: `Task ${taskId} not found` };
  }

  await updateTask(taskId, {
    status: "cancelled",
    logEntry: "Task cancelled by user"
  }, username);
  
  console.log(`[Tasks] Cancelled task: ${taskId}`);
  return { success: true };
};

// Hide a task
const hideTask = async (taskId, username) => {
  const task = await getTask(taskId, username);
  if (!task) {
    return { error: `Task ${taskId} not found` };
  }

  await updateTask(taskId, {
    hidden: true,
    logEntry: "Task hidden from UI"
  }, username);
  
  console.log(`[Tasks] Hidden task: ${taskId}`);
  return { success: true };
};

// Get raw markdown
const getTaskRawMarkdown = async (taskId, username) => {
  const tasksDir = await getTasksDir(username);
  const taskPath = path.join(tasksDir, `${taskId}.md`);
  
  try {
    return await fs.readFile(taskPath, "utf8");
  } catch (err) {
    return { error: `Task ${taskId} not found` };
  }
};

// Save raw markdown
const saveTaskRawMarkdown = async (taskId, markdown, username) => {
  if (!markdown.includes("## Metadata") || !markdown.includes("**Status**")) {
    return { error: "Invalid markdown format" };
  }

  const tasksDir = await getTasksDir(username);
  const taskPath = path.join(tasksDir, `${taskId}.md`);
  
  try {
    await fs.writeFile(taskPath, markdown, "utf8");
    return { success: true };
  } catch (err) {
    return { error: `Failed to save: ${err.message}` };
  }
};

module.exports = {
  POLL_FREQUENCY_PRESETS,
  DEFAULT_POLL_FREQUENCY,
  getTasksDir,
  parseTaskMarkdown,
  serializeTask,
  createTask,
  getTask,
  updateTask,
  listTasks,
  listActiveTasks,
  getTasksWaitingForInput,
  cancelTask,
  hideTask,
  getTaskRawMarkdown,
  saveTaskRawMarkdown
};
