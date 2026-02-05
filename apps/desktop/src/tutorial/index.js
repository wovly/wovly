/**
 * Tutorial Module
 * 
 * Handles onboarding and guided experiences for new users.
 */

const {
  ONBOARDING_STAGES,
  PROFILE_QUESTIONS,
  isInOnboarding,
  getNextStage,
  getNextProfileQuestion,
  isProfileComplete,
  processProfileStageMessage,
  getStageWelcomeMessage,
  checkStageAdvancement,
  shouldUseTutorialMode,
  generateTutorialResponse
} = require("./onboarding");

module.exports = {
  // Onboarding
  ONBOARDING_STAGES,
  PROFILE_QUESTIONS,
  isInOnboarding,
  getNextStage,
  getNextProfileQuestion,
  isProfileComplete,
  processProfileStageMessage,
  getStageWelcomeMessage,
  checkStageAdvancement,
  shouldUseTutorialMode,
  generateTutorialResponse
};
