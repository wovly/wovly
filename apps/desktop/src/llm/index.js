/**
 * LLM Module - Query decomposition using Architect-Builder pattern
 * 
 * Stage 1 (Architect): Decomposes user intent into logical, human-readable steps
 * Stage 2 (Builder): Maps logical steps to specific tool calls with arguments
 * Stage 3 (Validator): Validates the plan and triggers refinement if needed
 * 
 * Note: The full chat processing logic is still in main.js due to deep integration
 * with IPC handlers. This module exports the decomposition logic.
 */

const decomposition = require("./decomposition");

module.exports = {
  // Core constants
  CLASSIFIER_MODELS: decomposition.CLASSIFIER_MODELS,
  
  // Main entry point (backwards compatible)
  decomposeQuery: decomposition.decomposeQuery,
  
  // Individual stages (for testing/debugging)
  architectDecompose: decomposition.architectDecompose,
  builderMapToTools: decomposition.builderMapToTools,
  validateDecomposition: decomposition.validateDecomposition,
  
  // Formatting utilities
  formatDecomposedSteps: decomposition.formatDecomposedSteps,
  formatArchitectSteps: decomposition.formatArchitectSteps,
  formatBuilderPlan: decomposition.formatBuilderPlan,
  
  // Helpers
  getToolCategories: decomposition.getToolCategories
};
