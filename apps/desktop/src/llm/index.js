/**
 * LLM Module - Query decomposition and chat processing
 * 
 * Note: The full chat processing logic is still in main.js due to deep integration
 * with IPC handlers. This module exports the decomposition logic.
 */

const decomposition = require("./decomposition");

module.exports = {
  CLASSIFIER_MODELS: decomposition.CLASSIFIER_MODELS,
  decomposeQuery: decomposition.decomposeQuery,
  validateDecomposition: decomposition.validateDecomposition,
  refineDecomposition: decomposition.refineDecomposition,
  formatDecomposedSteps: decomposition.formatDecomposedSteps
};
