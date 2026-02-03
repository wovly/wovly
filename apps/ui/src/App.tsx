import React, { useEffect, useState, useRef, Fragment } from "react";
import { WovlyIcon, GoogleIcon, IMessageIcon, WeatherIcon, SlackIcon, WhatsAppIcon, TelegramIcon, DiscordIcon, ClaudeIcon, OpenAIIcon, GeminiIcon, PlaywrightIcon, NotionIcon, GitHubIcon, AsanaIcon, RedditIcon, SpotifyIcon, DocsIcon, LogoutIcon, ChatIcon, TasksIcon, SkillsIcon, AboutMeIcon, InterfacesIcon, IntegrationsIcon, SettingsIcon, CredentialsIcon } from "./icons";

type NavItem = "chat" | "tasks" | "skills" | "about-me" | "interfaces" | "integrations" | "credentials" | "settings";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  source?: "app" | "whatsapp" | "task" | "decomposed" | "clarification"; // Where the message originated from
  images?: string[]; // Screenshot paths from browser automation
};

type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  location?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Markdown Renderer
// ─────────────────────────────────────────────────────────────────────────────

function processInlineMarkdown(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let keyIndex = 0;

  while (remaining.length > 0) {
    const boldMatch = remaining.match(/\*\*([^*]+)\*\*/);
    
    if (boldMatch && boldMatch.index !== undefined) {
      if (boldMatch.index > 0) {
        parts.push(remaining.substring(0, boldMatch.index));
      }
      parts.push(<strong key={keyIndex++}>{boldMatch[1]}</strong>);
      remaining = remaining.substring(boldMatch.index + boldMatch[0].length);
    } else {
      parts.push(remaining);
      break;
    }
  }

  return parts;
}

