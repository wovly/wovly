/**
 * Skills Storage and Routing
 */

const path = require("path");
const fs = require("fs/promises");
const { getUserDataDir } = require("../utils/helpers");

const getSkillsDir = async (username) => {
  const dir = await getUserDataDir(username);
  const skillsDir = path.join(dir, "skills");
  await fs.mkdir(skillsDir, { recursive: true });
  return skillsDir;
};

// Parse skill markdown into structured object
const parseSkill = (markdown, filename) => {
  const skill = {
    id: filename.replace(".md", ""),
    name: "",
    description: "",
    keywords: [],
    procedure: [],
    constraints: [],
    tools: []
  };

  const lines = markdown.split("\n");
  let currentSection = null;

  for (const line of lines) {
    // Get skill name from title
    if (line.startsWith("# ")) {
      skill.name = line.slice(2).trim();
      continue;
    }

    // Detect section headers
    if (line.startsWith("## ")) {
      currentSection = line.slice(3).trim().toLowerCase();
      continue;
    }

    // Parse content based on current section
    if (currentSection === "description") {
      if (line.trim()) {
        skill.description += (skill.description ? " " : "") + line.trim();
      }
    } else if (currentSection === "keywords") {
      if (line.trim()) {
        // Keywords are comma-separated
        const keywords = line.split(",").map(k => k.trim().toLowerCase()).filter(k => k);
        skill.keywords.push(...keywords);
      }
    } else if (currentSection === "procedure") {
      // Parse numbered list items
      const match = line.match(/^\d+\.\s+(.+)$/);
      if (match) {
        skill.procedure.push(match[1].trim());
      }
    } else if (currentSection === "constraints") {
      // Parse bullet points
      const match = line.match(/^[-*]\s+(.+)$/);
      if (match) {
        skill.constraints.push(match[1].trim());
      }
    } else if (currentSection === "tools") {
      if (line.trim()) {
        // Tools are comma-separated
        const tools = line.split(",").map(t => t.trim()).filter(t => t);
        skill.tools.push(...tools);
      }
    }
  }

  return skill;
};

// Serialize skill object to markdown
const serializeSkill = (skill) => {
  let markdown = `# ${skill.name}

## Description
${skill.description}

## Keywords
${skill.keywords.join(", ")}

## Procedure
${skill.procedure.map((step, i) => `${i + 1}. ${step}`).join("\n")}

## Constraints
${skill.constraints.map(c => `- ${c}`).join("\n")}

## Tools
${skill.tools.join(", ")}
`;
  return markdown;
};

// Load all skills from the skills directory
const loadAllSkills = async (username) => {
  const skillsDir = await getSkillsDir(username);
  const skills = [];

  try {
    const files = await fs.readdir(skillsDir);
    const mdFiles = files.filter(f => f.endsWith(".md"));

    for (const file of mdFiles) {
      try {
        const filePath = path.join(skillsDir, file);
        const content = await fs.readFile(filePath, "utf8");
        const skill = parseSkill(content, file);
        if (skill.name && skill.description) {
          skills.push(skill);
        }
      } catch (err) {
        console.error(`[Skills] Error loading ${file}:`, err.message);
      }
    }
  } catch {
    // Skills directory may not exist yet
  }

  return skills;
};

// Get a single skill by ID
const getSkill = async (skillId, username) => {
  const skillsDir = await getSkillsDir(username);
  const filePath = path.join(skillsDir, `${skillId}.md`);
  
  try {
    const content = await fs.readFile(filePath, "utf8");
    return parseSkill(content, `${skillId}.md`);
  } catch {
    return null;
  }
};

// Save a skill (create or update)
const saveSkill = async (skillId, content, username) => {
  const skillsDir = await getSkillsDir(username);
  const filePath = path.join(skillsDir, `${skillId}.md`);
  await fs.writeFile(filePath, content, "utf8");
  return parseSkill(content, `${skillId}.md`);
};

