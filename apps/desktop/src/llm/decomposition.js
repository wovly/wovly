/**
 * Query Decomposition - Architect-Builder Pattern
 * 
 * Stage 1 (Architect): Decomposes user intent into logical, human-readable steps
 * Stage 2 (Builder): Maps logical steps to specific tool calls with arguments
 * Stage 3 (Validator): Validates the plan and triggers refinement if needed
 */

// Model selection for classification tasks
const CLASSIFIER_MODELS = {
  anthropic: "claude-sonnet-4-20250514",
  openai: "gpt-4o"
};

const MAX_REFINEMENT_ATTEMPTS = 1;

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Call LLM (supports Anthropic and OpenAI)
// ─────────────────────────────────────────────────────────────────────────────

async function callLLM(prompt, apiKeys, activeProvider, options = {}) {
  const { maxTokens = 2048, systemPrompt = null } = options;
  
  try {
    // Try Anthropic first if available
    if (apiKeys.anthropic) {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKeys.anthropic,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: CLASSIFIER_MODELS.anthropic,
          max_tokens: maxTokens,
          ...(systemPrompt ? { system: systemPrompt } : {}),
          messages: [{ role: "user", content: prompt }]
        })
      });

      if (response.ok) {
        const data = await response.json();
        return data.content?.[0]?.text || "";
      }
    }
    
    // Fallback to OpenAI
    if (apiKeys.openai) {
      const messages = systemPrompt 
        ? [{ role: "system", content: systemPrompt }, { role: "user", content: prompt }]
        : [{ role: "user", content: prompt }];
        
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKeys.openai}`
        },
        body: JSON.stringify({
          model: CLASSIFIER_MODELS.openai,
          max_tokens: maxTokens,
          messages
        })
      });

      if (response.ok) {
        const data = await response.json();
        return data.choices?.[0]?.message?.content || "";
      }
    }
    
    return null;
  } catch (err) {
    console.error("[LLM] Call failed:", err.message);
    return null;
  }
}

function parseJSON(text) {
  if (!text) return null;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.error("[JSON Parse] Failed:", e.message);
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Extract tool categories for Architect (high-level, no schemas)
// ─────────────────────────────────────────────────────────────────────────────

function getToolCategories(availableTools) {
  const categories = {};
  
  for (const tool of availableTools) {
    // Extract category from tool name (e.g., "send_email" -> "Email")
    const name = tool.name;
    let category = "General";
    
    if (name.includes("email") || name.includes("gmail")) category = "Email";
    else if (name.includes("calendar") || name.includes("event")) category = "Calendar";
    else if (name.includes("drive") || name.includes("file")) category = "Files";
    else if (name.includes("slack")) category = "Slack";
    else if (name.includes("imessage") || name.includes("sms") || name.includes("text")) category = "iMessage";
    else if (name.includes("telegram")) category = "Telegram";
    else if (name.includes("discord")) category = "Discord";
    else if (name.includes("browser") || name.includes("navigate") || name.includes("click")) category = "Browser";
    else if (name.includes("task")) category = "Tasks";
    else if (name.includes("memory") || name.includes("search_memory")) category = "Memory";
    else if (name.includes("profile") || name.includes("user")) category = "Profile";
    else if (name.includes("weather")) category = "Weather";
    else if (name.includes("time") || name.includes("reminder")) category = "Time & Reminders";
    else if (name.includes("spotify") || name.includes("music")) category = "Music";
    
    if (!categories[category]) {
      categories[category] = [];
    }
    categories[category].push(tool.name);
  }
  
  // Format as readable string
  return Object.entries(categories)
    .map(([cat, tools]) => `${cat}: ${tools.join(", ")}`)
    .join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 1: The Architect (Reasoning Agent)
// ─────────────────────────────────────────────────────────────────────────────

async function architectDecompose(query, availableTools, apiKeys, activeProvider) {
  const toolCategories = getToolCategories(availableTools);
  
  const architectPrompt = `# System Role
You are The Architect. Your goal is to break down a user's natural language request into a strictly sequential list of logical steps that work within this system's execution model.

# CRITICAL: How This System Works

This is a desktop app that does NOT run 24/7. The user opens and closes the app as needed. Tasks execute via POLLING:

