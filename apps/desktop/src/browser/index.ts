/**
 * Browser module exports
 */

import {
  BrowserController,
  getBrowserController,
  loadPuppeteer,
  checkPuppeteerCoreInstalled,
  ensurePuppeteerCoreInstalled,
} from "./controller";

export {
  BrowserController,
  getBrowserController,
  loadPuppeteer,
  checkPuppeteerCoreInstalled,
  ensurePuppeteerCoreInstalled,
};

export type {
  SnapshotElement,
  SnapshotResult,
  ClickResult,
  TypeResult,
  PressResult,
  ScrollResult,
} from "./controller";
