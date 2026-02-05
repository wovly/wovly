/**
 * Onboarding / Tutorial System
 * 
 * Handles the multi-stage onboarding wizard that guides new users through:
 * 1. API Setup - Configure LLM provider keys
 * 2. Profile - Collect basic user information
 * 3. Task Demo - Guide user to create their first task
 * 4. Skill Demo - Guide user to create and test a skill
 * 5. Integrations - Recommend connecting services
 */

const ONBOARDING_STAGES = ["api_setup", "profile", "task_demo", "skill_demo", "integrations", "completed"];

/**
 * Check if user is in an active onboarding stage (not completed)
 */
const isInOnboarding = (profile) => {
  return profile && profile.onboardingStage && profile.onboardingStage !== "completed";
};

/**
 * Get the next stage after the current one
 */
const getNextStage = (currentStage) => {
  const currentIndex = ONBOARDING_STAGES.indexOf(currentStage);
  if (currentIndex === -1 || currentIndex >= ONBOARDING_STAGES.length - 1) {
    return "completed";
  }
  return ONBOARDING_STAGES[currentIndex + 1];
};

/**
 * Profile fields we want to collect during onboarding
 */
const PROFILE_QUESTIONS = [
  { field: "firstName", question: "What should I call you? (Just your first name is fine!)", followUp: null },
  { field: "occupation", question: "What do you do for work?", followUp: "That's interesting!" },
  { field: "city", question: "Where are you based?", followUp: "Nice!" },
  { field: "homeLife", question: "Tell me about your household - roommates, family, pets?", followUp: "Got it!" }
];

/**
 * Determine which profile field to ask about next
 */
const getNextProfileQuestion = (profile) => {
  for (const q of PROFILE_QUESTIONS) {
    const value = profile[q.field];
    // Check if field is empty or has default value
    if (!value || value === "User" || value.trim() === "") {
      return q;
    }
  }
  return null; // All fields collected
};

/**
 * Check if profile collection is complete
 */
const isProfileComplete = (profile) => {
  const hasName = profile.firstName && profile.firstName !== "User" && profile.firstName.trim() !== "";
  const hasContext = profile.occupation || profile.city || profile.homeLife;
  return hasName && hasContext;
};

/**
 * Process a message during the profile collection stage
 * Returns { response, shouldAdvance, updatedFields }
 */