1. **Polling Model**: Tasks run repeatedly at intervals (e.g., every 1 minute). Each poll cycle executes the steps.
2. **Cannot Schedule**: The system CANNOT "wait until" a time. It can only CHECK if a target time has passed.
3. **Overshoot Expected**: The app may start after the target time, so check if current_time >= target_time.
4. **State Tracking**: Use variables to track state between polls (e.g., "reminded_today", "last_check_date").

# Fundamental Tools Available

The system has these fundamental tools for building any task:

**Variables (persist between poll cycles):**
- save_variable: Save a named value to task memory (alarm_time, reminded_today, etc.)
- get_variable: Read a saved variable
- check_variable: Check if variable exists and compare its value

**Time Operations:**
- get_current_time: Get current date/time
- parse_time: Parse "12pm" or "2:30 PM" into hour/minute
- check_time_passed: Check if current time >= target time (with tolerance window)
- is_new_day: Check if it's a new calendar day (for resetting daily flags)

**Control Flow:**
- evaluate_condition: Compare values (==, !=, >, <, contains, etc.)
- goto_step: Jump to a specific step (for loops)
- complete_task: Mark task as done

**Communication:**
- send_reminder: Display a reminder message to the user (with ⏰ prefix)
- notify_user: Send status updates/notifications (with type emoji)
- send_chat_message: Send any message to the main chat window
- ask_user_question: Ask the user a question and wait for their reply (task pauses until response)

## Example: "Remind me at 12pm daily"
1. Parse user's time ("12pm") and save to variable "target_hour"
2. Get current time
3. Check if it's a new day -> if yes, reset "reminded_today" to false
4. Get variable "reminded_today"
5. Check if time has passed (current hour >= target hour)
6. If time passed AND not reminded today: send reminder, save "reminded_today" = true
7. End poll cycle (will repeat at next interval)

# Available Tool Categories
${toolCategories}

# Instructions
1. Understand the user's intent and goal.
2. Use variables to store user-specified values (times, names, settings).
3. Use time comparison tools for scheduling logic.
4. Include state tracking for recurring tasks.
5. Design for the POLLING model - steps run repeatedly each poll cycle.

# Output Format
Respond with ONLY a JSON object:
{
  "title": "Brief 3-5 word title",
  "task_type": "discrete" or "continuous",
  "user_intent": "One sentence summary of what the user wants to accomplish",
  "success_criteria": "What defines task completion (null for continuous)",
  "logical_steps": [
    "Step 1: [Action description]. Output: [what this step produces]",
    "Step 2: [Action description]. Requires: [data from previous step]. Output: [what this produces]",
    ...
  ],
  "data_flow": {
    "step_2": ["step_1"],
    "step_3": ["step_1", "step_2"]
  }
}

# User Request
"${query}"`;

  console.log("[Architect] Analyzing user intent...");
  console.log(`[Architect] Tool categories:\n${toolCategories}`);
  
  const response = await callLLM(architectPrompt, apiKeys, activeProvider, { maxTokens: 1500 });
  const result = parseJSON(response);
  
  if (!result || !result.logical_steps || result.logical_steps.length === 0) {
    console.log("[Architect] Failed to decompose query");
    return null;
  }
  
  console.log(`[Architect] Decomposed into ${result.logical_steps.length} logical steps: "${result.title}"`);
  console.log(`[Architect] Task type: ${result.task_type}`);
  console.log(`[Architect] User intent: ${result.user_intent}`);
  console.log(`[Architect] Logical steps:`);
  result.logical_steps.forEach((step, i) => {
    console.log(`  ${i + 1}. ${step}`);
  });
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 2: The Builder (Grounding Agent)
// ─────────────────────────────────────────────────────────────────────────────

async function builderMapToTools(architectResult, availableTools, apiKeys, activeProvider, validationFeedback = null) {
  // Format tool definitions with full schemas
  const toolDefinitions = availableTools.map(t => {
    const schema = t.input_schema || { type: "object", properties: {}, required: [] };
    return {
      name: t.name,
      description: t.description,
      parameters: schema.properties || {},
      required: schema.required || []
    };
  });
  
  const toolDefsJson = JSON.stringify(toolDefinitions, null, 2);
  const logicalStepsText = architectResult.logical_steps.map((s, i) => `${i + 1}. ${s}`).join("\n");
  
  let feedbackSection = "";
  if (validationFeedback) {
    feedbackSection = `
