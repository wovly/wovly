import React, { useEffect, useState, useRef, Fragment } from "react";
import { WovlyIcon, GoogleIcon, IMessageIcon, WeatherIcon, SlackIcon, WhatsAppIcon, TelegramIcon, DiscordIcon, ClaudeIcon, OpenAIIcon, GeminiIcon, PlaywrightIcon, ChatIcon, TasksIcon, SkillsIcon, AboutMeIcon, InterfacesIcon, IntegrationsIcon, SettingsIcon, CredentialsIcon } from "./icons";

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
      const dateStr = currentDate.toISOString().split("T")[0];
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
  
  // Fact confirmation state (for informational statements)
  const [pendingFactConfirmation, setPendingFactConfirmation] = useState<PendingFactConfirmation | null>(null);
  const [isSavingFacts, setIsSavingFacts] = useState(false);

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

      const result = await window.wovly.chat.send(chatHistory) as {
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
        executedInline?: boolean;
      };

      if (result.ok && result.response) {
        const responseText = result.response;
        
        // Check if this is an informational statement that needs confirmation
        if (result.informationType && result.facts && result.facts.length > 0) {
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
      
      // Create task with the decomposition plan
      const taskResult = await window.wovly.tasks.create({
        title: pendingDecomposition.title,
        originalRequest: messages[messages.length - 2]?.content || pendingDecomposition.title, // Get the user's original message
        plan: pendingDecomposition.steps.map(s => s.action),
        taskType: taskType,
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
    // Just return to normal chat mode - no action needed
  };

  // Dismiss the task suggestion and execute steps inline
  const handleDismissTaskSuggestion = async () => {
    if (!pendingDecomposition || !window.wovly) {
      setPendingDecomposition(null);
      return;
    }
    
    // Get the original user message (the one before the decomposition response)
    const originalMessage = messages[messages.length - 2]?.content || "";
    const decomposition = pendingDecomposition;
    
    setPendingDecomposition(null);
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
      } else if (result.error) {
        setError(result.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to execute steps");
    } finally {
      setIsLoading(false);
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

type TaskType = {
  id: string;
  title: string;
  status: TaskStatus;
  created: string;
  lastUpdated: string;
  nextCheck: number | null;
  autoSend?: boolean;
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
// Interfaces Page (WhatsApp, future: iMessage, Telegram, Discord)
// ─────────────────────────────────────────────────────────────────────────────

function InterfacesPage() {
  const [whatsappConnected, setWhatsappConnected] = useState(false);
  const [whatsappStatus, setWhatsappStatus] = useState<WhatsAppStatus>("disconnected");
  const [showWhatsAppSetup, setShowWhatsAppSetup] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    // Check WhatsApp auth status
    const checkStatus = async () => {
      if (!window.wovly) return;
      const result = await window.wovly.whatsapp.checkAuth();
      if (result.ok) {
        setWhatsappConnected(result.connected);
      }
    };
    checkStatus();

    // Subscribe to status updates
    const unsubscribe = window.wovly.whatsapp.onStatus((data) => {
      setWhatsappStatus(data.status);
      setWhatsappConnected(data.status === "connected");
    });

    return unsubscribe;
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

      {/* Telegram - Coming Soon */}
      <div className="interface-row disabled">
        <div className="interface-icon telegram">
          <TelegramIcon size={32} />
        </div>
        <div className="interface-info">
          <h3>Telegram</h3>
          <p>Chat with Wovly via Telegram</p>
        </div>
        <div className="interface-status">
          <span className="status coming-soon">Coming soon</span>
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
  
  const getPlatformIcon = () => {
    switch (confirmation.toolName) {
      case 'send_email': return '📧';
      case 'send_imessage': return '💬';
      case 'send_slack_message': return '💼';
      default: return '📤';
    }
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 9999 }}>
      <div className="modal confirmation-modal" style={{ maxWidth: '600px' }}>
        <div className="modal-header" style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '12px',
          borderBottom: '1px solid var(--border-color)',
          paddingBottom: '16px',
          marginBottom: '16px'
        }}>
          <span style={{ fontSize: '32px' }}>{getPlatformIcon()}</span>
          <div>
            <h2 style={{ margin: 0, fontSize: '18px' }}>Confirm Message</h2>
            <p style={{ margin: '4px 0 0 0', color: 'var(--text-secondary)', fontSize: '14px' }}>
              {preview.platform}
            </p>
          </div>
        </div>
        
        <div className="confirmation-content" style={{ marginBottom: '20px' }}>
          <div style={{ 
            background: 'var(--bg-secondary)', 
            borderRadius: '8px', 
            padding: '16px',
            marginBottom: '16px'
          }}>
            <div style={{ marginBottom: '12px' }}>
              <strong style={{ color: 'var(--text-secondary)', fontSize: '12px', textTransform: 'uppercase' }}>
                To:
              </strong>
              <p style={{ margin: '4px 0 0 0', fontSize: '15px' }}>{preview.recipient}</p>
            </div>
            
            {preview.subject && (
              <div style={{ marginBottom: '12px' }}>
                <strong style={{ color: 'var(--text-secondary)', fontSize: '12px', textTransform: 'uppercase' }}>
                  Subject:
                </strong>
                <p style={{ margin: '4px 0 0 0', fontSize: '15px' }}>{preview.subject}</p>
              </div>
            )}
            
            {preview.cc && (
              <div style={{ marginBottom: '12px' }}>
                <strong style={{ color: 'var(--text-secondary)', fontSize: '12px', textTransform: 'uppercase' }}>
                  CC:
                </strong>
                <p style={{ margin: '4px 0 0 0', fontSize: '15px' }}>{preview.cc}</p>
              </div>
            )}
            
            <div>
              <strong style={{ color: 'var(--text-secondary)', fontSize: '12px', textTransform: 'uppercase' }}>
                Message:
              </strong>
              <p style={{ 
                margin: '8px 0 0 0', 
                fontSize: '14px',
                whiteSpace: 'pre-wrap',
                lineHeight: '1.5',
                maxHeight: '300px',
                overflow: 'auto'
              }}>
                {preview.message}
              </p>
            </div>
          </div>
          
          <p style={{ 
            color: 'var(--text-secondary)', 
            fontSize: '13px',
            margin: 0,
            textAlign: 'center'
          }}>
            This message will be sent immediately upon approval.
          </p>
        </div>
        
        <div className="modal-actions" style={{ 
          display: 'flex', 
          gap: '12px',
          justifyContent: 'flex-end'
        }}>
          <button 
            onClick={onReject}
            className="btn btn-secondary"
            style={{ 
              padding: '10px 24px',
              borderRadius: '8px',
              fontSize: '14px'
            }}
          >
            Cancel
          </button>
          <button 
            onClick={onApprove}
            className="btn btn-primary"
            style={{ 
              padding: '10px 24px',
              borderRadius: '8px',
              fontSize: '14px',
              background: '#10b981',
              color: 'white'
            }}
          >
            ✓ Send Message
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main App
// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  const [navItem, setNavItem] = useState<NavItem>("chat");
  
  // Chat state lifted for persistence across navigation
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInitialized, setChatInitialized] = useState(false);
  
  // Message confirmation state
  const [pendingConfirmation, setPendingConfirmation] = useState<MessageConfirmation | null>(null);
  
  // Pending task approvals count (for notification badge)
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState(0);
  
  // Load pending approvals count
  const loadPendingApprovalsCount = async () => {
    if (!window.wovly) return;
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
  }, []);
  
  // Subscribe to message confirmation requests
  useEffect(() => {
    const unsubscribe = window.wovly.messageConfirmation?.onConfirmationRequired((data) => {
      console.log('[UI] Message confirmation required:', data);
      setPendingConfirmation(data);
    });
    return () => unsubscribe?.();
  }, []);
  
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
        </ul>
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
