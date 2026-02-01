/// <reference types="vite/client" />

// Image module declarations
declare module "*.png" {
  const src: string;
  export default src;
}

declare module "*.svg" {
  const src: string;
  export default src;
}

declare module "*.jpg" {
  const src: string;
  export default src;
}

declare module "*.jpeg" {
  const src: string;
  export default src;
}

type WovlyFullProfile = {
  firstName: string;
  lastName: string;
  email: string;
  dateOfBirth: string;
  city: string;
  occupation: string;
  homeLife: string;
  userId: string;
  created: string;
  onboardingCompleted: boolean;
  notes: string[]; // Custom facts and notes
};

type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  location?: string;
  description?: string;
};

type WhatsAppStatus = "disconnected" | "connecting" | "connected" | "qr_ready";

type WhatsAppStatusData = {
  status: WhatsAppStatus;
  qr?: string; // QR code as data URL
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  source?: "app" | "whatsapp" | "task" | "decomposed" | "clarification";
  timestamp?: number;
};

type ClarificationQuestion = {
  param: string;
  question: string;
  suggested_value?: string;
};

// Types for fact extraction from informational statements
type ExtractedFactType = {
  category: string;
  summary: string;
  entities: Record<string, string>;
  subject: string;
};

type FactConflictType = {
  newFactIndex: number;
  existingNoteIndex: number;
  newFact: string;
  existingNote: string;
  subject: string;
  conflictDescription: string;
};

type ChatResponse = {
  ok: boolean;
  response?: string;
  error?: string;
  suggestTask?: boolean;
  decomposition?: object;
  executedInline?: boolean;
  clarification_needed?: boolean;
  clarification_questions?: ClarificationQuestion[];
  original_query?: string;
  // Fact confirmation (informational statements)
  informationType?: boolean;
  facts?: ExtractedFactType[];
  conflicts?: FactConflictType[];
  originalInput?: string;
  nonConflictingIndexes?: number[];
};

// Credential types for secure website login storage
type CredentialListItem = {
  domain: string;
  displayName: string;
  username: string;
  hasPassword: boolean;
  notes: string;
  lastUsed: string | null;
  created: string | null;
};

type WovlyCredential = {
  domain: string;
  displayName: string;
  username: string;
  password?: string; // Only included when explicitly requested
  notes: string;
  lastUsed: string | null;
  created: string | null;
};

type CredentialInput = {
  domain: string;
  displayName?: string;
  username?: string;
  password?: string;
  notes?: string;
};

type TaskStatus = "pending" | "active" | "waiting" | "waiting_approval" | "waiting_for_input" | "completed" | "failed" | "cancelled";

type TaskCurrentStep = {
  step: number;
  description: string;
  state: string;
  pollInterval: number | null;
};

type TaskLogEntry = {
  timestamp: string;
  message: string;
};

type PendingMessage = {
  id: string;
  toolName: string;
  platform: string;
  recipient: string;
  subject?: string;
  message: string;
  created: string;
};

type Task = {
  id: string;
  title: string;
  status: TaskStatus;
  created: string;
  lastUpdated: string;
  nextCheck: number | null;
  hidden?: boolean;
  autoSend?: boolean; // Auto-send messages without approval
  originalRequest: string;
  plan: string[];
  currentStep: TaskCurrentStep;
  executionLog: TaskLogEntry[];
  contextMemory: Record<string, string>;
  pendingMessages?: PendingMessage[]; // Messages awaiting approval
};

type TaskUpdate = {
  taskId: string;
  message: string;
  timestamp: string;
};

type Skill = {
  id: string;
  name: string;
  description: string;
  keywords: string[];
  procedure: string[];
  constraints: string[];
  tools: string[];
};

