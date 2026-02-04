/**
 * Browser Module - Re-exports browser automation functionality
 */

const controller = require("./controller");

module.exports = {
  BrowserController: controller.BrowserController,
  getBrowserController: controller.getBrowserController,
  loadPuppeteer: controller.loadPuppeteer,
  checkPuppeteerCoreInstalled: controller.checkPuppeteerCoreInstalled,
  ensurePuppeteerCoreInstalled: controller.ensurePuppeteerCoreInstalled
};