# Previous Attempt Feedback
Your previous mapping was invalid. Issues found:
${validationFeedback.issues?.map(i => `- ${i}`).join("\n") || "Unspecified issues"}

Suggestions:
${validationFeedback.suggestions?.map(s => `- ${s}`).join("\n") || "None"}

Please correct these issues in your new mapping.
`;
  }

  const builderPrompt = `# System Role
You are The Builder. You receive logical steps from The Architect and must convert them into a strictly formatted JSON execution plan using ONLY the defined tools.

# Execution Model
This plan executes via POLLING - steps run repeatedly at intervals. Use these patterns:

**To store/retrieve values:**
- save_variable: Store values that persist between polls (e.g., target times, flags)
- get_variable: Read stored values
- check_variable: Check if a variable equals a specific value

**For time-based logic:**
- parse_time: Convert "12pm" to { hour: 12, minute: 0 }
- check_time_passed: Check if current time >= target (handles overshoot)
- is_new_day: Check if calendar day changed (for resetting daily flags)

**For decisions:**
- evaluate_condition: Compare values (result is true/false)
- Steps after a condition should check the previous result

**For output:**
- send_reminder: Show reminder message to user (with ⏰ prefix)
- notify_user: Show status/info notifications (with type emoji)
- send_chat_message: Send any message directly to the chat
- ask_user_question: Ask user a question and wait for reply (pauses task)

# Tool Definitions
${toolDefsJson}

# Logical Steps from Architect
Title: ${architectResult.title}
Task Type: ${architectResult.task_type}
User Intent: ${architectResult.user_intent}

Steps:
${logicalStepsText}
${feedbackSection}
# Constraints
1. Output ONLY valid JSON - no explanations, no markdown.
2. Each step MUST map to exactly ONE tool from the definitions.
3. Use "output_var" to capture tool results for later steps.
4. Reference previous outputs: {{step_N.field_name}}
5. For variables, first use save_variable to store, then get_variable to read.
6. Mark conditional steps with "is_conditional": true.
7. Include "dependencies" array listing step_ids this step depends on.

# Output Format
{
  "title": "${architectResult.title}",
  "task_type": "${architectResult.task_type}",
  "success_criteria": ${JSON.stringify(architectResult.success_criteria)},
  "plan": [
    {
      "step_id": 1,
      "tool": "tool_name",
      "description": "What this step does",
      "args": { "param1": "value1", "param2": "{{step_1.output_var}}" },
      "output_var": "descriptive_name",
      "dependencies": [],
      "is_conditional": false,
      "condition": null
    }
  ],
  "requires_task": true
}`;

  console.log("[Builder] Mapping logical steps to tools...");
  console.log(`[Builder] Available tools (${toolDefinitions.length}): ${toolDefinitions.map(t => t.name).join(', ')}`);
  
  const response = await callLLM(builderPrompt, apiKeys, activeProvider, { 
    maxTokens: 2500,
    systemPrompt: "You are a precise JSON generator. Output only valid JSON with no additional text."
  });
  
  const result = parseJSON(response);
  
  if (!result || !result.plan || result.plan.length === 0) {
    console.log("[Builder] Failed to map steps to tools");
    return null;
  }
  
  // Check for ERROR steps
  const errorSteps = result.plan.filter(s => s.tool === "ERROR");
  if (errorSteps.length > 0) {
    console.log(`[Builder] Warning: ${errorSteps.length} steps could not be mapped to tools`);
    errorSteps.forEach(s => console.log(`  - Step ${s.step_id}: ${s.description}`));
  }
  
  console.log(`[Builder] Mapped ${result.plan.length} steps to tools`);
  console.log(`[Builder] Plan details:`);
  result.plan.forEach((step, i) => {
    const argsStr = JSON.stringify(step.args || {});
    const deps = step.dependencies?.length > 0 ? ` (deps: ${step.dependencies.join(', ')})` : '';
    console.log(`  Step ${step.step_id}: [${step.tool}] ${step.description}${deps}`);
    console.log(`    Args: ${argsStr}`);
    if (step.output_var) console.log(`    Output: ${step.output_var}`);
    if (step.is_conditional) console.log(`    Condition: ${step.condition}`);
  });
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage 3: The Validator
// ─────────────────────────────────────────────────────────────────────────────

async function validateDecomposition(builderResult, originalQuery, availableTools, apiKeys, activeProvider) {
  const toolNames = new Set(availableTools.map(t => t.name));
  const issues = [];
  const suggestions = [];
  
  // Static validation first
  if (!builderResult?.plan || builderResult.plan.length === 0) {
    return { isValid: false, reasoning: "No plan steps generated", issues: ["Empty plan"], suggestions: ["Regenerate the plan"] };
  }
  
  // Check each step
  for (const step of builderResult.plan) {
    // Check tool exists
    if (step.tool !== "ERROR" && !toolNames.has(step.tool)) {
      issues.push(`Step ${step.step_id} uses unknown tool "${step.tool}"`);
      suggestions.push(`Use one of the available tools for step ${step.step_id}`);
    }
    
    // Check dependencies reference valid steps
    if (step.dependencies) {
      for (const dep of step.dependencies) {
        if (dep >= step.step_id) {
          issues.push(`Step ${step.step_id} depends on future step ${dep}`);
          suggestions.push(`Reorder steps so dependencies come before dependent steps`);
        }
      }
    }
    
    // Check for template references to non-existent steps
    const argsStr = JSON.stringify(step.args || {});
    const templateRefs = argsStr.match(/\{\{step_(\d+)\./g) || [];
    for (const ref of templateRefs) {
      const refStepId = parseInt(ref.match(/\d+/)[0]);
      if (refStepId >= step.step_id) {
        issues.push(`Step ${step.step_id} references future step ${refStepId}`);
        suggestions.push(`Ensure step ${refStepId} comes before step ${step.step_id}`);
      }
    }
  }
  
  // If static validation passed, do LLM validation for semantic correctness
  if (issues.length === 0) {
    const stepsText = builderResult.plan.map(s => 
      `${s.step_id}. [${s.tool}] ${s.description} - Args: ${JSON.stringify(s.args || {})}`
    ).join("\n");
    
    const validationPrompt = `You are a task validation assistant. Evaluate if this execution plan will accomplish the user's goal.

