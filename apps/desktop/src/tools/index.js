/**
 * Tools Module - Tool definitions and executors
 * 
 * Note: The full tool definitions are still in main.js due to their size (~7,000 lines).
 * This module exports time tools and task primitive tools.
 */

const { timeTools, executeTimeTool } = require("./time");
const { taskPrimitiveTools, executeTaskPrimitiveTool, parseTimeString } = require("./task-primitives");

module.exports = {
  // Time tools
  timeTools,
  executeTimeTool,
  
  // Task primitive tools (variables, control flow, etc.)
  taskPrimitiveTools,
  executeTaskPrimitiveTool,
  parseTimeString
};
