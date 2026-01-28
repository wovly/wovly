import { promises as fs } from "fs";
import path from "path";
import { LlmConfig } from "@wovly/shared";

export const getLlmConfigPath = (root: string) =>
  path.join(root, "config", "llm.json");

export const saveLlmConfig = async (root: string, config: LlmConfig) => {
  const filePath = getLlmConfigPath(root);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(config, null, 2), "utf8");
};

export const loadLlmConfig = async (root: string): Promise<LlmConfig | null> => {
  const filePath = getLlmConfigPath(root);
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as LlmConfig;
  } catch {
    return null;
  }
};
