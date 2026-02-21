/**
 * Web Scraper Module
 *
 * Entry point for the custom web integration system.
 * Exports all components for use in the main application.
 */

import WebScraper from './scraper';
import VisualSelectorTool from './visual-selector';
import * as configManager from './config-manager';
import * as sessionManager from './session-manager';
import * as elementDetector from './element-detector';
import * as aiSelectorGenerator from './ai-selector-generator';
import * as errorDetector from './error-detector';

export {
  // Main classes
  WebScraper,
  VisualSelectorTool,
  // Configuration management
  configManager as config,
  // Session management
  sessionManager as session,
  // Element detection
  elementDetector as elements,
  // AI selector generation
  aiSelectorGenerator as ai,
  // Error handling
  errorDetector as errors,
};

// Default export
export default {
  WebScraper,
  VisualSelectorTool,
  config: configManager,
  session: sessionManager,
  elements: elementDetector,
  ai: aiSelectorGenerator,
  errors: errorDetector,
};
