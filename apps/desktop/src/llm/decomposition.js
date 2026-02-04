/**
 * Query Decomposition - Break down complex queries into actionable steps
 */

// Model selection for classification tasks
const CLASSIFIER_MODELS = {
  anthropic: "claude-sonnet-4-20250514",
  openai: "gpt-4o"
};

/**
 * Decompose a query into executable steps using LLM
 * @param {string} query - User query to decompose
 * @param {Array} availableTools - List of available tools with name/description
 * @param {Object} apiKeys - API keys { anthropic, openai }
 * @param {string} activeProvider - "anthropic" or "openai"
 * @returns {Object} Decomposition result with title, steps, task_type, etc.
 */
async function decomposeQuery(query, availableTools, apiKeys, activeProvider) {
  const toolNames = availableTools.map(t => `${t.name}: ${t.description}`).join("\n");
  
  const decompositionPrompt = `You are a task decomposition assistant. Review the user's request and intent, then break it down into clear, sequential steps that can be accomplished with the tools provided.

Think of this like writing a simple computer program - each step must be PRECISE and EXECUTABLE, not vague or abstract.

## User Request
"${query}"

## Available Tools
${toolNames}

## Core Principles

1. **Every step must call a tool** - Steps cannot be abstract like "at 12pm send a reminder". How does the task know when it's 12pm? It must call a tool to check the time.

2. **Tasks poll at regular intervals** (e.g., every 1 minute) - Time-based conditions need an acceptance window. Instead of "when it's exactly 12:00", use "when the time is between 11:59 and 12:01".

3. **Steps must be atomic and executable** - Each step is ONE action using ONE tool that produces a concrete result.

4. **No meta-tasks** - Don't create steps like "create a reminder" or "set up a task". The steps themselves ARE the task.

5. **Use conditional logic** - Steps can include conditions like "IF [condition from previous step], THEN [action]".

## Task Types

- **DISCRETE**: Has a clear end goal (send email, find information, schedule meeting)
- **CONTINUOUS**: Ongoing monitoring with no end (check weather daily, monitor inbox, time-based reminders)

## Response Format

Respond with ONLY a JSON object:
{
  "title": "Brief 3-5 word title",
  "task_type": "discrete" or "continuous",
  "success_criteria": "What defines completion (null for continuous)",
  "monitoring_condition": "What triggers action (for continuous tasks)",
  "trigger_action": "What to do when triggered (for continuous tasks)",
  "steps": [
    {
      "step": 1,
      "action": "Precise description using [tool_name]",
      "tools_needed": ["tool_name"],
      "depends_on_previous": false,
      "may_require_waiting": false,
      "is_recurring": false
    }
  ],
  "requires_task": true
}`;

  let initialDecomposition = null;
  
  try {
    // Use Anthropic if available (preferred)
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
          max_tokens: 2048,
          messages: [{ role: "user", content: decompositionPrompt }]
        })
      });

      if (response.ok) {
        const data = await response.json();
        const text = data.content?.[0]?.text || "{}";
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          initialDecomposition = JSON.parse(jsonMatch[0]);
          console.log(`[QueryDecomposition] Initial: ${initialDecomposition.steps?.length || 0} steps - "${initialDecomposition.title}"`);
        }
      }
    }
    
    // Fallback to OpenAI
    if (!initialDecomposition && apiKeys.openai) {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKeys.openai}`
        },
        body: JSON.stringify({
          model: CLASSIFIER_MODELS.openai,
          max_tokens: 2048,
          messages: [
            { role: "system", content: "You are a query decomposition assistant. Respond with only JSON." },
            { role: "user", content: decompositionPrompt }
          ]
        })
      });

      if (response.ok) {
        const data = await response.json();
        const text = data.choices?.[0]?.message?.content || "{}";
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          initialDecomposition = JSON.parse(jsonMatch[0]);
          console.log(`[QueryDecomposition] Initial: ${initialDecomposition.steps?.length || 0} steps - "${initialDecomposition.title}"`);
        }
      }
    }

    if (!initialDecomposition) {
      console.log("[QueryDecomposition] Initial decomposition failed");
      return { title: "Unknown", steps: [], requires_task: false, reason_for_task: null };
    }

    // Validation Loop
    let currentDecomposition = initialDecomposition;
    let attempts = 0;
    const MAX_REFINEMENT_ATTEMPTS = 3;

    while (attempts < MAX_REFINEMENT_ATTEMPTS) {
      console.log(`[QueryDecomposition] Validating (attempt ${attempts + 1}/${MAX_REFINEMENT_ATTEMPTS})...`);
      
      const validation = await validateDecomposition(
        currentDecomposition, 
        query, 
        availableTools, 
        apiKeys, 
        activeProvider
      );
      
      if (validation.isValid) {
        console.log(`[QueryDecomposition] Validated successfully`);
        break;
      }
      
      console.log(`[QueryDecomposition] Issues: ${validation.issues?.join(', ') || 'unspecified'}`);
      
      currentDecomposition = await refineDecomposition(
        currentDecomposition,
        query,
        validation,
        availableTools,
        apiKeys,
        activeProvider
      );
      attempts++;
    }

    if (attempts === MAX_REFINEMENT_ATTEMPTS) {
      console.log(`[QueryDecomposition] Max refinements reached, returning best effort`);
    }

    return currentDecomposition;

  } catch (err) {
    console.error("[QueryDecomposition] Error:", err.message);
    return { title: "Unknown", steps: [], requires_task: false, reason_for_task: null };
  }
}

/**
 * LLM-based validation of decomposition
 */
async function validateDecomposition(decomposition, originalQuery, availableTools, apiKeys, activeProvider) {
  const toolDescriptions = availableTools.map(t => `- ${t.name}: ${t.description}`).join('\n');
  const stepsText = decomposition.steps?.map((s, i) => 
    `${i + 1}. ${s.action || s.step_description || JSON.stringify(s)}`
  ).join('\n') || 'No steps defined';

  const validationPrompt = `You are a task validation assistant. Evaluate whether the proposed steps will accomplish the user's goal.

