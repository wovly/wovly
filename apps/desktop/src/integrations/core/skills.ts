/**
 * Skills Integration
 *
 * Provides tools for creating and managing custom skills/procedures:
 * - Create reusable skills with procedures and keywords
 * - Skills teach the assistant custom behaviors and workflows
 */

import { Integration, Tool, IntegrationContext } from '../base';
// @ts-ignore
import { saveSkill } from '../../../src/index';

// ─────────────────────────────────────────────────────────────────────────────
// Tool Definitions
// ─────────────────────────────────────────────────────────────────────────────

const skillTools: Tool[] = [
  {
    name: 'create_skill',
    description:
      'Create a new custom skill/procedure that can be reused. Skills teach the assistant custom behaviors, responses, or workflows.',
    input_schema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: "Title of the skill (e.g., 'Marco Polo Response', 'Daily Standup Reminder')",
        },
        description: {
          type: 'string',
          description: 'Brief description of what the skill does',
        },
        keywords: {
          type: 'string',
          description: "Comma-separated keywords to trigger this skill (e.g., 'marco, polo, game')",
        },
        procedure: {
          type: 'array',
          items: { type: 'string' },
          description: 'Step-by-step procedure for executing the skill. Each item is one step.',
        },
        constraints: {
          type: 'string',
          description: 'Optional constraints or special conditions for when/how to use this skill',
        },
      },
      required: ['title', 'description', 'keywords', 'procedure'],
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Tool Execution
// ─────────────────────────────────────────────────────────────────────────────

interface CreateSkillInput {
  title: string;
  description: string;
  keywords: string;
  procedure: string[];
  constraints?: string;
}

interface SkillResult {
  success?: boolean;
  skillId?: string;
  message?: string;
  error?: string;
}

async function executeSkillTool(
  toolName: string,
  toolInput: any,
  context: IntegrationContext
): Promise<SkillResult> {
  try {
    switch (toolName) {
      case 'create_skill': {
        const { title, description, keywords, procedure, constraints } =
          toolInput as CreateSkillInput;

        // Generate skill ID from title
        const skillId = title.toLowerCase().replace(/[^a-z0-9]+/g, '-');

        // Build skill markdown
        let skillContent = `# ${title}\n\n`;
        skillContent += `## Description\n${description}\n\n`;
        skillContent += `## Keywords\n${keywords}\n\n`;
        skillContent += `## Procedure\n`;
        procedure.forEach((step, index) => {
          skillContent += `${index + 1}. Step ${index + 1}: ${step}\n`;
        });
        if (constraints) {
          skillContent += `\n## Constraints\n${constraints}\n`;
        }

        // Save the skill using context.user for username
        await saveSkill(skillId, skillContent, context.user?.username);

        return {
          success: true,
          skillId,
          message: `Skill "${title}" created successfully! You can now use it by saying keywords like: ${keywords.split(',')[0].trim()}`,
        };
      }

      default:
        return { error: `Unknown skill tool: ${toolName}` };
    }
  } catch (err: any) {
    console.error(`[Skills] Error executing ${toolName}:`, err.message);
    return { error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Integration Export
// ─────────────────────────────────────────────────────────────────────────────

export const skillsIntegration: Integration = {
  name: 'skills',
  category: 'core',
  tools: skillTools,
  execute: executeSkillTool,
  isAvailable: async () => true, // Skills are always available
};
