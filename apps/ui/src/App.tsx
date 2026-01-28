import React, { useEffect, useState, useRef, Fragment } from "react";
import { WovlyIcon, GoogleIcon, IMessageIcon, WeatherIcon, SlackIcon, WhatsAppIcon, TelegramIcon, DiscordIcon, ClaudeIcon, OpenAIIcon, GeminiIcon, ChatIcon, TasksIcon, SkillsIcon, InterfacesIcon, IntegrationsIcon, SettingsIcon } from "./icons";

type NavItem = "chat" | "tasks" | "skills" | "interfaces" | "integrations" | "settings";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  source?: "app" | "whatsapp" | "task"; // Where the message originated from
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

  const timedEvents = events.filter(e => e.start.includes("T"));
  const eventColumns = calculateEventColumns(timedEvents);

  return (
    <div className="panel agenda-panel">
      <div className="panel-header">
        <button className="icon-btn" onClick={goToPreviousDay}>←</button>
        <h2>{formatDate(currentDate)}</h2>
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
      // Handle incoming messages from various sources
      if (msg.source === "whatsapp" || msg.source === "task") {
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

      const result = await window.wovly.chat.send(chatHistory);

      if (result.ok && result.response) {
        const responseText = result.response;
        setMessages(prev => [...prev, {
          id: crypto.randomUUID(),
          role: "assistant" as const,
          content: responseText,
          source: "app"
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
          <div key={msg.id} className={`chat-bubble ${msg.role} ${msg.source === "whatsapp" ? "from-whatsapp" : ""} ${msg.source === "task" ? "from-task" : ""}`}>
            {msg.source === "whatsapp" && <span className="source-badge">📱</span>}
            {msg.source === "task" && <span className="source-badge">📋</span>}
            {msg.role === "assistant" ? renderMarkdown(msg.content) : msg.content}
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

type TaskStatus = "pending" | "active" | "waiting" | "completed" | "failed" | "cancelled";

type TaskType = {
  id: string;
  title: string;
  status: TaskStatus;
  created: string;
  lastUpdated: string;
  nextCheck: number | null;
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
    if (window.wovly) {
      unsubscribe = window.wovly.tasks.onUpdate(() => {
        loadTasks(); // Reload tasks on any update
      });
    }
    
    // Refresh task list every 10 seconds to catch nextCheck updates
    const refreshInterval = setInterval(() => {
      loadTasks();
      setTick(t => t + 1);
    }, 10000);
    
    return () => {
      if (unsubscribe) unsubscribe();
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

  const getStatusBadge = (status: TaskStatus) => {
    const badges: Record<TaskStatus, { className: string; label: string }> = {
      pending: { className: "status-pending", label: "Pending" },
      active: { className: "status-active", label: "Active" },
      waiting: { className: "status-waiting", label: "Waiting" },
      completed: { className: "status-completed", label: "Completed" },
      failed: { className: "status-failed", label: "Failed" },
      cancelled: { className: "status-cancelled", label: "Cancelled" }
    };
    const badge = badges[status];
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
            <div key={task.id} className={`task-card ${expandedTask === task.id ? "expanded" : ""}`}>
              <div className="task-header" onClick={() => setExpandedTask(expandedTask === task.id ? null : task.id)}>
                <div className="task-title-row">
                  <span className="expand-icon">{expandedTask === task.id ? "▼" : "▶"}</span>
                  <h3>{task.title}</h3>
                  {getStatusBadge(task.status)}
                </div>
                <div className="task-meta">
                  Step {task.currentStep.step} of {task.plan.length} • Updated {formatDate(task.lastUpdated)}
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
          
          <textarea
            className="skill-editor-textarea"
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            placeholder="Enter skill markdown..."
          />
          
          <div className="editor-help">
            <h4>Skill Format:</h4>
            <pre>{`# Skill Name

## Description
What this skill does and when to use it.

## Keywords
keyword1, keyword2, keyword3

## Procedure
1. First step
2. Second step
3. Third step

## Constraints
- Important rule or constraint
- Another constraint

## Tools
tool1, tool2`}</pre>
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
// Main App
// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  const [navItem, setNavItem] = useState<NavItem>("chat");
  
  // Chat state lifted for persistence across navigation
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInitialized, setChatInitialized] = useState(false);

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
              <TasksIcon size={18} /> Tasks
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
        {navItem === "interfaces" && <InterfacesPage />}
        {navItem === "integrations" && <IntegrationsPage />}
        {navItem === "settings" && <SettingsPage />}
      </main>
    </div>
  );
}
