import React, { useState } from 'react';
import './WebIntegrationModal.css';

interface AddWebIntegrationModalProps {
  onClose: () => void;
  onSave: (config: any) => void;
}

interface SelectorConfig {
  login: {
    usernameField: string;
    passwordField: string;
    submitButton: string;
    successIndicator: string;
  };
  navigation: Array<{
    step: number;
    action: string;
    selector: string;
    waitFor: string;
    description: string;
  }>;
  messages: {
    container: string;
    messageItem: string;
    sender: string;
    content: string;
    timestamp: string;
  };
  oauth?: {
    provider?: string;
    loginDetectionSelector?: string;
    successDetectionSelector?: string;
  };
}

export default function AddWebIntegrationModal({ onClose, onSave }: AddWebIntegrationModalProps) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load available credentials on mount
  React.useEffect(() => {
    loadAvailableCredentials();
  }, []);

  // Form data
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [siteType, setSiteType] = useState('');
  const [credentialDomain, setCredentialDomain] = useState('');

  // Available credential domains (loaded from backend)
  const [availableCredentials, setAvailableCredentials] = useState<string[]>([]);
  const [loadingCredentials, setLoadingCredentials] = useState(false);
  const [showCredentialManager, setShowCredentialManager] = useState(false);

  // Auth method
  const [authMethod, setAuthMethod] = useState<'form' | 'oauth'>('form');

  // OAuth state
  const [oauthLoginComplete, setOAuthLoginComplete] = useState(false);
  const [oauthLoginInProgress, setOAuthLoginInProgress] = useState(false);
  const [oauthError, setOAuthError] = useState<string | null>(null);

  // AI-generated selectors
  const [aiSelectors, setAiSelectors] = useState<SelectorConfig | null>(null);
  const [aiConfidence, setAiConfidence] = useState<string>('');

  // Store the actual login page URL (may differ from original URL)
  const [loginPageUrl, setLoginPageUrl] = useState<string>('');

  // Final selectors (after user refinement)
  const [selectors, setSelectors] = useState<SelectorConfig>({
    login: {
      usernameField: '',
      passwordField: '',
      submitButton: '',
      successIndicator: ''
    },
    navigation: [],
    messages: {
      container: '',
      messageItem: '',
      sender: '',
      content: '',
      timestamp: ''
    }
  });

  // Recording wizard state
  const [recordingComplete, setRecordingComplete] = useState(false);
  const [recordingInProgress, setRecordingInProgress] = useState(false);
  const [recordedSession, setRecordedSession] = useState<any>(null);

  // Test results
  const [testResult, setTestResult] = useState<any>(null);

  const handleAnalyze = async () => {
    setLoading(true);
    setError(null);

    try {
      // For form-based auth, skip directly to recording
      if (authMethod === 'form') {
        setStep(2);
        setLoading(false);
        return;
      }

      // For OAuth, we still need AI analysis
      if (!(window as any).wovly?.webscraper) {
        setError("Web scraper API not available. Please restart the application.");
        setLoading(false);
        return;
      }
      const result = await (window as any).wovly.webscraper.analyzeUrl(url, siteType);

      if (result.success) {
        setAiSelectors(result.selectors);
        setAiConfidence(result.confidence);
        setSelectors(result.selectors);
        setLoginPageUrl(result.loginPageUrl || url);

        // Override authMethod if AI detected something different
        if (result.selectors?.authMethod) {
          console.log(`AI detected auth method: ${result.selectors.authMethod} (user selected: ${authMethod})`);
          if (result.selectors.authMethod !== authMethod) {
            console.log(`Overriding user selection with AI detection: ${result.selectors.authMethod}`);
            setAuthMethod(result.selectors.authMethod);
          }
        }

        // For OAuth, go to step 2 (OAuth login)
        if (result.selectors?.authMethod === 'oauth') {
          console.log('OAuth detected - going to OAuth login step');
          setStep(2);
        }
      } else {
        setError(result.error || 'Failed to analyze page');
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleVisualSelect = async (field: string) => {
    try {
      if (!(window as any).wovly?.webscraper) {
        setError("Web scraper API not available. Please restart the application.");
        return;
      }
      const purpose = `${field.replace(/([A-Z])/g, ' $1').toLowerCase()}`;
      const suggested = getSelectorValue(field);

      // Use the actual login page URL, not the original URL
      const pageUrl = loginPageUrl || url;
      console.log('Visual selector using URL:', pageUrl);

      // For messages area, we need to navigate to the final page after login
      const isMessagesArea = field.startsWith('messages.');
      const options: any = {
        purpose,
        suggested
      };

      // If selecting messages area, provide navigation to get to the right page
      if (isMessagesArea) {
        options.credentialDomain = credentialDomain;
        options.loginSelectors = selectors.login;
        options.navigationSteps = selectors.navigation;
        console.log('Visual selector will auto-login and navigate before selection', {
          hasCredentials: !!credentialDomain,
          hasLoginSelectors: !!selectors.login,
          navigationStepsCount: selectors.navigation?.length || 0,
          navigationSteps: selectors.navigation
        });
      }

      const result = await (window as any).wovly.webscraper.launchVisualSelector(pageUrl, options);

      if (result.selector) {
        updateSelector(field, result.selector);
      }
    } catch (err: any) {
      if (err.message !== 'User cancelled') {
        setError(err.message || 'Visual selector failed');
      }
    }
  };

  const handleRecordNavigation = async () => {
    try {
      if (!(window as any).wovly?.webscraper) {
        setError("Web scraper API not available. Please restart the application.");
        return;
      }

      // For navigation recording, start from the logged-in page
      // Use loginPageUrl if available, otherwise fall back to url
      const pageUrl = loginPageUrl || url;
      console.log('Navigation recorder using URL:', pageUrl);

      const result = await (window as any).wovly.webscraper.launchVisualSelector(pageUrl, {
        mode: 'navigation',
        credentialDomain,
        loginSelectors: selectors.login
      });

      if (result.steps) {
        setSelectors({
          ...selectors,
          navigation: result.steps
        });
      }
    } catch (err: any) {
      if (err.message !== 'User cancelled') {
        setError(err.message || 'Navigation recording failed');
      }
    }
  };

  const handleCombinedSetup = async () => {
    try {
      if (!(window as any).wovly?.webscraper) {
        setError("Web scraper API not available. Please restart the application.");
        return;
      }

      const pageUrl = loginPageUrl || url;
      console.log('Combined setup using URL:', pageUrl);

      const result = await (window as any).wovly.webscraper.launchVisualSelector(pageUrl, {
        mode: 'combined',
        credentialDomain,
        loginSelectors: selectors.login
      });

      if (result.navigationSteps || result.messageSelector) {
        setSelectors({
          ...selectors,
          navigation: result.navigationSteps || [],
          messages: {
            container: result.messageSelector || '',
            messageItem: '',
            sender: '',
            content: '',
            timestamp: ''
          }
        });
        console.log('Combined setup complete:', {
          navigationSteps: result.navigationSteps?.length || 0,
          messageSelector: result.messageSelector
        });
        // Move to test step after successful setup
        setStep(4);
      }
    } catch (err: any) {
      if (err.message !== 'User cancelled') {
        setError(err.message || 'Combined setup failed');
      }
    }
  };

  const getSelectorValue = (field: string): string => {
    const parts = field.split('.');
    let value: any = selectors;
    for (const part of parts) {
      value = value?.[part];
    }
    return value || '';
  };

  const updateSelector = (field: string, value: string) => {
    const parts = field.split('.');
    const updated = { ...selectors };
    let current: any = updated;

    for (let i = 0; i < parts.length - 1; i++) {
      current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;

    setSelectors(updated);
  };

  const handleTest = async () => {
    setLoading(true);
    setError(null);

    try {
      if (!(window as any).wovly?.webscraper) {
        setError("Web scraper API not available. Please restart the application.");
        setLoading(false);
        return;
      }
      const config: any = {
        name,
        url: loginPageUrl || url, // Use actual login page URL
        originalUrl: url, // Keep original for reference
        credentialDomain,
        selectors: recordedSession?.selectors || selectors
      };

      // Include 2FA metadata if detected during recording
      const twoFactorAuth = recordedSession?.selectors?.twoFactorAuth || recordedSession?.twoFactorAuth;
      if (twoFactorAuth) {
        config.twoFactorAuth = twoFactorAuth;
        console.log('[UI Test] ✓ Including 2FA config for test:', JSON.stringify(config.twoFactorAuth, null, 2));
      } else {
        console.log('[UI Test] ⚠ No 2FA config found for test');
      }

      const result = await (window as any).wovly.webscraper.testConfiguration(config);

      setTestResult(result);
      if (!result.success) {
        setError(result.error || 'Test failed');
      }
      // Stay on step 4 to show results and save button
    } catch (err: any) {
      setError(err.message || 'Test failed');
    } finally {
      setLoading(false);
    }
  };

  const loadAvailableCredentials = async () => {
    setLoadingCredentials(true);
    try {
      if (!(window as any).wovly?.credentials) {
        console.error("Credentials API not available");
        return;
      }

      const result = await (window as any).wovly.credentials.list();
      console.log('[AddWebIntegration] Loaded credentials:', result);

      if (result?.ok && result.credentials) {
        // Extract unique domains from credentials list
        const domains = result.credentials.map((cred: any) => cred.domain);
        setAvailableCredentials(domains || []);
      } else {
        console.error('[AddWebIntegration] Failed to load credentials:', result?.error);
        setAvailableCredentials([]);
      }
    } catch (err: any) {
      console.error("Failed to load credentials:", err);
      setAvailableCredentials([]);
    } finally {
      setLoadingCredentials(false);
    }
  };

  const handleStartRecording = async () => {
    setRecordingInProgress(true);
    setError(null);

    try {
      if (!(window as any).wovly?.webscraper) {
        setError("Web scraper API not available");
        setRecordingInProgress(false);
        return;
      }

      // Only send credential domain, not actual credentials
      const result = await (window as any).wovly.webscraper.startRecording({
        url,
        credentialDomain,
        siteName: name
      });

      if (result.success && result.session) {
        setRecordedSession(result.session);
        setRecordingComplete(true);

        // Update selectors from recording session
        if (result.session.selectors) {
          setSelectors(result.session.selectors);
          console.log('[UI] Updated selectors from recording:', result.session.selectors);
        }

        // Move to test step
        setStep(3);
      } else {
        setError(result.error || 'Recording failed');
      }
    } catch (err: any) {
      setError(err.message || 'Recording failed');
    } finally {
      setRecordingInProgress(false);
    }
  };

  const handleOAuthLogin = async () => {
    setOAuthLoginInProgress(true);
    setOAuthError(null);

    try {
      if (!(window as any).wovly?.webscraper) {
        setOAuthError("Web scraper API not available");
        setOAuthLoginInProgress(false);
        return;
      }

      const result = await (window as any).wovly.webscraper.launchOAuthLogin({
        url,
        siteName: name,
        oauth: aiSelectors?.oauth || {}
      });

      if (result.success) {
        setOAuthLoginComplete(true);
      } else {
        setOAuthError(result.error || 'Login failed');
      }
    } catch (err: any) {
      setOAuthError(err.message || 'Login failed');
    } finally {
      setOAuthLoginInProgress(false);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    setError(null);

    try {
      const config: any = {
        name,
        url: loginPageUrl || url, // Use actual login page URL
        originalUrl: url, // Keep original URL for reference
        siteType,
        authMethod, // 'form' or 'oauth'
        sessionManagement: {
          saveSession: true,
          sessionTimeout: authMethod === 'oauth' ? 604800000 : 3600000 // 7 days for OAuth, 1 hour for form
        },
        messageFormat: {
          platform: `custom-${name.toLowerCase().replace(/\s+/g, '-')}`,
          subject: name
        }
      };

      // Add form-based auth fields
      if (authMethod === 'form') {
        // Store only credential domain reference, not actual credentials
        config.credentialDomain = credentialDomain;

        // Use recorded session if available, otherwise fall back to selectors
        if (recordedSession) {
          console.log('[UI] recordedSession:', JSON.stringify(recordedSession, null, 2));
          config.recordedActions = recordedSession.actions;
          config.contentSelector = recordedSession.contentSelector;
          config.messageSelectors = recordedSession.messageSelectors;
          // Use converted selectors for scraper compatibility
          config.selectors = recordedSession.selectors || selectors;

          // Include 2FA metadata if detected during recording
          // Try both locations: session.twoFactorAuth and session.selectors.twoFactorAuth
          const twoFactorAuth = recordedSession.selectors?.twoFactorAuth || recordedSession.twoFactorAuth;
          if (twoFactorAuth) {
            config.twoFactorAuth = twoFactorAuth;
            console.log('[UI] ✓ Including 2FA config:', JSON.stringify(config.twoFactorAuth, null, 2));
          } else {
            console.log('[UI] ⚠ No 2FA config found in recordedSession');
            console.log('[UI]   recordedSession.selectors?.twoFactorAuth:', recordedSession.selectors?.twoFactorAuth);
            console.log('[UI]   recordedSession.twoFactorAuth:', recordedSession.twoFactorAuth);
          }
        } else {
          config.selectors = selectors;
        }
      }

      // Add OAuth-based auth fields
      if (authMethod === 'oauth') {
        config.oauth = {
          provider: aiSelectors?.oauth?.provider || 'generic',
          loginDetectionSelector: aiSelectors?.oauth?.loginDetectionSelector,
          successDetectionSelector: aiSelectors?.oauth?.successDetectionSelector,
          requiresManualLogin: true
        };
        // Still need navigation and messages selectors for OAuth sites
        config.selectors = {
          navigation: selectors.navigation,
          messages: selectors.messages
        };
      }

      await onSave(config);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save configuration');
    } finally {
      setLoading(false);
    }
  };

  const renderStep1 = () => (
    <div className="wizard-step">
      <h3>Website Information</h3>
      <p className="step-description">Enter the URL and basic information about the website you want to integrate.</p>

      <div className="form-group">
        <label>Integration Name *</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., Brightwheel Daycare"
        />
      </div>

      <div className="form-group">
        <label>Website URL *</label>
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/login"
        />
      </div>

      <div className="form-group">
        <label>Site Type (Optional)</label>
        <select value={siteType} onChange={(e) => setSiteType(e.target.value)}>
          <option value="">-- Select Type --</option>
          <option value="daycare">Daycare/School Portal</option>
          <option value="tax">Tax/Accounting</option>
          <option value="healthcare">Healthcare Portal</option>
          <option value="community">Community/HOA</option>
          <option value="other">Other</option>
        </select>
        <small>Helps AI understand the page structure</small>
      </div>

      <div className="form-group">
        <label>Login Method *</label>
        <div className="auth-method-selector">
          <label className="auth-method-option">
            <input
              type="radio"
              name="authMethod"
              value="form"
              checked={authMethod === 'form'}
              onChange={(e) => setAuthMethod(e.target.value as 'form' | 'oauth')}
            />
            <div className="auth-method-card">
              <div className="auth-method-icon">🔑</div>
              <div className="auth-method-title">Username & Password</div>
              <div className="auth-method-description">
                Traditional login form
              </div>
            </div>
          </label>

          <label className="auth-method-option">
            <input
              type="radio"
              name="authMethod"
              value="oauth"
              checked={authMethod === 'oauth'}
              onChange={(e) => setAuthMethod(e.target.value as 'form' | 'oauth')}
            />
            <div className="auth-method-card">
              <div className="auth-method-icon">🔐</div>
              <div className="auth-method-title">OAuth / SSO</div>
              <div className="auth-method-description">
                Sign in with Google, Microsoft, etc.
              </div>
            </div>
          </label>
        </div>
      </div>

      {authMethod === 'form' && (
        <>
          <div className="form-group">
            <label>Stored Credentials *</label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <select
                  value={credentialDomain}
                  onChange={(e) => setCredentialDomain(e.target.value)}
                  disabled={loadingCredentials}
                  style={{ width: '100%' }}
                >
                  <option value="">-- Select Stored Credential --</option>
                  {availableCredentials.map((domain) => (
                    <option key={domain} value={domain}>
                      {domain}
                    </option>
                  ))}
                </select>
                <small style={{ display: 'block', marginTop: '6px', color: '#666' }}>
                  🔒 Credentials are stored securely and never sent to LLM
                </small>
              </div>
              <button
                type="button"
                onClick={() => setShowCredentialManager(true)}
                className="btn btn-secondary"
                style={{ whiteSpace: 'nowrap', padding: '8px 16px' }}
              >
                Manage Credentials
              </button>
            </div>
          </div>

          {!credentialDomain && availableCredentials.length === 0 && (
            <div style={{
              padding: '12px',
              background: '#fff3cd',
              border: '1px solid #ffc107',
              borderRadius: '6px',
              fontSize: '14px',
              marginTop: '-8px'
            }}>
              <strong>📌 First time setup:</strong>
              <p style={{ margin: '6px 0 0 0' }}>
                Click "Manage Credentials" to securely store your login credentials.
                This keeps your username and password encrypted and separate from integration settings.
              </p>
            </div>
          )}
        </>
      )}

      {authMethod === 'oauth' && (
        <div className="oauth-info-box">
          <div className="oauth-info-icon">ℹ️</div>
          <div className="oauth-info-content">
            <strong>How OAuth login works:</strong>
            <ul>
              <li>A browser window will open with the website</li>
              <li>Log in using your Google/Microsoft account</li>
              <li>Complete any 2FA or security checks</li>
              <li>We'll save your session for future access</li>
            </ul>
            <p className="oauth-privacy-note">
              Your login credentials are never stored. We only save session cookies.
            </p>
          </div>
        </div>
      )}

      <div className="wizard-actions">
        <button onClick={onClose} className="btn btn-ghost">Cancel</button>
        <button
          onClick={authMethod === 'oauth' ? () => setStep(2) : handleAnalyze}
          disabled={!name || !url || (authMethod === 'form' && !credentialDomain) || loading}
          className="btn btn-primary"
        >
          {loading ? 'Analyzing...' : 'Next: Recording'}
        </button>
      </div>
    </div>
  );

  const renderStep2 = () => {
    // Recording flow (works for both form AND OAuth)
    if (authMethod === 'form' || !aiSelectors) {
      return (
        <div className="wizard-step">
          <h3>{authMethod === 'oauth' ? 'Record OAuth Login Flow' : 'Record Login Flow'}</h3>
          <p className="step-description">
            {authMethod === 'oauth'
              ? 'We\'ll open a browser window where you can log in using OAuth/SSO. Wovly will record your login steps and navigation to messages.'
              : 'We\'ll record your login process to understand the exact steps needed to access your messages.'
            }
          </p>

          <div className="form-group">
            <label>Select Stored Credentials (or add new ones)</label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
              <select
                value={credentialDomain}
                onChange={(e) => setCredentialDomain(e.target.value)}
                style={{ flex: 1 }}
                disabled={recordingInProgress}
              >
                <option value="">-- Select credential domain --</option>
                {availableCredentials.map(domain => (
                  <option key={domain} value={domain}>{domain}</option>
                ))}
              </select>
              <button
                onClick={() => setShowCredentialManager(true)}
                className="btn btn-secondary"
                disabled={recordingInProgress}
              >
                + Add Credentials
              </button>
            </div>
            <small style={{ color: '#666', display: 'block', marginTop: '4px' }}>
              {authMethod === 'oauth'
                ? 'Select credentials for the OAuth login page (if needed)'
                : 'Select or add credentials for this website'
              }
            </small>
          </div>

          {!recordingComplete ? (
            <>
              <div className="recording-instructions">
                <h4>📹 Recording Instructions:</h4>
                <ol>
                  <li>Click "Start Recording" below</li>
                  <li>A browser window will open with recording overlay</li>
                  <li>Log in to your account {authMethod === 'oauth' && '(using OAuth/SSO)'}</li>
                  <li>Navigate to your messages/inbox</li>
                  <li>Click "Stop Recording" when done</li>
                </ol>
              </div>

              <button
                className="btn btn-primary btn-large"
                onClick={handleStartRecording}
                disabled={recordingInProgress || !credentialDomain}
              >
                {recordingInProgress ? (
                  <>
                    <span className="spinner"></span>
                    Recording in progress...
                  </>
                ) : (
                  <>
                    📹 Start Recording
                  </>
                )}
              </button>
            </>
          ) : (
            <div className="recording-success">
              <div className="success-icon">✓</div>
              <div className="success-details">
                {recordedSession && (
                  <>
                    <div>📝 Recorded {recordedSession.actions?.length || 0} actions</div>
                    <div>
                      {recordedSession.messageSelectors?.container ? (
                        <>✨ AI detected message selectors automatically</>
                      ) : (
                        <>⚠️ AI couldn't detect messages - you may need to configure manually</>
                      )}
                    </div>

                    {recordedSession.selectors?.twoFactorAuth?.enabled && (
                      <div style={{ marginTop: '8px' }}>
                        {recordedSession.selectors.twoFactorAuth.method === 'email' && (
                          <div style={{ color: '#0066cc' }}>
                            🔐 Email-based 2FA detected
                            {recordedSession.selectors.twoFactorAuth.requiredIntegration === 'gmail' && (
                              <> (Gmail integration needed for automation)</>
                            )}
                          </div>
                        )}
                        {recordedSession.selectors.twoFactorAuth.method === 'sms' && (
                          <div style={{ color: '#0066cc' }}>
                            🔐 SMS-based 2FA detected
                            {recordedSession.selectors.twoFactorAuth.requiredIntegration === 'imessage' && (
                              <> (iMessage integration needed for automation)</>
                            )}
                          </div>
                        )}
                        {recordedSession.selectors.twoFactorAuth.method === 'authenticator' && (
                          <div style={{ color: '#ff9800' }}>
                            🔐 Authenticator app detected (manual re-login needed when session expires)
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
              <button className="btn btn-primary" onClick={() => setStep(3)}>
                Continue to Test
              </button>
            </div>
          )}
        </div>
      );
    }

    // Legacy OAuth flow with AI analysis (only if aiSelectors exist)
    if (authMethod === 'oauth' && aiSelectors) {
      return (
        <div className="wizard-step oauth-login-step">
          <h3>OAuth Login Setup</h3>

          {aiSelectors?.oauth?.provider && (
            <div className="detected-provider">
              <span className="provider-icon">
                {aiSelectors.oauth.provider === 'google' && '🔵'}
                {aiSelectors.oauth.provider === 'microsoft' && '🟦'}
                {aiSelectors.oauth.provider === 'facebook' && '🔷'}
                {!['google', 'microsoft', 'facebook'].includes(aiSelectors.oauth.provider) && '🔐'}
              </span>
              <span className="provider-name">
                Detected: Sign in with {aiSelectors.oauth.provider.charAt(0).toUpperCase() + aiSelectors.oauth.provider.slice(1)}
              </span>
            </div>
          )}

          <div className="oauth-instructions">
            <h4>How this works:</h4>
            <ol>
              <li>Click the button below to open a browser window</li>
              <li>Complete the login process (including any 2FA)</li>
              <li>Once logged in, click "I'm Logged In - Continue" in the browser</li>
              <li>Your session will be saved automatically</li>
            </ol>
          </div>

          {!oauthLoginComplete ? (
            <button
              className="btn btn-primary btn-large"
              onClick={handleOAuthLogin}
              disabled={oauthLoginInProgress}
            >
              {oauthLoginInProgress ? (
                <>
                  <span className="spinner"></span>
                  Waiting for login...
                </>
              ) : (
                <>
                  🔐 Open Browser & Log In
                </>
              )}
            </button>
          ) : (
            <div className="oauth-success">
              <div className="success-icon">✓</div>
              <div className="success-message">
                <strong>Login Successful!</strong>
                <p>Your session has been saved. You can now continue with setup.</p>
              </div>
            </div>
          )}

          {oauthError && (
            <div className="error-banner" style={{ marginTop: '16px' }}>
              <span className="error-icon">⚠️</span>
              <span>{oauthError}</span>
            </div>
          )}

          <div className="wizard-actions">
            <button className="btn btn-ghost" onClick={() => setStep(1)}>Back</button>
            <button
              className="btn btn-primary"
              onClick={() => setStep(3)}
              disabled={!oauthLoginComplete}
            >
              Next: Navigation
            </button>
          </div>
        </div>
      );
    }

    // Recording wizard for form-based auth
    return (
      <div className="wizard-step recording-wizard-step">
        <h3>🎬 Record Your Login Flow</h3>
        <p className="step-description">
          Just use the website naturally – we'll watch and learn!
        </p>

        <div style={{ marginBottom: '20px', padding: '15px', background: '#f0f7ff', borderRadius: '8px', fontSize: '14px' }}>
          <strong>🎯 How it works:</strong>
          <ol style={{ margin: '8px 0 0 20px', lineHeight: '1.6' }}>
            <li>Browser opens to <code style={{ background: 'rgba(0,0,0,0.05)', padding: '2px 6px', borderRadius: '3px' }}>{url}</code></li>
            <li><strong>Log in naturally</strong> – type your username and password as you normally would</li>
            <li><strong>Navigate to messages</strong> – click through menus/tabs to reach the page with your messages</li>
            <li><strong>Click "Done"</strong> – AI will automatically detect and extract message selectors</li>
          </ol>
        </div>

        <div style={{ marginBottom: '20px', padding: '12px', background: '#e8f5e9', border: '1px solid #4caf50', borderRadius: '6px', fontSize: '13px' }}>
          <strong>✨ AI-Powered Detection:</strong>
          <p style={{ margin: '6px 0 0 0' }}>
            Wovly uses AI vision to automatically identify message content on the page. Just navigate to your messages and click "Done" – no technical knowledge required!
          </p>
        </div>

        <div style={{ marginBottom: '20px', padding: '12px', background: '#fff3cd', border: '1px solid #ffc107', borderRadius: '6px', fontSize: '13px' }}>
          <strong>💡 Behind the scenes:</strong>
          <p style={{ margin: '6px 0 0 0' }}>
            • Credentials are detected automatically by watching what you type<br />
            • Message selectors are extracted using AI vision analysis<br />
            • Works with any website layout, even complex ones!
          </p>
        </div>

        <div style={{ marginBottom: '20px', padding: '12px', background: '#f0f7ff', border: '1px solid #667eea', borderRadius: '6px', fontSize: '13px' }}>
          <strong>🔒 Security Note:</strong>
          <p style={{ margin: '6px 0 0 0' }}>
            Your credentials are loaded from secure storage (<code>{credentialDomain}</code>) and never exposed to the frontend or LLM.
          </p>
        </div>

        {recordingComplete && (
          <div style={{ marginBottom: '20px', padding: '15px', background: '#e8f5e9', borderRadius: '8px' }}>
            <strong>✓ Recording Complete!</strong>
            <div style={{ marginTop: '8px', fontSize: '13px' }}>
              {recordedSession && (
                <>
                  <div>📝 Recorded {recordedSession.actions?.length || 0} actions</div>
                  <div>
                    {recordedSession.messageSelectors?.container ? (
                      <>✨ AI detected message selectors automatically</>
                    ) : (
                      <>⚠️ AI couldn't detect messages - you may need to configure manually</>
                    )}
                  </div>

                  {recordedSession.twoFactorAuth?.enabled && (
                    <div style={{ marginTop: '8px' }}>
                      {recordedSession.twoFactorAuth.method === 'email' && (
                        <div style={{ color: '#0066cc' }}>
                          🔐 Email-based 2FA detected
                          {recordedSession.twoFactorAuth.requiredIntegration === 'gmail' && (
                            <> (Gmail integration will enable automation)</>
                          )}
                        </div>
                      )}
                      {recordedSession.twoFactorAuth.method === 'sms' && (
                        <div style={{ color: '#0066cc' }}>
                          🔐 SMS-based 2FA detected
                          {recordedSession.twoFactorAuth.requiredIntegration === 'imessage' && (
                            <> (iMessage will enable automation)</>
                          )}
                        </div>
                      )}
                      {recordedSession.twoFactorAuth.method === 'authenticator' && (
                        <div style={{ color: '#ff9800' }}>
                          🔐 Authenticator app detected (manual authentication required)
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        <div className="wizard-actions">
          <button onClick={() => setStep(1)} className="btn btn-ghost">Back</button>
          <button
            onClick={handleStartRecording}
            className="btn btn-primary btn-large"
            disabled={recordingInProgress || recordingComplete}
          >
            {recordingInProgress ? (
              <>
                <span className="spinner"></span>
                Recording in progress...
              </>
            ) : recordingComplete ? (
              <>✓ Recording Complete</>
            ) : (
              <>🔴 Start Recording</>
            )}
          </button>
          {recordingComplete && (
            <button onClick={() => setStep(3)} className="btn btn-primary">
              Next: Test
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderStep3 = () => {
    // For OAuth, keep the old navigation setup
    if (authMethod === 'oauth') {
      return (
        <div className="wizard-step">
          <h3>Complete Setup</h3>
          <p className="step-description">
            Click through your site's navigation to reach messages, then select the messages area.
          </p>

          {aiConfidence === 'high' && (
            <div style={{ marginBottom: '15px', padding: '12px', background: '#f0f7ff', borderRadius: '6px', fontSize: '13px' }}>
              <strong>✓ Login selectors auto-configured</strong>
              <p style={{ margin: '4px 0 0 0' }}>
                High confidence detected. If login fails, use the Back button to review selectors.
              </p>
            </div>
          )}

          <div style={{ marginBottom: '20px', padding: '15px', background: '#f0f7ff', borderRadius: '8px', fontSize: '14px' }}>
            <strong>🎯 How it works:</strong>
            <ol style={{ margin: '8px 0 0 20px', lineHeight: '1.6' }}>
              <li>Browser will open and log you in automatically</li>
              <li><strong>Click through navigation</strong> (e.g., "Messaging" → "Conversation")</li>
              <li>Click "Done" when you reach the messages page</li>
              <li><strong>Click the messages area</strong> to select it</li>
              <li>Click "Finish" to complete setup</li>
            </ol>
          </div>

          {(selectors.navigation.length > 0 || selectors.messages.container) && (
            <div style={{ marginBottom: '20px', padding: '15px', background: '#e8f5e9', borderRadius: '8px' }}>
              <strong>✓ Setup Complete</strong>
              <div style={{ marginTop: '8px', fontSize: '13px' }}>
                {selectors.navigation.length > 0 && (
                  <div>📍 Navigation steps: {selectors.navigation.length}</div>
                )}
                {selectors.messages.container && (
                  <div>✉️ Messages area: Selected</div>
                )}
              </div>
            </div>
          )}

          <div className="wizard-actions">
            <button onClick={() => setStep(2)} className="btn btn-ghost">Back</button>
            <button
              onClick={handleCombinedSetup}
              className="btn btn-primary"
              disabled={loading}
            >
              {loading ? 'Opening...' : '🎯 Start Setup Wizard'}
            </button>
            {(selectors.navigation.length > 0 || selectors.messages.container) && (
              <button onClick={() => setStep(4)} className="btn btn-primary">
                Next: Test
              </button>
            )}
          </div>
        </div>
      );
    }

    // For form-based auth with recording, show test step
    return renderTestStep();
  };

  const renderTestStep = () => (
    <div className="wizard-step">
      <h3>Test Configuration</h3>
      <p className="step-description">Let's test if everything works correctly.</p>

      {testResult && (
        <div className={`test-result ${testResult.success ? 'success' : 'error'}`}>
          {testResult.success ? (
            <>
              <h4>✓ Test Successful!</h4>
              <p>Found {testResult.messageCount} messages</p>
              {testResult.sampleMessage && (
                <div className="sample-message">
                  <div><strong>From:</strong> {testResult.sampleMessage.from}</div>
                  <div><strong>Content:</strong> {testResult.sampleMessage.body.substring(0, 100)}...</div>
                </div>
              )}
            </>
          ) : (
            <>
              <h4>✗ Test Failed</h4>
              <p>{testResult.error}</p>
            </>
          )}
        </div>
      )}

      <div className="wizard-actions">
        <button onClick={() => setStep(2)} className="btn btn-ghost">Back</button>
        <button onClick={handleTest} disabled={loading} className="btn btn-secondary">
          {loading ? 'Testing...' : 'Run Test'}
        </button>
        <button
          onClick={handleSave}
          disabled={!testResult?.success}
          className="btn btn-primary"
        >
          Save & Enable
        </button>
      </div>
    </div>
  );

  const renderStep4 = () => renderTestStep();

  const renderSelectorField = (field: string, label: string) => {
    const value = getSelectorValue(field);

    return (
      <div className="selector-field">
        <label>{label}</label>
        <div className="selector-input-group">
          <input
            type="text"
            value={value}
            onChange={(e) => updateSelector(field, e.target.value)}
            placeholder="CSS selector"
            className="selector-input"
          />
          <button
            onClick={() => handleVisualSelect(field)}
            className="btn btn-icon"
            title="Visual selector"
          >
            🎯
          </button>
        </div>
      </div>
    );
  };

  return (
    <>
      {showCredentialManager && (
        <CredentialManagerModal
          onClose={() => {
            setShowCredentialManager(false);
            loadAvailableCredentials(); // Reload after closing
          }}
        />
      )}

      <div className="modal-overlay">
        <div className="modal web-integration-modal">
          <div className="modal-header">
            <h2>Add Custom Website Integration</h2>
            <button onClick={onClose} className="close-button">×</button>
          </div>

          <div className="modal-body">
          <div className="wizard-progress">
            {authMethod === 'form' ? (
              <>
                <div className={`progress-step ${step >= 1 ? 'active' : ''}`}>1. Info</div>
                <div className={`progress-step ${step >= 2 ? 'active' : ''}`}>2. Recording</div>
                <div className={`progress-step ${step >= 3 ? 'active' : ''}`}>3. Test</div>
              </>
            ) : (
              <>
                <div className={`progress-step ${step >= 1 ? 'active' : ''}`}>1. Info</div>
                <div className={`progress-step ${step >= 2 ? 'active' : ''}`}>2. Login</div>
                <div className={`progress-step ${step >= 3 ? 'active' : ''}`}>3. Setup</div>
                <div className={`progress-step ${step >= 4 ? 'active' : ''}`}>4. Test</div>
              </>
            )}
          </div>

          {error && (
            <div className="error-message">
              {error}
            </div>
          )}

          {step === 1 && renderStep1()}
          {step === 2 && renderStep2()}
          {step === 3 && renderStep3()}
          {step === 4 && renderStep4()}
        </div>
      </div>
    </div>
    </>
  );
}

// Simple Credential Manager Modal Component
interface CredentialManagerModalProps {
  onClose: () => void;
}

function CredentialManagerModal({ onClose }: CredentialManagerModalProps) {
  const [credentials, setCredentials] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);

  // Add form state
  const [newDomain, setNewDomain] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    loadCredentials();
  }, []);

  const loadCredentials = async () => {
    setLoading(true);
    try {
      const result = await (window as any).wovly.credentials.list();
      console.log('[CredentialManager] Loaded credentials:', result);

      if (result?.ok && result.credentials) {
        setCredentials(result.credentials);
      } else {
        console.error('[CredentialManager] Failed to load:', result?.error);
        setCredentials([]);
      }
    } catch (err: any) {
      console.error('Failed to load credentials:', err);
      setCredentials([]);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveCredential = async () => {
    if (!newDomain || !newUsername || !newPassword) {
      setSaveError('All fields are required');
      return;
    }

    setSaving(true);
    setSaveError(null);

    try {
      const result = await (window as any).wovly.credentials.save({
        domain: newDomain,
        displayName: newDomain, // Use domain as display name
        username: newUsername,
        password: newPassword,
        notes: ''
      });

      console.log('[CredentialManager] Save result:', result);

      if (!result?.ok) {
        throw new Error(result?.error || 'Failed to save credential');
      }

      // Reset form
      setNewDomain('');
      setNewUsername('');
      setNewPassword('');
      setShowAddForm(false);

      // Reload list
      await loadCredentials();
    } catch (err: any) {
      setSaveError(err.message || 'Failed to save credential');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteCredential = async (domain: string) => {
    if (!confirm(`Delete credentials for ${domain}?`)) return;

    try {
      await (window as any).wovly.credentials.delete(domain);
      await loadCredentials();
    } catch (err: any) {
      console.error('Failed to delete credential:', err);
    }
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 10001 }}>
      <div className="modal" style={{ maxWidth: '600px' }}>
        <div className="modal-header">
          <h2>🔒 Credential Manager</h2>
          <button onClick={onClose} className="close-button">×</button>
        </div>

        <div className="modal-body">
          <p style={{ marginBottom: '20px', fontSize: '14px', color: '#666' }}>
            Securely store website credentials. These are encrypted and stored locally, never sent to LLM.
          </p>

          {!showAddForm ? (
            <>
              {loading ? (
                <div>Loading...</div>
              ) : credentials.length === 0 ? (
                <div style={{
                  padding: '20px',
                  textAlign: 'center',
                  background: '#f5f5f5',
                  borderRadius: '8px',
                  marginBottom: '16px'
                }}>
                  <p>No credentials stored yet</p>
                </div>
              ) : (
                <div style={{ marginBottom: '16px' }}>
                  {credentials.map((cred) => (
                    <div
                      key={cred.domain}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '12px',
                        background: '#f9f9f9',
                        borderRadius: '6px',
                        marginBottom: '8px'
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '14px' }}>{cred.domain}</div>
                        <div style={{ fontSize: '13px', color: '#666' }}>
                          Username: {cred.username}
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteCredential(cred.domain)}
                        className="btn btn-ghost"
                        style={{ padding: '6px 12px', fontSize: '13px' }}
                      >
                        Delete
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={() => setShowAddForm(true)}
                className="btn btn-primary"
                style={{ width: '100%' }}
              >
                + Add New Credential
              </button>
            </>
          ) : (
            <div>
              <h3 style={{ fontSize: '16px', marginBottom: '16px' }}>Add New Credential</h3>

              <div className="form-group">
                <label>Domain *</label>
                <input
                  type="text"
                  value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value)}
                  placeholder="example.com"
                />
                <small>Use the domain of the website (e.g., mychart.com)</small>
              </div>

              <div className="form-group">
                <label>Username *</label>
                <input
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="your@email.com"
                />
              </div>

              <div className="form-group">
                <label>Password *</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••"
                />
              </div>

              {saveError && (
                <div style={{
                  padding: '10px',
                  background: '#fee',
                  border: '1px solid #fcc',
                  borderRadius: '4px',
                  marginBottom: '16px',
                  fontSize: '14px'
                }}>
                  {saveError}
                </div>
              )}

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => {
                    setShowAddForm(false);
                    setSaveError(null);
                  }}
                  className="btn btn-ghost"
                  style={{ flex: 1 }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveCredential}
                  disabled={saving}
                  className="btn btn-primary"
                  style={{ flex: 1 }}
                >
                  {saving ? 'Saving...' : 'Save Credential'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