function renderMarkdown(text: string): React.ReactNode {
  const paragraphs = text.split(/\n\n+/);
  
  return paragraphs.map((para, pIndex) => {
    const lines = para.split("\n");
    
    // Check for numbered list
    if (lines.every(line => /^\d+\.\s/.test(line.trim()) || line.trim() === "")) {
      return (
        <div key={pIndex} className="md-list">
          {lines.filter(l => l.trim()).map((line, lIndex) => {
            const match = line.match(/^(\d+)\.\s(.*)$/);
            if (match) {
              return (
                <div key={lIndex} className="md-list-item">
                  <span className="md-list-number">{match[1]}.</span>
                  <span className="md-list-content">{processInlineMarkdown(match[2])}</span>
                </div>
              );
            }
            return null;
          })}
        </div>
      );
    }

    // Check for bullet list
    if (lines.every(line => /^[-•]\s/.test(line.trim()) || line.trim() === "")) {
      return (
        <div key={pIndex} className="md-bullets">
          {lines.filter(l => l.trim()).map((line, lIndex) => {
            const content = line.replace(/^[-•]\s/, "");
            return (
              <div key={lIndex} className="md-bullet-item">
                <span className="md-bullet">•</span>
                <span>{processInlineMarkdown(content)}</span>
              </div>
            );
          })}
        </div>
      );
    }

    // Regular paragraph with line breaks
    return (
      <p key={pIndex} className="md-paragraph">
        {lines.map((line, lIndex) => (
          <Fragment key={lIndex}>
            {processInlineMarkdown(line)}
            {lIndex < lines.length - 1 && <br />}
          </Fragment>
        ))}
      </p>
    );
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Agenda Panel
// ─────────────────────────────────────────────────────────────────────────────

const START_HOUR = 8;
const END_HOUR = 18;
const TOTAL_HOURS = END_HOUR - START_HOUR;

function formatHourLabel(hour: number): string {
  if (hour === 0) return "12 AM";
  if (hour === 12) return "12 PM";
  if (hour < 12) return `${hour} AM`;
  return `${hour - 12} PM`;
}

function getEventPosition(event: CalendarEvent): { top: number; height: number } | null {
  const startDate = new Date(event.start);
  const endDate = new Date(event.end);
  
  const startHour = startDate.getHours() + startDate.getMinutes() / 60;
  const endHour = endDate.getHours() + endDate.getMinutes() / 60;
  
  if (endHour <= START_HOUR || startHour >= END_HOUR) {
    return null;
  }
  
  const clampedStart = Math.max(startHour, START_HOUR);
  const clampedEnd = Math.min(endHour, END_HOUR);
  
  const top = ((clampedStart - START_HOUR) / TOTAL_HOURS) * 100;
  const height = ((clampedEnd - clampedStart) / TOTAL_HOURS) * 100;
  
  return { top, height: Math.max(height, 2) };
}

function eventsOverlap(a: CalendarEvent, b: CalendarEvent): boolean {
  const aStart = new Date(a.start).getTime();
  const aEnd = new Date(a.end).getTime();
  const bStart = new Date(b.start).getTime();
  const bEnd = new Date(b.end).getTime();
  return aStart < bEnd && aEnd > bStart;
}

function calculateEventColumns(events: CalendarEvent[]): Map<string, { column: number; totalColumns: number }> {
  const result = new Map<string, { column: number; totalColumns: number }>();
  const sorted = [...events].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  
  const groups: CalendarEvent[][] = [];
  
  for (const event of sorted) {
    let addedToGroup = false;
    for (const group of groups) {
      if (group.some(e => eventsOverlap(e, event))) {
        group.push(event);
        addedToGroup = true;
        break;
      }
    }
    if (!addedToGroup) {
      groups.push([event]);
    }
  }
  
  for (const group of groups) {
    const columns: CalendarEvent[][] = [];
    for (const event of group) {
      let placed = false;
      for (let col = 0; col < columns.length; col++) {
        if (!columns[col].some(e => eventsOverlap(e, event))) {
          columns[col].push(event);
          result.set(event.id, { column: col, totalColumns: 0 });
          placed = true;
          break;
        }
      }
      if (!placed) {
        columns.push([event]);
        result.set(event.id, { column: columns.length - 1, totalColumns: 0 });
      }
    }
    for (const event of group) {
      const info = result.get(event.id)!;
      info.totalColumns = columns.length;
    }
  }
  
  return result;
}

function AgendaPanel() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [googleConnected, setGoogleConnected] = useState(false);

  useEffect(() => {
    const checkGoogle = async () => {
      if (!window.wovly) return;
      const result = await window.wovly.integrations.checkGoogleAuth();
      setGoogleConnected(result.authorized);
    };
    checkGoogle();
  }, []);

  useEffect(() => {
    const fetchEvents = async () => {
      if (!window.wovly || !googleConnected) {
        setLoading(false);
        return;
      }
      
      setLoading(true);
      // Use local date format (YYYY-MM-DD) instead of toISOString() which converts to UTC
      // toISOString() can shift the date by a day depending on timezone
      const year = currentDate.getFullYear();
      const month = String(currentDate.getMonth() + 1).padStart(2, '0');
      const day = String(currentDate.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;
      const result = await window.wovly.calendar.getEvents(dateStr);
      
      if (result.ok && result.events) {
        setEvents(result.events);
      }
      setLoading(false);
    };
    fetchEvents();
  }, [currentDate, googleConnected]);

  const goToPreviousDay = () => {
    setCurrentDate(prev => {
      const d = new Date(prev);
      d.setDate(d.getDate() - 1);
      return d;
    });
  };

  const goToNextDay = () => {
    setCurrentDate(prev => {
      const d = new Date(prev);
      d.setDate(d.getDate() + 1);
      return d;
    });
  };

  const formatDate = (date: Date) => {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    if (date.toDateString() === today.toDateString()) {
      return "Today's Agenda";
    }
    if (date.toDateString() === tomorrow.toDateString()) {
      return "Tomorrow's Agenda";
    }
    return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  };

  // Format full date with ordinal suffix (e.g., "Wednesday, Jan 28th, 2026")
  const formatFullDate = (date: Date) => {
    const day = date.getDate();
    const ordinalSuffix = (d: number) => {
      if (d > 3 && d < 21) return "th";
      switch (d % 10) {
        case 1: return "st";
        case 2: return "nd";
        case 3: return "rd";
        default: return "th";
      }
    };
    const weekday = date.toLocaleDateString("en-US", { weekday: "long" });
    const month = date.toLocaleDateString("en-US", { month: "short" });
    const year = date.getFullYear();
    return `${weekday}, ${month} ${day}${ordinalSuffix(day)}, ${year}`;
  };

  const timedEvents = events.filter(e => e.start.includes("T"));
  const eventColumns = calculateEventColumns(timedEvents);

  return (
    <div className="panel agenda-panel">
      <div className="panel-header">
        <button className="icon-btn" onClick={goToPreviousDay}>←</button>
        <div className="agenda-header-text">
          <h2>{formatDate(currentDate)}</h2>
          <span className="agenda-date-subtitle">{formatFullDate(currentDate)}</span>
        </div>
        <button className="icon-btn" onClick={goToNextDay}>→</button>
      </div>
      <div className="panel-body">
        {!googleConnected ? (
          <div className="empty-state">
            <p>Connect Google Calendar in Integrations to see your agenda.</p>
          </div>
        ) : loading ? (
          <div className="empty-state"><p>Loading...</p></div>
        ) : events.length === 0 ? (
          <div className="empty-state"><p>No events scheduled for this day.</p></div>
        ) : (
          <div className="agenda-timeline-container">
            <div className="agenda-timeline">
              <div className="timeline-grid">
                {Array.from({ length: TOTAL_HOURS + 1 }, (_, i) => {
                  const hour = START_HOUR + i;
                  const topPercent = (i / TOTAL_HOURS) * 100;
                  return (
                    <div key={hour} className="timeline-hour" style={{ top: `${topPercent}%` }}>
                      <span className="timeline-hour-label">{formatHourLabel(hour)}</span>
                      <div className="timeline-hour-line" />
                    </div>
                  );
                })}
              </div>
              <div className="timeline-events">
                {timedEvents.map(event => {
                  const pos = getEventPosition(event);
                  if (!pos) return null;
                  
                  const colInfo = eventColumns.get(event.id);
                  const column = colInfo?.column ?? 0;
                  const totalColumns = colInfo?.totalColumns ?? 1;
                  const width = 100 / totalColumns;
                  const left = column * width;
                  
                  const startTime = new Date(event.start).toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit"
                  });
                  
                  return (
                    <div
                      key={event.id}
                      className="timeline-event"
                      style={{
                        top: `${pos.top}%`,
                        height: `${pos.height}%`,
                        left: `${left}%`,
                        width: `${width}%`
                      }}
                    >
                      <div className="timeline-event-title">{event.title}</div>
                      <div className="timeline-event-time">{startTime}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Chat Panel
// ─────────────────────────────────────────────────────────────────────────────

// Type for decomposition result
type DecompositionStep = {
  step: number;
  action: string;
  tools_needed?: string[];
  depends_on_previous?: boolean;
  may_require_waiting?: boolean;
  is_recurring?: boolean;
  expected_output?: string;
};

type DecompositionResult = {
  title: string;
  task_type: "discrete" | "continuous";
  // For discrete tasks
  success_criteria?: string | null;
  // For continuous tasks
  monitoring_condition?: string | null;
  trigger_action?: string | null;
  steps: DecompositionStep[];
  requires_task: boolean;
  reason_for_task?: string | null;
};

// Types for fact confirmation (informational statements)
type ExtractedFact = {
  category: string;
  summary: string;
  entities: Record<string, string>;
  subject: string;
};

type FactConflict = {
  newFactIndex: number;
  existingNoteIndex: number;
  newFact: string;
  existingNote: string;
  subject: string;
  conflictDescription: string;
};

type PendingFactConfirmation = {
  facts: ExtractedFact[];
  conflicts: FactConflict[];
  originalInput: string;
  conflictResolutions: { [key: number]: boolean }; // newFactIndex -> keepNew (true) or keepExisting (false)
};

// Workflow state to prevent ad-hoc features from interrupting active workflows
type WorkflowState = {
  type: 'clarifying_for_task' | 'confirming_facts' | 'inline_execution' | null;
  context?: {
    original_query?: string;
    clarification_questions?: string[];
    detected_facts?: ExtractedFact[];  // Store facts detected during workflow for later
  };
};

function ChatPanel({
  messages,
  setMessages,
  initialized,
  setInitialized
}: {
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  initialized: boolean;
  setInitialized: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const [message, setMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [whatsappSyncReady, setWhatsappSyncReady] = useState(false);
  const chatBodyRef = useRef<HTMLDivElement>(null);
  
  // Query decomposition state
  const [pendingDecomposition, setPendingDecomposition] = useState<DecompositionResult | null>(null);
  const [isCreatingTask, setIsCreatingTask] = useState(false);
  const [selectedPollFrequency, setSelectedPollFrequency] = useState("5min"); // Default to 5 minutes
  
  // Fact confirmation state (for informational statements)
  const [pendingFactConfirmation, setPendingFactConfirmation] = useState<PendingFactConfirmation | null>(null);
  const [isSavingFacts, setIsSavingFacts] = useState(false);
  
  // Workflow state - tracks active workflows to prevent interruption by ad-hoc features
  const [activeWorkflow, setActiveWorkflow] = useState<WorkflowState>({ type: null });

  // Auto-scroll
  useEffect(() => {
    if (chatBodyRef.current) {
      chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  // Listen for incoming WhatsApp messages
  useEffect(() => {
    if (!window.wovly) return;

    const unsubscribe = window.wovly.chat.onNewMessage((msg) => {
      // Handle incoming messages from various sources (WhatsApp, tasks, decomposed inline execution)
      if (msg.source === "whatsapp" || msg.source === "task" || msg.source === "decomposed") {
        setMessages(prev => [...prev, {
          id: crypto.randomUUID(),
          role: msg.role,
          content: msg.content,
          source: msg.source
        }]);
        
        // Auto-scroll to bottom when task update arrives
        if (msg.source === "task") {
          setTimeout(() => {
            const chatContainer = document.querySelector('.chat-messages');
            if (chatContainer) {
              chatContainer.scrollTop = chatContainer.scrollHeight;
            }
          }, 100);
        }
      }
    });
    
    // Listen for screenshots from browser automation
    const screenshotUnsubscribe = window.wovly.chat.onScreenshot?.((data: { dataUrl: string }) => {
      if (data.dataUrl) {
        // Add screenshot as a new message with image (using base64 data URL)
        setMessages(prev => [...prev, {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "📸 Browser screenshot:",
          source: "app",
          images: [data.dataUrl]
        }]);
        
        // Auto-scroll
        setTimeout(() => {
          const chatContainer = document.querySelector('.chat-messages');
          if (chatContainer) {
            chatContainer.scrollTop = chatContainer.scrollHeight;
          }
        }, 100);
      }
    });

    // Check if WhatsApp sync is ready
    window.wovly.whatsapp.isSyncReady().then(result => {
      setWhatsappSyncReady(result.ready);
    });

    // Also listen for WhatsApp status changes
    const statusUnsubscribe = window.wovly.whatsapp.onStatus(() => {
      window.wovly.whatsapp.isSyncReady().then(result => {
        setWhatsappSyncReady(result.ready);
      });
    });

    return () => {
      unsubscribe();
      statusUnsubscribe();
      screenshotUnsubscribe?.();
    };
  }, [setMessages]);

  // Note: Task updates are now sent via chat:newMessage for richer formatting
  // The tasks.onUpdate is still used by TasksPage to refresh the task list

  // Generate LLM-powered welcome message
  useEffect(() => {
    const generateWelcome = async () => {
      if (initialized || !window.wovly) return;
      setInitialized(true);
      
      try {
        const result = await window.wovly.welcome.generate();
        setMessages([{
          id: "welcome",
          role: "assistant",
          content: result.message
        }]);
      } catch {
        setMessages([{
          id: "welcome",
          role: "assistant",
          content: "Hello! I'm Wovly, your AI assistant. How can I help you today?"
        }]);
      }
    };
    generateWelcome();
  }, [initialized, setInitialized, setMessages]);

  const handleSend = async () => {
    if (!message.trim() || !window.wovly || isLoading) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: message.trim(),
      source: "app"
    };

    setMessages(prev => [...prev, userMessage]);
    setMessage("");
    setIsLoading(true);
    setError(null);

    // Sync user message to WhatsApp if connected
    if (whatsappSyncReady) {
      window.wovly.whatsapp.syncToSelfChat(userMessage.content, true).catch(() => {
        // Silently ignore sync errors
      });
    }

    try {
      const chatHistory = [...messages, userMessage].map(m => ({
        role: m.role,
        content: m.content
      }));

      // Pass workflow context to backend so it can skip info detection during clarification
      const workflowContext = activeWorkflow.type ? {
        type: activeWorkflow.type,
        original_query: activeWorkflow.context?.original_query
      } : null;

      const result = await window.wovly.chat.send(chatHistory, workflowContext) as {
        ok: boolean;
        response?: string;
        error?: string;
        informationType?: boolean;
        facts?: ExtractedFact[];
        conflicts?: FactConflict[];
        originalInput?: string;
        suggestTask?: boolean;
        decomposition?: DecompositionResult;
        clarification_needed?: boolean;
        clarification_questions?: Array<{ question: string }>;
        original_query?: string;
        executedInline?: boolean;
        detectedFacts?: ExtractedFact[];  // Facts detected during clarification (captured silently)
      };

      if (result.ok && result.response) {
        const responseText = result.response;
        
        // Check if this is an informational statement that needs confirmation
        // Only show fact confirmation if NOT in an active workflow (to avoid interruption)
        if (result.informationType && result.facts && result.facts.length > 0 && !activeWorkflow.type) {
          // Initialize conflict resolutions - default to keeping new facts
          const initialResolutions: { [key: number]: boolean } = {};
          (result.conflicts || []).forEach((conflict) => {
            initialResolutions[conflict.newFactIndex] = true; // Default to keeping new
          });
          
          setPendingFactConfirmation({
            facts: result.facts,
            conflicts: result.conflicts || [],
            originalInput: result.originalInput || "",
            conflictResolutions: initialResolutions
          });
        }
        
        // Check if this is a task suggestion from query decomposition
        if (result.suggestTask && result.decomposition) {
          setPendingDecomposition(result.decomposition as DecompositionResult);
          
          // Clear clarification workflow since we now have a task suggestion
          if (activeWorkflow.type === 'clarifying_for_task') {
            // If facts were detected during clarification, store them for later
            const detectedFacts = result.detectedFacts || activeWorkflow.context?.detected_facts;
            if (detectedFacts && detectedFacts.length > 0) {
              // Store facts in decomposition context for prompting after task creation
              setActiveWorkflow({ 
                type: null, 
                context: { detected_facts: detectedFacts } 
              });
            } else {
              setActiveWorkflow({ type: null });
            }
          }
        }
        
        // Handle clarification response - set workflow state
        if (result.clarification_needed) {
          setActiveWorkflow({
            type: 'clarifying_for_task',
            context: {
              original_query: result.original_query || userMessage.content,
              clarification_questions: result.clarification_questions?.map(q => q.question) || []
            }
          });
        }
        
        // If facts were silently detected during workflow, store them for later
        if (result.detectedFacts && result.detectedFacts.length > 0 && activeWorkflow.type) {
          setActiveWorkflow(prev => ({
            ...prev,
            context: {
              ...prev.context,
              detected_facts: [...(prev.context?.detected_facts || []), ...result.detectedFacts!]
            }
          }));
        }
        
        // Determine the source type based on response flags
        let messageSource: "app" | "decomposed" | "clarification" = "app";
        if (result.clarification_needed) {
          messageSource = "clarification";
        } else if (result.executedInline) {
          messageSource = "decomposed";
        }
        
        setMessages(prev => [...prev, {
          id: crypto.randomUUID(),
          role: "assistant" as const,
          content: responseText,
          source: messageSource
        }]);

        // Sync AI response to WhatsApp if connected
        if (whatsappSyncReady) {
          window.wovly.whatsapp.syncToSelfChat(responseText, false).catch(() => {
            // Silently ignore sync errors
          });
        }
      } else {
        setError(result.error || "Failed to get response");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Handle creating a task from pending decomposition
  const handleCreateTaskFromDecomposition = async () => {
    if (!pendingDecomposition || !window.wovly) return;
    
    setIsCreatingTask(true);
    try {
      // Determine task type from decomposition
      const taskType = pendingDecomposition.task_type || "discrete";
      const isContinuous = taskType === "continuous";
      
      // Find the most recent USER message from the app (not task status updates or other sources)
      // This ensures we capture the actual user request, not a task notification that came in between
      const userMessages = messages.filter(m => m.role === "user" && (m.source === "app" || !m.source));
      const originalUserRequest = userMessages[userMessages.length - 1]?.content || pendingDecomposition.title;
      
      // Create task with the decomposition plan
      const taskResult = await window.wovly.tasks.create({
        title: pendingDecomposition.title,
        originalRequest: originalUserRequest,
        plan: pendingDecomposition.steps.map(s => s.action),
        taskType: taskType,
        pollFrequency: selectedPollFrequency,
        // For continuous tasks, pass monitoring info
        ...(isContinuous ? {
          monitoringCondition: pendingDecomposition.monitoring_condition ?? undefined,
          triggerAction: pendingDecomposition.trigger_action ?? undefined
        } : {
          successCriteria: pendingDecomposition.success_criteria ?? undefined
        }),
        context: {}
      });
      
      if (taskResult.ok) {
        const taskDescription = isContinuous 
          ? `I've created a **continuous monitoring task**: **${pendingDecomposition.title}**\n\nThis task will run indefinitely, checking periodically and alerting you when the condition is met.`
          : `I've created a background task: **${pendingDecomposition.title}**\n\nThe task will run autonomously and I'll notify you of progress. You can view it in the Tasks page.`;
        
        setMessages(prev => [...prev, {
          id: crypto.randomUUID(),
          role: "assistant",
          content: taskDescription,
          source: "task"
        }]);
        setPendingDecomposition(null);
        
        // Check if we have deferred facts from the clarification workflow
        const deferredFacts = activeWorkflow.context?.detected_facts;
        if (deferredFacts && deferredFacts.length > 0) {
          // Prompt user to save facts that were detected during task creation
          const initialResolutions: { [key: number]: boolean } = {};
          setPendingFactConfirmation({
            facts: deferredFacts,
            conflicts: [], // No conflict check for deferred facts (simplification)
            originalInput: "",
            conflictResolutions: initialResolutions
          });
        }
        
        // Clear workflow state
        setActiveWorkflow({ type: null });
      } else {
        setError(taskResult.error || "Failed to create task");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task");
    } finally {
      setIsCreatingTask(false);
    }
  };

  // Cancel the task suggestion entirely (close button)
  const handleCancelTaskSuggestion = () => {
    setPendingDecomposition(null);
    // Clear workflow state and any deferred facts
    setActiveWorkflow({ type: null });
    // Just return to normal chat mode - no action needed
  };

  // Dismiss the task suggestion and execute steps inline
  const handleDismissTaskSuggestion = async () => {
    if (!pendingDecomposition || !window.wovly) {
      setPendingDecomposition(null);
      setActiveWorkflow({ type: null });
      return;
    }
    
    // Find the most recent USER message from the app (not task status updates or other sources)
    const userMessages = messages.filter(m => m.role === "user" && (m.source === "app" || !m.source));
    const originalMessage = userMessages[userMessages.length - 1]?.content || "";
    const decomposition = pendingDecomposition;
    
    // Store any deferred facts before clearing
    const deferredFacts = activeWorkflow.context?.detected_facts;
    
    setPendingDecomposition(null);
    setActiveWorkflow({ type: 'inline_execution' }); // Mark as inline execution workflow
    setIsLoading(true);
    
    try {
      // Execute the decomposed steps inline
      // Progress updates will come through the onNewMessage listener
      const result = await window.wovly.chat.executeInline(decomposition, originalMessage);
      
      if (result.ok && result.response) {
        const responseContent = result.response; // TypeScript narrowing
        setMessages(prev => [...prev, {
          id: crypto.randomUUID(),
          role: "assistant" as const,
          content: responseContent,
          source: "decomposed" as const
        }]);
        
        // After inline execution completes, prompt for deferred facts if any
        if (deferredFacts && deferredFacts.length > 0) {
          const initialResolutions: { [key: number]: boolean } = {};
          setPendingFactConfirmation({
            facts: deferredFacts,
            conflicts: [],
            originalInput: "",
            conflictResolutions: initialResolutions
          });
        }
      } else if (result.error) {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to execute steps");
    } finally {
      setIsLoading(false);
      setActiveWorkflow({ type: null }); // Clear workflow after inline execution
    }
  };

  // Handle saving facts to profile
  const handleSaveFacts = async () => {
    if (!pendingFactConfirmation || !window.wovly) return;
    
    setIsSavingFacts(true);
    try {
      // Build conflict resolutions for the API
      const conflictResolutions = pendingFactConfirmation.conflicts.map(conflict => ({
        newFact: conflict.newFact,
        existingNote: conflict.existingNote,
        keepNew: pendingFactConfirmation.conflictResolutions[conflict.newFactIndex] ?? true
      }));
      
      const result = await (window.wovly.profile as {
        addFacts: (facts: ExtractedFact[], conflictResolutions: Array<{newFact: string; existingNote: string; keepNew: boolean}>) => Promise<{ok: boolean; error?: string}>;
      }).addFacts(
        pendingFactConfirmation.facts,
        conflictResolutions
      );
      
      if (result.ok) {
        setMessages(prev => [...prev, {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "✅ I've saved that information to your profile! I'll remember this for our future conversations.",
          source: "app"
        }]);
        setPendingFactConfirmation(null);
      } else {
        setError(result.error || "Failed to save facts");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save facts");
    } finally {
      setIsSavingFacts(false);
    }
  };

  // Handle skipping fact save
  const handleSkipFacts = () => {
    setMessages(prev => [...prev, {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "No problem! I won't save this information. Let me know if you need anything else.",
      source: "app"
    }]);
    setPendingFactConfirmation(null);
  };

  // Handle conflict resolution toggle
  const handleConflictResolutionChange = (newFactIndex: number, keepNew: boolean) => {
    if (!pendingFactConfirmation) return;
    
    setPendingFactConfirmation({
      ...pendingFactConfirmation,
      conflictResolutions: {
        ...pendingFactConfirmation.conflictResolutions,
        [newFactIndex]: keepNew
      }
    });
  };

  return (
    <div className="panel chat-panel">
      <div className="panel-header">
        <h2>Chat</h2>
        {whatsappSyncReady && (
          <span className="sync-indicator whatsapp" title="Synced with WhatsApp">
            💬 Synced
          </span>
        )}
      </div>
      <div className="chat-body" ref={chatBodyRef}>
        {messages.map(msg => (
          <div key={msg.id} className={`chat-bubble ${msg.role} ${msg.source === "whatsapp" ? "from-whatsapp" : ""} ${msg.source === "task" ? "from-task" : ""} ${msg.source === "clarification" ? "clarification" : ""}`}>
            {msg.source === "whatsapp" && <span className="source-badge">📱</span>}
            {msg.source === "task" && <span className="source-badge">📋</span>}
            {msg.source === "clarification" && <span className="source-badge">❓</span>}
            {msg.role === "assistant" ? renderMarkdown(msg.content) : msg.content}
            {msg.images && msg.images.length > 0 && (
              <div className="chat-images">
                {msg.images.map((imgSrc, idx) => (
                  <img 
                    key={idx} 
                    src={imgSrc} 
                    alt="Browser screenshot" 
                    className="chat-screenshot"
                    onClick={() => window.open(imgSrc, '_blank')}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
        {isLoading && (
          <div className="chat-bubble assistant">
            <div className="typing-dots">
              <span className="typing-dot"></span>
              <span className="typing-dot"></span>
              <span className="typing-dot"></span>
            </div>
          </div>
        )}
        {error && <div className="chat-error">{error}</div>}
        
        {/* Task Suggestion from Query Decomposition */}
        {pendingDecomposition && (
          <div className="task-suggestion-actions">
            <button 
              className="task-suggestion-close"
              onClick={handleCancelTaskSuggestion}
              disabled={isCreatingTask}
              title="Cancel request"
            >
              ×
            </button>
            <div className="poll-frequency-selector">
              <label>Check frequency:</label>
              <select 
                value={selectedPollFrequency}
                onChange={(e) => setSelectedPollFrequency(e.target.value)}
                disabled={isCreatingTask}
              >
                <option value="1min">Every 1 minute</option>
                <option value="5min">Every 5 minutes</option>
                <option value="15min">Every 15 minutes</option>
                <option value="30min">Every 30 minutes</option>
                <option value="1hour">Every hour</option>
                <option value="daily">Daily</option>
                <option value="on_login">On login only</option>
              </select>
            </div>
            <button 
              className="primary" 
              onClick={handleCreateTaskFromDecomposition}
              disabled={isCreatingTask}
            >
              {isCreatingTask ? "Creating Task..." : "Yes, Create Task"}
            </button>
            <button 
              className="secondary" 
              onClick={handleDismissTaskSuggestion}
              disabled={isCreatingTask}
            >
              No, Help Me Directly
            </button>
          </div>
        )}
        
        {/* Fact Confirmation UI (for informational statements) */}
        {pendingFactConfirmation && (
          <div className="fact-confirmation-panel">
            <div className="fact-confirmation-header">
              <h4>📝 Save to Profile?</h4>
              <button 
                className="fact-confirmation-close"
                onClick={handleSkipFacts}
                disabled={isSavingFacts}
                title="Skip"
              >
                ×
              </button>
            </div>
            
            {/* Conflicts Section */}
            {pendingFactConfirmation.conflicts.length > 0 && (
              <div className="fact-conflicts-section">
                <div className="conflict-warning">⚠️ Conflicts Detected</div>
                {pendingFactConfirmation.conflicts.map((conflict, idx) => (
                  <div key={idx} className="fact-conflict-item">
                    <p className="conflict-description">{conflict.conflictDescription}</p>
                    <div className="conflict-options">
                      <label className="conflict-option">
                        <input
                          type="radio"
                          name={`conflict-${idx}`}
                          checked={!pendingFactConfirmation.conflictResolutions[conflict.newFactIndex]}
                          onChange={() => handleConflictResolutionChange(conflict.newFactIndex, false)}
                        />
                        <span>Keep existing: "{conflict.existingNote}"</span>
                      </label>
                      <label className="conflict-option">
                        <input
                          type="radio"
                          name={`conflict-${idx}`}
                          checked={pendingFactConfirmation.conflictResolutions[conflict.newFactIndex] ?? true}
                          onChange={() => handleConflictResolutionChange(conflict.newFactIndex, true)}
                        />
                        <span>Use new: "{conflict.newFact}"</span>
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            )}
            
            {/* Facts to Save */}
            <div className="facts-to-save">
              <div className="facts-label">Facts to save:</div>
              {pendingFactConfirmation.facts.map((fact, idx) => {
                const isConflicted = pendingFactConfirmation.conflicts.some(c => c.newFactIndex === idx);
                const keepNew = pendingFactConfirmation.conflictResolutions[idx] ?? true;
                return (
                  <div 
                    key={idx} 
                    className={`fact-item ${isConflicted ? (keepNew ? 'will-save' : 'will-skip') : 'will-save'}`}
                  >
                    <span className="fact-icon">{isConflicted && !keepNew ? '○' : '✓'}</span>
                    <span className="fact-text">{fact.summary}</span>
                    {isConflicted && !keepNew && <span className="fact-status">(keeping existing)</span>}
                  </div>
                );
              })}
            </div>
            
            {/* Action Buttons */}
            <div className="fact-confirmation-actions">
              <button 
                className="primary" 
                onClick={handleSaveFacts}
                disabled={isSavingFacts}
              >
                {isSavingFacts ? "Saving..." : "Save to Profile"}
              </button>
              <button 
                className="secondary" 
                onClick={handleSkipFacts}
                disabled={isSavingFacts}
              >
                Skip
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="chat-input-area">
        <textarea
          value={message}
          onChange={e => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          rows={1}
        />
        <button className="send-btn" onClick={handleSend} disabled={isLoading || !message.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Google Setup Modal
// ─────────────────────────────────────────────────────────────────────────────

function GoogleSetupModal({ onClose, onComplete }: { onClose: () => void; onComplete: () => void }) {
  const [step, setStep] = useState(1);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [authStatus, setAuthStatus] = useState<"idle" | "authorizing" | "success" | "error">("idle");
  const [authError, setAuthError] = useState("");

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const credentials = json.web || json.installed;
      
      if (credentials?.client_id && credentials?.client_secret) {
        setClientId(credentials.client_id);
        setClientSecret(credentials.client_secret);
      }
    } catch {
      alert("Invalid credentials file");
    }
  };

  const handleAuthorize = async () => {
    if (!clientId || !clientSecret) return;
    
    setAuthStatus("authorizing");
    setAuthError("");

    try {
      // Save credentials first
      await window.wovly.settings.set({
        googleCredentials: { clientId, clientSecret }
      });

      const result = await window.wovly.integrations.startGoogleOAuth(clientId, clientSecret);

      if (result.ok) {
        setAuthStatus("success");
        setTimeout(() => {
          onComplete();
        }, 1500);
      } else {
        setAuthStatus("error");
        setAuthError(result.error || "Authorization failed");
      }
    } catch (err) {
      setAuthStatus("error");
      setAuthError(err instanceof Error ? err.message : "Authorization failed");
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Connect Google Workspace</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {step === 1 && (
            <>
              <h3>Step 1: Create a Google Cloud Project</h3>
              <ol>
                <li>Go to <a href="https://console.cloud.google.com" target="_blank" rel="noreferrer">Google Cloud Console</a></li>
                <li>Create a new project or select an existing one</li>
                <li>Enable the following APIs:
                  <ul>
                    <li>Google Calendar API</li>
                    <li>Gmail API</li>
                    <li>Google Drive API</li>
                  </ul>
                </li>
              </ol>
              <button className="primary" onClick={() => setStep(2)}>Next</button>
            </>
          )}

          {step === 2 && (
            <>
              <h3>Step 2: Configure OAuth Consent Screen</h3>
              <ol>
                <li>Go to "OAuth consent screen" in the left menu</li>
                <li>Select "External" user type</li>
                <li>Fill in the required fields (app name, email)</li>
                <li>Add scopes for Calendar, Gmail, and Drive</li>
                <li>Add your email as a test user</li>
              </ol>
              <button className="secondary" onClick={() => setStep(1)}>Back</button>
              <button className="primary" onClick={() => setStep(3)}>Next</button>
            </>
          )}

          {step === 3 && (
            <>
              <h3>Step 3: Create OAuth Credentials</h3>
              <ol>
                <li>Go to "Credentials" in the left menu</li>
                <li>Click "Create Credentials" → "OAuth client ID"</li>
                <li><strong>Select "Web application"</strong> as application type</li>
                <li>Add this redirect URI:
                  <div className="code-block">http://localhost:18923/oauth/callback</div>
                </li>
                <li>Click "Create"</li>
              </ol>
              <button className="secondary" onClick={() => setStep(2)}>Back</button>
              <button className="primary" onClick={() => setStep(4)}>Next</button>
            </>
          )}

          {step === 4 && (
            <>
              <h3>Step 4: Enter Credentials</h3>
              <p>Upload the JSON file or enter manually:</p>
              
              <div className="form-group">
                <label>Upload credentials JSON:</label>
                <input type="file" accept=".json" onChange={handleFileUpload} />
              </div>
              
              <div className="form-group">
                <label>Client ID:</label>
                <input
                  type="text"
                  value={clientId}
                  onChange={e => setClientId(e.target.value)}
                  placeholder="Your client ID"
                />
              </div>
              
              <div className="form-group">
                <label>Client Secret:</label>
                <input
                  type="password"
                  value={clientSecret}
                  onChange={e => setClientSecret(e.target.value)}
                  placeholder="Your client secret"
                />
              </div>

              <button className="secondary" onClick={() => setStep(3)}>Back</button>
              <button className="primary" onClick={() => setStep(5)} disabled={!clientId || !clientSecret}>
                Next
              </button>
            </>
          )}

          {step === 5 && (
            <>
              <h3>Step 5: Authorize</h3>
              <p>Click below to authorize Wovly to access your Google account:</p>
              
              {authStatus === "idle" && (
                <button className="primary" onClick={handleAuthorize}>
                  Authorize with Google
                </button>
              )}
              
              {authStatus === "authorizing" && (
                <p className="info-text">Opening browser for authorization...</p>
              )}
              
              {authStatus === "success" && (
                <p className="success-text">✓ Authorization successful!</p>
              )}
              
              {authStatus === "error" && (
                <>
                  <p className="error-text">✗ {authError}</p>
                  <button className="primary" onClick={handleAuthorize}>Try Again</button>
                </>
              )}

              <button className="secondary" onClick={() => setStep(4)}>Back</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Slack Setup Modal
// ─────────────────────────────────────────────────────────────────────────────

function SlackSetupModal({ onClose, onComplete }: { onClose: () => void; onComplete: () => void }) {
  const [step, setStep] = useState(1);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [authStatus, setAuthStatus] = useState<"idle" | "authorizing" | "success" | "error">("idle");
  const [authError, setAuthError] = useState("");
  const [teamName, setTeamName] = useState("");
  
  // Tunnel state
  const [tunnelUrl, setTunnelUrl] = useState<string | null>(null);
  const [tunnelStatus, setTunnelStatus] = useState<"idle" | "starting" | "ready" | "error">("idle");
  const [tunnelError, setTunnelError] = useState("");

  // Cleanup tunnel on unmount
  useEffect(() => {
    return () => {
      window.wovly.integrations.stopSlackTunnel();
    };
  }, []);

  const handleStartTunnel = async () => {
    setTunnelStatus("starting");
    setTunnelError("");
    
    try {
      const result = await window.wovly.integrations.startSlackTunnel();
      if (result.ok && result.url) {
        setTunnelUrl(result.url);
        setTunnelStatus("ready");
      } else {
        setTunnelStatus("error");
        setTunnelError(result.error || "Failed to start tunnel");
      }
    } catch (err) {
      setTunnelStatus("error");
      setTunnelError(err instanceof Error ? err.message : "Failed to start tunnel");
    }
  };

  const handleAuthorize = async () => {
    if (!clientId || !clientSecret || !tunnelUrl) return;
    
    setAuthStatus("authorizing");
    setAuthError("");

    try {
      const result = await window.wovly.integrations.startSlackOAuth(clientId, clientSecret, tunnelUrl);

      if (result.ok) {
        setAuthStatus("success");
        setTeamName(result.team?.name || "");
        // Stop tunnel after successful auth
        window.wovly.integrations.stopSlackTunnel();
        setTimeout(() => {
          onComplete();
        }, 1500);
      } else {
        setAuthStatus("error");
        setAuthError(result.error || "Authorization failed");
      }
    } catch (err) {
      setAuthStatus("error");
      setAuthError(err instanceof Error ? err.message : "Authorization failed");
    }
  };

  const handleClose = () => {
    window.wovly.integrations.stopSlackTunnel();
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Connect Slack</h2>
          <button className="close-btn" onClick={handleClose}>×</button>
        </div>
        <div className="modal-body">
          {step === 1 && (
            <>
              <h3>Step 1: Create a Slack App</h3>
              <ol>
                <li>Go to <a href="https://api.slack.com/apps" target="_blank" rel="noreferrer">Slack API Apps</a></li>
                <li>Click <strong>"Create New App"</strong></li>
                <li>Select <strong>"From scratch"</strong></li>
                <li>Enter an app name (e.g., "Wovly Assistant")</li>
                <li>Select your workspace</li>
                <li>Click <strong>"Create App"</strong></li>
              </ol>
              <button className="primary" onClick={() => setStep(2)}>Next</button>
            </>
          )}

          {step === 2 && (
            <>
              <h3>Step 2: Configure User Permissions</h3>
              <p style={{ fontSize: "0.9rem", color: "#666", marginBottom: "12px" }}>
                We'll use <strong>User Token Scopes</strong> so messages are sent as you, not as a bot.
              </p>
              <ol>
                <li>In the left sidebar, click <strong>"OAuth & Permissions"</strong></li>
                <li>Scroll to <strong>"Scopes"</strong> → <strong>"User Token Scopes"</strong> (not Bot Token Scopes!)</li>
                <li>Click <strong>"Add an OAuth Scope"</strong> and add:
                  <ul style={{ fontSize: "0.85rem", marginTop: "8px" }}>
                    <li><code>channels:history</code> - Read messages in public channels</li>
                    <li><code>channels:read</code> - List public channels</li>
                    <li><code>channels:write</code> - Join/leave channels</li>
                    <li><code>chat:write</code> - Send messages as you</li>
                    <li><code>groups:history</code> - Read private channels</li>
                    <li><code>groups:read</code> - List private channels</li>
                    <li><code>groups:write</code> - Manage private channels</li>
                    <li><code>im:history</code> - Read DMs</li>
                    <li><code>im:read</code> - List DMs</li>
                    <li><code>im:write</code> - Send DMs</li>
                    <li><code>users:read</code> - View users</li>
                  </ul>
                </li>
              </ol>
              <div style={{ background: "#fff3cd", padding: "10px", borderRadius: "6px", marginTop: "12px", fontSize: "0.85rem" }}>
                ⚠️ Make sure you add these to <strong>User Token Scopes</strong>, not Bot Token Scopes
              </div>
              <button className="secondary" onClick={() => setStep(1)}>Back</button>
              <button className="primary" onClick={() => setStep(3)}>Next</button>
            </>
          )}

          {step === 3 && (
            <>
              <h3>Step 3: Start Secure Tunnel</h3>
              <p>Slack requires HTTPS redirect URLs. We'll create a secure tunnel using Cloudflare.</p>
              
              <div className="info-box" style={{ margin: "12px 0", padding: "12px", background: "#f0f9ff", borderRadius: "8px" }}>
                <p style={{ margin: 0, fontSize: "0.9rem" }}>
                  ℹ️ <strong>cloudflared</strong> will be installed automatically via Homebrew if needed.
                </p>
              </div>

              {tunnelStatus === "idle" && (
                <button className="primary" onClick={handleStartTunnel}>
                  🚀 Start Secure Tunnel
                </button>
              )}

              {tunnelStatus === "starting" && (
                <div className="auth-status">
                  <div className="loading-spinner"></div>
                  <p>Setting up secure tunnel...</p>
                  <p style={{ fontSize: "0.85rem", color: "#666" }}>
                    This may take a moment if installing cloudflared for the first time.
                  </p>
                </div>
              )}

              {tunnelStatus === "ready" && tunnelUrl && (
                <div className="auth-status success" style={{ textAlign: "left" }}>
                  <p style={{ marginBottom: "8px" }}>✅ Tunnel is ready!</p>
                  <p style={{ fontSize: "0.85rem", marginBottom: "12px", color: "#333" }}>Copy this redirect URL and add it to your Slack app:</p>
                  <div style={{ 
                    background: "#f5f5f5", 
                    padding: "12px", 
                    borderRadius: "6px", 
                    fontFamily: "monospace",
                    fontSize: "0.85rem",
                    wordBreak: "break-all",
                    color: "#1a1a1a",
                    border: "1px solid #e0e0e0"
                  }}>
                    {tunnelUrl}/oauth/callback
                  </div>
                  <button 
                    className="secondary small" 
                    style={{ marginTop: "8px" }}
                    onClick={() => navigator.clipboard.writeText(`${tunnelUrl}/oauth/callback`)}
                  >
                    📋 Copy URL
                  </button>
                </div>
              )}

              {tunnelStatus === "error" && (
                <div className="auth-status error">
                  <p>❌ {tunnelError}</p>
                  <button className="primary" onClick={handleStartTunnel}>Try Again</button>
                </div>
              )}

              <div style={{ marginTop: "16px" }}>
                <button className="secondary" onClick={() => setStep(2)}>Back</button>
                <button 
                  className="primary" 
                  onClick={() => setStep(4)} 
                  disabled={tunnelStatus !== "ready"}
                >
                  Next
                </button>
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <h3>Step 4: Add Redirect URL to Slack</h3>
              <ol>
                <li>In your Slack app, go to <strong>"OAuth & Permissions"</strong></li>
                <li>Scroll to <strong>"Redirect URLs"</strong></li>
                <li>Click <strong>"Add New Redirect URL"</strong></li>
                <li>Paste this URL:
                  <div className="code-block" style={{ 
                    margin: "8px 0", 
                    padding: "12px", 
                    background: "#f5f5f5", 
                    borderRadius: "4px", 
                    fontSize: "0.85rem",
                    wordBreak: "break-all",
                    color: "#1a1a1a",
                    fontFamily: "monospace"
                  }}>
                    {tunnelUrl}/oauth/callback
                  </div>
                </li>
                <li>Click <strong>"Add"</strong> then <strong>"Save URLs"</strong></li>
              </ol>
              <button className="secondary" onClick={() => setStep(3)}>Back</button>
              <button className="primary" onClick={() => setStep(5)}>Next</button>
            </>
          )}

          {step === 5 && (
            <>
              <h3>Step 5: Get Client Credentials</h3>
              <ol>
                <li>In the left sidebar, click <strong>"Basic Information"</strong></li>
                <li>Scroll to <strong>"App Credentials"</strong></li>
                <li>Copy the <strong>Client ID</strong> and <strong>Client Secret</strong></li>
              </ol>
              
              <div className="form-group" style={{ marginTop: "16px" }}>
                <label>Client ID</label>
                <input
                  type="text"
                  value={clientId}
                  onChange={e => setClientId(e.target.value)}
                  placeholder="Paste your Client ID"
                />
              </div>
              
              <div className="form-group">
                <label>Client Secret</label>
                <input
                  type="password"
                  value={clientSecret}
                  onChange={e => setClientSecret(e.target.value)}
                  placeholder="Paste your Client Secret"
                />
              </div>

              <button className="secondary" onClick={() => setStep(4)}>Back</button>
              <button className="primary" onClick={() => setStep(6)} disabled={!clientId || !clientSecret}>
                Next
              </button>
            </>
          )}

          {step === 6 && (
            <>
              <h3>Step 6: Authorize Wovly</h3>
              <p>Click the button below to authorize Wovly to access your Slack workspace.</p>
              
              {authStatus === "idle" && (
                <button className="primary auth-button" onClick={handleAuthorize}>
                  🔗 Connect to Slack
                </button>
              )}

              {authStatus === "authorizing" && (
                <div className="auth-status">
                  <div className="loading-spinner"></div>
                  <p>Waiting for authorization...</p>
                  <p style={{ fontSize: "0.85rem", color: "#666" }}>
                    Complete the authorization in the browser window that opened.
                  </p>
                </div>
              )}

              {authStatus === "success" && (
                <div className="auth-status success">
                  <div className="success-icon">✓</div>
                  <p>Connected to {teamName || "Slack"}!</p>
                </div>
              )}

              {authStatus === "error" && (
                <div className="auth-status error">
                  <p>❌ {authError}</p>
                  <button className="primary" onClick={handleAuthorize}>Try Again</button>
                </div>
              )}

              <button className="secondary" onClick={() => setStep(5)}>Back</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// iMessage Setup Modal
// ─────────────────────────────────────────────────────────────────────────────

function IMessageSetupModal({ onClose }: { onClose: () => void }) {
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [testMessage, setTestMessage] = useState("");

  const handleTest = async () => {
    setTestStatus("testing");
    try {
      const result = await window.wovly.integrations.testIMessage();
      if (result.ok) {
        setTestStatus("success");
        setTestMessage(result.message || "Connection successful");
      } else {
        setTestStatus("error");
        setTestMessage(result.error || "Connection failed");
      }
    } catch (err) {
      setTestStatus("error");
      setTestMessage(err instanceof Error ? err.message : "Test failed");
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>iMessage Integration</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <h3>Grant Full Disk Access</h3>
          <p>To access your messages, this app needs Full Disk Access:</p>
          <ol>
            <li>Open System Settings → Privacy & Security → Full Disk Access</li>
            <li>Click the + button</li>
            <li>Add Electron (or your terminal app if running in dev mode)</li>
            <li>Restart the app</li>
          </ol>
          
          <button className="primary" onClick={handleTest} disabled={testStatus === "testing"}>
            {testStatus === "testing" ? "Testing..." : "Test iMessage Access"}
          </button>
          
          {testStatus === "success" && <p className="success-text">✓ {testMessage}</p>}
          {testStatus === "error" && <p className="error-text">✗ {testMessage}</p>}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp Setup Modal
// ─────────────────────────────────────────────────────────────────────────────

type WhatsAppStatus = "disconnected" | "connecting" | "connected" | "qr_ready";

function WhatsAppSetupModal({ 
  onClose, 
  onConnect 
}: { 
  onClose: () => void; 
  onConnect: () => void;
}) {
  const [status, setStatus] = useState<WhatsAppStatus>("disconnected");
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [step, setStep] = useState(1);

  useEffect(() => {
    // Subscribe to status updates
    const unsubscribe = window.wovly.whatsapp.onStatus((data) => {
      setStatus(data.status);
      if (data.qr) {
        setQrCode(data.qr);
      }
      if (data.status === "connected") {
        setTimeout(() => {
          onConnect();
        }, 1500);
      }
    });

    // Get initial status
    window.wovly.whatsapp.getStatus().then((result) => {
      if (result.ok) {
        setStatus(result.status);
        if (result.qr) {
          setQrCode(result.qr);
        }
      }
    });

    return unsubscribe;
  }, [onConnect]);

  const handleConnect = async () => {
    setStep(2);
    await window.wovly.whatsapp.connect();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal whatsapp-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Connect WhatsApp</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {step === 1 && (
            <>
              <div className="whatsapp-intro">
                <div className="whatsapp-icon-large">📱</div>
                <h3>Chat with Wovly via WhatsApp</h3>
                <p>Connect your WhatsApp to send and receive messages from Wovly on your phone.</p>
              </div>
              
              <div className="info-box">
                <p><strong>How it works:</strong></p>
                <ul style={{ margin: "8px 0 0 0", paddingLeft: "20px" }}>
                  <li>We'll show you a QR code</li>
                  <li>Scan it with WhatsApp on your phone</li>
                  <li><strong>Message yourself</strong> on WhatsApp to chat with Wovly</li>
                </ul>
              </div>

              <div className="info-box">
                <p><strong>To chat with Wovly:</strong></p>
                <p style={{ margin: "4px 0 0 0", fontSize: "0.9rem" }}>
                  In WhatsApp, find "<strong>Message yourself</strong>" (or your own number) in your contacts and send messages there. Wovly will respond!
                </p>
              </div>

              <button className="primary auth-button" onClick={handleConnect}>
                Continue to Setup
              </button>
            </>
          )}

          {step === 2 && (
            <>
              <h3>Scan QR Code with WhatsApp</h3>
              
              <ol className="setup-instructions">
                <li>Open WhatsApp on your phone</li>
                <li>Tap <strong>Settings</strong> → <strong>Linked Devices</strong></li>
                <li>Tap <strong>Link a Device</strong></li>
                <li>Point your phone at the QR code below</li>
              </ol>

              <div className="qr-container">
                {status === "connecting" && !qrCode && (
                  <div className="qr-loading">
                    <div className="loading-spinner"></div>
                    <p>Preparing QR code...</p>
                  </div>
                )}
                
                {status === "qr_ready" && qrCode && (
                  <div className="qr-display">
                    <img src={qrCode} alt="WhatsApp QR Code" className="qr-image" />
                    <p className="qr-hint">Scan this code with WhatsApp</p>
                  </div>
                )}

                {status === "connected" && (
                  <div className="qr-success">
                    <div className="success-icon">✓</div>
                    <p className="success-text">WhatsApp Connected!</p>
                    <div className="success-instructions">
                      <p><strong>How to chat with Wovly:</strong></p>
                      <ol>
                        <li>Open WhatsApp on your phone</li>
                        <li>Find "<strong>Message yourself</strong>" in your contacts<br/>
                          <span style={{ fontSize: "0.85rem", color: "#666" }}>(or search for your own phone number)</span>
                        </li>
                        <li>Send a message - Wovly will reply with [Wovly] prefix</li>
                      </ol>
                    </div>
                  </div>
                )}
              </div>

              {status !== "connected" && (
                <button className="secondary" onClick={() => setStep(1)}>Back</button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Telegram Setup Modal
// ─────────────────────────────────────────────────────────────────────────────

function TelegramSetupModal({ onClose, onComplete }: { onClose: () => void; onComplete: () => void }) {
  const [step, setStep] = useState(1);
  const [token, setToken] = useState("");
  const [authStatus, setAuthStatus] = useState<"idle" | "connecting" | "success" | "error">("idle");
  const [authError, setAuthError] = useState("");

  const handleConnect = async () => {
    if (!token) return;
    
    setAuthStatus("connecting");
    setAuthError("");

    try {
      const result = await window.wovly.telegram.setToken(token);
      if (result.ok) {
        setAuthStatus("success");
        setTimeout(onComplete, 1500);
      } else {
        setAuthStatus("error");
        setAuthError(result.error || "Connection failed");
      }
    } catch (err) {
      setAuthStatus("error");
      setAuthError(err instanceof Error ? err.message : "Connection failed");
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Connect Telegram</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {step === 1 && (
            <>
              <h3>Step 1: Create a Telegram Bot</h3>
              <ol>
                <li>Open Telegram and search for <strong>@BotFather</strong></li>
                <li>Send the command <code>/newbot</code></li>
                <li>Follow the prompts to name your bot</li>
                <li>Copy the bot token provided by BotFather</li>
              </ol>
              <button className="primary" onClick={() => setStep(2)}>Next</button>
            </>
          )}

          {step === 2 && (
            <>
              <h3>Step 2: Enter Bot Token</h3>
              <p>Paste the bot token you received from @BotFather:</p>
              
              <div className="form-group">
                <label>Bot Token:</label>
                <input
                  type="password"
                  value={token}
                  onChange={e => setToken(e.target.value)}
                  placeholder="123456789:ABCdefGHIjklmNOPqrs..."
                />
              </div>

              {authStatus === "idle" && (
                <button className="primary" onClick={handleConnect} disabled={!token}>
                  Connect
                </button>
              )}
              
              {authStatus === "connecting" && (
                <p className="info-text">Connecting to Telegram...</p>
              )}
              
              {authStatus === "success" && (
                <p className="success-text">✓ Connected successfully!</p>
              )}
              
              {authStatus === "error" && (
                <>
                  <p className="error-text">✗ {authError}</p>
                  <button className="primary" onClick={handleConnect}>Try Again</button>
                </>
              )}

              <button className="secondary" onClick={() => setStep(1)}>Back</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Discord Setup Modal
// ─────────────────────────────────────────────────────────────────────────────

function DiscordSetupModal({ onClose, onComplete }: { onClose: () => void; onComplete: () => void }) {
  const [step, setStep] = useState(1);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [authStatus, setAuthStatus] = useState<"idle" | "authorizing" | "success" | "error">("idle");
  const [authError, setAuthError] = useState("");

  const handleAuthorize = async () => {
    if (!clientId || !clientSecret) return;
    
    setAuthStatus("authorizing");
    setAuthError("");

    try {
      const result = await window.wovly.discord.startOAuth(clientId, clientSecret);
      if (result.ok) {
        setAuthStatus("success");
        setTimeout(onComplete, 1500);
      } else {
        setAuthStatus("error");
        setAuthError(result.error || "Authorization failed");
      }
    } catch (err) {
      setAuthStatus("error");
      setAuthError(err instanceof Error ? err.message : "Authorization failed");
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Connect Discord</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {step === 1 && (
            <>
              <h3>Step 1: Create a Discord Application</h3>
              <ol>
                <li>Go to <a href="https://discord.com/developers/applications" target="_blank" rel="noreferrer">Discord Developer Portal</a></li>
                <li>Click "New Application"</li>
                <li>Name your application</li>
              </ol>
              <button className="primary" onClick={() => setStep(2)}>Next</button>
            </>
          )}

          {step === 2 && (
            <>
              <h3>Step 2: Create a Bot</h3>
              <ol>
                <li>Go to the "Bot" section in the left menu</li>
                <li>Click "Add Bot"</li>
                <li>Enable "Message Content Intent" under Privileged Gateway Intents</li>
              </ol>
              <button className="secondary" onClick={() => setStep(1)}>Back</button>
              <button className="primary" onClick={() => setStep(3)}>Next</button>
            </>
          )}

          {step === 3 && (
            <>
              <h3>Step 3: Configure OAuth2</h3>
              <ol>
                <li>Go to the "OAuth2" section</li>
                <li>Add this redirect URI:
                  <div className="code-block">http://localhost:18923/oauth/callback</div>
                </li>
                <li>Copy the Client ID and Client Secret</li>
              </ol>
              <button className="secondary" onClick={() => setStep(2)}>Back</button>
              <button className="primary" onClick={() => setStep(4)}>Next</button>
            </>
          )}

          {step === 4 && (
            <>
              <h3>Step 4: Enter Credentials</h3>
              
              <div className="form-group">
                <label>Client ID:</label>
                <input
                  type="text"
                  value={clientId}
                  onChange={e => setClientId(e.target.value)}
                  placeholder="Your client ID"
                />
              </div>
              
              <div className="form-group">
                <label>Client Secret:</label>
                <input
                  type="password"
                  value={clientSecret}
                  onChange={e => setClientSecret(e.target.value)}
                  placeholder="Your client secret"
                />
              </div>

              {authStatus === "idle" && (
                <button className="primary" onClick={handleAuthorize} disabled={!clientId || !clientSecret}>
                  Authorize with Discord
                </button>
              )}
              
              {authStatus === "authorizing" && (
                <p className="info-text">Opening browser for authorization...</p>
              )}
              
              {authStatus === "success" && (
                <p className="success-text">✓ Authorization successful!</p>
              )}
              
              {authStatus === "error" && (
                <>
                  <p className="error-text">✗ {authError}</p>
                  <button className="primary" onClick={handleAuthorize}>Try Again</button>
                </>
              )}

              <button className="secondary" onClick={() => setStep(3)}>Back</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// X (Twitter) Setup Modal
// ─────────────────────────────────────────────────────────────────────────────

function XSetupModal({ onClose, onComplete }: { onClose: () => void; onComplete: () => void }) {
  const [step, setStep] = useState(1);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [authStatus, setAuthStatus] = useState<"idle" | "authorizing" | "success" | "error">("idle");
  const [authError, setAuthError] = useState("");

  const handleAuthorize = async () => {
    if (!clientId || !clientSecret) return;
    
    setAuthStatus("authorizing");
    setAuthError("");

    try {
      const result = await window.wovly.x.startOAuth(clientId, clientSecret);
      if (result.ok) {
        setAuthStatus("success");
        setTimeout(onComplete, 1500);
      } else {
        setAuthStatus("error");
        setAuthError(result.error || "Authorization failed");
      }
    } catch (err) {
      setAuthStatus("error");
      setAuthError(err instanceof Error ? err.message : "Authorization failed");
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Connect X (Twitter)</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {step === 1 && (
            <>
              <h3>Step 1: Create Developer Account</h3>
              <ol>
                <li>Go to <a href="https://developer.x.com" target="_blank" rel="noreferrer">X Developer Portal</a></li>
                <li>Sign up for a developer account</li>
                <li>Create a new Project and App</li>
              </ol>
              <button className="primary" onClick={() => setStep(2)}>Next</button>
            </>
          )}

          {step === 2 && (
            <>
              <h3>Step 2: Configure App Settings</h3>
              <ol>
                <li>Go to "User authentication settings"</li>
                <li>Enable OAuth 2.0</li>
                <li>Set App permissions to "Read and write"</li>
                <li>Add callback URL:
                  <div className="code-block">http://localhost:18923/oauth/callback</div>
                </li>
              </ol>
              <button className="secondary" onClick={() => setStep(1)}>Back</button>
              <button className="primary" onClick={() => setStep(3)}>Next</button>
            </>
          )}

          {step === 3 && (
            <>
              <h3>Step 3: Get Credentials</h3>
              <ol>
                <li>Go to "Keys and tokens" tab</li>
                <li>Copy Client ID (OAuth 2.0)</li>
                <li>Generate and copy Client Secret</li>
              </ol>
              <button className="secondary" onClick={() => setStep(2)}>Back</button>
              <button className="primary" onClick={() => setStep(4)}>Next</button>
            </>
          )}

          {step === 4 && (
            <>
              <h3>Step 4: Enter Credentials</h3>
              <p className="info-text">Note: Free tier has limits (500 posts/100 reads per month)</p>
              
              <div className="form-group">
                <label>Client ID:</label>
                <input
                  type="text"
                  value={clientId}
                  onChange={e => setClientId(e.target.value)}
                  placeholder="Your OAuth 2.0 client ID"
                />
              </div>
              
              <div className="form-group">
                <label>Client Secret:</label>
                <input
                  type="password"
                  value={clientSecret}
                  onChange={e => setClientSecret(e.target.value)}
                  placeholder="Your client secret"
                />
              </div>

              {authStatus === "idle" && (
                <button className="primary" onClick={handleAuthorize} disabled={!clientId || !clientSecret}>
                  Authorize with X
                </button>
              )}
              
              {authStatus === "authorizing" && (
                <p className="info-text">Opening browser for authorization...</p>
              )}
              
              {authStatus === "success" && (
                <p className="success-text">✓ Authorization successful!</p>
              )}
              
              {authStatus === "error" && (
                <>
                  <p className="error-text">✗ {authError}</p>
                  <button className="primary" onClick={handleAuthorize}>Try Again</button>
                </>
              )}

              <button className="secondary" onClick={() => setStep(3)}>Back</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Notion Setup Modal
// ─────────────────────────────────────────────────────────────────────────────

function NotionSetupModal({ onClose, onComplete }: { onClose: () => void; onComplete: () => void }) {
  const [step, setStep] = useState(1);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [authStatus, setAuthStatus] = useState<"idle" | "authorizing" | "success" | "error">("idle");
  const [authError, setAuthError] = useState("");

  const handleAuthorize = async () => {
    if (!clientId || !clientSecret) return;
    
    setAuthStatus("authorizing");
    setAuthError("");

    try {
      const result = await window.wovly.notion.startOAuth(clientId, clientSecret);
      if (result.ok) {
        setAuthStatus("success");
        setTimeout(onComplete, 1500);
      } else {
        setAuthStatus("error");
        setAuthError(result.error || "Authorization failed");
      }
    } catch (err) {
      setAuthStatus("error");
      setAuthError(err instanceof Error ? err.message : "Authorization failed");
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Connect Notion</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {step === 1 && (
            <>
              <h3>Step 1: Create Integration</h3>
              <ol>
                <li>Go to <a href="https://www.notion.so/my-integrations" target="_blank" rel="noreferrer">Notion Integrations</a></li>
                <li>Click "New integration"</li>
                <li>Name it and select your workspace</li>
                <li>Set capabilities (Read/Update/Insert content)</li>
              </ol>
              <button className="primary" onClick={() => setStep(2)}>Next</button>
            </>
          )}

          {step === 2 && (
            <>
              <h3>Step 2: Enable OAuth (Public Integration)</h3>
              <ol>
                <li>Go to the "Distribution" tab</li>
                <li>Enable public integration</li>
                <li>Add redirect URI:
                  <div className="code-block">http://localhost:18923/oauth/callback</div>
                </li>
                <li>Copy OAuth client ID and secret</li>
              </ol>
              <button className="secondary" onClick={() => setStep(1)}>Back</button>
              <button className="primary" onClick={() => setStep(3)}>Next</button>
            </>
          )}

          {step === 3 && (
            <>
              <h3>Step 3: Enter Credentials</h3>
              <p className="info-text">Note: You'll need to share pages with the integration in Notion</p>
              
              <div className="form-group">
                <label>OAuth Client ID:</label>
                <input
                  type="text"
                  value={clientId}
                  onChange={e => setClientId(e.target.value)}
                  placeholder="Your OAuth client ID"
                />
              </div>
              
              <div className="form-group">
                <label>OAuth Client Secret:</label>
                <input
                  type="password"
                  value={clientSecret}
                  onChange={e => setClientSecret(e.target.value)}
                  placeholder="Your OAuth client secret"
                />
              </div>

              {authStatus === "idle" && (
                <button className="primary" onClick={handleAuthorize} disabled={!clientId || !clientSecret}>
                  Authorize with Notion
                </button>
              )}
              
              {authStatus === "authorizing" && (
                <p className="info-text">Opening browser for authorization...</p>
              )}
              
              {authStatus === "success" && (
                <p className="success-text">✓ Authorization successful!</p>
              )}
              
              {authStatus === "error" && (
                <>
                  <p className="error-text">✗ {authError}</p>
                  <button className="primary" onClick={handleAuthorize}>Try Again</button>
                </>
              )}

              <button className="secondary" onClick={() => setStep(2)}>Back</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GitHub Setup Modal
// ─────────────────────────────────────────────────────────────────────────────

function GitHubSetupModal({ onClose, onComplete }: { onClose: () => void; onComplete: () => void }) {
  const [step, setStep] = useState(1);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [authStatus, setAuthStatus] = useState<"idle" | "authorizing" | "success" | "error">("idle");
  const [authError, setAuthError] = useState("");

  const handleAuthorize = async () => {
    if (!clientId || !clientSecret) return;
    
    setAuthStatus("authorizing");
    setAuthError("");

    try {
      const result = await window.wovly.github.startOAuth(clientId, clientSecret);
      if (result.ok) {
        setAuthStatus("success");
        setTimeout(onComplete, 1500);
      } else {
        setAuthStatus("error");
        setAuthError(result.error || "Authorization failed");
      }
    } catch (err) {
      setAuthStatus("error");
      setAuthError(err instanceof Error ? err.message : "Authorization failed");
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Connect GitHub</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {step === 1 && (
            <>
              <h3>Step 1: Create OAuth App</h3>
              <ol>
                <li>Go to <a href="https://github.com/settings/developers" target="_blank" rel="noreferrer">GitHub Developer Settings</a></li>
                <li>Click "New OAuth App"</li>
                <li>Fill in application name and homepage URL</li>
              </ol>
              <button className="primary" onClick={() => setStep(2)}>Next</button>
            </>
          )}

          {step === 2 && (
            <>
              <h3>Step 2: Configure OAuth</h3>
              <ol>
                <li>Set Authorization callback URL:
                  <div className="code-block">http://localhost:18923/oauth/callback</div>
                </li>
                <li>Register the application</li>
                <li>Copy Client ID</li>
                <li>Generate and copy Client Secret</li>
              </ol>
              <button className="secondary" onClick={() => setStep(1)}>Back</button>
              <button className="primary" onClick={() => setStep(3)}>Next</button>
            </>
          )}

          {step === 3 && (
            <>
              <h3>Step 3: Enter Credentials</h3>
              
              <div className="form-group">
                <label>Client ID:</label>
                <input
                  type="text"
                  value={clientId}
                  onChange={e => setClientId(e.target.value)}
                  placeholder="Your client ID"
                />
              </div>
              
              <div className="form-group">
                <label>Client Secret:</label>
                <input
                  type="password"
                  value={clientSecret}
                  onChange={e => setClientSecret(e.target.value)}
                  placeholder="Your client secret"
                />
              </div>

              {authStatus === "idle" && (
                <button className="primary" onClick={handleAuthorize} disabled={!clientId || !clientSecret}>
                  Authorize with GitHub
                </button>
              )}
              
              {authStatus === "authorizing" && (
                <p className="info-text">Opening browser for authorization...</p>
              )}
              
              {authStatus === "success" && (
                <p className="success-text">✓ Authorization successful!</p>
              )}
              
              {authStatus === "error" && (
                <>
                  <p className="error-text">✗ {authError}</p>
                  <button className="primary" onClick={handleAuthorize}>Try Again</button>
                </>
              )}

              <button className="secondary" onClick={() => setStep(2)}>Back</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Asana Setup Modal
// ─────────────────────────────────────────────────────────────────────────────

function AsanaSetupModal({ onClose, onComplete }: { onClose: () => void; onComplete: () => void }) {
  const [step, setStep] = useState(1);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [authStatus, setAuthStatus] = useState<"idle" | "authorizing" | "success" | "error">("idle");
  const [authError, setAuthError] = useState("");

  const handleAuthorize = async () => {
    if (!clientId || !clientSecret) return;
    
    setAuthStatus("authorizing");
    setAuthError("");

    try {
      const result = await window.wovly.asana.startOAuth(clientId, clientSecret);
      if (result.ok) {
        setAuthStatus("success");
        setTimeout(onComplete, 1500);
      } else {
        setAuthStatus("error");
        setAuthError(result.error || "Authorization failed");
      }
    } catch (err) {
      setAuthStatus("error");
      setAuthError(err instanceof Error ? err.message : "Authorization failed");
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Connect Asana</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {step === 1 && (
            <>
              <h3>Step 1: Create App</h3>
              <ol>
                <li>Go to <a href="https://app.asana.com/0/my-apps" target="_blank" rel="noreferrer">Asana Developer Console</a></li>
                <li>Click "Create New App"</li>
                <li>Name your application</li>
              </ol>
              <button className="primary" onClick={() => setStep(2)}>Next</button>
            </>
          )}

          {step === 2 && (
            <>
              <h3>Step 2: Configure OAuth</h3>
              <ol>
                <li>Go to the "OAuth" tab</li>
                <li>Add redirect URL:
                  <div className="code-block">http://localhost:18923/oauth/callback</div>
                </li>
                <li>Copy Client ID and Client Secret</li>
              </ol>
              <button className="secondary" onClick={() => setStep(1)}>Back</button>
              <button className="primary" onClick={() => setStep(3)}>Next</button>
            </>
          )}

          {step === 3 && (
            <>
              <h3>Step 3: Enter Credentials</h3>
              
              <div className="form-group">
                <label>Client ID:</label>
                <input
                  type="text"
                  value={clientId}
                  onChange={e => setClientId(e.target.value)}
                  placeholder="Your client ID"
                />
              </div>
              
              <div className="form-group">
                <label>Client Secret:</label>
                <input
                  type="password"
                  value={clientSecret}
                  onChange={e => setClientSecret(e.target.value)}
                  placeholder="Your client secret"
                />
              </div>

              {authStatus === "idle" && (
                <button className="primary" onClick={handleAuthorize} disabled={!clientId || !clientSecret}>
                  Authorize with Asana
                </button>
              )}
              
              {authStatus === "authorizing" && (
                <p className="info-text">Opening browser for authorization...</p>
              )}
              
              {authStatus === "success" && (
                <p className="success-text">✓ Authorization successful!</p>
              )}
              
              {authStatus === "error" && (
                <>
                  <p className="error-text">✗ {authError}</p>
                  <button className="primary" onClick={handleAuthorize}>Try Again</button>
                </>
              )}

              <button className="secondary" onClick={() => setStep(2)}>Back</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Reddit Setup Modal
// ─────────────────────────────────────────────────────────────────────────────

function RedditSetupModal({ onClose, onComplete }: { onClose: () => void; onComplete: () => void }) {
  const [step, setStep] = useState(1);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [authStatus, setAuthStatus] = useState<"idle" | "authorizing" | "success" | "error">("idle");
  const [authError, setAuthError] = useState("");

  const handleAuthorize = async () => {
    if (!clientId || !clientSecret) return;
    
    setAuthStatus("authorizing");
    setAuthError("");

    try {
      const result = await window.wovly.reddit.startOAuth(clientId, clientSecret);
      if (result.ok) {
        setAuthStatus("success");
        setTimeout(onComplete, 1500);
      } else {
        setAuthStatus("error");
        setAuthError(result.error || "Authorization failed");
      }
    } catch (err) {
      setAuthStatus("error");
      setAuthError(err instanceof Error ? err.message : "Authorization failed");
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Connect Reddit</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {step === 1 && (
            <>
              <h3>Step 1: Create App</h3>
              <ol>
                <li>Go to <a href="https://www.reddit.com/prefs/apps" target="_blank" rel="noreferrer">Reddit App Preferences</a></li>
                <li>Click "create another app..."</li>
                <li>Select "web app" type</li>
                <li>Set redirect URI:
                  <div className="code-block">http://localhost:18923/oauth/callback</div>
                </li>
              </ol>
              <button className="primary" onClick={() => setStep(2)}>Next</button>
            </>
          )}

          {step === 2 && (
            <>
              <h3>Step 2: Get Credentials</h3>
              <ol>
                <li>Copy the Client ID (shown under the app name)</li>
                <li>Copy the Client Secret</li>
              </ol>
              <button className="secondary" onClick={() => setStep(1)}>Back</button>
              <button className="primary" onClick={() => setStep(3)}>Next</button>
            </>
          )}

          {step === 3 && (
            <>
              <h3>Step 3: Enter Credentials</h3>
              
              <div className="form-group">
                <label>Client ID:</label>
                <input
                  type="text"
                  value={clientId}
                  onChange={e => setClientId(e.target.value)}
                  placeholder="Your client ID"
                />
              </div>
              
              <div className="form-group">
                <label>Client Secret:</label>
                <input
                  type="password"
                  value={clientSecret}
                  onChange={e => setClientSecret(e.target.value)}
                  placeholder="Your client secret"
                />
              </div>

              {authStatus === "idle" && (
                <button className="primary" onClick={handleAuthorize} disabled={!clientId || !clientSecret}>
                  Authorize with Reddit
                </button>
              )}
              
              {authStatus === "authorizing" && (
                <p className="info-text">Opening browser for authorization...</p>
              )}
              
              {authStatus === "success" && (
                <p className="success-text">✓ Authorization successful!</p>
              )}
              
              {authStatus === "error" && (
                <>
                  <p className="error-text">✗ {authError}</p>
                  <button className="primary" onClick={handleAuthorize}>Try Again</button>
                </>
              )}

              <button className="secondary" onClick={() => setStep(2)}>Back</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Spotify Setup Modal
// ─────────────────────────────────────────────────────────────────────────────

function SpotifySetupModal({ onClose, onComplete }: { onClose: () => void; onComplete: () => void }) {
  const [step, setStep] = useState(1);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [authStatus, setAuthStatus] = useState<"idle" | "authorizing" | "success" | "error">("idle");
  const [authError, setAuthError] = useState("");

  const handleAuthorize = async () => {
    if (!clientId || !clientSecret) return;
    
    setAuthStatus("authorizing");
    setAuthError("");

    try {
      const result = await window.wovly.spotify.startOAuth(clientId, clientSecret);
      if (result.ok) {
        setAuthStatus("success");
        setTimeout(onComplete, 1500);
      } else {
        setAuthStatus("error");
        setAuthError(result.error || "Authorization failed");
      }
    } catch (err) {
      setAuthStatus("error");
      setAuthError(err instanceof Error ? err.message : "Authorization failed");
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Connect Spotify</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {step === 1 && (
            <>
              <h3>Step 1: Create App</h3>
              <ol>
                <li>Go to <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">Spotify Developer Dashboard</a></li>
                <li>Click "Create app"</li>
                <li>Name your app and add a description</li>
              </ol>
              <button className="primary" onClick={() => setStep(2)}>Next</button>
            </>
          )}

          {step === 2 && (
            <>
              <h3>Step 2: Configure Settings</h3>
              <ol>
                <li>Go to app settings</li>
                <li>Add redirect URI:
                  <div className="code-block">http://localhost:18923/oauth/callback</div>
                </li>
                <li>Copy Client ID and Client Secret</li>
              </ol>
              <button className="secondary" onClick={() => setStep(1)}>Back</button>
              <button className="primary" onClick={() => setStep(3)}>Next</button>
            </>
          )}

          {step === 3 && (
            <>
              <h3>Step 3: Enter Credentials</h3>
              <p className="info-text">Note: Playback control requires Spotify Premium</p>
              
              <div className="form-group">
                <label>Client ID:</label>
                <input
                  type="text"
                  value={clientId}
                  onChange={e => setClientId(e.target.value)}
                  placeholder="Your client ID"
                />
              </div>
              
              <div className="form-group">
                <label>Client Secret:</label>
                <input
                  type="password"
                  value={clientSecret}
                  onChange={e => setClientSecret(e.target.value)}
                  placeholder="Your client secret"
                />
              </div>

              {authStatus === "idle" && (
                <button className="primary" onClick={handleAuthorize} disabled={!clientId || !clientSecret}>
                  Authorize with Spotify
                </button>
              )}
              
              {authStatus === "authorizing" && (
                <p className="info-text">Opening browser for authorization...</p>
              )}
              
              {authStatus === "success" && (
                <p className="success-text">✓ Authorization successful!</p>
              )}
              
              {authStatus === "error" && (
                <>
                  <p className="error-text">✗ {authError}</p>
                  <button className="primary" onClick={handleAuthorize}>Try Again</button>
                </>
              )}

              <button className="secondary" onClick={() => setStep(2)}>Back</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tasks Page
// ─────────────────────────────────────────────────────────────────────────────

type TaskStatus = "pending" | "active" | "waiting" | "waiting_approval" | "waiting_for_input" | "completed" | "failed" | "cancelled";

type PendingMessageType = {
  id: string;
  toolName: string;
  platform: string;
  recipient: string;
  subject?: string;
  message: string;
  created: string;
};

type PollFrequency = {
  type: "preset" | "custom" | "event";
  value: number | string;
  label: string;
};

type TaskType = {
  id: string;
  title: string;
  status: TaskStatus;
  created: string;
  lastUpdated: string;
  nextCheck: number | null;
  autoSend?: boolean;
  pollFrequency?: PollFrequency;
  originalRequest: string;
  plan: string[];
  currentStep: {
    step: number;
    description: string;
    state: string;
    pollInterval: number | null;
  };
  executionLog: Array<{ timestamp: string; message: string }>;
  contextMemory: Record<string, string>;
  pendingMessages?: PendingMessageType[];
};

function TaskEditModal({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const [markdown, setMarkdown] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const loadMarkdown = async () => {
      if (!window.wovly) return;
      const result = await window.wovly.tasks.getRawMarkdown(taskId);
      if (result.ok && result.markdown) {
        setMarkdown(result.markdown);
      } else {
        setError(result.error || "Failed to load task");
      }
      setLoading(false);
    };
    loadMarkdown();
  }, [taskId]);

  const handleSave = async () => {
    if (!window.wovly) return;
    setSaving(true);
    setError("");
    
    const result = await window.wovly.tasks.saveRawMarkdown(taskId, markdown);
    if (result.ok) {
      onClose();
    } else {
      setError(result.error || "Failed to save");
    }
    setSaving(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal task-edit-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Edit Task: {taskId}</h2>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <div className="warning-banner">
            <span className="warning-icon">⚠️</span>
            <span>
              <strong>Warning:</strong> Direct edits may break task execution. 
              Only modify if you understand the file format.
            </span>
          </div>
          
          {loading ? (
            <div className="loading">Loading...</div>
          ) : (
            <textarea
              className="markdown-editor"
              value={markdown}
              onChange={e => setMarkdown(e.target.value)}
              spellCheck={false}
            />
          )}
          
          {error && <div className="error-message">{error}</div>}
          
          <div className="modal-actions">
            <button className="secondary" onClick={onClose}>Cancel</button>
            <button className="primary" onClick={handleSave} disabled={saving || loading}>
              {saving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Countdown timer component for task next check
function CountdownTimer({ targetTime }: { targetTime: number }) {
  const [timeLeft, setTimeLeft] = useState(() => Math.max(0, targetTime - Date.now()));
  
  useEffect(() => {
    const timer = setInterval(() => {
      const remaining = Math.max(0, targetTime - Date.now());
      setTimeLeft(remaining);
    }, 1000);
    
    return () => clearInterval(timer);
  }, [targetTime]);
  
  if (timeLeft <= 0) {
    return <span className="countdown-checking">Checking now...</span>;
  }
  
  const seconds = Math.floor(timeLeft / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return <span className="countdown-timer">{hours}h {minutes % 60}m {seconds % 60}s</span>;
  } else if (minutes > 0) {
    return <span className="countdown-timer">{minutes}m {seconds % 60}s</span>;
  } else {
    return <span className="countdown-timer">{seconds}s</span>;
  }
}

function TasksPage() {
  const [tasks, setTasks] = useState<TaskType[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<string | null>(null);
  const [executing, setExecuting] = useState<string | null>(null);
  const [, setTick] = useState(0); // Force re-render for countdown updates
  
  // Pending message state
  const [editingMessage, setEditingMessage] = useState<{ taskId: string; messageId: string; content: string } | null>(null);
  const [sendingMessage, setSendingMessage] = useState<string | null>(null);

  const loadTasks = async () => {
    if (!window.wovly) return;
    const result = await window.wovly.tasks.list();
    if (result.ok && result.tasks) {
      setTasks(result.tasks as TaskType[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadTasks();
    
    // Subscribe to task updates
    let unsubscribe: (() => void) | undefined;
    let unsubscribePending: (() => void) | undefined;
    
    if (window.wovly) {
      unsubscribe = window.wovly.tasks.onUpdate(() => {
        loadTasks(); // Reload tasks on any update
      });
      
      // Subscribe to pending message events
      unsubscribePending = window.wovly.tasks.onPendingMessage?.(() => {
        loadTasks(); // Reload tasks when new pending message arrives
      });
    }
    
    // Refresh task list every 10 seconds to catch nextCheck updates
    const refreshInterval = setInterval(() => {
      loadTasks();
      setTick(t => t + 1);
    }, 10000);
    
    return () => {
      if (unsubscribe) unsubscribe();
      if (unsubscribePending) unsubscribePending();
      clearInterval(refreshInterval);
    };
  }, []);

  const handleCancel = async (taskId: string) => {
    if (!window.wovly) return;
    if (!confirm("Are you sure you want to cancel this task?")) return;
    
    const result = await window.wovly.tasks.cancel(taskId);
    if (result.ok) {
      loadTasks();
    }
  };

  const handleHide = async (taskId: string) => {
    if (!window.wovly) return;
    if (!confirm("Remove this task from the list? (The task file will be kept)")) return;
    
    const result = await window.wovly.tasks.hide(taskId);
    if (result.ok) {
      loadTasks();
    }
  };

  const handleExecute = async (taskId: string) => {
    if (!window.wovly) return;
    setExecuting(taskId);
    await window.wovly.tasks.execute(taskId);
    await loadTasks();
    setExecuting(null);
  };

  // Approve and send a pending message
  const handleApproveMessage = async (taskId: string, messageId: string) => {
    if (!window.wovly) return;
    setSendingMessage(messageId);
    
    const editedContent = editingMessage?.messageId === messageId ? editingMessage.content : undefined;
    const result = await window.wovly.tasks.approvePendingMessage(taskId, messageId, editedContent);
    
    if (result.ok) {
      setEditingMessage(null);
      await loadTasks();
    } else {
      alert(result.error || "Failed to send message");
    }
    setSendingMessage(null);
  };

  // Reject/discard a pending message
  const handleRejectMessage = async (taskId: string, messageId: string) => {
    if (!window.wovly) return;
    if (!confirm("Are you sure you want to discard this message? It will not be sent.")) return;
    
    const result = await window.wovly.tasks.rejectPendingMessage(taskId, messageId);
    if (result.ok) {
      await loadTasks();
    } else {
      alert(result.error || "Failed to discard message");
    }
  };

  // Toggle auto-send for a task
  const handleToggleAutoSend = async (taskId: string, currentValue: boolean) => {
    if (!window.wovly) return;
    
    const newValue = !currentValue;
    if (newValue && !confirm("Enable auto-send? Future messages from this task will be sent automatically without requiring approval.")) {
      return;
    }
    
    const result = await window.wovly.tasks.setAutoSend(taskId, newValue);
    if (result.ok) {
      await loadTasks();
    } else {
      alert(result.error || "Failed to update auto-send setting");
    }
  };

  // Update poll frequency for a task
  const handleChangePollFrequency = async (taskId: string, newFrequency: string) => {
    if (!window.wovly) return;
    
    const result = await window.wovly.tasks.setPollFrequency(taskId, newFrequency);
    if (result.ok) {
      await loadTasks();
    } else {
      alert(result.error || "Failed to update poll frequency");
    }
  };

  // Helper to get current poll frequency preset key from task
  const getPollFrequencyKey = (task: TaskType): string => {
    if (!task.pollFrequency) return "1min";
    const { type, value } = task.pollFrequency;
    if (type === "event") return value as string;
    // Match by value for presets
    const presetMap: Record<number, string> = {
      60000: "1min",
      300000: "5min",
      900000: "15min",
      1800000: "30min",
      3600000: "1hour",
      86400000: "daily"
    };
    return presetMap[value as number] || "1min";
  };

  const getStatusBadge = (status: TaskStatus, hasPendingMessages = false) => {
    const badges: Record<TaskStatus, { className: string; label: string }> = {
      pending: { className: "status-pending", label: "Pending" },
      active: { className: "status-active", label: "Active" },
      waiting: { className: "status-waiting", label: "Waiting" },
      waiting_approval: { className: "status-approval", label: "Needs Approval" },
      waiting_for_input: { className: "status-input", label: "Needs Input" },
      completed: { className: "status-completed", label: "Completed" },
      failed: { className: "status-failed", label: "Failed" },
      cancelled: { className: "status-cancelled", label: "Cancelled" }
    };
    const badge = badges[status] || { className: "status-pending", label: status };
    
    // Show approval indicator if task has pending messages
    if (hasPendingMessages || status === "waiting_approval") {
      return <span className={`status-badge status-approval`}>⚠️ Needs Approval</span>;
    }
    
    // Show input needed indicator
    if (status === "waiting_for_input") {
      return <span className={`status-badge status-input`}>❓ Needs Input</span>;
    }
    
    return <span className={`status-badge ${badge.className}`}>{badge.label}</span>;
  };

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleString();
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="tasks-page">
      <h1>Tasks</h1>
      <p className="page-description">
        Autonomous background tasks that run on your behalf. Tasks can monitor for events, 
        send follow-up messages, and more.
      </p>

      {loading ? (
        <div className="loading-state">Loading tasks...</div>
      ) : tasks.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📋</div>
          <h3>No tasks yet</h3>
          <p>
            Create tasks by asking in the chat! For example:
            <br />
            <em>"Email Jeff to schedule lunch and follow up until confirmed"</em>
          </p>
        </div>
      ) : (
        <div className="tasks-list">
          {tasks.map(task => (
            <div key={task.id} className={`task-card ${expandedTask === task.id ? "expanded" : ""} ${(task.pendingMessages?.length || 0) > 0 ? "has-pending" : ""}`}>
              <div className="task-header" onClick={() => setExpandedTask(expandedTask === task.id ? null : task.id)}>
                <div className="task-title-row">
                  <span className="expand-icon">{expandedTask === task.id ? "▼" : "▶"}</span>
                  <h3>{task.title}</h3>
                  {getStatusBadge(task.status, (task.pendingMessages?.length || 0) > 0)}
                  {/* Quick remove button for completed/failed tasks */}
                  {(task.status === "completed" || task.status === "failed" || task.status === "cancelled") && (
                    <button
                      className="quick-remove-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleHide(task.id);
                      }}
                      title="Remove task"
                    >
                      ×
                    </button>
                  )}
                </div>
                <div className="task-meta">
                  Step {task.currentStep.step} of {task.plan.length} • Updated {formatDate(task.lastUpdated)}
                  {(task.pendingMessages?.length || 0) > 0 && (
                    <span className="pending-count"> • {task.pendingMessages?.length} message{task.pendingMessages?.length !== 1 ? 's' : ''} awaiting approval</span>
                  )}
                </div>
              </div>

              {expandedTask === task.id && (
                <div className="task-details">
                  <div className="task-section">
                    <h4>Original Request</h4>
                    <p className="task-request">{task.originalRequest}</p>
                  </div>

                  <div className="task-section">
                    <h4>Plan</h4>
                    <ol className="task-plan">
                      {task.plan.map((step, index) => (
                        <li 
                          key={index} 
                          className={index + 1 === task.currentStep.step ? "current-step" : ""}
                        >
                          {step}
                          {index + 1 === task.currentStep.step && (
                            <span className="current-indicator"> ← Current</span>
                          )}
                        </li>
                      ))}
                    </ol>
                  </div>

                  {task.nextCheck && task.status === "waiting" && (
                    <div className="task-section next-check-section">
                      <h4>Next Check</h4>
                      <div className="next-check-display">
                        <CountdownTimer targetTime={task.nextCheck} />
                        <span className="next-check-time">({formatDate(new Date(task.nextCheck).toISOString())})</span>
                      </div>
                    </div>
                  )}

                  {task.executionLog.length > 0 && (
                    <div className="task-section">
                      <h4>Recent Activity</h4>
                      <ul className="execution-log">
                        {task.executionLog.slice(-5).map((entry, index) => (
                          <li key={index}>
                            <span className="log-time">{formatDate(entry.timestamp)}</span>
                            <span className="log-message">{entry.message}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {Object.keys(task.contextMemory).length > 0 && (
                    <div className="task-section">
                      <h4>Context</h4>
                      <ul className="context-list">
                        {Object.entries(task.contextMemory).map(([key, value]) => (
                          <li key={key}>
                            <strong>{key}:</strong> {value}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Pending Messages Section */}
                  {task.pendingMessages && task.pendingMessages.length > 0 && (
                    <div className="task-section pending-messages-section">
                      <h4>⚠️ Messages Awaiting Approval</h4>
                      <div className="pending-messages-list">
                        {task.pendingMessages.map((msg) => (
                          <div key={msg.id} className="pending-message-card">
                            <div className="pending-message-header">
                              <span className="platform-badge">{msg.platform}</span>
                              <span className="recipient">To: {msg.recipient}</span>
                            </div>
                            {msg.subject && (
                              <div className="pending-message-subject">
                                <strong>Subject:</strong> {msg.subject}
                              </div>
                            )}
                            <div className="pending-message-content">
                              {editingMessage?.messageId === msg.id ? (
                                <textarea
                                  className="message-editor"
                                  value={editingMessage.content}
                                  onChange={(e) => setEditingMessage({ ...editingMessage, content: e.target.value })}
                                  rows={4}
                                />
                              ) : (
                                <pre className="message-preview">{msg.message}</pre>
                              )}
                            </div>
                            <div className="pending-message-actions">
                              {editingMessage?.messageId === msg.id ? (
                                <>
                                  <button
                                    className="secondary small"
                                    onClick={() => setEditingMessage(null)}
                                  >
                                    Cancel Edit
                                  </button>
                                  <button
                                    className="primary small"
                                    onClick={() => handleApproveMessage(task.id, msg.id)}
                                    disabled={sendingMessage === msg.id}
                                  >
                                    {sendingMessage === msg.id ? "Sending..." : "Send Edited"}
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    className="secondary small"
                                    onClick={() => setEditingMessage({ taskId: task.id, messageId: msg.id, content: msg.message })}
                                  >
                                    Edit
                                  </button>
                                  <button
                                    className="danger small"
                                    onClick={() => handleRejectMessage(task.id, msg.id)}
                                  >
                                    Discard
                                  </button>
                                  <button
                                    className="primary small"
                                    onClick={() => handleApproveMessage(task.id, msg.id)}
                                    disabled={sendingMessage === msg.id}
                                  >
                                    {sendingMessage === msg.id ? "Sending..." : "Send"}
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Auto-send Toggle */}
                  <div className="task-section auto-send-section">
                    <label className="auto-send-toggle">
                      <input
                        type="checkbox"
                        checked={task.autoSend || false}
                        onChange={() => handleToggleAutoSend(task.id, task.autoSend || false)}
                      />
                      <span className="toggle-label">
                        Auto-send messages
                        <span className="toggle-hint">(Skip approval for future messages from this task)</span>
                      </span>
                    </label>
                  </div>

                  {/* Poll Frequency Selector */}
                  <div className="task-section poll-frequency-section">
                    <label className="poll-frequency-label">
                      <span>Check frequency:</span>
                      <select 
                        value={getPollFrequencyKey(task)}
                        onChange={(e) => handleChangePollFrequency(task.id, e.target.value)}
                        className="poll-frequency-select"
                      >
                        <option value="1min">Every 1 minute</option>
                        <option value="5min">Every 5 minutes</option>
                        <option value="15min">Every 15 minutes</option>
                        <option value="30min">Every 30 minutes</option>
                        <option value="1hour">Every hour</option>
                        <option value="daily">Daily</option>
                        <option value="on_login">On login only</option>
                      </select>
                    </label>
                    {task.pollFrequency?.type === "event" && (
                      <span className="poll-frequency-hint">Task will run once when you log in</span>
                    )}
                  </div>

                  <div className="task-actions">
                    {(task.status === "pending" || task.status === "active" || task.status === "waiting") && (
                      <>
                        <button 
                          className="secondary small"
                          onClick={() => handleExecute(task.id)}
                          disabled={executing === task.id}
                        >
                          {executing === task.id ? "Running..." : "Run Now"}
                        </button>
                        <button 
                          className="danger small"
                          onClick={() => handleCancel(task.id)}
                        >
                          Cancel Task
                        </button>
                      </>
                    )}
                    <button 
                      className="secondary small"
                      onClick={() => setEditingTask(task.id)}
                    >
                      Edit
                    </button>
                    <button 
                      className="secondary small"
                      onClick={() => handleHide(task.id)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {editingTask && (
        <TaskEditModal
          taskId={editingTask}
          onClose={() => {
            setEditingTask(null);
            loadTasks();
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Skills Page
// ─────────────────────────────────────────────────────────────────────────────

type Skill = {
  id: string;
  name: string;
  description: string;
  keywords: string[];
  procedure: string[];
  constraints: string[];
  tools: string[];
};

function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingSkill, setEditingSkill] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [newSkillId, setNewSkillId] = useState("");

  const loadSkills = async () => {
    if (!window.wovly) return;
    const result = await window.wovly.skills.list();
    if (result.ok && result.skills) {
      setSkills(result.skills as Skill[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadSkills();
  }, []);

  const handleEdit = async (skillId: string) => {
    if (!window.wovly) return;
    const result = await window.wovly.skills.get(skillId);
    if (result.ok && result.content) {
      setEditContent(result.content);
      setEditingSkill(skillId);
    }
  };

  const handleSave = async () => {
    if (!window.wovly || !editingSkill) return;
    const result = await window.wovly.skills.save(editingSkill, editContent);
    if (result.ok) {
      setEditingSkill(null);
      setEditContent("");
      loadSkills();
    } else {
      alert(`Error saving skill: ${result.error}`);
    }
  };

  const handleDelete = async (skillId: string) => {
    if (!window.wovly) return;
    if (!confirm(`Are you sure you want to delete the "${skillId}" skill?`)) return;
    
    const result = await window.wovly.skills.delete(skillId);
    if (result.ok) {
      loadSkills();
    } else {
      alert(`Error deleting skill: ${result.error}`);
    }
  };

  const handleCreate = async () => {
    if (!window.wovly) return;
    const result = await window.wovly.skills.getTemplate();
    if (result.ok && result.template) {
      setEditContent(result.template);
      setIsCreating(true);
      setNewSkillId("");
    }
  };

  const handleCreateSave = async () => {
    if (!window.wovly || !newSkillId.trim()) {
      alert("Please enter a skill ID");
      return;
    }
    
    // Sanitize the skill ID
    const cleanId = newSkillId.toLowerCase().replace(/[^a-z0-9-_]/g, "-").replace(/-+/g, "-");
    
    const result = await window.wovly.skills.save(cleanId, editContent);
    if (result.ok) {
      setIsCreating(false);
      setEditContent("");
      setNewSkillId("");
      loadSkills();
    } else {
      alert(`Error creating skill: ${result.error}`);
    }
  };

  const handleCancel = () => {
    setEditingSkill(null);
    setIsCreating(false);
    setEditContent("");
    setNewSkillId("");
  };

  const [showToolsRef, setShowToolsRef] = useState(false);

  // Available tools reference data
  const availableTools = [
    {
      category: "Google Calendar",
      tools: [
        { name: "get_calendar_events", desc: "Get events from calendar (specify days)" },
        { name: "create_calendar_event", desc: "Create event with title, time, attendees" },
        { name: "delete_calendar_event", desc: "Delete an event by ID" },
      ]
    },
    {
      category: "Gmail",
      tools: [
        { name: "send_email", desc: "Send or reply to an email" },
        { name: "list_emails", desc: "List recent emails (optionally filter by from/to)" },
        { name: "search_emails", desc: "Search emails by query" },
        { name: "get_email_content", desc: "Get full content of a specific email" },
        { name: "create_draft", desc: "Create an email draft" },
      ]
    },
    {
      category: "iMessage (macOS)",
      tools: [
        { name: "send_imessage", desc: "Send a text message to a contact" },
        { name: "lookup_contact", desc: "Find contact by name, returns phone number" },
        { name: "get_recent_messages", desc: "Get recent messages with a contact" },
      ]
    },
    {
      category: "Slack",
      tools: [
        { name: "send_slack_message", desc: "Send message to channel or user" },
        { name: "list_slack_channels", desc: "List available channels" },
        { name: "list_slack_messages", desc: "Get messages from a channel" },
        { name: "search_slack_users", desc: "Find Slack users by name" },
      ]
    },
    {
      category: "Weather",
      tools: [
        { name: "get_current_weather", desc: "Current conditions for a location" },
        { name: "get_weather_forecast", desc: "Multi-day forecast" },
        { name: "search_location", desc: "Find location coordinates" },
      ]
    },
    {
      category: "Tasks",
      tools: [
        { name: "create_task", desc: "Create an autonomous background task" },
        { name: "list_tasks", desc: "List all active tasks" },
        { name: "cancel_task", desc: "Cancel a running task" },
      ]
    },
    {
      category: "Browser Automation",
      tools: [
        { name: "browser_navigate", desc: "Navigate to a URL and return page snapshot" },
        { name: "browser_snapshot", desc: "Get current page screenshot and element refs" },
        { name: "browser_click", desc: "Click an element by its ref (e.g., 'e5')" },
        { name: "browser_type", desc: "Type text into an input field" },
        { name: "browser_press", desc: "Press keyboard key (Enter, Tab, etc.)" },
        { name: "browser_scroll", desc: "Scroll page up or down" },
        { name: "browser_back", desc: "Navigate back to previous page" },
        { name: "browser_fill_credential", desc: "Securely fill login form with saved credential" },
      ]
    },
  ];

  // Editing/Creating modal
  if (editingSkill || isCreating) {
    return (
      <div className="skills-page">
        <div className="skills-editor">
          <div className="editor-header">
            <h2>{isCreating ? "Create New Skill" : `Edit: ${editingSkill}`}</h2>
            <div className="editor-actions">
              <button className="btn-secondary" onClick={handleCancel}>Cancel</button>
              <button className="btn-primary" onClick={isCreating ? handleCreateSave : handleSave}>Save</button>
            </div>
          </div>
          
          {isCreating && (
            <div className="skill-id-input">
              <label>Skill ID (filename):</label>
              <input
                type="text"
                value={newSkillId}
                onChange={(e) => setNewSkillId(e.target.value)}
                placeholder="e.g., scheduling, email-drafting, research"
              />
            </div>
          )}
          
          <div className="editor-main">
            <textarea
              className="skill-editor-textarea"
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              placeholder="Enter skill markdown..."
            />
            
            <div className="editor-sidebar">
              <div className="editor-help">
                <h4>Skill Format:</h4>
                <pre>{`# Skill Name

## Description
What this skill does.

## Keywords
keyword1, keyword2

## Procedure
1. First step
2. Second step

## Constraints
- Important rule

## Tools
tool1, tool2`}</pre>
              </div>
              
              <div className="tools-reference">
                <button 
                  className="tools-reference-toggle"
                  onClick={() => setShowToolsRef(!showToolsRef)}
                >
                  {showToolsRef ? "▼" : "▶"} Available Tools Reference
                </button>
                
                {showToolsRef && (
                  <div className="tools-reference-content">
                    {availableTools.map(category => (
                      <div key={category.category} className="tool-category">
                        <h5>{category.category}</h5>
                        <ul>
                          {category.tools.map(tool => (
                            <li key={tool.name}>
                              <code 
                                className="tool-name" 
                                onClick={() => {
                                  navigator.clipboard.writeText(tool.name);
                                }}
                                title="Click to copy"
                              >
                                {tool.name}
                              </code>
                              <span className="tool-desc">{tool.desc}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="skills-page">
      <div className="skills-header">
        <div>
          <h1>Skills Library</h1>
          <p className="page-description">
            Skills provide procedural knowledge for the AI. In chat, skills give advisory guidance. 
            In tasks, skills become execution plans.
          </p>
        </div>
        <button className="btn-primary" onClick={handleCreate}>+ New Skill</button>
      </div>

      {loading ? (
        <div className="loading-state">Loading skills...</div>
      ) : skills.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">📚</div>
          <h3>No skills yet</h3>
          <p>
            Create skills to teach the AI specific procedures. Skills are markdown files that define
            step-by-step processes for tasks like scheduling, email drafting, research, and more.
          </p>
          <button className="btn-primary" onClick={handleCreate}>Create Your First Skill</button>
        </div>
      ) : (
        <div className="skills-list">
          {skills.map(skill => (
            <div key={skill.id} className="skill-card">
              <div className="skill-card-header">
                <h3>{skill.name}</h3>
                <div className="skill-actions">
                  <button className="btn-secondary btn-small" onClick={() => handleEdit(skill.id)}>Edit</button>
                  <button className="btn-danger btn-small" onClick={() => handleDelete(skill.id)}>Delete</button>
                </div>
              </div>
              <p className="skill-description">{skill.description}</p>
              
              {skill.keywords.length > 0 && (
                <div className="skill-keywords">
                  {skill.keywords.map((kw, i) => (
                    <span key={i} className="keyword-tag">{kw}</span>
                  ))}
                </div>
              )}
              
              <div className="skill-procedure">
                <h4>Procedure ({skill.procedure.length} steps)</h4>
                <ol>
                  {skill.procedure.slice(0, 3).map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                  {skill.procedure.length > 3 && <li className="more">...and {skill.procedure.length - 3} more steps</li>}
                </ol>
              </div>
              
              {skill.constraints.length > 0 && (
                <div className="skill-constraints">
                  <h4>Constraints</h4>
                  <ul>
                    {skill.constraints.slice(0, 2).map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                    {skill.constraints.length > 2 && <li className="more">...and {skill.constraints.length - 2} more</li>}
                  </ul>
                </div>
              )}
              
              {skill.tools.length > 0 && (
                <div className="skill-tools">
                  <span className="tools-label">Tools:</span>
                  {skill.tools.map((tool, i) => (
                    <code key={i} className="tool-name">{tool}</code>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Interfaces Page (WhatsApp, Telegram, future: Discord)
// ─────────────────────────────────────────────────────────────────────────────

type TelegramInterfaceStatus = "disconnected" | "connecting" | "connected";

function InterfacesPage() {
  const [whatsappConnected, setWhatsappConnected] = useState(false);
  const [whatsappStatus, setWhatsappStatus] = useState<WhatsAppStatus>("disconnected");
  const [showWhatsAppSetup, setShowWhatsAppSetup] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  // Telegram Interface state
  const [telegramInterfaceConnected, setTelegramInterfaceConnected] = useState(false);
  const [telegramInterfaceStatus, setTelegramInterfaceStatus] = useState<TelegramInterfaceStatus>("disconnected");
  const [telegramHasBot, setTelegramHasBot] = useState(false);
  const [telegramConnecting, setTelegramConnecting] = useState(false);
  const [telegramDisconnecting, setTelegramDisconnecting] = useState(false);
  const [telegramError, setTelegramError] = useState("");

  useEffect(() => {
    // Check WhatsApp auth status
    const checkStatus = async () => {
      if (!window.wovly) return;
      const result = await window.wovly.whatsapp.checkAuth();
      if (result.ok) {
        setWhatsappConnected(result.connected);
      }

      // Check Telegram interface status
      const telegramResult = await window.wovly.telegramInterface?.checkAuth();
      if (telegramResult?.ok) {
        setTelegramHasBot(telegramResult.hasBot);
        setTelegramInterfaceConnected(telegramResult.connected);
      }
    };
    checkStatus();

    // Subscribe to WhatsApp status updates
    const unsubscribeWhatsApp = window.wovly.whatsapp.onStatus((data) => {
      setWhatsappStatus(data.status);
      setWhatsappConnected(data.status === "connected");
    });

    // Subscribe to Telegram interface status updates
    const unsubscribeTelegram = window.wovly.telegramInterface?.onStatus((data) => {
      setTelegramInterfaceStatus(data.status);
      setTelegramInterfaceConnected(data.status === "connected");
      setTelegramConnecting(false);
    });

    return () => {
      unsubscribeWhatsApp();
      unsubscribeTelegram?.();
    };
  }, []);

  const handleDisconnect = async () => {
    if (!confirm("Disconnect WhatsApp? You'll need to scan the QR code again to reconnect.")) {
      return;
    }
    setDisconnecting(true);
    await window.wovly.whatsapp.disconnect();
    setWhatsappConnected(false);
    setDisconnecting(false);
  };

  const handleReconnect = async () => {
    await window.wovly.whatsapp.connect();
  };

  // Telegram Interface handlers
  const handleTelegramConnect = async () => {
    setTelegramConnecting(true);
    setTelegramError("");
    try {
      const result = await window.wovly.telegramInterface.connect();
      if (!result.ok) {
        setTelegramError(result.error || "Failed to connect");
        setTelegramConnecting(false);
      }
      // Status will be updated via the onStatus subscription
    } catch (err) {
      setTelegramError(err instanceof Error ? err.message : "Connection failed");
      setTelegramConnecting(false);
    }
  };

  const handleTelegramDisconnect = async () => {
    if (!confirm("Disconnect Telegram chat interface?")) {
      return;
    }
    setTelegramDisconnecting(true);
    await window.wovly.telegramInterface.disconnect();
    setTelegramInterfaceConnected(false);
    setTelegramDisconnecting(false);
  };

  return (
    <div className="interfaces-page">
      <h1>Chat Interfaces</h1>
      <p className="page-description">Connect messaging apps to chat with Wovly from your phone or other devices.</p>
      
      {/* WhatsApp */}
      <div className="interface-row">
        <div className="interface-icon whatsapp">
          <WhatsAppIcon size={32} />
        </div>
        <div className="interface-info">
          <h3>WhatsApp</h3>
          <p>Chat with Wovly via WhatsApp on your phone</p>
          {whatsappConnected && (
            <span className="interface-detail">Messages will be answered by your configured AI</span>
          )}
        </div>
        <div className="interface-status">
          {whatsappConnected ? (
            <>
              <span className="status connected">Connected</span>
              <button 
                className="danger small" 
                onClick={handleDisconnect}
                disabled={disconnecting}
              >
                {disconnecting ? "..." : "Disconnect"}
              </button>
            </>
          ) : whatsappStatus === "connecting" || whatsappStatus === "qr_ready" ? (
            <>
              <span className="status connecting">Connecting...</span>
              <button className="secondary small" onClick={() => setShowWhatsAppSetup(true)}>
                View QR
              </button>
            </>
          ) : (
            <>
              <span className="status disconnected">Not connected</span>
              <button className="primary small" onClick={() => setShowWhatsAppSetup(true)}>
                Setup
              </button>
            </>
          )}
        </div>
      </div>

      {/* Telegram */}
      <div className="interface-row">
        <div className="interface-icon telegram">
          <TelegramIcon size={32} />
        </div>
        <div className="interface-info">
          <h3>Telegram</h3>
          <p>Chat with Wovly via your Telegram bot</p>
          {!telegramHasBot && (
            <span className="interface-detail warning">Set up a Telegram bot in Integrations first</span>
          )}
          {telegramInterfaceConnected && (
            <span className="interface-detail">Messages to your bot will be answered by Wovly</span>
          )}
          {telegramError && (
            <span className="interface-detail error">{telegramError}</span>
          )}
        </div>
        <div className="interface-status">
          {telegramInterfaceConnected ? (
            <>
              <span className="status connected">Connected</span>
              <button 
                className="danger small" 
                onClick={handleTelegramDisconnect}
                disabled={telegramDisconnecting}
              >
                {telegramDisconnecting ? "..." : "Disconnect"}
              </button>
            </>
          ) : telegramConnecting || telegramInterfaceStatus === "connecting" ? (
            <>
              <span className="status connecting">Connecting...</span>
            </>
          ) : telegramHasBot ? (
            <>
              <span className="status disconnected">Not listening</span>
              <button className="primary small" onClick={handleTelegramConnect}>
                Start Listening
              </button>
            </>
          ) : (
            <>
              <span className="status disconnected">No bot configured</span>
              <button className="secondary small" disabled>
                Setup bot first
              </button>
            </>
          )}
        </div>
      </div>

      {/* Discord - Coming Soon */}
      <div className="interface-row disabled">
        <div className="interface-icon discord">
          <DiscordIcon size={32} />
        </div>
        <div className="interface-info">
          <h3>Discord</h3>
          <p>Chat with Wovly on Discord</p>
        </div>
        <div className="interface-status">
          <span className="status coming-soon">Coming soon</span>
        </div>
      </div>

      {/* Slack - Coming Soon */}
      <div className="interface-row disabled">
        <div className="interface-icon slack">
          <SlackIcon size={32} />
        </div>
        <div className="interface-info">
          <h3>Slack</h3>
          <p>Chat with Wovly in your Slack workspace</p>
        </div>
        <div className="interface-status">
          <span className="status coming-soon">Coming soon</span>
        </div>
      </div>

      {showWhatsAppSetup && (
        <WhatsAppSetupModal
          onClose={() => setShowWhatsAppSetup(false)}
          onConnect={() => {
            setWhatsappConnected(true);
            setShowWhatsAppSetup(false);
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Integrations Page
// ─────────────────────────────────────────────────────────────────────────────

function IntegrationsPage() {
  const [googleConnected, setGoogleConnected] = useState(false);
  const [showGoogleSetup, setShowGoogleSetup] = useState(false);
  const [showIMessageSetup, setShowIMessageSetup] = useState(false);
  const [testingGoogle, setTestingGoogle] = useState(false);
  const [googleTestResult, setGoogleTestResult] = useState<{ ok: boolean; message?: string } | null>(null);
  
  // Slack state
  const [slackConnected, setSlackConnected] = useState(false);
  const [slackTeam, setSlackTeam] = useState("");
  const [showSlackSetup, setShowSlackSetup] = useState(false);
  const [testingSlack, setTestingSlack] = useState(false);
  const [slackTestResult, setSlackTestResult] = useState<{ ok: boolean; message?: string } | null>(null);
  
  // Weather state
  const [weatherEnabled, setWeatherEnabled] = useState(true);
  const [testingWeather, setTestingWeather] = useState(false);
  const [weatherTestResult, setWeatherTestResult] = useState<{ ok: boolean; message?: string } | null>(null);

  // Browser Automation state (CDP-based)
  const [browserEnabled, setBrowserEnabled] = useState(false);
  const [testingBrowser, setTestingBrowser] = useState(false);
  const [browserTestResult, setBrowserTestResult] = useState<{ ok: boolean; message?: string } | null>(null);

  // New integrations state
  const [telegramConnected, setTelegramConnected] = useState(false);
  const [showTelegramSetup, setShowTelegramSetup] = useState(false);
  const [testingTelegram, setTestingTelegram] = useState(false);
  const [telegramTestResult, setTelegramTestResult] = useState<{ ok: boolean; message?: string } | null>(null);

  const [discordConnected, setDiscordConnected] = useState(false);
  const [showDiscordSetup, setShowDiscordSetup] = useState(false);
  const [testingDiscord, setTestingDiscord] = useState(false);
  const [discordTestResult, setDiscordTestResult] = useState<{ ok: boolean; message?: string } | null>(null);

  const [xConnected, setXConnected] = useState(false);
  const [showXSetup, setShowXSetup] = useState(false);
  const [testingX, setTestingX] = useState(false);
  const [xTestResult, setXTestResult] = useState<{ ok: boolean; message?: string } | null>(null);

  const [notionConnected, setNotionConnected] = useState(false);
  const [showNotionSetup, setShowNotionSetup] = useState(false);
  const [testingNotion, setTestingNotion] = useState(false);
  const [notionTestResult, setNotionTestResult] = useState<{ ok: boolean; message?: string } | null>(null);

  const [githubConnected, setGithubConnected] = useState(false);
  const [showGithubSetup, setShowGithubSetup] = useState(false);
  const [testingGithub, setTestingGithub] = useState(false);
  const [githubTestResult, setGithubTestResult] = useState<{ ok: boolean; message?: string } | null>(null);

  const [asanaConnected, setAsanaConnected] = useState(false);
  const [showAsanaSetup, setShowAsanaSetup] = useState(false);
  const [testingAsana, setTestingAsana] = useState(false);
  const [asanaTestResult, setAsanaTestResult] = useState<{ ok: boolean; message?: string } | null>(null);

  const [redditConnected, setRedditConnected] = useState(false);
  const [showRedditSetup, setShowRedditSetup] = useState(false);
  const [testingReddit, setTestingReddit] = useState(false);
  const [redditTestResult, setRedditTestResult] = useState<{ ok: boolean; message?: string } | null>(null);

  const [spotifyConnected, setSpotifyConnected] = useState(false);
  const [showSpotifySetup, setShowSpotifySetup] = useState(false);
  const [testingSpotify, setTestingSpotify] = useState(false);
  const [spotifyTestResult, setSpotifyTestResult] = useState<{ ok: boolean; message?: string } | null>(null);

  useEffect(() => {
    const checkConnections = async () => {
      if (!window.wovly) return;
      const result = await window.wovly.integrations.checkGoogleAuth();
      setGoogleConnected(result.authorized);
      
      // Check Slack
      const slackResult = await window.wovly.integrations.checkSlackAuth();
      if (slackResult.ok && slackResult.authorized) {
        setSlackConnected(true);
        setSlackTeam(slackResult.team?.name || "");
      }
      
      // Check weather enabled
      const weatherResult = await window.wovly.integrations.getWeatherEnabled();
      if (weatherResult.ok) {
        setWeatherEnabled(weatherResult.enabled);
      }

      // Check browser automation enabled
      const browserResult = await window.wovly.integrations.getBrowserEnabled?.();
      if (browserResult?.ok) {
        setBrowserEnabled(browserResult.enabled);
      }

      // Check new integrations
      const telegramResult = await window.wovly.telegram?.checkAuth();
      if (telegramResult?.authorized) setTelegramConnected(true);

      const discordResult = await window.wovly.discord?.checkAuth();
      if (discordResult?.authorized) setDiscordConnected(true);

      const xResult = await window.wovly.x?.checkAuth();
      if (xResult?.authorized) setXConnected(true);

      const notionResult = await window.wovly.notion?.checkAuth();
      if (notionResult?.authorized) setNotionConnected(true);

      const githubResult = await window.wovly.github?.checkAuth();
      if (githubResult?.authorized) setGithubConnected(true);

      const asanaResult = await window.wovly.asana?.checkAuth();
      if (asanaResult?.authorized) setAsanaConnected(true);

      const redditResult = await window.wovly.reddit?.checkAuth();
      if (redditResult?.authorized) setRedditConnected(true);

      const spotifyResult = await window.wovly.spotify?.checkAuth();
      if (spotifyResult?.authorized) setSpotifyConnected(true);
    };
    checkConnections();
  }, []);

  const handleTestGoogle = async () => {
    setTestingGoogle(true);
    setGoogleTestResult(null);
    const result = await window.wovly.integrations.testGoogle();
    setGoogleTestResult(result);
    setTestingGoogle(false);
  };

  const handleDisconnectGoogle = async () => {
    if (!confirm("Disconnect Google? You'll need to re-authorize to use Calendar, Gmail, and Drive features.")) {
      return;
    }
    await window.wovly.integrations.disconnectGoogle();
    setGoogleConnected(false);
    setGoogleTestResult(null);
  };

  const handleTestWeather = async () => {
    setTestingWeather(true);
    setWeatherTestResult(null);
    const result = await window.wovly.integrations.testWeather();
    setWeatherTestResult(result);
    setTestingWeather(false);
  };

  const handleToggleWeather = async () => {
    const newValue = !weatherEnabled;
    await window.wovly.integrations.setWeatherEnabled(newValue);
    setWeatherEnabled(newValue);
    setWeatherTestResult(null);
  };

  const handleTestSlack = async () => {
    setTestingSlack(true);
    setSlackTestResult(null);
    const result = await window.wovly.integrations.testSlack();
    setSlackTestResult(result);
    setTestingSlack(false);
  };

  const handleDisconnectSlack = async () => {
    if (!confirm("Disconnect Slack? You'll need to re-authorize to access Slack channels and messages.")) {
      return;
    }
    await window.wovly.integrations.disconnectSlack();
    setSlackConnected(false);
    setSlackTeam("");
    setSlackTestResult(null);
  };

  const handleTestBrowser = async () => {
    setTestingBrowser(true);
    setBrowserTestResult(null);
    const result = await window.wovly.integrations.testBrowser?.();
    setBrowserTestResult(result || { ok: false, message: "Browser test not available" });
    setTestingBrowser(false);
  };

  const handleToggleBrowser = async () => {
    const newValue = !browserEnabled;
    setBrowserTestResult(null);
    const result = await window.wovly.integrations.setBrowserEnabled?.(newValue);
    if (result?.ok) {
      setBrowserEnabled(newValue);
    } else {
      setBrowserTestResult({ ok: false, message: result?.error || "Failed to toggle" });
    }
  };

  // New integration handlers
  const handleTestTelegram = async () => {
    setTestingTelegram(true);
    setTelegramTestResult(null);
    const result = await window.wovly.telegram.test();
    setTelegramTestResult(result);
    setTestingTelegram(false);
  };

  const handleDisconnectTelegram = async () => {
    if (!confirm("Disconnect Telegram?")) return;
    await window.wovly.telegram.disconnect();
    setTelegramConnected(false);
    setTelegramTestResult(null);
  };

  const handleTestDiscord = async () => {
    setTestingDiscord(true);
    setDiscordTestResult(null);
    const result = await window.wovly.discord.test();
    setDiscordTestResult(result);
    setTestingDiscord(false);
  };

  const handleDisconnectDiscord = async () => {
    if (!confirm("Disconnect Discord?")) return;
    await window.wovly.discord.disconnect();
    setDiscordConnected(false);
    setDiscordTestResult(null);
  };

  const handleTestX = async () => {
    setTestingX(true);
    setXTestResult(null);
    const result = await window.wovly.x.test();
    setXTestResult(result);
    setTestingX(false);
  };

  const handleDisconnectX = async () => {
    if (!confirm("Disconnect X?")) return;
    await window.wovly.x.disconnect();
    setXConnected(false);
    setXTestResult(null);
  };

  const handleTestNotion = async () => {
    setTestingNotion(true);
    setNotionTestResult(null);
    const result = await window.wovly.notion.test();
    setNotionTestResult(result);
    setTestingNotion(false);
  };

  const handleDisconnectNotion = async () => {
    if (!confirm("Disconnect Notion?")) return;
    await window.wovly.notion.disconnect();
    setNotionConnected(false);
    setNotionTestResult(null);
  };

  const handleTestGithub = async () => {
    setTestingGithub(true);
    setGithubTestResult(null);
    const result = await window.wovly.github.test();
    setGithubTestResult(result);
    setTestingGithub(false);
  };

  const handleDisconnectGithub = async () => {
    if (!confirm("Disconnect GitHub?")) return;
    await window.wovly.github.disconnect();
    setGithubConnected(false);
    setGithubTestResult(null);
  };

  const handleTestAsana = async () => {
    setTestingAsana(true);
    setAsanaTestResult(null);
    const result = await window.wovly.asana.test();
    setAsanaTestResult(result);
    setTestingAsana(false);
  };

  const handleDisconnectAsana = async () => {
    if (!confirm("Disconnect Asana?")) return;
    await window.wovly.asana.disconnect();
    setAsanaConnected(false);
    setAsanaTestResult(null);
  };

  const handleTestReddit = async () => {
    setTestingReddit(true);
    setRedditTestResult(null);
    const result = await window.wovly.reddit.test();
    setRedditTestResult(result);
    setTestingReddit(false);
  };

  const handleDisconnectReddit = async () => {
    if (!confirm("Disconnect Reddit?")) return;
    await window.wovly.reddit.disconnect();
    setRedditConnected(false);
    setRedditTestResult(null);
  };

  const handleTestSpotify = async () => {
    setTestingSpotify(true);
    setSpotifyTestResult(null);
    const result = await window.wovly.spotify.test();
    setSpotifyTestResult(result);
    setTestingSpotify(false);
  };

  const handleDisconnectSpotify = async () => {
    if (!confirm("Disconnect Spotify?")) return;
    await window.wovly.spotify.disconnect();
    setSpotifyConnected(false);
    setSpotifyTestResult(null);
  };

  return (
    <div className="integrations-page">
      <h1>Integrations</h1>
      
      <div className="integration-row">
        <div className="integration-icon">
          <GoogleIcon size={32} />
        </div>
        <div className="integration-info">
          <h3>Google Workspace</h3>
          <p>Calendar, Gmail, Drive</p>
        </div>
        <div className="integration-status">
          {googleConnected ? (
            <>
              <span className="status connected">Connected</span>
              <button className="secondary small" onClick={handleTestGoogle} disabled={testingGoogle}>
                {testingGoogle ? "Testing..." : "Test"}
              </button>
              <button className="secondary small" onClick={() => setShowGoogleSetup(true)}>Re-auth</button>
              <button className="danger small" onClick={handleDisconnectGoogle}>Disconnect</button>
            </>
          ) : (
            <>
              <span className="status disconnected">Not connected</span>
              <button className="primary small" onClick={() => setShowGoogleSetup(true)}>Setup</button>
            </>
          )}
        </div>
        {googleTestResult && (
          <div className={`test-result ${googleTestResult.ok ? "success" : "error"}`}>
            {googleTestResult.ok ? `✓ ${googleTestResult.message}` : `✗ ${googleTestResult.message}`}
          </div>
        )}
      </div>

      <div className="integration-row">
        <div className="integration-icon">
          <IMessageIcon size={32} />
        </div>
        <div className="integration-info">
          <h3>iMessage</h3>
          <p>Read and send text messages</p>
        </div>
        <div className="integration-status">
          <span className="status disconnected">Requires setup</span>
          <button className="primary small" onClick={() => setShowIMessageSetup(true)}>Setup</button>
        </div>
      </div>

      {/* Weather - Open-Meteo (No API key required) */}
      <div className="integration-row">
        <div className="integration-icon">
          <WeatherIcon size={32} />
        </div>
        <div className="integration-info">
          <h3>Weather</h3>
          <p>Forecasts, current conditions, alerts (powered by Open-Meteo)</p>
          <span className="integration-detail no-key">No API key required</span>
        </div>
        <div className="integration-status">
          {weatherEnabled ? (
            <>
              <span className="status connected">Enabled</span>
              <button className="secondary small" onClick={handleTestWeather} disabled={testingWeather}>
                {testingWeather ? "Testing..." : "Test"}
              </button>
              <button className="secondary small" onClick={handleToggleWeather}>Disable</button>
            </>
          ) : (
            <>
              <span className="status disconnected">Disabled</span>
              <button className="primary small" onClick={handleToggleWeather}>Enable</button>
            </>
          )}
        </div>
        {weatherTestResult && (
          <div className={`test-result ${weatherTestResult.ok ? "success" : "error"}`}>
            {weatherTestResult.ok ? `✓ ${weatherTestResult.message}` : `✗ ${weatherTestResult.message}`}
          </div>
        )}
      </div>

      <div className="integration-row">
        <div className="integration-icon">
          <SlackIcon size={32} />
        </div>
        <div className="integration-info">
          <h3>Slack</h3>
          <p>Team messaging {slackTeam && <span style={{ color: "#666" }}>• {slackTeam}</span>}</p>
        </div>
        <div className="integration-status">
          {slackConnected ? (
            <>
              <span className="status connected">Connected</span>
              <button className="secondary small" onClick={handleTestSlack} disabled={testingSlack}>
                {testingSlack ? "Testing..." : "Test"}
              </button>
              <button className="secondary small" onClick={() => setShowSlackSetup(true)}>Re-auth</button>
              <button className="danger small" onClick={handleDisconnectSlack}>Disconnect</button>
            </>
          ) : (
            <>
              <span className="status disconnected">Not connected</span>
              <button className="primary small" onClick={() => setShowSlackSetup(true)}>Setup</button>
            </>
          )}
        </div>
        {slackTestResult && (
          <div className={`test-result ${slackTestResult.ok ? "success" : "error"}`}>
            {slackTestResult.ok ? `✓ ${slackTestResult.message}` : `✗ ${slackTestResult.message}`}
          </div>
        )}
      </div>

      {/* Browser Automation */}
      <div className="integration-row">
        <div className="integration-icon">
          <PlaywrightIcon size={32} />
        </div>
        <div className="integration-info">
          <h3>Browser Automation</h3>
          <p>Web navigation, clicking, typing, screenshots for researching online.</p>
          <span className="integration-detail no-key">No API key required</span>
        </div>
        <div className="integration-status">
          {browserEnabled ? (
            <>
              <span className="status connected">Enabled</span>
              <button 
                className="secondary small" 
                onClick={handleTestBrowser} 
                disabled={testingBrowser}
              >
                {testingBrowser ? "Testing..." : "Test"}
              </button>
              <button className="secondary small" onClick={handleToggleBrowser}>Disable</button>
            </>
          ) : (
            <>
              <span className="status disconnected">Disabled</span>
              <button className="primary small" onClick={handleToggleBrowser}>Enable</button>
            </>
          )}
        </div>
        {browserTestResult && (
          <div className={`test-result ${browserTestResult.ok ? "success" : "error"}`}>
            {browserTestResult.ok ? `✓ ${browserTestResult.message}` : `✗ ${browserTestResult.message}`}
          </div>
        )}
      </div>

      {/* Telegram */}
      <div className="integration-row">
        <div className="integration-icon">
          <TelegramIcon size={32} />
        </div>
        <div className="integration-info">
          <h3>Telegram</h3>
          <p>Send and receive messages via Telegram bot</p>
        </div>
        <div className="integration-status">
          {telegramConnected ? (
            <>
              <span className="status connected">Connected</span>
              <button className="secondary small" onClick={handleTestTelegram} disabled={testingTelegram}>
                {testingTelegram ? "Testing..." : "Test"}
              </button>
              <button className="danger small" onClick={handleDisconnectTelegram}>Disconnect</button>
            </>
          ) : (
            <>
              <span className="status disconnected">Not connected</span>
              <button className="primary small" onClick={() => setShowTelegramSetup(true)}>Setup</button>
            </>
          )}
        </div>
        {telegramTestResult && (
          <div className={`test-result ${telegramTestResult.ok ? "success" : "error"}`}>
            {telegramTestResult.ok ? `✓ ${telegramTestResult.message}` : `✗ ${telegramTestResult.message}`}
          </div>
        )}
      </div>

      {/* Discord */}
      <div className="integration-row">
        <div className="integration-icon">
          <DiscordIcon size={32} />
        </div>
        <div className="integration-info">
          <h3>Discord</h3>
          <p>Send messages to Discord servers and DMs</p>
        </div>
        <div className="integration-status">
          {discordConnected ? (
            <>
              <span className="status connected">Connected</span>
              <button className="secondary small" onClick={handleTestDiscord} disabled={testingDiscord}>
                {testingDiscord ? "Testing..." : "Test"}
              </button>
              <button className="danger small" onClick={handleDisconnectDiscord}>Disconnect</button>
            </>
          ) : (
            <>
              <span className="status disconnected">Not connected</span>
              <button className="primary small" onClick={() => setShowDiscordSetup(true)}>Setup</button>
            </>
          )}
        </div>
        {discordTestResult && (
          <div className={`test-result ${discordTestResult.ok ? "success" : "error"}`}>
            {discordTestResult.ok ? `✓ ${discordTestResult.message}` : `✗ ${discordTestResult.message}`}
          </div>
        )}
      </div>

      {/* X (Twitter) */}
      <div className="integration-row">
        <div className="integration-icon">
          <span style={{ fontSize: "24px", fontWeight: "bold" }}>𝕏</span>
        </div>
        <div className="integration-info">
          <h3>X (Twitter)</h3>
          <p>Post tweets, read timeline, send DMs</p>
        </div>
        <div className="integration-status">
          {xConnected ? (
            <>
              <span className="status connected">Connected</span>
              <button className="secondary small" onClick={handleTestX} disabled={testingX}>
                {testingX ? "Testing..." : "Test"}
              </button>
              <button className="danger small" onClick={handleDisconnectX}>Disconnect</button>
            </>
          ) : (
            <>
              <span className="status disconnected">Not connected</span>
              <button className="primary small" onClick={() => setShowXSetup(true)}>Setup</button>
            </>
          )}
        </div>
        {xTestResult && (
          <div className={`test-result ${xTestResult.ok ? "success" : "error"}`}>
            {xTestResult.ok ? `✓ ${xTestResult.message}` : `✗ ${xTestResult.message}`}
          </div>
        )}
      </div>

      {/* Notion */}
      <div className="integration-row">
        <div className="integration-icon">
          <NotionIcon size={32} />
        </div>
        <div className="integration-info">
          <h3>Notion</h3>
          <p>Search, read, and create pages and databases</p>
        </div>
        <div className="integration-status">
          {notionConnected ? (
            <>
              <span className="status connected">Connected</span>
              <button className="secondary small" onClick={handleTestNotion} disabled={testingNotion}>
                {testingNotion ? "Testing..." : "Test"}
              </button>
              <button className="danger small" onClick={handleDisconnectNotion}>Disconnect</button>
            </>
          ) : (
            <>
              <span className="status disconnected">Not connected</span>
              <button className="primary small" onClick={() => setShowNotionSetup(true)}>Setup</button>
            </>
          )}
        </div>
        {notionTestResult && (
          <div className={`test-result ${notionTestResult.ok ? "success" : "error"}`}>
            {notionTestResult.ok ? `✓ ${notionTestResult.message}` : `✗ ${notionTestResult.message}`}
          </div>
        )}
      </div>

      {/* GitHub */}
      <div className="integration-row">
        <div className="integration-icon">
          <GitHubIcon size={32} />
        </div>
        <div className="integration-info">
          <h3>GitHub</h3>
          <p>Repos, issues, PRs, and notifications</p>
        </div>
        <div className="integration-status">
          {githubConnected ? (
            <>
              <span className="status connected">Connected</span>
              <button className="secondary small" onClick={handleTestGithub} disabled={testingGithub}>
                {testingGithub ? "Testing..." : "Test"}
              </button>
              <button className="danger small" onClick={handleDisconnectGithub}>Disconnect</button>
            </>
          ) : (
            <>
              <span className="status disconnected">Not connected</span>
              <button className="primary small" onClick={() => setShowGithubSetup(true)}>Setup</button>
            </>
          )}
        </div>
        {githubTestResult && (
          <div className={`test-result ${githubTestResult.ok ? "success" : "error"}`}>
            {githubTestResult.ok ? `✓ ${githubTestResult.message}` : `✗ ${githubTestResult.message}`}
          </div>
        )}
      </div>

      {/* Asana */}
      <div className="integration-row">
        <div className="integration-icon">
          <AsanaIcon size={32} />
        </div>
        <div className="integration-info">
          <h3>Asana</h3>
          <p>Task management and project tracking</p>
        </div>
        <div className="integration-status">
          {asanaConnected ? (
            <>
              <span className="status connected">Connected</span>
              <button className="secondary small" onClick={handleTestAsana} disabled={testingAsana}>
                {testingAsana ? "Testing..." : "Test"}
              </button>
              <button className="danger small" onClick={handleDisconnectAsana}>Disconnect</button>
            </>
          ) : (
            <>
              <span className="status disconnected">Not connected</span>
              <button className="primary small" onClick={() => setShowAsanaSetup(true)}>Setup</button>
            </>
          )}
        </div>
        {asanaTestResult && (
          <div className={`test-result ${asanaTestResult.ok ? "success" : "error"}`}>
            {asanaTestResult.ok ? `✓ ${asanaTestResult.message}` : `✗ ${asanaTestResult.message}`}
          </div>
        )}
      </div>

      {/* Reddit */}
      <div className="integration-row">
        <div className="integration-icon">
          <RedditIcon size={32} />
        </div>
        <div className="integration-info">
          <h3>Reddit</h3>
          <p>Browse, post, and comment on Reddit</p>
        </div>
        <div className="integration-status">
          {redditConnected ? (
            <>
              <span className="status connected">Connected</span>
              <button className="secondary small" onClick={handleTestReddit} disabled={testingReddit}>
                {testingReddit ? "Testing..." : "Test"}
              </button>
              <button className="danger small" onClick={handleDisconnectReddit}>Disconnect</button>
            </>
          ) : (
            <>
              <span className="status disconnected">Not connected</span>
              <button className="primary small" onClick={() => setShowRedditSetup(true)}>Setup</button>
            </>
          )}
        </div>
        {redditTestResult && (
          <div className={`test-result ${redditTestResult.ok ? "success" : "error"}`}>
            {redditTestResult.ok ? `✓ ${redditTestResult.message}` : `✗ ${redditTestResult.message}`}
          </div>
        )}
      </div>

      {/* Spotify */}
      <div className="integration-row">
        <div className="integration-icon">
          <SpotifyIcon size={32} />
        </div>
        <div className="integration-info">
          <h3>Spotify</h3>
          <p>Playback control and music search</p>
        </div>
        <div className="integration-status">
          {spotifyConnected ? (
            <>
              <span className="status connected">Connected</span>
              <button className="secondary small" onClick={handleTestSpotify} disabled={testingSpotify}>
                {testingSpotify ? "Testing..." : "Test"}
              </button>
              <button className="danger small" onClick={handleDisconnectSpotify}>Disconnect</button>
            </>
          ) : (
            <>
              <span className="status disconnected">Not connected</span>
              <button className="primary small" onClick={() => setShowSpotifySetup(true)}>Setup</button>
            </>
          )}
        </div>
        {spotifyTestResult && (
          <div className={`test-result ${spotifyTestResult.ok ? "success" : "error"}`}>
            {spotifyTestResult.ok ? `✓ ${spotifyTestResult.message}` : `✗ ${spotifyTestResult.message}`}
          </div>
        )}
      </div>

      {showGoogleSetup && (
        <GoogleSetupModal
          onClose={() => setShowGoogleSetup(false)}
          onComplete={() => {
            setGoogleConnected(true);
            setShowGoogleSetup(false);
          }}
        />
      )}

      {showIMessageSetup && (
        <IMessageSetupModal onClose={() => setShowIMessageSetup(false)} />
      )}

      {showSlackSetup && (
        <SlackSetupModal
          onClose={() => setShowSlackSetup(false)}
          onComplete={() => {
            setSlackConnected(true);
            setShowSlackSetup(false);
            // Refresh to get team name
            window.wovly.integrations.checkSlackAuth().then(result => {
              if (result.ok && result.team) {
                setSlackTeam(result.team.name);
              }
            });
          }}
        />
      )}

      {showTelegramSetup && (
        <TelegramSetupModal
          onClose={() => setShowTelegramSetup(false)}
          onComplete={() => {
            setTelegramConnected(true);
            setShowTelegramSetup(false);
          }}
        />
      )}

      {showDiscordSetup && (
        <DiscordSetupModal
          onClose={() => setShowDiscordSetup(false)}
          onComplete={() => {
            setDiscordConnected(true);
            setShowDiscordSetup(false);
          }}
        />
      )}

      {showXSetup && (
        <XSetupModal
          onClose={() => setShowXSetup(false)}
          onComplete={() => {
            setXConnected(true);
            setShowXSetup(false);
          }}
        />
      )}

      {showNotionSetup && (
        <NotionSetupModal
          onClose={() => setShowNotionSetup(false)}
          onComplete={() => {
            setNotionConnected(true);
            setShowNotionSetup(false);
          }}
        />
      )}

      {showGithubSetup && (
        <GitHubSetupModal
          onClose={() => setShowGithubSetup(false)}
          onComplete={() => {
            setGithubConnected(true);
            setShowGithubSetup(false);
          }}
        />
      )}

      {showAsanaSetup && (
        <AsanaSetupModal
          onClose={() => setShowAsanaSetup(false)}
          onComplete={() => {
            setAsanaConnected(true);
            setShowAsanaSetup(false);
          }}
        />
      )}

      {showRedditSetup && (
        <RedditSetupModal
          onClose={() => setShowRedditSetup(false)}
          onComplete={() => {
            setRedditConnected(true);
            setShowRedditSetup(false);
          }}
        />
      )}

      {showSpotifySetup && (
        <SpotifySetupModal
          onClose={() => setShowSpotifySetup(false)}
          onComplete={() => {
            setSpotifyConnected(true);
            setShowSpotifySetup(false);
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings Page
// ─────────────────────────────────────────────────────────────────────────────

const ANTHROPIC_MODELS = [
  { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4 (Latest)" },
  { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet" },
  { id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku (Fast)" },
  { id: "claude-3-opus-20240229", name: "Claude 3 Opus" },
];

const OPENAI_MODELS = [
  { id: "gpt-4o", name: "GPT-4o (Latest)" },
  { id: "gpt-4o-mini", name: "GPT-4o Mini (Fast)" },
  { id: "gpt-4-turbo", name: "GPT-4 Turbo" },
  { id: "gpt-3.5-turbo", name: "GPT-3.5 Turbo" },
];

const GOOGLE_MODELS = [
  { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro" },
  { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash (Fast)" },
  { id: "gemini-pro", name: "Gemini Pro" },
];

// ─────────────────────────────────────────────────────────────────────────────
// Credentials Page - Secure local storage for website logins
// ─────────────────────────────────────────────────────────────────────────────

function CredentialsPage() {
  const [credentials, setCredentials] = useState<CredentialListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingDomain, setEditingDomain] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState<Record<string, boolean>>({});
  
  // Form state for add/edit modal
  const [formDomain, setFormDomain] = useState("");
  const [formDisplayName, setFormDisplayName] = useState("");
  const [formUsername, setFormUsername] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [showFormPassword, setShowFormPassword] = useState(false);
  const [saving, setSaving] = useState(false);

  // Load credentials on mount
  useEffect(() => {
    loadCredentials();
  }, []);

  const loadCredentials = async () => {
    if (!window.wovly) return;
    setLoading(true);
    setError(null);
    
    try {
      const result = await window.wovly.credentials.list();
      if (result.ok && result.credentials) {
        setCredentials(result.credentials);
      } else {
        setError(result.error || "Failed to load credentials");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load credentials");
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = () => {
    setEditingDomain(null);
    setFormDomain("");
    setFormDisplayName("");
    setFormUsername("");
    setFormPassword("");
    setFormNotes("");
    setShowFormPassword(false);
    setShowAddModal(true);
  };

  const handleEdit = async (domain: string) => {
    if (!window.wovly) return;
    
    try {
      const result = await window.wovly.credentials.get(domain, true);
      if (result.ok && result.credential) {
        const cred = result.credential as WovlyCredential;
        setEditingDomain(domain);
        setFormDomain(cred.domain);
        setFormDisplayName(cred.displayName);
        setFormUsername(cred.username);
        setFormPassword(cred.password || "");
        setFormNotes(cred.notes);
        setShowFormPassword(false);
        setShowAddModal(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load credential");
    }
  };

  const handleSave = async () => {
    if (!window.wovly || !formDomain.trim()) return;
    
    setSaving(true);
    setError(null);
    
    try {
      const result = await window.wovly.credentials.save({
        domain: formDomain.trim(),
        displayName: formDisplayName.trim() || undefined,
        username: formUsername.trim() || undefined,
        password: formPassword || undefined,
        notes: formNotes.trim() || undefined
      });
      
      if (result.ok) {
        setShowAddModal(false);
        await loadCredentials();
      } else {
        setError(result.error || "Failed to save credential");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save credential");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (domain: string) => {
    if (!window.wovly) return;
    
    if (!confirm(`Delete credentials for ${domain}? This cannot be undone.`)) {
      return;
    }
    
    try {
      const result = await window.wovly.credentials.delete(domain);
      if (result.ok) {
        await loadCredentials();
      } else {
        setError(result.error || "Failed to delete credential");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete credential");
    }
  };

  const togglePasswordVisibility = (domain: string) => {
    setShowPassword(prev => ({ ...prev, [domain]: !prev[domain] }));
  };

  return (
    <div className="credentials-page">
      <div className="page-header">
        <div>
          <h1>Credentials</h1>
          <p className="page-subtitle">Securely stored website logins for browser automation. Credentials are encrypted locally and never sent to AI providers.</p>
        </div>
        <button className="primary" onClick={handleAdd}>
          + Add Credential
        </button>
      </div>

      {error && <div className="credentials-error">{error}</div>}

      {loading ? (
        <div className="credentials-loading">Loading credentials...</div>
      ) : credentials.length === 0 ? (
        <div className="credentials-empty">
          <div className="empty-icon">🔐</div>
          <h3>No credentials saved</h3>
          <p>Add website credentials to enable automatic login during browser automation.</p>
          <button className="primary" onClick={handleAdd}>Add Your First Credential</button>
        </div>
      ) : (
        <div className="credentials-list">
          {credentials.map((cred) => (
            <div key={cred.domain} className="credential-row">
              <div className="credential-icon">🔐</div>
              <div className="credential-info">
                <div className="credential-domain">{cred.displayName || cred.domain}</div>
                <div className="credential-username">{cred.username || "(no username)"}</div>
                {cred.hasPassword && (
                  <div className="credential-password">
                    {showPassword[cred.domain] ? "••••••••" : "Password saved"}
                    <button 
                      className="show-password-btn"
                      onClick={() => togglePasswordVisibility(cred.domain)}
                    >
                      {showPassword[cred.domain] ? "Hide" : "Show"}
                    </button>
                  </div>
                )}
                {cred.notes && <div className="credential-notes">{cred.notes}</div>}
                {cred.lastUsed && (
                  <div className="credential-last-used">
                    Last used: {new Date(cred.lastUsed).toLocaleDateString()}
                  </div>
                )}
              </div>
              <div className="credential-actions">
                <button className="secondary small" onClick={() => handleEdit(cred.domain)}>Edit</button>
                <button className="danger small" onClick={() => handleDelete(cred.domain)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="credentials-help">
        <h4>How credentials work</h4>
        <p>Credentials are stored securely on your device using OS-level encryption. They are used locally for browser automation when logging into websites - your passwords are never sent to AI providers.</p>
      </div>

      {/* Add/Edit Modal */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal credential-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingDomain ? "Edit Credential" : "Add Credential"}</h2>
              <button className="modal-close" onClick={() => setShowAddModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Website Domain *</label>
                <input
                  type="text"
                  value={formDomain}
                  onChange={e => setFormDomain(e.target.value)}
                  placeholder="e.g., amazon.com"
                  disabled={!!editingDomain}
                />
                <span className="form-hint">The website domain this credential is for</span>
              </div>
              
              <div className="form-group">
                <label>Display Name</label>
                <input
                  type="text"
                  value={formDisplayName}
                  onChange={e => setFormDisplayName(e.target.value)}
                  placeholder="e.g., Amazon Shopping"
                />
              </div>
              
              <div className="form-group">
                <label>Username / Email</label>
                <input
                  type="text"
                  value={formUsername}
                  onChange={e => setFormUsername(e.target.value)}
                  placeholder="e.g., user@email.com"
                />
              </div>
              
              <div className="form-group">
                <label>Password</label>
                <div className="password-input-wrapper">
                  <input
                    type={showFormPassword ? "text" : "password"}
                    value={formPassword}
                    onChange={e => setFormPassword(e.target.value)}
                    placeholder={editingDomain ? "(unchanged)" : "Enter password"}
                  />
                  <button 
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowFormPassword(!showFormPassword)}
                  >
                    {showFormPassword ? "Hide" : "Show"}
                  </button>
                </div>
                <span className="form-hint">Encrypted locally using OS-level security</span>
              </div>
              
              <div className="form-group">
                <label>Notes (optional)</label>
                <textarea
                  value={formNotes}
                  onChange={e => setFormNotes(e.target.value)}
                  placeholder="e.g., Work account, 2FA enabled"
                  rows={2}
                />
              </div>

              {error && <div className="form-error">{error}</div>}
            </div>
            <div className="modal-footer">
              <button className="secondary" onClick={() => setShowAddModal(false)}>Cancel</button>
              <button 
                className="primary" 
                onClick={handleSave}
                disabled={saving || !formDomain.trim()}
              >
                {saving ? "Saving..." : "Save Credential"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// About Me Page - Profile Viewer/Editor
// ─────────────────────────────────────────────────────────────────────────────

function AboutMePage() {
  const [markdown, setMarkdown] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [editedMarkdown, setEditedMarkdown] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadProfile = async () => {
      setLoading(true);
      try {
        const profileApi = window.wovly.profile as {
          getMarkdown: () => Promise<{ok: boolean; markdown?: string; error?: string}>;
        };
        const result = await profileApi.getMarkdown();
        if (result.ok && result.markdown !== undefined) {
          setMarkdown(result.markdown);
          setEditedMarkdown(result.markdown);
        } else {
          setError(result.error || "Failed to load profile");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load profile");
      } finally {
        setLoading(false);
      }
    };
    loadProfile();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const profileApi = window.wovly.profile as {
        saveMarkdown: (markdown: string) => Promise<{ok: boolean; error?: string}>;
      };
      const result = await profileApi.saveMarkdown(editedMarkdown);
      if (result.ok) {
        setMarkdown(editedMarkdown);
        setIsEditing(false);
      } else {
        setError(result.error || "Failed to save profile");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditedMarkdown(markdown);
  };

  if (loading) {
    return (
      <div className="about-me-page">
        <div className="loading-state">Loading profile...</div>
      </div>
    );
  }

  return (
    <div className="about-me-page">
      {/* Important Description Header */}
      <div className="about-me-header">
        <h1>About Me</h1>
        <div className="about-me-description">
          <p><strong>This is your personal profile that Wovly uses to understand you better.</strong></p>
          <p>
            The information here helps me remember important details about your life, 
            relationships, preferences, and context. The more I know about you, the 
            better I can assist you with personalized responses and actions.
          </p>
          <p className="important-note">
            🔒 This file is stored locally on your device and is never shared. 
            Keep it updated with information you want me to remember!
          </p>
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="error-banner">
          {error}
        </div>
      )}

      {/* View/Edit Toggle */}
      <div className="about-me-actions">
        {isEditing ? (
          <>
            <button 
              className="btn-primary" 
              onClick={handleSave} 
              disabled={saving}
            >
              {saving ? "Saving..." : "Save"}
            </button>
            <button 
              className="btn-secondary" 
              onClick={handleCancel}
              disabled={saving}
            >
              Cancel
            </button>
          </>
        ) : (
          <button 
            className="btn-primary" 
            onClick={() => setIsEditing(true)}
          >
            Edit Profile
          </button>
        )}
      </div>

      {/* Content Area */}
      <div className="about-me-content">
        {isEditing ? (
          <textarea
            value={editedMarkdown}
            onChange={(e) => setEditedMarkdown(e.target.value)}
            className="profile-editor"
            placeholder="Enter your profile information in markdown format..."
          />
        ) : (
          <div className="profile-viewer">
            <pre>{markdown || "No profile information yet. Click 'Edit Profile' to add your information."}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

type LLMProvider = "anthropic" | "openai" | "google";

function SettingsPage() {
  const [anthropicKey, setAnthropicKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [googleKey, setGoogleKey] = useState("");
  const [anthropicModel, setAnthropicModel] = useState(ANTHROPIC_MODELS[0].id);
  const [openaiModel, setOpenaiModel] = useState(OPENAI_MODELS[0].id);
  const [googleModel, setGoogleModel] = useState(GOOGLE_MODELS[0].id);
  const [activeProvider, setActiveProvider] = useState<LLMProvider>("anthropic");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadSettings = async () => {
      if (!window.wovly) return;
      const result = await window.wovly.settings.get();
      if (result.ok && result.settings) {
        const apiKeys = result.settings.apiKeys as Record<string, string> || {};
        const models = result.settings.models as Record<string, string> || {};
        const provider = result.settings.activeProvider as LLMProvider || "anthropic";
        
        setAnthropicKey(apiKeys.anthropic || "");
        setOpenaiKey(apiKeys.openai || "");
        setGoogleKey(apiKeys.google || "");
        setAnthropicModel(models.anthropic || ANTHROPIC_MODELS[0].id);
        setOpenaiModel(models.openai || OPENAI_MODELS[0].id);
        setGoogleModel(models.google || GOOGLE_MODELS[0].id);
        setActiveProvider(provider);
      }
      setLoading(false);
    };
    loadSettings();
  }, []);

  const handleSave = async () => {
    if (!window.wovly) return;
    await window.wovly.settings.set({
      apiKeys: {
        anthropic: anthropicKey,
        openai: openaiKey,
        google: googleKey
      },
      models: {
        anthropic: anthropicModel,
        openai: openaiModel,
        google: googleModel
      },
      activeProvider
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const selectProvider = (provider: LLMProvider) => {
    setActiveProvider(provider);
  };

  if (loading) {
    return <div className="settings-page"><p>Loading...</p></div>;
  }

  return (
    <div className="settings-page">
      <h1>Settings</h1>
      
      <div className="settings-section">
        <h2>LLM Providers</h2>
        <p className="settings-description">Configure your AI providers. The active provider will be used for chat.</p>
        
        {/* Anthropic */}
        <div className={`provider-row ${activeProvider === "anthropic" ? "active" : ""}`}>
          <div className="provider-header">
            <div className="provider-info">
              <div className="provider-name">
                <span className="provider-icon"><ClaudeIcon size={24} /></span>
                Anthropic (Claude)
              </div>
              {anthropicKey && <span className="provider-configured">Configured</span>}
            </div>
            <button 
              className={`provider-select-btn ${activeProvider === "anthropic" ? "selected" : ""}`}
              onClick={() => selectProvider("anthropic")}
              disabled={!anthropicKey}
            >
              {activeProvider === "anthropic" ? "✓ Active" : "Use"}
            </button>
          </div>
          <div className="provider-fields">
            <div className="form-row">
              <div className="form-group flex-2">
                <label>API Key</label>
                <input
                  type="password"
                  value={anthropicKey}
                  onChange={e => setAnthropicKey(e.target.value)}
                  placeholder="sk-ant-api03-..."
                />
              </div>
              <div className="form-group flex-1">
                <label>Model</label>
                <select value={anthropicModel} onChange={e => setAnthropicModel(e.target.value)}>
                  {ANTHROPIC_MODELS.map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* OpenAI */}
        <div className={`provider-row ${activeProvider === "openai" ? "active" : ""}`}>
          <div className="provider-header">
            <div className="provider-info">
              <div className="provider-name">
                <span className="provider-icon"><OpenAIIcon size={24} /></span>
                OpenAI (GPT)
              </div>
              {openaiKey && <span className="provider-configured">Configured</span>}
            </div>
            <button 
              className={`provider-select-btn ${activeProvider === "openai" ? "selected" : ""}`}
              onClick={() => selectProvider("openai")}
              disabled={!openaiKey}
            >
              {activeProvider === "openai" ? "✓ Active" : "Use"}
            </button>
          </div>
          <div className="provider-fields">
            <div className="form-row">
              <div className="form-group flex-2">
                <label>API Key</label>
                <input
                  type="password"
                  value={openaiKey}
                  onChange={e => setOpenaiKey(e.target.value)}
                  placeholder="sk-..."
                />
              </div>
              <div className="form-group flex-1">
                <label>Model</label>
                <select value={openaiModel} onChange={e => setOpenaiModel(e.target.value)}>
                  {OPENAI_MODELS.map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Google */}
        <div className={`provider-row ${activeProvider === "google" ? "active" : ""}`}>
          <div className="provider-header">
            <div className="provider-info">
              <div className="provider-name">
                <span className="provider-icon"><GeminiIcon size={24} /></span>
                Google (Gemini)
              </div>
              {googleKey && <span className="provider-configured">Configured</span>}
            </div>
            <button 
              className={`provider-select-btn ${activeProvider === "google" ? "selected" : ""}`}
              onClick={() => selectProvider("google")}
              disabled={!googleKey}
            >
              {activeProvider === "google" ? "✓ Active" : "Use"}
            </button>
          </div>
          <div className="provider-fields">
            <div className="form-row">
              <div className="form-group flex-2">
                <label>API Key</label>
                <input
                  type="password"
                  value={googleKey}
                  onChange={e => setGoogleKey(e.target.value)}
                  placeholder="AIza..."
                />
              </div>
              <div className="form-group flex-1">
                <label>Model</label>
                <select value={googleModel} onChange={e => setGoogleModel(e.target.value)}>
                  {GOOGLE_MODELS.map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>

        <div className="settings-actions">
          <button className="primary" onClick={handleSave}>
            {saved ? "✓ Saved" : "Save Settings"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Message Confirmation Modal - Requires user approval before sending messages
// ─────────────────────────────────────────────────────────────────────────────

interface MessageConfirmation {
  confirmationId: string;
  toolName: string;
  preview: {
    type: string;
    platform: string;
    recipient: string;
    subject?: string;
    message: string;
    cc?: string;
  };
}

function MessageConfirmationModal({ 
  confirmation, 
  onApprove, 
  onReject 
}: { 
  confirmation: MessageConfirmation;
  onApprove: () => void;
  onReject: () => void;
}) {
  const { preview } = confirmation;
  
  const getPlatformColor = () => {
    switch (confirmation.toolName) {
      case 'send_email': return '#EA4335';
      case 'send_imessage': return '#34C759';
      case 'send_slack_message': return '#4A154B';
      case 'send_telegram_message': return '#0088cc';
      case 'send_discord_message': return '#5865F2';
      default: return '#6366f1';
    }
  };
  
  const getPlatformIcon = () => {
    switch (confirmation.toolName) {
      case 'send_email': 
        return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 6L2 7"/></svg>;
      case 'send_imessage': 
        return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>;
      case 'send_slack_message': 
        return <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/></svg>;
      case 'send_telegram_message':
        return <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>;
      case 'send_discord_message':
        return <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>;
      default: 
        return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 2L11 13"/><path d="M22 2L15 22l-4-9-9-4 20-7z"/></svg>;
    }
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 9999 }}>
      <div className="modal" style={{ 
        maxWidth: '480px', 
        width: '100%',
        padding: 0,
        overflow: 'hidden',
        borderRadius: '16px',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)'
      }}>
        {/* Header */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between',
          padding: '20px 24px',
          borderBottom: '1px solid rgba(0,0,0,0.06)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ 
              width: '40px', 
              height: '40px', 
              borderRadius: '10px',
              background: getPlatformColor(),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white'
            }}>
              {getPlatformIcon()}
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#1a1a2e' }}>
                Send via {preview.platform}
              </h2>
              <p style={{ margin: 0, fontSize: '13px', color: '#7a7a8c' }}>
                Review before sending
              </p>
            </div>
          </div>
          <button 
            onClick={onReject}
            style={{
              background: 'none',
              border: 'none',
              padding: '8px',
              cursor: 'pointer',
              color: '#9ca3af',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            onMouseOver={(e) => e.currentTarget.style.background = '#f3f4f6'}
            onMouseOut={(e) => e.currentTarget.style.background = 'none'}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>
        
        {/* Content */}
        <div style={{ padding: '24px' }}>
          {/* Recipient */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ 
              display: 'block',
              fontSize: '11px', 
              fontWeight: 600,
              color: '#9ca3af',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              marginBottom: '6px'
            }}>
              To
            </label>
            <div style={{ 
              fontSize: '15px', 
              color: '#1a1a2e',
              fontWeight: 500
            }}>
              {preview.recipient}
            </div>
          </div>
          
          {/* Subject (if email) */}
          {preview.subject && (
            <div style={{ marginBottom: '16px' }}>
              <label style={{ 
                display: 'block',
                fontSize: '11px', 
                fontWeight: 600,
                color: '#9ca3af',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginBottom: '6px'
              }}>
                Subject
              </label>
              <div style={{ 
                fontSize: '15px', 
                color: '#1a1a2e',
                fontWeight: 500
              }}>
                {preview.subject}
              </div>
            </div>
          )}
          
          {/* CC (if email) */}
          {preview.cc && (
            <div style={{ marginBottom: '16px' }}>
              <label style={{ 
                display: 'block',
                fontSize: '11px', 
                fontWeight: 600,
                color: '#9ca3af',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginBottom: '6px'
              }}>
                CC
              </label>
              <div style={{ 
                fontSize: '15px', 
                color: '#1a1a2e'
              }}>
                {preview.cc}
              </div>
            </div>
          )}
          
          {/* Message */}
          <div>
            <label style={{ 
              display: 'block',
              fontSize: '11px', 
              fontWeight: 600,
              color: '#9ca3af',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              marginBottom: '8px'
            }}>
              Message
            </label>
            <div style={{ 
              background: '#f8f9fb',
              borderRadius: '12px',
              padding: '16px',
              fontSize: '14px',
              color: '#374151',
              lineHeight: '1.6',
              whiteSpace: 'pre-wrap',
              maxHeight: '200px',
              overflowY: 'auto'
            }}>
              {preview.message}
            </div>
          </div>
        </div>
        
        {/* Footer */}
        <div style={{ 
          display: 'flex', 
          gap: '12px',
          padding: '16px 24px 24px',
          justifyContent: 'flex-end'
        }}>
          <button 
            onClick={onReject}
            style={{ 
              padding: '10px 20px',
              borderRadius: '10px',
              fontSize: '14px',
              fontWeight: 500,
              border: '1px solid #e5e7eb',
              background: 'white',
              color: '#374151',
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = '#f9fafb';
              e.currentTarget.style.borderColor = '#d1d5db';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = 'white';
              e.currentTarget.style.borderColor = '#e5e7eb';
            }}
          >
            Cancel
          </button>
          <button 
            onClick={onApprove}
            style={{ 
              padding: '10px 24px',
              borderRadius: '10px',
              fontSize: '14px',
              fontWeight: 500,
              border: 'none',
              background: getPlatformColor(),
              color: 'white',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.15s ease'
            }}
            onMouseOver={(e) => e.currentTarget.style.opacity = '0.9'}
            onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M22 2L11 13"/><path d="M22 2L15 22l-4-9-9-4 20-7z"/>
            </svg>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Login Page - Authentication screen
// ─────────────────────────────────────────────────────────────────────────────

type AuthUser = {
  username: string;
  displayName: string;
};

function LoginPage({ onLogin }: { onLogin: (user: AuthUser) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<Array<{ username: string; displayName: string }>>([]);
  const [hasUsers, setHasUsers] = useState<boolean | null>(null);

  useEffect(() => {
    const checkUsers = async () => {
      const result = await window.wovly.auth.hasUsers();
      if (result.ok) {
        setHasUsers(result.hasUsers || false);
        if (result.hasUsers) {
          const listResult = await window.wovly.auth.listUsers();
          if (listResult.ok && listResult.users) {
            setUsers(listResult.users);
          }
        } else {
          // No users yet, show register mode
          setMode("register");
        }
      }
    };
    checkUsers();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (mode === "register") {
        const result = await window.wovly.auth.register(username, password, displayName || username);
        if (result.ok) {
          // Auto-login after registration
          const loginResult = await window.wovly.auth.login(username, password);
          if (loginResult.ok && loginResult.user) {
            onLogin(loginResult.user);
          }
        } else {
          setError(result.error || "Registration failed");
        }
      } else {
        const result = await window.wovly.auth.login(username, password);
        if (result.ok && result.user) {
          onLogin(result.user);
        } else {
          setError(result.error || "Login failed");
        }
      }
    } catch (err) {
      setError("An error occurred");
    } finally {
      setLoading(false);
    }
  };

  if (hasUsers === null) {
    return (
      <div className="login-page">
        <div className="login-container">
          <div className="login-loading">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-header">
          <WovlyIcon size={48} />
          <h1>Wovly</h1>
          <p>{mode === "register" ? "Create your account" : "Welcome back"}</p>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          {mode === "register" && (
            <div className="form-group">
              <label>Display Name</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name"
                autoFocus
              />
            </div>
          )}

          <div className="form-group">
            <label>Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username"
              required
              autoFocus={mode === "login"}
            />
          </div>

          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              required
            />
          </div>

          {error && <div className="login-error">{error}</div>}

          <button type="submit" className="login-btn primary" disabled={loading}>
            {loading ? "Please wait..." : mode === "register" ? "Create Account" : "Login"}
          </button>
        </form>

        {hasUsers && (
          <div className="login-footer">
            {mode === "login" ? (
              <p>
                New user?{" "}
                <button className="link-btn" onClick={() => { setMode("register"); setError(""); }}>
                  Create an account
                </button>
              </p>
            ) : (
              <p>
                Already have an account?{" "}
                <button className="link-btn" onClick={() => { setMode("login"); setError(""); }}>
                  Login
                </button>
              </p>
            )}
          </div>
        )}

        {mode === "login" && users.length > 1 && (
          <div className="login-users">
            <p className="users-label">Quick login:</p>
            <div className="user-list">
              {users.map((user) => (
                <button
                  key={user.username}
                  className="user-btn"
                  onClick={() => setUsername(user.username)}
                >
                  {user.displayName || user.username}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="login-privacy-note">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <span>All login data is stored locally on your device.</span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main App
// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  // Authentication state
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  const [navItem, setNavItem] = useState<NavItem>("chat");
  
  // Chat state lifted for persistence across navigation
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInitialized, setChatInitialized] = useState(false);
  
  // Message confirmation state
  const [pendingConfirmation, setPendingConfirmation] = useState<MessageConfirmation | null>(null);
  
  // Pending task approvals count (for notification badge)
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState(0);

  // Check auth session on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const result = await window.wovly.auth.checkSession();
        if (result.ok && result.loggedIn && result.user) {
          setIsLoggedIn(true);
          setCurrentUser(result.user);
        }
      } catch (err) {
        console.error("[Auth] Session check failed:", err);
      } finally {
        setAuthChecked(true);
      }
    };
    checkAuth();
  }, []);

  const handleLogin = (user: AuthUser) => {
    setCurrentUser(user);
    setIsLoggedIn(true);
  };

  const handleLogout = async () => {
    try {
      await window.wovly.auth.logout();
      setIsLoggedIn(false);
      setCurrentUser(null);
      // Reset app state
      setChatMessages([]);
      setChatInitialized(false);
      setNavItem("chat");
    } catch (err) {
      console.error("[Auth] Logout failed:", err);
    }
  };

  // Load pending approvals count
  const loadPendingApprovalsCount = async () => {
    if (!window.wovly || !isLoggedIn) return;
    try {
      const result = await window.wovly.tasks.list();
      if (result.ok && result.tasks) {
        // Count all pending messages across all tasks
        // Note: tasks with waiting_approval status already have pendingMessages, so we only count messages
        let count = 0;
        for (const task of result.tasks) {
          if (task.pendingMessages && task.pendingMessages.length > 0) {
            count += task.pendingMessages.length;
          }
        }
        setPendingApprovalsCount(count);
      }
    } catch (err) {
      console.error('[UI] Error loading pending approvals:', err);
    }
  };
  
  // Load pending count on mount and subscribe to updates
  useEffect(() => {
    if (!isLoggedIn) return;
    
    loadPendingApprovalsCount();
    
    // Subscribe to task updates to refresh count
    const unsubscribeTask = window.wovly?.tasks?.onUpdate?.(() => {
      loadPendingApprovalsCount();
    });
    
    // Subscribe to pending message events
    const unsubscribePending = window.wovly?.tasks?.onPendingMessage?.(() => {
      loadPendingApprovalsCount();
    });
    
    return () => {
      unsubscribeTask?.();
      unsubscribePending?.();
    };
  }, [isLoggedIn]);
  
  // Subscribe to message confirmation requests
  useEffect(() => {
    if (!isLoggedIn) return;
    
    const unsubscribe = window.wovly.messageConfirmation?.onConfirmationRequired((data) => {
      console.log('[UI] Message confirmation required:', data);
      setPendingConfirmation(data);
    });
    return () => unsubscribe?.();
  }, [isLoggedIn]);
  
  const handleConfirmationApprove = async () => {
    if (pendingConfirmation) {
      console.log('[UI] User approved message:', pendingConfirmation.confirmationId);
      await window.wovly.messageConfirmation.approve(pendingConfirmation.confirmationId);
      setPendingConfirmation(null);
    }
  };
  
  const handleConfirmationReject = async () => {
    if (pendingConfirmation) {
      console.log('[UI] User rejected message:', pendingConfirmation.confirmationId);
      await window.wovly.messageConfirmation.reject(pendingConfirmation.confirmationId, 'User cancelled');
      setPendingConfirmation(null);
    }
  };

  // Show loading while checking auth
  if (!authChecked) {
    return (
      <div className="login-page">
        <div className="login-container">
          <div className="login-loading">
            <WovlyIcon size={48} />
            <p>Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  // Show login page if not logged in
  if (!isLoggedIn) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <div className="app-shell">
      <nav className="sidebar">
        <div className="logo">
          <WovlyIcon size={32} />
        </div>
        <ul className="nav-list">
          <li>
            <button
              className={`nav-btn ${navItem === "chat" ? "active" : ""}`}
              onClick={() => setNavItem("chat")}
            >
              <ChatIcon size={18} /> Chat
            </button>
          </li>
          <li>
            <button
              className={`nav-btn ${navItem === "tasks" ? "active" : ""}`}
              onClick={() => setNavItem("tasks")}
            >
              <span className="nav-icon-wrapper">
                <TasksIcon size={18} />
                {pendingApprovalsCount > 0 && (
                  <span className="nav-badge">{pendingApprovalsCount > 9 ? '9+' : pendingApprovalsCount}</span>
                )}
              </span>
              Tasks
            </button>
          </li>
          <li>
            <button
              className={`nav-btn ${navItem === "skills" ? "active" : ""}`}
              onClick={() => setNavItem("skills")}
            >
              <SkillsIcon size={18} /> Skills
            </button>
          </li>
          <li>
            <button
              className={`nav-btn ${navItem === "about-me" ? "active" : ""}`}
              onClick={() => setNavItem("about-me")}
            >
              <AboutMeIcon size={18} /> About Me
            </button>
          </li>
          <li>
            <button
              className={`nav-btn ${navItem === "interfaces" ? "active" : ""}`}
              onClick={() => setNavItem("interfaces")}
            >
              <InterfacesIcon size={18} /> Interfaces
            </button>
          </li>
          <li>
            <button
              className={`nav-btn ${navItem === "integrations" ? "active" : ""}`}
              onClick={() => setNavItem("integrations")}
            >
              <IntegrationsIcon size={18} /> Integrations
            </button>
          </li>
          <li>
            <button
              className={`nav-btn ${navItem === "credentials" ? "active" : ""}`}
              onClick={() => setNavItem("credentials")}
            >
              <CredentialsIcon size={18} /> Credentials
            </button>
          </li>
          <li>
            <button
              className={`nav-btn ${navItem === "settings" ? "active" : ""}`}
              onClick={() => setNavItem("settings")}
            >
              <SettingsIcon size={18} /> Settings
            </button>
          </li>
          <li>
            <button
              className="nav-btn nav-btn-external"
              onClick={() => window.wovly.shell.openExternal("https://wovly.mintlify.app/")}
            >
              <DocsIcon size={18} /> Docs
            </button>
          </li>
        </ul>
        
        {/* Bottom section with user info and logout */}
        <div className="nav-bottom">
          {currentUser && (
            <div className="nav-user">
              <span className="nav-user-name">{currentUser.displayName}</span>
            </div>
          )}
          <button
            className="nav-btn nav-btn-logout"
            onClick={handleLogout}
          >
            <LogoutIcon size={18} /> Logout
          </button>
        </div>
      </nav>

      <main className="main-content">
        {navItem === "chat" && (
          <div className="content-grid">
            <AgendaPanel />
            <ChatPanel
              messages={chatMessages}
              setMessages={setChatMessages}
              initialized={chatInitialized}
              setInitialized={setChatInitialized}
            />
          </div>
        )}
        {navItem === "tasks" && <TasksPage />}
        {navItem === "skills" && <SkillsPage />}
        {navItem === "about-me" && <AboutMePage />}
        {navItem === "interfaces" && <InterfacesPage />}
        {navItem === "integrations" && <IntegrationsPage />}
        {navItem === "credentials" && <CredentialsPage />}
        {navItem === "settings" && <SettingsPage />}
      </main>
      
      {/* Message Confirmation Modal - Requires approval before sending any message */}
      {pendingConfirmation && (
        <MessageConfirmationModal
          confirmation={pendingConfirmation}
          onApprove={handleConfirmationApprove}
          onReject={handleConfirmationReject}
        />
      )}
    </div>
  );
}