## Original User Request
"${originalQuery}"

## Proposed Steps
${stepsText}

## Task Type
${decomposition.task_type || 'discrete'}

## Available Tools
${toolDescriptions}

## Evaluation Criteria
1. Do the steps use the available tools to actually perform actions?
2. Will executing these steps accomplish what the user asked for?
3. Are there any "meta-steps" that just describe creating a task rather than doing the actual work?
4. For time-based requests, do the steps check the time and trigger actions at the right moment?

## Response Format
Respond with ONLY a JSON object:
{
  "isValid": true or false,
  "reasoning": "Brief explanation of your evaluation",
  "issues": ["List of specific problems if invalid"],
  "suggestions": ["Specific corrections needed if invalid"]
}`;

  try {
    let response;
    
    if (apiKeys.anthropic) {
      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKeys.anthropic,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: CLASSIFIER_MODELS.anthropic,
          max_tokens: 500,
          messages: [{ role: "user", content: validationPrompt }]
        })
      });

      if (response.ok) {
        const data = await response.json();
        const text = data.content?.[0]?.text || "{}";
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const result = JSON.parse(jsonMatch[0]);
          console.log(`[Validation] ${result.isValid ? 'VALID' : 'INVALID'} - ${result.reasoning}`);
          return result;
        }
      }
    }
    
    if (apiKeys.openai) {
      response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKeys.openai}`
        },
        body: JSON.stringify({
          model: CLASSIFIER_MODELS.openai,
          max_tokens: 500,
          messages: [
            { role: "system", content: "You are a task validation assistant. Respond with only JSON." },
            { role: "user", content: validationPrompt }
          ]
        })
      });

      if (response.ok) {
        const data = await response.json();
        const text = data.choices?.[0]?.message?.content || "{}";
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const result = JSON.parse(jsonMatch[0]);
          console.log(`[Validation] ${result.isValid ? 'VALID' : 'INVALID'} - ${result.reasoning}`);
          return result;
        }
      }
    }

    return { isValid: true, reasoning: 'Validation skipped due to error', issues: [], suggestions: [] };
  } catch (err) {
    console.error('[Validation] Error:', err.message);
    return { isValid: true, reasoning: 'Validation skipped due to error', issues: [], suggestions: [] };
  }
}

