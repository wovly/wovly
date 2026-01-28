import { McpRegistry } from "@wovly/tools";
import { ToolResult } from "@wovly/shared";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class GoogleWorkspaceIntegration {
  constructor(private registry: McpRegistry, private serverId: string) {}

  async listCalendarEvents(params: Record<string, unknown>): Promise<ToolResult> {
    return this.registry.callTool({
      serverId: this.serverId,
      toolName: "get_events",
      input: params
    });
  }

  async searchGmail(params: Record<string, unknown>): Promise<ToolResult> {
    return this.registry.callTool({
      serverId: this.serverId,
      toolName: "search_gmail_messages",
      input: params
    });
  }

  async uploadDriveFile(params: Record<string, unknown>): Promise<ToolResult> {
    return this.registry.callTool({
      serverId: this.serverId,
      toolName: "create_drive_file",
      input: params
    });
  }
}

export class SlackIntegration {
  constructor(private registry: McpRegistry, private serverId: string) {}

  async listChannels(params: Record<string, unknown>): Promise<ToolResult> {
    return this.registry.callTool({
      serverId: this.serverId,
      toolName: "channels_list",
      input: params
    });
  }

  async searchMessages(params: Record<string, unknown>): Promise<ToolResult> {
    return this.registry.callTool({
      serverId: this.serverId,
      toolName: "conversations_search_messages",
      input: params
    });
  }
}

export class IMessageIntegration {
  private async runAppleScript(script: string): Promise<ToolResult> {
    try {
      const { stdout } = await execFileAsync("osascript", ["-e", script]);
      return { ok: true, output: stdout.trim() };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  }

  async readMessages(chatName: string, limit = 10): Promise<ToolResult> {
    const script = `
      tell application "Messages"
        set targetChat to first chat whose name is "${chatName}"
        set recentMessages to (messages of targetChat)
        set outputText to ""
        repeat with i from ((count of recentMessages) - ${limit} + 1) to (count of recentMessages)
          if i > 0 then
            set outputText to outputText & (text of item i of recentMessages) & "\\n"
          end if
        end repeat
        return outputText
      end tell
    `;
    return this.runAppleScript(script);
  }

  async sendMessage(recipient: string, message: string): Promise<ToolResult> {
    const script = `
      tell application "Messages"
        set targetService to 1st service whose service type = iMessage
        set targetBuddy to buddy "${recipient}" of targetService
        send "${message}" to targetBuddy
      end tell
    `;
    return this.runAppleScript(script);
  }

  async writeMessageDraft(recipient: string, message: string): Promise<ToolResult> {
    return {
      ok: true,
      output: {
        recipient,
        message,
        status: "drafted"
      }
    };
  }
}
