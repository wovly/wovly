export type LlmProvider = "openai" | "anthropic" | "custom";

export type LlmConfig = {
  provider: LlmProvider;
  apiKey: string;
  model: string;
  baseUrl?: string;
};

export type ToolCall = {
  serverId: string;
  toolName: string;
  input: Record<string, unknown>;
};

export type ToolResult = {
  ok: boolean;
  output?: unknown;
  error?: string;
};

export type MemoryEntry = {
  id: string;
  createdAt: string;
  content: string;
  tags?: string[];
};

export type ScheduledTask = {
  id: string;
  name: string;
  cron: string;
  description?: string;
  toolCall?: ToolCall;
  enabled: boolean;
};

export type AgentProfile = {
  agentId: string;
  directives: string[];
};

export type UserProfile = {
  userId: string;
  displayName: string;
  preferences: Record<string, string>;
};
