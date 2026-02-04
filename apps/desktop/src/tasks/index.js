/**
 * Tasks Module - Re-exports all task-related functionality
 */

const storage = require("./storage");
const updates = require("./updates");

module.exports = {
  // Storage exports
  POLL_FREQUENCY_PRESETS: storage.POLL_FREQUENCY_PRESETS,
  DEFAULT_POLL_FREQUENCY: storage.DEFAULT_POLL_FREQUENCY,
  getTasksDir: storage.getTasksDir,
  parseTaskMarkdown: storage.parseTaskMarkdown,
  serializeTask: storage.serializeTask,
  createTask: storage.createTask,
  getTask: storage.getTask,
  updateTask: storage.updateTask,
  listTasks: storage.listTasks,
  listActiveTasks: storage.listActiveTasks,
  getTasksWaitingForInput: storage.getTasksWaitingForInput,
  cancelTask: storage.cancelTask,
  hideTask: storage.hideTask,
  getTaskRawMarkdown: storage.getTaskRawMarkdown,
  saveTaskRawMarkdown: storage.saveTaskRawMarkdown,
  
  // Updates exports
  setMainWindow: updates.setMainWindow,
  addTaskUpdate: updates.addTaskUpdate,
  getTaskUpdates: updates.getTaskUpdates
};
