/**
 * User Profile Management
 */

const path = require("path");
const fs = require("fs/promises");
const crypto = require("crypto");
const { getUserDataDir } = require("../utils/helpers");

const getUserProfilePath = async (username) => {
  const dir = await getUserDataDir(username);
  const profilesDir = path.join(dir, "profiles");
  await fs.mkdir(profilesDir, { recursive: true });
  
  // Look for existing profile or create one
  try {
    const files = await fs.readdir(profilesDir);
    const profileFile = files.find(f => f.endsWith(".md"));
    if (profileFile) {
      return path.join(profilesDir, profileFile);
    }
  } catch {
    // Directory doesn't exist yet
  }
  
  // Create a new profile
  const userId = crypto.randomUUID();
  const profilePath = path.join(profilesDir, `${userId}.md`);
  const defaultProfile = `# User Profile

## Basic Info
- **First Name**: User
- **Last Name**: 
- **Email**: 
- **Date of Birth**: 
- **City**: 

## Life Context
- **Occupation**: 
- **Home Life**: 

## Personal Notes

## System
- **User ID**: ${userId}
- **Created**: ${new Date().toISOString()}
- **Onboarding Stage**: api_setup
- **Onboarding Skipped At**: 
`;
  await fs.writeFile(profilePath, defaultProfile, "utf8");
  return profilePath;
};

// Valid onboarding stages
const ONBOARDING_STAGES = ["api_setup", "profile", "task_demo", "skill_demo", "integrations", "completed"];

// Parse user profile markdown
const parseUserProfile = (markdown) => {
  const profile = {
    firstName: "",
    lastName: "",
    email: "",
    dateOfBirth: "",
    city: "",
    occupation: "",
    homeLife: "",
    userId: "",
    created: "",
    onboardingStage: "api_setup", // Default to api_setup for new users
    onboardingSkippedAt: null,
    notes: [] // Custom facts and notes
  };

  const lines = markdown.split("\n");
  let inNotesSection = false;
  
  for (const line of lines) {
    // Check if we're entering the Notes section
    if (line.match(/^##\s*Notes/i) || line.match(/^##\s*Personal Notes/i) || line.match(/^##\s*Custom Facts/i)) {
      inNotesSection = true;
      continue;
    }
    
    // Check if we're leaving notes section (another ## header)
    if (inNotesSection && line.match(/^##\s/)) {
      inNotesSection = false;
    }
    
    // Parse notes as bullet points
    if (inNotesSection) {
      const noteMatch = line.match(/^\s*-\s+(.+)$/);
      if (noteMatch) {
        profile.notes.push(noteMatch[1].trim());
      }
      continue;
    }
    
    // Parse structured fields
    const match = line.match(/^\s*-\s*\*\*([^*]+)\*\*:\s*(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim();
      
      switch (key) {
        case "First Name": profile.firstName = value; break;
        case "Last Name": profile.lastName = value; break;
        case "Email": profile.email = value; break;
        case "Date of Birth": profile.dateOfBirth = value; break;
        case "City": profile.city = value; break;
        case "Occupation": profile.occupation = value; break;
        case "Home Life": profile.homeLife = value; break;
        case "User ID": profile.userId = value; break;
        case "Created": profile.created = value; break;
        // Legacy field - convert to new stage system
        case "Onboarding Completed": 
          if (value.toLowerCase() === "true") {
            profile.onboardingStage = "completed";
          }
          break;
        case "Onboarding Stage": 
          if (ONBOARDING_STAGES.includes(value)) {
            profile.onboardingStage = value;
          }
          break;
        case "Onboarding Skipped At":
          profile.onboardingSkippedAt = value || null;
          break;
      }
    }
  }
  return profile;
};

// Serialize profile back to markdown
const serializeUserProfile = (profile) => {
  let markdown = `# User Profile

## Basic Info
- **First Name**: ${profile.firstName || ""}
- **Last Name**: ${profile.lastName || ""}
- **Email**: ${profile.email || ""}
- **Date of Birth**: ${profile.dateOfBirth || ""}
- **City**: ${profile.city || ""}

## Life Context
- **Occupation**: ${profile.occupation || ""}
- **Home Life**: ${profile.homeLife || ""}

## Personal Notes
`;

  // Add notes
  if (profile.notes && profile.notes.length > 0) {
    for (const note of profile.notes) {
      markdown += `- ${note}\n`;
    }
  }

  markdown += `
## System
- **User ID**: ${profile.userId || ""}
- **Created**: ${profile.created || ""}
- **Onboarding Stage**: ${profile.onboardingStage || "api_setup"}
- **Onboarding Skipped At**: ${profile.onboardingSkippedAt || ""}
`;

  return markdown;
};

module.exports = {
  getUserProfilePath,
  parseUserProfile,
  serializeUserProfile,
  ONBOARDING_STAGES
};