// Delete a skill
const deleteSkill = async (skillId, username) => {
  const skillsDir = await getSkillsDir(username);
  const filePath = path.join(skillsDir, `${skillId}.md`);
  await fs.unlink(filePath);
};

// ─────────────────────────────────────────────────────────────────────────────
// Skill Router - Match user queries to skills
// ─────────────────────────────────────────────────────────────────────────────

// Extract keywords from user query for matching
const extractQueryKeywords = (query) => {
  // Convert to lowercase and remove punctuation
  const cleaned = query.toLowerCase().replace(/[^\w\s]/g, " ");
  // Split into words and filter out common stop words
  const stopWords = new Set([
    "i", "me", "my", "we", "our", "you", "your", "it", "its", "the", "a", "an",
    "is", "are", "was", "were", "be", "been", "being", "have", "has", "had",
    "do", "does", "did", "will", "would", "could", "should", "can", "may",
    "to", "of", "in", "for", "on", "with", "at", "by", "from", "as", "into",
    "about", "like", "through", "after", "over", "between", "out", "against",
    "during", "without", "before", "under", "around", "among", "this", "that",
    "these", "those", "then", "just", "so", "than", "too", "very", "now",
    "want", "need", "please", "help", "me", "can", "could", "would"
  ]);
  
  const words = cleaned.split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
  return [...new Set(words)];
};

// Calculate keyword match score between query and skill
const calculateSkillScore = (queryKeywords, skill) => {
  if (!skill.keywords || skill.keywords.length === 0) return 0;
  
  let matchCount = 0;
  const skillKeywords = skill.keywords.map(k => k.toLowerCase());
  
  for (const queryWord of queryKeywords) {
    // Check exact match
    if (skillKeywords.includes(queryWord)) {
      matchCount += 2; // Exact match worth more
      continue;
    }
    
    // Check partial match (skill keyword contains query word or vice versa)
    for (const skillWord of skillKeywords) {
      if (skillWord.includes(queryWord) || queryWord.includes(skillWord)) {
        matchCount += 1;
        break;
      }
    }
  }
  
  // Also check description for matches
  const descWords = skill.description.toLowerCase().split(/\s+/);
  for (const queryWord of queryKeywords) {
    if (descWords.some(dw => dw.includes(queryWord) || queryWord.includes(dw))) {
      matchCount += 0.5;
    }
  }
  
  // Normalize score (0-1 range)
  const maxPossibleScore = queryKeywords.length * 2.5;
  return matchCount / maxPossibleScore;
};

// Find the best matching skill for a user query
const findBestSkill = async (userQuery, username, skills = null) => {
  // Load skills if not provided
  if (!skills) {
    skills = await loadAllSkills(username);
  }
  
  if (skills.length === 0) {
    return null;
  }
  
  const queryKeywords = extractQueryKeywords(userQuery);
  console.log(`[Skills] Query keywords: ${queryKeywords.join(", ")}`);
  
  if (queryKeywords.length === 0) {
    return null;
  }
  
  // Score each skill
  let bestSkill = null;
  let bestScore = 0;
  
  for (const skill of skills) {
    const score = calculateSkillScore(queryKeywords, skill);
    console.log(`[Skills] ${skill.name}: score ${score.toFixed(2)}`);
    
    if (score > bestScore) {
      bestScore = score;
      bestSkill = skill;
    }
  }
  
  // Only return if confidence is above threshold
  const CONFIDENCE_THRESHOLD = 0.3;
  if (bestScore >= CONFIDENCE_THRESHOLD && bestSkill) {
    console.log(`[Skills] Best match: ${bestSkill.name} (confidence: ${bestScore.toFixed(2)})`);
    return { skill: bestSkill, confidence: bestScore };
  }
  
  console.log(`[Skills] No skill matched with sufficient confidence`);
  return null;
};

module.exports = {
  getSkillsDir,
  parseSkill,
  serializeSkill,
  loadAllSkills,
  getSkill,
  saveSkill,
  deleteSkill,
  extractQueryKeywords,
  calculateSkillScore,
  findBestSkill
};