const processProfileStageMessage = async (userMessage, profile, llmCall) => {
  // Find which field we're currently collecting
  const currentQuestion = getNextProfileQuestion(profile);
  
  if (!currentQuestion) {
    // Profile is complete, prepare to advance
    return {
      response: null,
      shouldAdvance: true,
      updatedFields: {}
    };
  }
  
  // The user's message is the answer to the current question
  const updatedFields = {};
  const fieldName = currentQuestion.field;
  
  // Clean up the answer - remove common prefixes
  let answer = userMessage.trim();
  
  // For firstName, extract just the name (handle "My name is X", "I'm X", "Call me X", etc.)
  if (fieldName === "firstName") {
    // Common patterns to strip
    const patterns = [
      /^(?:my name is|i'm|i am|call me|it's|its)\s+/i,
      /^(?:hi,?\s*)?(?:my name is|i'm|i am)\s+/i
    ];
    for (const pattern of patterns) {
      answer = answer.replace(pattern, "");
    }
    // Take just the first word if it looks like a name with extra text
    const words = answer.split(/\s+/);
    if (words.length > 1 && words[0].length <= 15) {
      // Check if first word looks like a name (capitalized or short)
      if (/^[A-Z][a-z]+$/.test(words[0]) || words[0].length <= 10) {
        answer = words[0];
      }
    }
    // Capitalize first letter
    answer = answer.charAt(0).toUpperCase() + answer.slice(1).toLowerCase();
  }
  
  updatedFields[fieldName] = answer;
  
  // Get the next question to ask
  const tempProfile = { ...profile, ...updatedFields };
  const nextQuestion = getNextProfileQuestion(tempProfile);
  
  let response;
  if (nextQuestion) {
    // More questions to ask
    const followUp = currentQuestion.followUp ? `${currentQuestion.followUp} ` : "";
    response = `${followUp}${nextQuestion.question}`;
  } else {
    // All questions answered - profile complete
    response = `Got it! I've saved your profile.\n\nBy the way, you can always tell me more about yourself anytime. Just share facts like your spouse's name, your pet's name, allergies, important dates, or preferences - and I'll ask if you want me to remember them.`;
  }
  
  return {
    response,
    shouldAdvance: !nextQuestion, // Advance if no more questions
    updatedFields
  };
};

/**
 * Get the welcome message for a specific onboarding stage
 */
const getStageWelcomeMessage = (stage, profile, timeOfDay) => {
  const greeting = timeOfDay === "morning" ? "Good morning" : 
                  timeOfDay === "afternoon" ? "Good afternoon" : 
                  timeOfDay === "evening" ? "Good evening" : "Hey there";
  
  switch (stage) {
    case "api_setup":
      return {
        message: `Welcome to Wovly! I'm your AI assistant.\n\nTo get started, you'll need to connect me to an AI provider. Head to **Settings** and add an API key from Anthropic, OpenAI, or Google.\n\nOnce configured, I'll help you set up your profile and show you what I can do!`,
        needsApiSetup: true
      };
    
    case "profile":
      return {
        message: `${greeting}! Great, you're all set up! Let me get to know you a bit.\n\nWhat should I call you? (Just your first name is fine!)`,
        needsOnboarding: true
      };
    
    case "task_demo":
      return {
        message: `Now let's see Wovly in action! Try creating your first task.\n\nType something like: **"Remind me to eat lunch at 12pm tomorrow"**\n\nTasks run in the background and can monitor, remind, and take actions for you.`,
        needsOnboarding: true
      };
    
    case "skill_demo":
      return {
        message: `Excellent! Now let's create a skill. Skills teach me custom procedures.\n\nTry: **"Create a skill where if I say marco you say polo"**`,
        needsOnboarding: true
      };
    
    case "integrations":
      return {
        message: `You're almost done! To unlock Wovly's full potential, connect some integrations:\n\n**Recommended:**\n- **Google Workspace** - Email and calendar management\n- **iMessage** (macOS) - Send and receive texts\n- **Slack** - Team messaging\n- **Browser Automation** - Web research and form filling\n\nHead to the **Integrations** page to connect these, or say "skip" to finish onboarding.`,
        needsOnboarding: true
      };
    
    default:
      return null; // No special message for completed stage
  }
};

/**
 * Check if a message should trigger stage advancement
 * Returns { shouldAdvance, nextStage, response } or null if no advancement
 */
const checkStageAdvancement = async (stage, userMessage, context) => {
  const msgLower = userMessage.toLowerCase().trim();
  
  switch (stage) {
    case "integrations":
      // Check for skip commands
      if (msgLower === "skip" || msgLower === "skip onboarding" || msgLower === "skip integrations") {
        return {
          shouldAdvance: true,
          nextStage: "completed",
          response: "Great! You've completed the onboarding. Feel free to explore and ask me anything!\n\nRemember, you can always tell me facts about yourself and I'll help you save them to your profile. Just share things like birthdays, preferences, or important dates."
        };
      }
      break;
    
    case "skill_demo":
      // Check for Marco/Polo skill test
      if (msgLower.includes("marco") && context.lastResponse && context.lastResponse.toLowerCase().includes("polo")) {
        return {
          shouldAdvance: true,
          nextStage: "integrations",
          response: null // Will show integrations welcome message
        };
      }
      break;
  }
  
  return null;
};

/**
 * Determine if a user message should be processed in tutorial mode
 * Tutorial mode bypasses task decomposition and other advanced features
 */
const shouldUseTutorialMode = (stage, userMessage) => {
  if (!stage || stage === "completed") {
    return false;
  }
  
  // Profile stage always uses tutorial mode - just collect info
  if (stage === "profile") {
    return true;
  }
  
  // Task demo stage - only use tutorial mode for non-task messages
  // Allow task creation to flow through normally
  if (stage === "task_demo") {
    const msgLower = userMessage.toLowerCase();
    // Let task-like messages flow through
    if (msgLower.includes("remind") || msgLower.includes("task") || msgLower.includes("alert") || 
        msgLower.includes("notify") || msgLower.includes("check") || msgLower.includes("monitor")) {
      return false;
    }
    return true;
  }
  
  // Skill demo stage - only use tutorial mode for non-skill messages
  if (stage === "skill_demo") {
    const msgLower = userMessage.toLowerCase();
    // Let skill creation and Marco test flow through
    if (msgLower.includes("skill") || msgLower.includes("create") || msgLower.includes("teach") ||
        msgLower.includes("marco")) {
      return false;
    }
    return true;
  }
  
  // Integrations stage - use tutorial mode for skip commands only
  if (stage === "integrations") {
    const msgLower = userMessage.toLowerCase().trim();
    if (msgLower === "skip" || msgLower.includes("skip")) {
      return true;
    }
    return false;
  }
  
  return false;
};

/**
 * Generate a tutorial-mode response for messages that shouldn't trigger advanced features
 */
const generateTutorialResponse = (stage, userMessage, profile) => {
  const msgLower = userMessage.toLowerCase().trim();
  
  switch (stage) {
    case "task_demo":
      return `I'm ready to help you create your first task! Try typing something like:\n\n**"Remind me to eat lunch at 12pm tomorrow"**\n\nor\n\n**"Check my email every hour and notify me of important messages"**`;
    
    case "skill_demo":
      return `Let's create a skill together! Try typing:\n\n**"Create a skill where if I say marco you say polo"**\n\nSkills teach me custom procedures that I can follow whenever you need them.`;
    
    case "integrations":
      if (msgLower.includes("skip")) {
        // This should be handled by checkStageAdvancement, but just in case
        return "Great! You've completed the onboarding.";
      }
      return `You can connect integrations from the **Integrations** page in the sidebar.\n\nOr say **"skip"** to finish onboarding and explore on your own.`;
    
    default:
      return null;
  }
};

module.exports = {
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
