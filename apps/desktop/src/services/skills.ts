/**
 * Skills Service
 * Handles skill CRUD operations and template generation
 */

import { promises as fs } from 'fs';
import path from 'path';

// Import skill storage functions and types
import {
  getSkillsDir,
  loadAllSkills,
  parseSkill,
  type Skill
} from '../storage/skills';

/**
 * Service response with skill data
 */
export interface SkillsResponse {
  ok: boolean;
  skill?: Skill;
  skills?: Skill[];
  content?: string;
  template?: string;
  error?: string;
}

/**
 * Default skill template
 */
const SKILL_TEMPLATE = `# New Skill

## Description
Describe what this skill does and when it should be used.

## Keywords
keyword1, keyword2, keyword3

## Procedure
1. First step
2. Second step
3. Third step

## Constraints
- Important constraint or rule
- Another constraint
`;

/**
 * SkillsService - Manages user skills
 */
export class SkillsService {
  /**
   * List all skills for user
   * @param username - Current username
   * @returns List of skills or empty array
   */
  static async listSkills(username: string | null | undefined): Promise<SkillsResponse> {
    try {
      if (!username) {
        return { ok: true, skills: [] };
      }

      const skills = await loadAllSkills(username);
      return { ok: true, skills };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      return { ok: false, error };
    }
  }

  /**
   * Get a specific skill by ID
   * @param username - Current username
   * @param skillId - Skill ID (filename without .md)
   * @returns Skill object with content
   */
  static async getSkill(
    username: string | null | undefined,
    skillId: string
  ): Promise<SkillsResponse> {
    try {
      if (!username) {
        return { ok: false, error: 'Not logged in' };
      }

      const skillsDir = await getSkillsDir(username);
      const filePath = path.join(skillsDir, `${skillId}.md`);
      const content = await fs.readFile(filePath, 'utf8');
      const skill = parseSkill(content, `${skillId}.md`);

      return { ok: true, skill, content };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      return { ok: false, error };
    }
  }

  /**
   * Save a skill (create or update)
   * @param username - Current username
   * @param skillId - Skill ID (filename without .md)
   * @param content - Skill markdown content
   * @returns Saved skill object
   */
  static async saveSkill(
    username: string | null | undefined,
    skillId: string,
    content: string
  ): Promise<SkillsResponse> {
    try {
      if (!username) {
        return { ok: false, error: 'Not logged in' };
      }

      const skillsDir = await getSkillsDir(username);
      const filePath = path.join(skillsDir, `${skillId}.md`);
      await fs.writeFile(filePath, content, 'utf8');
      const skill = parseSkill(content, `${skillId}.md`);

      return { ok: true, skill };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      return { ok: false, error };
    }
  }

  /**
   * Delete a skill
   * @param username - Current username
   * @param skillId - Skill ID (filename without .md)
   * @returns Success/error response
   */
  static async deleteSkill(
    username: string | null | undefined,
    skillId: string
  ): Promise<SkillsResponse> {
    try {
      if (!username) {
        return { ok: false, error: 'Not logged in' };
      }

      const skillsDir = await getSkillsDir(username);
      const filePath = path.join(skillsDir, `${skillId}.md`);
      await fs.unlink(filePath);

      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      return { ok: false, error };
    }
  }

  /**
   * Get skill template for new skills
   * @returns Template markdown
   */
  static getTemplate(): SkillsResponse {
    return { ok: true, template: SKILL_TEMPLATE };
  }
}
