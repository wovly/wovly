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
}

export default function AddWebIntegrationModal({ onClose, onSave }: AddWebIntegrationModalProps) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form data
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [siteType, setSiteType] = useState('');
  const [credentialDomain, setCredentialDomain] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

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

  // Test results
  const [testResult, setTestResult] = useState<any>(null);

  const handleAnalyze = async () => {
    setLoading(true);
    setError(null);

    try {
      if (!(window as any).wovly?.webscraper) {
        setError("Web scraper API not available. Please restart the application.");
        setLoading(false);
        return;
      }
      const result = await (window as any).wovly.webscraper.analyzeUrl(url, siteType);

      if (result.success) {
        setAiSelectors(result.selectors);
        setAiConfidence(result.confidence);
        setSelectors(result.selectors); // Pre-fill with AI suggestions
        setLoginPageUrl(result.loginPageUrl || url); // Use actual login page URL
        console.log('Login page URL:', result.loginPageUrl);

        // Override authMethod if AI detected something different
        if (result.selectors?.authMethod) {
          console.log(`AI detected auth method: ${result.selectors.authMethod} (user selected: ${authMethod})`);
          if (result.selectors.authMethod !== authMethod) {
            console.log(`Overriding user selection with AI detection: ${result.selectors.authMethod}`);
            setAuthMethod(result.selectors.authMethod);
          }
        }

        // For OAuth, skip directly to step 2 (OAuth login)
        // For form-based, skip to step 3 if high confidence, otherwise step 2 for review
        if (result.selectors?.authMethod === 'oauth') {
          console.log('OAuth detected - going to OAuth login step');
          setStep(2);
        } else if (result.confidence === 'high') {
          console.log('High confidence - skipping to combined navigation+messages step');
          setStep(3);
        } else {
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

      // If selecting messages area, provide credentials and navigation to get to the right page
      if (isMessagesArea) {
        options.credentials = { username, password };
        options.loginSelectors = selectors.login;
        options.navigationSteps = selectors.navigation;
        console.log('Visual selector will auto-login and navigate before selection', {
          hasUsername: !!username,
          hasPassword: !!password,
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
        credentials: { username, password },
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
        credentials: { username, password },
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
      const config = {
        name,
        url: loginPageUrl || url, // Use actual login page URL
        originalUrl: url, // Keep original for reference
        credentialDomain,
        credentials: { username, password },
        selectors
      };

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
        config.credentialDomain = credentialDomain;
        config.credentials = { username, password };
        config.selectors = selectors;
      }

      // Add OAuth-based auth fields
      if (authMethod === 'oauth') {
        config.oauth = {
          oauthProvider: aiSelectors?.oauth?.oauthProvider || 'generic',
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
            <label>Username/Email *</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="your@email.com"
            />
          </div>

          <div className="form-group">
            <label>Password *</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>
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
          onClick={handleAnalyze}
          disabled={!name || !url || (authMethod === 'form' && (!username || !password)) || loading}
          className="btn btn-primary"
        >
          {loading ? 'Analyzing...' : 'Next: AI Analysis'}
        </button>
      </div>
    </div>
  );

  const renderStep2 = () => {
    // OAuth flow
    if (authMethod === 'oauth') {
      return (
        <div className="wizard-step oauth-login-step">
          <h3>OAuth Login Setup</h3>

          {aiSelectors?.oauth?.oauthProvider && (
            <div className="detected-provider">
              <span className="provider-icon">
                {aiSelectors.oauth.oauthProvider === 'google' && '🔵'}
                {aiSelectors.oauth.oauthProvider === 'microsoft' && '🟦'}
                {aiSelectors.oauth.oauthProvider === 'facebook' && '🔷'}
                {!['google', 'microsoft', 'facebook'].includes(aiSelectors.oauth.oauthProvider) && '🔐'}
              </span>
              <span className="provider-name">
                Detected: Sign in with {aiSelectors.oauth.oauthProvider.charAt(0).toUpperCase() + aiSelectors.oauth.oauthProvider.slice(1)}
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

    // Form-based auth flow
    return (
      <div className="wizard-step">
        <h3>Login Selectors {aiConfidence && <span className="confidence-badge">{aiConfidence} confidence</span>}</h3>
        <p className="step-description">Review and refine the login form selectors.</p>

        {renderSelectorField('login.usernameField', 'Username Field')}
        {renderSelectorField('login.passwordField', 'Password Field')}
        {renderSelectorField('login.submitButton', 'Submit Button')}
        {renderSelectorField('login.successIndicator', 'Success Indicator')}

        <div className="wizard-actions">
          <button onClick={() => setStep(1)} className="btn btn-ghost">Back</button>
          <button onClick={() => setStep(3)} className="btn btn-primary">Next: Navigation</button>
        </div>
      </div>
    );
  };

  const renderStep3 = () => (
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

  const renderStep4 = () => (
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
        <button onClick={() => setStep(3)} className="btn btn-ghost">Back</button>
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
    <div className="modal-overlay">
      <div className="modal web-integration-modal">
        <div className="modal-header">
          <h2>Add Custom Website Integration</h2>
          <button onClick={onClose} className="close-button">×</button>
        </div>

        <div className="modal-body">
          <div className="wizard-progress">
            <div className={`progress-step ${step >= 1 ? 'active' : ''}`}>1. Info</div>
            <div className={`progress-step ${step >= 2 ? 'active' : ''}`}>2. Login</div>
            <div className={`progress-step ${step >= 3 ? 'active' : ''}`}>3. Setup</div>
            <div className={`progress-step ${step >= 4 ? 'active' : ''}`}>4. Test</div>
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
  );
}
