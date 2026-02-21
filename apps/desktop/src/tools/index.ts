/**
 * Tools Module - Tool definitions and executors
 *
 * Note: The full tool definitions are still in main.js due to their size (~7,000 lines).
 * This module exports time tools and task primitive tools.
 */

import { timeTools, executeTimeTool } from "./time";
import { taskPrimitiveTools, executeTaskPrimitiveTool, parseTimeString } from "./task-primitives";

export {
  // Time tools
  timeTools,
  executeTimeTool,

  // Task primitive tools (variables, control flow, etc.)
  taskPrimitiveTools,
  executeTaskPrimitiveTool,
  parseTimeString
};

// Re-export types
export type {
  Tool as TimeTool,
  GetCurrentTimeInput,
  SendReminderInput,
  GetCurrentTimeResult,
  SendReminderResult,
  ToolContext as TimeToolContext
} from "./time";

export type {
  Tool as TaskPrimitiveTool,
  TaskContext,
  ToolExecutorContext,
  TimeParseResult,
  ToolResult as TaskPrimitiveToolResult,
  SaveVariableResult,
  GetVariableResult,
  CheckVariableResult,
  ParseTimeResult,
  CheckTimePassedResult,
  IsNewDayResult,
  EvaluateConditionResult,
  GotoStepResult,
  CompleteTaskResult,
  FormatStringResult,
  IncrementCounterResult,
  LogEventResult,
  NotifyUserResult,
  SendChatMessageResult,
  AskUserQuestionResult,
  WaitForReplyResult
} from "./task-primitives";
