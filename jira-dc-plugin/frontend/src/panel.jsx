import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  DynamicIcon,
  PanelSections,
  buildSessionUrl,
  buildTestCaseUrl,
  buildTestRunUrl,
} from '@testplanit/jira-panel-ui';
import { createDcBridge } from './dcBridge';
import './panel.css';

// Shown to everyone when the plugin has no instance URL/API key yet. Only a
// Jira admin can fix it, so this is a pointer, not a form (unlike Forge,
// which exposed an in-panel config UI — an admin-page-only flow is stricter).
const NotConfiguredHint = () => (
  <div className="p-4 testplanit-bg">
    <div className="bg-card rounded-lg border border-border p-4">
      <div className="flex items-center gap-2 mb-2">
        <DynamicIcon name="Settings" className="h-5 w-5 text-primary" />
        <h3 className="text-sm font-semibold">TestPlanIt is not configured</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        A Jira administrator can connect TestPlanIt under
        {' '}<strong>Administration &gt; Manage apps &gt; TestPlanIt Settings</strong>:
        set the instance URL and paste an API key generated in TestPlanIt
        (Admin &gt; Integrations &gt; Jira).
      </p>
    </div>
  </div>
);

const ErrorState = ({ message, onRetry }) => (
  <div className="p-4 testplanit-bg">
    <div className="bg-card rounded-lg border border-border p-4">
      <div className="flex items-start gap-2 mb-3">
        <DynamicIcon name="AlertTriangle" className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-medium">Could not load TestPlanIt data</p>
          <p className="text-xs text-muted-foreground mt-1">{message}</p>
        </div>
      </div>
      <button
        className="px-3 py-1.5 border border-border rounded text-xs font-medium hover:bg-muted transition-colors"
        onClick={onRetry}
      >
        Retry
      </button>
    </div>
  </div>
);

const DcApp = ({ bridge }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [testData, setTestData] = useState(null);
  const [instanceUrl, setInstanceUrl] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const response = await bridge.getTestInfo();
    if (response.notConfigured) {
      setNotConfigured(true);
    } else if (response.error) {
      setError(response.error);
    } else {
      setTestData(response);
      setInstanceUrl(response.instanceUrl);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) {
    return (
      <div className="p-4 testplanit-bg">
        <div className="flex items-center gap-3">
          <div className="animate-spin rounded-full h-5 w-5 border-b-4 border-primary shrink-0"></div>
          <span className="text-sm text-muted-foreground">Loading test information...</span>
        </div>
      </div>
    );
  }
  if (notConfigured) return <NotConfiguredHint />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  return (
    <PanelSections
      testData={testData}
      onOpenTestCase={(id, projectId) => instanceUrl && bridge.openUrl(buildTestCaseUrl(instanceUrl, id, projectId))}
      onOpenSession={(id, projectId) => instanceUrl && bridge.openUrl(buildSessionUrl(instanceUrl, id, projectId))}
      onOpenTestRun={(id, projectId, opts) => instanceUrl && bridge.openUrl(buildTestRunUrl(instanceUrl, id, projectId, opts))}
      onOpenHome={() => bridge.openUrl(instanceUrl || 'https://testplanit.com')}
    />
  );
};

const container = document.getElementById('testplanit-panel');
if (container) {
  const bridge = createDcBridge(container);
  createRoot(container).render(<DcApp bridge={bridge} />);
}
