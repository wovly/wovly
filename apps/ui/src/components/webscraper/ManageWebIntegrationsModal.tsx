import React, { useState, useEffect } from 'react';
import './WebIntegrationModal.css';

interface ManageWebIntegrationsModalProps {
  onClose: () => void;
  onEdit?: (siteId: string) => void;
  onDelete?: (siteId: string) => void;
  onUpdate?: () => Promise<void>;
}

interface Integration {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  authMethod?: 'oauth' | 'form' | 'none';
  oauth?: {
    provider?: string;
    loginDetectionSelector?: string;
    successDetectionSelector?: string;
  };
  twoFactorAuth?: {
    enabled: boolean;
    method: 'sms' | 'email' | 'authenticator' | 'unknown';
    target?: string;
    codeLength?: number;
    requiredIntegration?: 'gmail' | 'imessage' | null;
    selector?: string;
  };
  status: {
    lastSuccess?: string;
    lastError?: string;
    consecutiveFailures?: number;
    paused?: boolean;
    twoFactorMode?: 'automated' | 'manual';
  };
}

export default function ManageWebIntegrationsModal({ onClose, onEdit, onDelete }: ManageWebIntegrationsModalProps) {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    loadIntegrations();
  }, []);

  const loadIntegrations = async () => {
    setLoading(true);
    setError(null);

    try {
      if (!(window as any).wovly?.webscraper) {
        setError("Web scraper API not available");
        setLoading(false);
        return;
      }

      const result = await (window as any).wovly.webscraper.listIntegrations();

      if (result.success) {
        setIntegrations(result.integrations || []);
      } else {
        setError(result.error || 'Failed to load integrations');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load integrations');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleEnabled = async (siteId: string, currentlyEnabled: boolean) => {
    try {
      if (!(window as any).wovly?.webscraper) {
        setError("Web scraper API not available");
        return;
      }

      const result = await (window as any).wovly.webscraper.updateIntegration(siteId, {
        enabled: !currentlyEnabled
      });

      if (result.success) {
        await loadIntegrations();
      } else {
        setError(result.error || 'Failed to update integration');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to update integration');
    }
  };

  const handleUnpause = async (siteId: string) => {
    try {
      if (!(window as any).wovly?.webscraper) {
        setError("Web scraper API not available");
        return;
      }

      const result = await (window as any).wovly.webscraper.updateIntegration(siteId, {
        'status.paused': false,
        'status.consecutiveFailures': 0
      });

      if (result.success) {
        await loadIntegrations();
      } else {
        setError(result.error || 'Failed to unpause integration');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to unpause integration');
    }
  };

  const handleTestNow = async (siteId: string) => {
    try {
      if (!(window as any).wovly?.webscraper) {
        setError("Web scraper API not available");
        return;
      }

      setError(null);
      const result = await (window as any).wovly.webscraper.testIntegration(siteId);

      if (result.success) {
        alert(`Test successful! Found ${result.messageCount} messages.`);
        await loadIntegrations();
      } else {
        setError(result.error || 'Test failed');
      }
    } catch (err: any) {
      setError(err.message || 'Test failed');
    }
  };

  const handleDeleteConfirm = async (siteId: string) => {
    try {
      if (!(window as any).wovly?.webscraper) {
        setError("Web scraper API not available");
        return;
      }

      const result = await (window as any).wovly.webscraper.deleteIntegration(siteId);

      if (result.success) {
        setConfirmDelete(null);
        await loadIntegrations();
      } else {
        setError(result.error || 'Failed to delete integration');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to delete integration');
    }
  };

  const handleRelogin = async (siteId: string) => {
    try {
      const integration = integrations.find(i => i.id === siteId);
      if (!integration) return;

      setError(null);

      if (!(window as any).wovly?.webscraper) {
        setError("Web scraper API not available");
        return;
      }

      // Launch OAuth login flow
      const result = await (window as any).wovly.webscraper.launchOAuthLogin({
        url: integration.url,
        siteName: integration.name,
        oauth: integration.oauth,
        siteId: integration.id
      });

      if (result.success) {
        // Clear error status
        await (window as any).wovly.webscraper.updateIntegration(siteId, {
          'status.lastError': null,
          'status.consecutiveFailures': 0,
          'status.paused': false
        });

        await loadIntegrations();

        alert('Re-login successful! Integration is now active.');
      } else {
        setError(result.error || 'Re-login failed');
      }
    } catch (err: any) {
      setError(err.message || 'Re-login failed');
    }
  };

  const getStatusBadge = (integration: Integration) => {
    if (!integration.enabled) {
      return <span className="status-badge disabled">Disabled</span>;
    }
    if (integration.status?.paused) {
      return <span className="status-badge paused">Paused</span>;
    }
    if (integration.status?.lastError) {
      return <span className="status-badge error">Error</span>;
    }
    if (integration.status?.lastSuccess) {
      return <span className="status-badge active">Active</span>;
    }
    return <span className="status-badge pending">Not Checked</span>;
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Never';

    const date = new Date(dateString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;

    return date.toLocaleDateString();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content manage-integrations-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Manage Custom Website Integrations</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          {error && (
            <div className="error-banner">
              <span className="error-icon">⚠️</span>
              <span>{error}</span>
              <button onClick={() => setError(null)}>×</button>
            </div>
          )}

          {loading ? (
            <div className="loading-state">
              <div className="loading-spinner"></div>
              <p>Loading integrations...</p>
            </div>
          ) : integrations.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">🌐</div>
              <h3>No Custom Integrations</h3>
              <p>You haven't added any custom website integrations yet.</p>
              <button className="btn btn-primary" onClick={onClose}>
                Add Your First Integration
              </button>
            </div>
          ) : (
            <div className="integrations-list">
              {integrations.map(integration => (
                <div key={integration.id} className="integration-item">
                  <div className="integration-item-header">
                    <div className="integration-info">
                      <h3>{integration.name}</h3>
                      <a href={integration.url} target="_blank" rel="noopener noreferrer" className="integration-url">
                        {integration.url}
                      </a>
                    </div>
                    {getStatusBadge(integration)}
                  </div>

                  <div className="integration-item-details">
                    <div className="detail-row">
                      <span className="detail-label">Last Check:</span>
                      <span className="detail-value">
                        {formatDate(integration.status?.lastSuccess)}
                      </span>
                    </div>

                    {integration.status?.lastError && (
                      <div className="detail-row error">
                        <span className="detail-label">Last Error:</span>
                        <span className="detail-value">{integration.status.lastError}</span>
                      </div>
                    )}

                    {integration.status?.consecutiveFailures && integration.status.consecutiveFailures > 0 && (
                      <div className="detail-row warning">
                        <span className="detail-label">Consecutive Failures:</span>
                        <span className="detail-value">{integration.status.consecutiveFailures}</span>
                      </div>
                    )}

                    {integration.twoFactorAuth?.enabled && (
                      <div className="detail-row">
                        <span className="detail-label">2FA Mode:</span>
                        {integration.status?.twoFactorMode === 'automated' ? (
                          <span className="twofa-badge automated">
                            ✓ Automated ({integration.twoFactorAuth.method})
                          </span>
                        ) : (
                          <span className="twofa-badge manual">
                            👤 Manual ({integration.twoFactorAuth.method})
                          </span>
                        )}
                      </div>
                    )}

                    {integration.status?.twoFactorMode === 'manual' && integration.twoFactorAuth?.enabled && (
                      <div className="info-box" style={{ marginTop: '8px', fontSize: '13px' }}>
                        <strong>ℹ️ Manual 2FA:</strong>
                        {integration.twoFactorAuth.method === 'email' && (
                          <p>
                            Email-based 2FA detected. Connect Gmail for automatic code retrieval,
                            or complete 2FA manually when prompted.
                          </p>
                        )}
                        {integration.twoFactorAuth.method === 'sms' && (
                          <p>
                            SMS-based 2FA detected. Enable iMessage for automatic code retrieval,
                            or complete 2FA manually when prompted.
                          </p>
                        )}
                        {integration.twoFactorAuth.method === 'authenticator' && (
                          <p>
                            Authenticator app 2FA requires manual entry. You'll be notified in chat
                            when authentication is needed.
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="integration-item-actions">
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => handleToggleEnabled(integration.id, integration.enabled)}
                    >
                      {integration.enabled ? 'Disable' : 'Enable'}
                    </button>

                    {integration.status?.paused && (
                      <button
                        className="btn btn-sm btn-secondary"
                        onClick={() => handleUnpause(integration.id)}
                      >
                        Unpause
                      </button>
                    )}

                    {integration.authMethod === 'oauth' && integration.status?.lastError === 'oauth_session_expired' && (
                      <button
                        className="btn btn-sm btn-warning"
                        onClick={() => handleRelogin(integration.id)}
                      >
                        🔐 Re-login Required
                      </button>
                    )}

                    <button
                      className="btn btn-sm btn-secondary"
                      onClick={() => handleTestNow(integration.id)}
                      disabled={!integration.enabled || integration.status?.paused}
                    >
                      Test Now
                    </button>

                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => onEdit?.(integration.id)}
                    >
                      Edit
                    </button>

                    {confirmDelete === integration.id ? (
                      <div className="delete-confirm">
                        <span>Delete?</span>
                        <button
                          className="btn btn-sm btn-danger"
                          onClick={() => handleDeleteConfirm(integration.id)}
                        >
                          Confirm
                        </button>
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() => setConfirmDelete(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        className="btn btn-sm btn-ghost text-danger"
                        onClick={() => setConfirmDelete(integration.id)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