# Original User Request
"${originalQuery}"

# Execution Plan
Title: ${builderResult.title}
Type: ${builderResult.task_type}

Steps:
${stepsText}

# Evaluation Criteria
1. Will executing these steps accomplish what the user asked for?
2. Are the tool arguments correct and complete?
3. Is the data flow between steps logical?
4. For time-based requests: Does the plan check time and act at the right moment?
5. Are there any missing steps or redundant steps?

# Response Format
{
  "isValid": true or false,
  "reasoning": "Brief explanation",
  "issues": ["List specific problems if invalid"],
  "suggestions": ["Specific corrections if invalid"]
}`;

    const response = await callLLM(validationPrompt, apiKeys, activeProvider, { maxTokens: 800 });
    const llmResult = parseJSON(response);
    
    if (llmResult) {
      console.log(`[Validator] LLM: ${llmResult.isValid ? 'VALID' : 'INVALID'} - ${llmResult.reasoning}`);
      if (!llmResult.isValid && llmResult.issues) {
        console.log(`[Validator] Issues: ${llmResult.issues.join('; ')}`);
      }
      if (!llmResult.isValid && llmResult.suggestions) {
        console.log(`[Validator] Suggestions: ${llmResult.suggestions.join('; ')}`);
      }
      return llmResult;
    }
  }
  
  // Return static validation results
  const isValid = issues.length === 0;
  console.log(`[Validator] Static: ${isValid ? 'VALID' : 'INVALID'} - ${issues.length} issues found`);
  
  return {
    isValid,
    reasoning: isValid ? "Plan passes static validation" : `Found ${issues.length} structural issues`,
    issues,
    suggestions
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Entry Point: decomposeQuery (Orchestrates Architect -> Builder -> Validator)
// ─────────────────────────────────────────────────────────────────────────────

async function decomposeQuery(query, availableTools, apiKeys, activeProvider) {
  try {
    // ─────────────────────────────────────────────────────────────────────────
    // Stage 1: Architect - Understand intent and create logical steps
    // ─────────────────────────────────────────────────────────────────────────
    
    const architectResult = await architectDecompose(query, availableTools, apiKeys, activeProvider);
    
    if (!architectResult) {
      console.log("[Decomposition] Architect failed, returning empty result");
      return { title: "Unknown", steps: [], requires_task: false, architectResult: null, builderResult: null };
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // Stage 2 & 3: Builder + Validation Loop
    // ─────────────────────────────────────────────────────────────────────────
    
    let builderResult = null;
    let validationFeedback = null;
    let attempts = 0;
    
    while (attempts < MAX_REFINEMENT_ATTEMPTS) {
      console.log(`[Decomposition] Builder attempt ${attempts + 1}/${MAX_REFINEMENT_ATTEMPTS}`);
      
      // Stage 2: Builder - Map to tool calls
      builderResult = await builderMapToTools(
        architectResult, 
        availableTools, 
        apiKeys, 
        activeProvider,
        validationFeedback
      );
      
      if (!builderResult) {
        console.log("[Decomposition] Builder failed");
        attempts++;
        continue;
      }
      
      // Stage 3: Validate
      const validation = await validateDecomposition(
        builderResult,
        query,
        availableTools,
        apiKeys,
        activeProvider
      );
      
      if (validation.isValid) {
        console.log("[Decomposition] Plan validated successfully");
        break;
      }
      
      console.log(`[Decomposition] Validation failed: ${validation.issues?.join(', ') || 'unspecified'}`);
      validationFeedback = validation;
      attempts++;
    }
    
    if (!builderResult) {
      return { title: "Unknown", steps: [], requires_task: false, architectResult, builderResult: null };
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // Format final result (backwards compatible with existing code)
    // ─────────────────────────────────────────────────────────────────────────
    
    const result = {
      title: builderResult.title || architectResult.title,
      task_type: builderResult.task_type || architectResult.task_type,
      success_criteria: builderResult.success_criteria || architectResult.success_criteria,
      requires_task: builderResult.requires_task !== false,
      
      // New structured plan with tool calls
      plan: builderResult.plan,
      
      // Backwards compatible steps array (for display)
      steps: builderResult.plan.map(p => ({
        step: p.step_id,
        action: p.description,
        tools_needed: [p.tool],
        tool_args: p.args,
        output_var: p.output_var,
        dependencies: p.dependencies,
        depends_on_previous: (p.dependencies?.length || 0) > 0,
        may_require_waiting: p.tool.includes("wait") || p.is_conditional,
        is_recurring: architectResult.task_type === "continuous"
      })),
      
      // Include architect result for observability
      architectResult: {
        logical_steps: architectResult.logical_steps,
        user_intent: architectResult.user_intent,
        data_flow: architectResult.data_flow
      }
    };
    
    return result;
    
  } catch (err) {
    console.error("[Decomposition] Error:", err.message);
    return { title: "Unknown", steps: [], requires_task: false, reason_for_task: null };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy/Utility Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format decomposed steps for display to user
 */
function formatDecomposedSteps(steps) {
  if (!steps || steps.length === 0) return "No steps identified.";
  
  return steps.map((s, i) => {
    const stepNum = s.step || s.step_id || (i + 1);
    const action = s.action || s.description || JSON.stringify(s);
    const tool = s.tools_needed?.[0] || s.tool || "";
    const toolDisplay = tool ? ` [${tool}]` : "";
    const waitIndicator = s.may_require_waiting ? " ⏳" : "";
    const depIndicator = s.depends_on_previous ? " ↩" : "";
    
    return `${stepNum}. ${action}${toolDisplay}${waitIndicator}${depIndicator}`;
  }).join("\n");
}

/**
 * Format the architect's logical steps for user preview
 */
function formatArchitectSteps(architectResult) {
  if (!architectResult?.logical_steps) return "No logical steps available.";
  
  return architectResult.logical_steps.map((step, i) => `${i + 1}. ${step}`).join("\n");
}

/**
 * Format the builder's plan for debugging
 */
function formatBuilderPlan(builderResult) {
  if (!builderResult?.plan) return "No plan available.";
  
  return builderResult.plan.map(step => {
    const args = JSON.stringify(step.args || {});
    const deps = step.dependencies?.length > 0 ? ` (depends on: ${step.dependencies.join(", ")})` : "";
    return `Step ${step.step_id}: [${step.tool}] ${step.description}\n  Args: ${args}${deps}`;
  }).join("\n\n");
}

module.exports = {
  CLASSIFIER_MODELS,
  decomposeQuery,
  validateDecomposition,
  architectDecompose,
  builderMapToTools,
  formatDecomposedSteps,
  formatArchitectSteps,
  formatBuilderPlan,
  getToolCategories
};
