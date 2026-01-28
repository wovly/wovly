import { LlmConfig, ToolCall, ToolResult } from "@wovly/shared";
import { McpRegistry } from "@wovly/tools";
import { MemoryPaths, readAgentProfile } from "@wovly/memory";

export type AgentContext = {
  agentId: string;
  directives: string[];
  llmConfig: LlmConfig;
};

export class AgentRouter {
  private defaultAgent = "main-agent";

  routeMessage(message: string): string {
    const lower = message.toLowerCase();
    if (lower.includes("invoice") || lower.includes("billing")) {
      return "finance-agent";
    }
    if (lower.includes("schedule") || lower.includes("calendar")) {
      return "calendar-agent";
    }
    return this.defaultAgent;
  }
}

export class AgentRuntime {
  private registry: McpRegistry;
  private memoryPaths: MemoryPaths;
  private llmConfig: LlmConfig;

  constructor(registry: McpRegistry, memoryPaths: MemoryPaths, llmConfig: LlmConfig) {
    this.registry = registry;
    this.memoryPaths = memoryPaths;
    this.llmConfig = llmConfig;
  }

  async buildContext(agentId: string): Promise<AgentContext> {
    let directives: string[] = [];
    try {
      const profileMarkdown = await readAgentProfile(this.memoryPaths, agentId);
      directives = profileMarkdown
        .split("\n")
        .filter((line) => line.trim().startsWith("- "))
        .map((line) => line.replace("- ", "").trim());
    } catch {
      directives = [];
    }

    return {
      agentId,
      directives,
      llmConfig: this.llmConfig
    };
  }

  async callTool(toolCall: ToolCall): Promise<ToolResult> {
    return this.registry.callTool(toolCall);
  }
}

export class LlmClient {
  constructor(private config: LlmConfig) {}

  async generate(prompt: string): Promise<string> {
    return `(${this.config.provider}:${this.config.model}) ${prompt}`;
  }
}

export const buildProactiveContext = (options: {
  localTime: string;
  upcomingMeetings: string[];
}) => {
  const meetingSummary =
    options.upcomingMeetings.length === 0
      ? "No upcoming meetings."
      : `Upcoming meetings: ${options.upcomingMeetings.join(", ")}.`;

  return `Local time: ${options.localTime}. ${meetingSummary}`;
};
