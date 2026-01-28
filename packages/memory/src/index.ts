import { promises as fs } from "fs";
import path from "path";
import { AgentProfile, MemoryEntry, UserProfile } from "@wovly/shared";

export type MemoryPaths = {
  root: string;
  daily: string;
  longterm: string;
  profiles: string;
  agentProfiles: string;
  souls: string;
};

export const getMemoryPaths = (root: string): MemoryPaths => ({
  root,
  daily: path.join(root, "memory", "daily"),
  longterm: path.join(root, "memory", "longterm"),
  profiles: path.join(root, "profiles"),
  agentProfiles: path.join(root, "memory", "agent-profiles"),
  souls: path.join(root, "souls")
});

export const ensureMemoryDirectories = async (paths: MemoryPaths) => {
  await Promise.all(
    Object.values(paths).map((dir) =>
      fs.mkdir(dir, { recursive: true })
    )
  );
};

const writeMarkdown = async (filePath: string, content: string) => {
  await fs.writeFile(filePath, content, "utf8");
};

const readMarkdown = async (filePath: string) => {
  return fs.readFile(filePath, "utf8");
};

export const writeDailyEntry = async (
  paths: MemoryPaths,
  date: string,
  entry: MemoryEntry
) => {
  await fs.mkdir(paths.daily, { recursive: true });
  const filePath = path.join(paths.daily, `${date}.md`);
  const content = `# ${date}\n\n- ${entry.content}\n`;
  await writeMarkdown(filePath, content);
};

export const appendDailyEntry = async (
  paths: MemoryPaths,
  date: string,
  entry: MemoryEntry
) => {
  await fs.mkdir(paths.daily, { recursive: true });
  const filePath = path.join(paths.daily, `${date}.md`);
  const line = `- ${entry.content}\n`;
  await fs.appendFile(filePath, line, "utf8");
};

export const readDailyEntry = async (paths: MemoryPaths, date: string) => {
  const filePath = path.join(paths.daily, `${date}.md`);
  return readMarkdown(filePath);
};

export const writeLongTermMemory = async (
  paths: MemoryPaths,
  topic: string,
  content: string
) => {
  await fs.mkdir(paths.longterm, { recursive: true });
  const filePath = path.join(paths.longterm, `${topic}.md`);
  await writeMarkdown(filePath, content);
};

export const readLongTermMemory = async (
  paths: MemoryPaths,
  topic: string
) => {
  const filePath = path.join(paths.longterm, `${topic}.md`);
  return readMarkdown(filePath);
};

export const writeUserProfile = async (
  paths: MemoryPaths,
  profile: UserProfile
) => {
  await fs.mkdir(paths.profiles, { recursive: true });
  const filePath = path.join(paths.profiles, `${profile.userId}.md`);
  const content = `# ${profile.displayName}\n\n${Object.entries(
    profile.preferences
  )
    .map(([key, value]) => `- ${key}: ${value}`)
    .join("\n")}\n`;
  await writeMarkdown(filePath, content);
};

export const readUserProfile = async (
  paths: MemoryPaths,
  userId: string
) => {
  const filePath = path.join(paths.profiles, `${userId}.md`);
  return readMarkdown(filePath);
};

export const writeAgentProfile = async (
  paths: MemoryPaths,
  profile: AgentProfile
) => {
  await fs.mkdir(paths.agentProfiles, { recursive: true });
  const filePath = path.join(paths.agentProfiles, `${profile.agentId}.md`);
  const content = `# Agent Profile: ${profile.agentId}\n\n${profile.directives
    .map((directive) => `- ${directive}`)
    .join("\n")}\n`;
  await writeMarkdown(filePath, content);
};

export const readAgentProfile = async (
  paths: MemoryPaths,
  agentId: string
) => {
  const filePath = path.join(paths.agentProfiles, `${agentId}.md`);
  return readMarkdown(filePath);
};

export const writeSoul = async (
  paths: MemoryPaths,
  soulId: string,
  content: string
) => {
  await fs.mkdir(paths.souls, { recursive: true });
  const filePath = path.join(paths.souls, `${soulId}.md`);
  await writeMarkdown(filePath, content);
};

export const readSoul = async (paths: MemoryPaths, soulId: string) => {
  const filePath = path.join(paths.souls, `${soulId}.md`);
  return readMarkdown(filePath);
};