type WovlyIpcApi = {
  settings: {
    get: () => Promise<{ ok: boolean; settings: Record<string, unknown> }>;
    set: (settings: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
  };
  chat: {
    send: (messages: Array<{ role: string; content: string }>) => Promise<{
      ok: boolean;
      response?: string;
      error?: string;
      // Query understanding - clarification fields
      clarification_needed?: boolean;
      clarification_questions?: ClarificationQuestion[];
      original_query?: string;
      // Fact confirmation (informational statements)
      informationType?: boolean;
      facts?: ExtractedFactType[];
      conflicts?: FactConflictType[];
      originalInput?: string;
      nonConflictingIndexes?: number[];
      // Query decomposition fields
      suggestTask?: boolean;
      executedInline?: boolean;
      decomposition?: {
        title: string;
        task_type: "discrete" | "continuous";
        // For discrete tasks
        success_criteria?: string | null;
        // For continuous tasks
        monitoring_condition?: string | null;
        trigger_action?: string | null;
        steps: Array<{
          step: number;
          action: string;
          tools_needed?: string[];
          depends_on_previous?: boolean;
          may_require_waiting?: boolean;
          is_recurring?: boolean;
          expected_output?: string;
        }>;
        requires_task: boolean;
        reason_for_task?: string | null;
      };
      classification?: {
        complexity: "simple" | "multi_step" | "complex_async";
        reason: string;
        requires_waiting: boolean;
        estimated_steps: number;
      };
      stepResults?: Array<{
        step: number;
        action: string;
        response: string | null;
        error?: string;
        success: boolean;
      }>;
    }>;
    executeInline: (decomposition: {
      title: string;
      task_type?: "discrete" | "continuous";
      steps: Array<{
        step: number;
        action: string;
        tools_needed?: string[];
      }>;
    }, originalMessage: string) => Promise<{
      ok: boolean;
      response?: string;
      error?: string;
      executedInline?: boolean;
      stepResults?: Array<{
        step: number;
        action: string;
        response: string | null;
        error?: string;
        success: boolean;
      }>;
    }>;
    onNewMessage: (callback: (message: ChatMessage) => void) => () => void;
    onScreenshot?: (callback: (data: { dataUrl: string }) => void) => () => void;
  };
  messageConfirmation: {
    approve: (confirmationId: string) => Promise<{ ok: boolean; error?: string }>;
    reject: (confirmationId: string, reason?: string) => Promise<{ ok: boolean; error?: string }>;
    onConfirmationRequired: (callback: (data: {
      confirmationId: string;
      toolName: string;
      preview: {
        type: string;
        platform: string;
        recipient: string;
        subject?: string;
        message: string;
        cc?: string;
      };
    }) => void) => () => void;
  };
  calendar: {
    getEvents: (date: string) => Promise<{
      ok: boolean;
      events?: CalendarEvent[];
      error?: string;
    }>;
  };
  integrations: {
    testGoogle: () => Promise<{ ok: boolean; message?: string; error?: string }>;
    testSlack: () => Promise<{ ok: boolean; message?: string; error?: string }>;
    testIMessage: () => Promise<{ ok: boolean; message?: string; error?: string }>;
    testWeather: () => Promise<{ ok: boolean; message?: string; error?: string }>;
    startGoogleOAuth: (clientId: string, clientSecret: string) => Promise<{
      ok: boolean;
      error?: string;
    }>;
    checkGoogleAuth: () => Promise<{ ok: boolean; authorized: boolean }>;
    disconnectGoogle: () => Promise<{ ok: boolean; error?: string }>;
    startSlackTunnel: () => Promise<{ ok: boolean; url?: string; error?: string }>;
    stopSlackTunnel: () => Promise<{ ok: boolean }>;
    getSlackTunnelUrl: () => Promise<{ ok: boolean; url?: string }>;
    startSlackOAuth: (clientId: string, clientSecret: string, tunnelUrl?: string) => Promise<{
      ok: boolean;
      error?: string;
      team?: { id: string; name: string };
    }>;
    checkSlackAuth: () => Promise<{ 
      ok: boolean; 
      authorized: boolean;
      team?: { id: string; name: string };
    }>;
    disconnectSlack: () => Promise<{ ok: boolean; error?: string }>;
    setWeatherEnabled: (enabled: boolean) => Promise<{ ok: boolean; error?: string }>;
    getWeatherEnabled: () => Promise<{ ok: boolean; enabled: boolean }>;
    // Playwright CLI - Browser Automation
    setPlaywrightEnabled: (enabled: boolean) => Promise<{ ok: boolean; enabled?: boolean; cliInstalled?: boolean; error?: string }>;
    getPlaywrightEnabled: () => Promise<{ ok: boolean; enabled: boolean; cliInstalled: boolean; browser?: string }>;
    testPlaywright: () => Promise<{ ok: boolean; message?: string; error?: string }>;
    getAvailableBrowsers: () => Promise<{ ok: boolean; browsers: Array<{ id: string; name: string; installed: boolean }> }>;
    setPlaywrightBrowser: (browser: string) => Promise<{ ok: boolean; error?: string }>;
    getPlaywrightCliReference: () => Promise<{ ok: boolean; reference?: string }>;
  };
  profile: {
    get: () => Promise<{
      ok: boolean;
      profile?: WovlyFullProfile;
      error?: string;
    }>;
    update: (updates: Partial<WovlyFullProfile>) => Promise<{
      ok: boolean;
      profile?: WovlyFullProfile;
      error?: string;
    }>;
    needsOnboarding: () => Promise<{
      ok: boolean;
      needsOnboarding?: boolean;
      profile?: WovlyFullProfile;
    }>;
    // Facts management (for informational statements)
    addFacts: (
      facts: ExtractedFactType[],
      conflictResolutions?: Array<{
        newFact: string;
        existingNote: string;
        keepNew: boolean;
      }>
    ) => Promise<{
      ok: boolean;
      error?: string;
    }>;
    // Raw markdown access (for About Me page)
    getMarkdown: () => Promise<{
      ok: boolean;
      markdown?: string;
      error?: string;
    }>;
    saveMarkdown: (markdown: string) => Promise<{
      ok: boolean;
      error?: string;
    }>;
  };
  welcome: {
    generate: () => Promise<{
      ok: boolean;
      message: string;
      needsOnboarding?: boolean;
      timeOfDay?: "morning" | "afternoon" | "evening" | "night";
      hour?: number;
      dayOfWeek?: string;
      profile?: WovlyFullProfile;
      todayEventCount?: number;
      tomorrowEventCount?: number;
      error?: string;
    }>;
  };
  // Chat Interfaces (WhatsApp, etc.)
  whatsapp: {
    connect: () => Promise<{ ok: boolean; error?: string }>;
    disconnect: () => Promise<{ ok: boolean; error?: string }>;
    getStatus: () => Promise<{
      ok: boolean;
      status: WhatsAppStatus;
      qr?: string;
    }>;
    checkAuth: () => Promise<{
      ok: boolean;
      hasAuth: boolean;
      connected: boolean;
    }>;
    sendMessage: (recipient: string, message: string) => Promise<{
      ok: boolean;
      error?: string;
    }>;
    syncToSelfChat: (message: string, isFromUser: boolean) => Promise<{
      ok: boolean;
      error?: string;
    }>;
    isSyncReady: () => Promise<{
      ok: boolean;
      ready: boolean;
    }>;
    onStatus: (callback: (data: WhatsAppStatusData) => void) => () => void;
  };
  // Tasks - autonomous background tasks
  tasks: {
    create: (taskData: {
      title: string;
      originalRequest: string;
      plan: string[];
      context?: Record<string, string>;
      taskType?: "discrete" | "continuous";
      successCriteria?: string | null;
      monitoringCondition?: string | null;
      triggerAction?: string | null;
    }) => Promise<{ ok: boolean; task?: Task; error?: string }>;
    list: () => Promise<{ ok: boolean; tasks?: Task[]; error?: string }>;
    get: (taskId: string) => Promise<{ ok: boolean; task?: Task; error?: string }>;
    update: (taskId: string, updates: Partial<Task>) => Promise<{ ok: boolean; task?: Task; error?: string }>;
    cancel: (taskId: string) => Promise<{ ok: boolean; error?: string }>;
    hide: (taskId: string) => Promise<{ ok: boolean; error?: string }>;
    getUpdates: () => Promise<{ ok: boolean; updates?: TaskUpdate[]; error?: string }>;
    getRawMarkdown: (taskId: string) => Promise<{ ok: boolean; markdown?: string; error?: string }>;
    saveRawMarkdown: (taskId: string, markdown: string) => Promise<{ ok: boolean; error?: string }>;
    execute: (taskId: string) => Promise<{ ok: boolean; result?: unknown; error?: string }>;
    onUpdate: (callback: (data: TaskUpdate) => void) => () => void;
    // Pending message operations
    approvePendingMessage: (taskId: string, messageId: string, editedMessage?: string) => Promise<{ ok: boolean; error?: string }>;
    rejectPendingMessage: (taskId: string, messageId: string) => Promise<{ ok: boolean; error?: string }>;
    setAutoSend: (taskId: string, autoSend: boolean) => Promise<{ ok: boolean; error?: string }>;
    onPendingMessage: (callback: (data: { taskId: string; message: PendingMessage }) => void) => () => void;
  };
  // Skills - procedural knowledge library
  skills: {
    list: () => Promise<{ ok: boolean; skills?: Skill[]; error?: string }>;
    get: (skillId: string) => Promise<{ ok: boolean; skill?: Skill; content?: string; error?: string }>;
    save: (skillId: string, content: string) => Promise<{ ok: boolean; skill?: Skill; error?: string }>;
    delete: (skillId: string) => Promise<{ ok: boolean; error?: string }>;
    getTemplate: () => Promise<{ ok: boolean; template?: string; error?: string }>;
  };
  // Credentials - secure local storage for website logins
  credentials: {
    list: () => Promise<{ 
      ok: boolean; 
      credentials?: CredentialListItem[];
      error?: string;
    }>;
    get: (domain: string, includePassword?: boolean) => Promise<{ 
      ok: boolean; 
      credential?: WovlyCredential;
      error?: string;
    }>;
    save: (credential: CredentialInput) => Promise<{ 
      ok: boolean;
      domain?: string;
      error?: string;
    }>;
    delete: (domain: string) => Promise<{ 
      ok: boolean;
      error?: string;
    }>;
  };
};

interface Window {
  wovly: WovlyIpcApi;
}
