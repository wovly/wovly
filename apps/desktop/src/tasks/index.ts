/**
 * Tasks Module - Re-exports all task-related functionality
 */

import * as storage from "./storage";
import * as updates from "./updates";

export {
  // Storage exports
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
} from "./storage";

export {
  // Updates exports
  setMainWindow,
  addTaskUpdate,
  getTaskUpdates
} from "./updates";

// Re-export types
export type {
  PollFrequency,
  PollFrequencyPresetType,
  TaskStatus,
  TaskType,
  CurrentStep,
  ExecutionLogEntry,
  PendingMessage,
  StructuredPlanStep,
  Task,
  CreateTaskData,
  UpdateTaskData
} from "./storage";

export type {
  TaskUpdate,
  AddTaskUpdateOptions
} from "./updates";
