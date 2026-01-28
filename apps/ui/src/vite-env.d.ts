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
  source?: "app" | "whatsapp" | "task";
  timestamp?: number;
};

type TaskStatus = "pending" | "active" | "waiting" | "completed" | "failed" | "cancelled";

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

type Task = {
  id: string;
  title: string;
  status: TaskStatus;
  created: string;
  lastUpdated: string;
  nextCheck: number | null;
  hidden?: boolean;
  originalRequest: string;
  plan: string[];
  currentStep: TaskCurrentStep;
  executionLog: TaskLogEntry[];
  contextMemory: Record<string, string>;
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
    }>;
    onNewMessage: (callback: (message: ChatMessage) => void) => () => void;
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
  };
  // Skills - procedural knowledge library
  skills: {
    list: () => Promise<{ ok: boolean; skills?: Skill[]; error?: string }>;
    get: (skillId: string) => Promise<{ ok: boolean; skill?: Skill; content?: string; error?: string }>;
    save: (skillId: string, content: string) => Promise<{ ok: boolean; skill?: Skill; error?: string }>;
    delete: (skillId: string) => Promise<{ ok: boolean; error?: string }>;
    getTemplate: () => Promise<{ ok: boolean; template?: string; error?: string }>;
  };
};

interface Window {
  wovly: WovlyIpcApi;
}