/**
 * LLM-based refinement of decomposition
 */
async function refineDecomposition(decomposition, originalQuery, validationResult, availableTools, apiKeys, activeProvider) {
  const toolDescriptions = availableTools.map(t => `- ${t.name}: ${t.description}`).join('\n');
  const stepsText = decomposition.steps?.map((s, i) => 
    `${i + 1}. ${s.action || s.step_description || JSON.stringify(s)}`
  ).join('\n') || 'No steps defined';

  const refinementPrompt = `Your previous task decomposition was evaluated and found to have issues. Please provide a corrected version.

## Original User Request
"${originalQuery}"

## Your Previous Decomposition
Title: ${decomposition.title}
Task Type: ${decomposition.task_type}
Steps:
${stepsText}

## Validation Feedback
Reasoning: ${validationResult.reasoning}
Issues: ${validationResult.issues?.join('; ') || 'None specified'}
Suggestions: ${validationResult.suggestions?.join('; ') || 'None specified'}

## Available Tools
${toolDescriptions}

## Instructions
Create a corrected decomposition that:
1. Uses the actual available tools to perform real actions
2. Does NOT create meta-steps like "create a task for X" or "set up reminder for X"
3. Each step should be a direct, executable action using one of the available tools
4. For time-based tasks: use get_current_time to check time, then use send_reminder when time matches

Respond with ONLY a JSON object in this format:
{
  "title": "Brief task title",
  "task_type": "discrete" or "continuous",
  "success_criteria": "What defines completion (null for continuous)",
  "monitoring_condition": "What to watch for (for continuous tasks)",
  "trigger_action": "What to do when condition met (for continuous tasks)",
  "steps": [
    {
      "step": 1,
      "action": "Step description",
      "tools_needed": ["tool_name"],
      "depends_on_previous": false,
      "may_require_waiting": false,
      "is_recurring": false
    }
  ],
  "requires_task": true
}`;

  try {
    let response;
    
    if (apiKeys.anthropic) {
      response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKeys.anthropic,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: CLASSIFIER_MODELS.anthropic,
          max_tokens: 1500,
          messages: [{ role: "user", content: refinementPrompt }]
        })
      });

      if (response.ok) {
        const data = await response.json();
        const text = data.content?.[0]?.text || "{}";
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const refined = JSON.parse(jsonMatch[0]);
          console.log(`[Refinement] New decomposition with ${refined.steps?.length || 0} steps`);
          return refined;
        }
      }
    }
    
    if (apiKeys.openai) {
      response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKeys.openai}`
        },
        body: JSON.stringify({
          model: CLASSIFIER_MODELS.openai,
          max_tokens: 1500,
          messages: [
            { role: "system", content: "You are a task decomposition assistant. Respond with only JSON." },
            { role: "user", content: refinementPrompt }
          ]
        })
      });

      if (response.ok) {
        const data = await response.json();
        const text = data.choices?.[0]?.message?.content || "{}";
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const refined = JSON.parse(jsonMatch[0]);
          console.log(`[Refinement] New decomposition with ${refined.steps?.length || 0} steps`);
          return refined;
        }
      }
    }

    console.log("[Refinement] Failed, returning original");
    return decomposition;
  } catch (err) {
    console.error('[Refinement] Error:', err.message);
    return decomposition;
  }
}

/**
 * Format decomposed steps for display
 */
function formatDecomposedSteps(steps) {
  if (!steps || steps.length === 0) return "No steps identified.";
  return steps.map((s, i) => {
    const waitIndicator = s.may_require_waiting ? " ⏳" : "";
    const tools = s.tools_needed?.length > 0 ? ` [${s.tools_needed.join(", ")}]` : "";
    return `${i + 1}. ${s.action}${tools}${waitIndicator}`;
  }).join("\n");
}

module.exports = {
  CLASSIFIER_MODELS,
  decomposeQuery,
  validateDecomposition,
  refineDecomposition,
  formatDecomposedSteps
};
