import { ToolCall, ToolResult } from "@wovly/shared";

export type McpServerConfig = {
  id: string;
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
};

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export class McpRegistry {
  private servers = new Map<string, McpServerConfig>();
  private tools = new Map<string, ToolDefinition[]>();

  registerServer(config: McpServerConfig) {
    this.servers.set(config.id, config);
  }

  listServers() {
    return Array.from(this.servers.values());
  }

  registerTools(serverId: string, toolDefinitions: ToolDefinition[]) {
    this.tools.set(serverId, toolDefinitions);
  }

  listTools(serverId: string) {
    return this.tools.get(serverId) ?? [];
  }

  async callTool(toolCall: ToolCall): Promise<ToolResult> {
    const server = this.servers.get(toolCall.serverId);
    if (!server) {
      return { ok: false, error: "Server not registered" };
    }

    return {
      ok: true,
      output: {
        serverId: server.id,
        toolName: toolCall.toolName,
        input: toolCall.input
      }
    };
  }
}

export const defaultMcpServers: McpServerConfig[] = [
  {
    id: "google-workspace",
    name: "Google Workspace MCP",
    transport: "stdio",
    command: "uvx",
    args: ["workspace-mcp", "--tool-tier", "core"]
  },
  {
    id: "slack",
    name: "Slack MCP",
    transport: "stdio",
    command: "slack-mcp-server",
    args: []
  }
];
