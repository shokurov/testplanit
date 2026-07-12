import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke } from '@forge/bridge';
import {
  DynamicIcon,
  PanelSections,
  buildSessionUrl,
  buildTestCaseUrl,
  buildTestRunUrl,
  flattenFolders,
} from '@testplanit/jira-panel-ui';
import { createForgeBridge } from './forgeBridge';
import './app.css';

// Quantity presets — values map to the backend's generation guidance keys.
// Mirrors the in-app wizard's quantity choices (generateTestCases.addNotes.
// quantityOptions). Values map to the backend's getQuantityGuidance keys.
const QUANTITY_OPTIONS = [
  { value: 'just_one', label: 'Just one' },
  { value: 'couple', label: 'A couple (2)' },
  { value: 'few', label: 'A few (2-3)' },
  { value: 'several', label: 'Several (4-6)' },
  { value: 'many', label: 'Many (7-10)' },
  { value: 'all', label: 'Maximum' },
];

// Render a single generated field value for the preview. Steps-shaped arrays
// render as an ordered list; everything else renders as compact text.
const PreviewFieldValue = ({ name, value }) => {
  const isSteps =
    Array.isArray(value) &&
    value.length > 0 &&
    typeof value[0] === 'object' &&
    value[0] !== null &&
    ('step' in value[0] || 'expectedResult' in value[0]);

  if (isSteps) {
    return (
      <div className="mt-1">
        <div className="text-xs font-medium text-muted-foreground">{name}</div>
        <ol className="list-decimal ml-4 mt-1 space-y-1">
          {value.map((s, i) => (
            <li key={i} className="text-xs">
              <span>{s.step}</span>
              {s.expectedResult ? (
                <span className="text-muted-foreground">
                  {' '}
                  → {s.expectedResult}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
    );
  }

  const text = Array.isArray(value)
    ? value.join(', ')
    : typeof value === 'object' && value !== null
      ? JSON.stringify(value)
      : String(value ?? '');

  if (!text) return null;

  return (
    <div className="mt-1">
      <span className="text-xs font-medium text-muted-foreground">{name}: </span>
      <span className="text-xs">{text}</span>
    </div>
  );
};

// A single generated case in the preview list: checkbox + name + expandable
// field values.
const PreviewCaseRow = ({ testCase, checked, onToggle }) => {
  const [expanded, setExpanded] = useState(false);
  const fieldEntries = Object.entries(testCase.fieldValues || {});

  return (
    <div className="testplanit-card border rounded-md mb-1">
      <div className="flex items-center gap-2 p-2">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="h-4 w-4 shrink-0"
        />
        <button
          className="text-sm font-medium flex-1 truncate text-left"
          onClick={() => setExpanded(!expanded)}
          title={testCase.name}
        >
          {testCase.name}
        </button>
        <button
          className="text-muted-foreground hover:text-primary p-1 rounded"
          onClick={() => setExpanded(!expanded)}
        >
          <DynamicIcon
            name={expanded ? 'ChevronDown' : 'ChevronRight'}
            className="h-4 w-4"
          />
        </button>
      </div>
      {expanded && (
        <div className="border-t border-border bg-muted/30 p-2">
          {fieldEntries.length > 0 ? (
            fieldEntries.map(([name, value]) => (
              <PreviewFieldValue key={name} name={name} value={value} />
            ))
          ) : (
            <div className="text-xs text-muted-foreground">No field values</div>
          )}
          {testCase.tags && testCase.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {testCase.tags.map((tag, i) => (
                <span
                  key={i}
                  className="text-xs testplanit-muted-bg testplanit-text-muted px-2 py-0.5 rounded"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// Generate Test Cases flow — configure → generating → preview → done.
const GenerateTestCasesFlow = ({ onClose, onImported, initialContext }) => {
  // Seed from the context the panel already fetched for the eligibility gate,
  // so opening the flow doesn't re-hit the backend on mount.
  const initialTemplates = initialContext?.templates || [];
  const initialTemplate =
    initialTemplates.find((t) => t.isDefault) || initialTemplates[0];

  const [step, setStep] = useState('configure'); // configure | generating | preview | saving | done
  const [loadingContext, setLoadingContext] = useState(!initialContext);
  const [error, setError] = useState(null);

  const [projects, setProjects] = useState(initialContext?.projects || []);
  const [selectedProjectId, setSelectedProjectId] = useState(
    initialContext?.selectedProjectId ?? null
  );
  const [templates, setTemplates] = useState(initialTemplates);
  const [selectedTemplateId, setSelectedTemplateId] = useState(
    initialTemplate ? initialTemplate.id : null
  );
  const [readiness, setReadiness] = useState(initialContext?.readiness || null);
  const [folders, setFolders] = useState(initialContext?.folders || []);
  const [selectedFolderId, setSelectedFolderId] = useState(
    initialContext?.suggestedFolderId ?? null
  );
  const [issueKey, setIssueKey] = useState(initialContext?.issueKey || null);
  // 'new' = create a top-level folder named after the ticket; 'existing' = pick
  // one. Default to the suggested existing folder when the issue already has
  // linked cases, otherwise to creating a new ticket-named folder.
  const [folderMode, setFolderMode] = useState(
    initialContext?.suggestedFolderId ? 'existing' : 'new'
  );

  const [quantity, setQuantity] = useState('several');
  const [autoGenerateTags, setAutoGenerateTags] = useState(true);
  const [userNotes, setUserNotes] = useState('');

  const [generated, setGenerated] = useState([]);
  const [selectedCases, setSelectedCases] = useState(new Set());
  const [issueMeta, setIssueMeta] = useState(null);
  const [warnings, setWarnings] = useState([]);
  const [importResult, setImportResult] = useState(null);

  useEffect(() => {
    if (!initialContext) loadContext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadContext = async (projectId) => {
    setLoadingContext(true);
    setError(null);
    try {
      const res = await invoke(
        'getGenerationContext',
        projectId ? { projectId } : {}
      );
      if (res.error) {
        setError(res.error);
        return;
      }
      setProjects(res.projects || []);
      setSelectedProjectId(res.selectedProjectId ?? null);
      setTemplates(res.templates || []);
      setReadiness(res.readiness || null);
      setFolders(res.folders || []);
      setSelectedFolderId(res.suggestedFolderId ?? null);
      setIssueKey(res.issueKey || null);
      setFolderMode(res.suggestedFolderId ? 'existing' : 'new');
      const defaultTemplate =
        (res.templates || []).find((t) => t.isDefault) ||
        (res.templates || [])[0];
      setSelectedTemplateId(defaultTemplate ? defaultTemplate.id : null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingContext(false);
    }
  };

  const handleProjectChange = (id) => {
    const projectId = Number(id);
    setSelectedProjectId(projectId);
    loadContext(projectId);
  };

  const readinessIssue = !readiness
    ? null
    : !readiness.hasActiveLlm
      ? 'No AI provider is configured for this project. Connect one in TestPlanIt under Admin → Integrations → AI.'
      : !readiness.hasRepository
        ? 'This project has no test repository yet.'
        : !readiness.hasDefaultWorkflow
          ? 'This project has no default workflow state for test cases.'
          : null;

  const canGenerate =
    selectedProjectId &&
    selectedTemplateId &&
    readiness &&
    readiness.hasActiveLlm &&
    readiness.hasRepository &&
    readiness.hasDefaultWorkflow &&
    // Either create a new ticket-named folder, or pick an existing one.
    (folderMode === 'new' || !!selectedFolderId);

  const handleGenerate = async () => {
    setStep('generating');
    setError(null);
    setWarnings([]);
    setGenerated([]);
    setSelectedCases(new Set());
    try {
      // Forge resolvers die at 25s, so we stream generation directly from the
      // browser: mint a short-lived token via the resolver, then fetch the
      // streaming endpoint (a browser fetch isn't bound by the function limit).
      const tokenRes = await invoke('getGenerateToken', {
        projectId: selectedProjectId,
      });
      if (tokenRes.error) {
        setError(tokenRes.error);
        setStep('configure');
        return;
      }
      const { token, instanceUrl } = tokenRes;

      const response = await fetch(
        `${instanceUrl}/api/integrations/jira/generate-stream`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Forge-Token': token,
          },
          body: JSON.stringify({
            templateId: selectedTemplateId,
            quantity,
            autoGenerateTags,
            userNotes: userNotes.trim() || undefined,
            folderId: folderMode === 'existing' ? selectedFolderId : undefined,
          }),
        }
      );

      if (!response.ok || !response.body) {
        let message = `Generation failed (${response.status})`;
        try {
          const j = await response.json();
          if (j.error) message = j.error;
        } catch {
          // non-JSON error body — keep the status message
        }
        setError(message);
        setStep('configure');
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const collected = [];
      let streamError = null;
      let doneIssue = null;
      let finished = false;

      while (!finished) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';
        for (const part of parts) {
          const dataLine = part.split('\n').find((l) => l.startsWith('data:'));
          if (!dataLine) continue;
          let evt;
          try {
            evt = JSON.parse(dataLine.slice(5).trim());
          } catch {
            continue;
          }
          if (evt.type === 'case' && evt.testCase) {
            collected.push(evt.testCase);
            setGenerated((prev) => [...prev, evt.testCase]);
            setSelectedCases((prev) => {
              const next = new Set(prev);
              next.add(evt.testCase.id);
              return next;
            });
          } else if (evt.type === 'error') {
            streamError = evt.message || 'Generation failed';
          } else if (evt.type === 'done') {
            doneIssue = evt.issue || null;
            finished = true;
          }
        }
      }

      if (streamError) {
        setError(streamError);
        setStep('configure');
        return;
      }
      if (collected.length === 0) {
        setError('No test cases were generated.');
        setStep('configure');
        return;
      }
      setIssueMeta(doneIssue);
      setStep('preview');
    } catch (err) {
      setError(err.message);
      setStep('configure');
    }
  };

  const toggleCase = (id) => {
    setSelectedCases((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    const toImport = generated.filter((tc) => selectedCases.has(tc.id));
    if (toImport.length === 0) return;
    setStep('saving');
    setError(null);
    try {
      const res = await invoke('importTestCases', {
        projectId: selectedProjectId,
        templateId: selectedTemplateId,
        issueTitle: issueMeta?.title,
        autoGenerateTags,
        testCases: toImport,
        folderId: folderMode === 'existing' ? selectedFolderId : undefined,
        newFolderName:
          folderMode === 'new' ? issueKey || 'Generated from Jira' : undefined,
      });
      if (res.error) {
        setError(res.error);
        setStep('preview');
        return;
      }
      if (res.status === 'error') {
        setError(res.message || 'Import failed');
        setStep('preview');
        return;
      }
      setImportResult(res);
      setStep('done');
    } catch (err) {
      setError(err.message);
      setStep('preview');
    }
  };

  const selectedCount = selectedCases.size;

  return (
    <div className="p-4 testplanit-bg">
      <div className="flex items-center gap-2 mb-3">
        <button
          className="text-muted-foreground hover:text-primary p-1 rounded"
          onClick={onClose}
          title="Back"
        >
          <DynamicIcon name="ArrowLeft" className="h-4 w-4" />
        </button>
        <DynamicIcon name="Sparkles" className="h-5 w-5 text-primary" />
        <h3 className="text-sm font-semibold">Generate Test Cases</h3>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded p-3 mb-3 text-xs">
          <div className="flex items-start gap-2">
            <DynamicIcon
              name="AlertCircle"
              className="h-4 w-4 text-red-600 mt-0.5 shrink-0"
            />
            <p className="text-red-800">{error}</p>
          </div>
        </div>
      )}

      {/* CONFIGURE */}
      {step === 'configure' &&
        (loadingContext ? (
          <div className="flex items-center gap-3 py-4">
            <div className="animate-spin rounded-full h-5 w-5 border-b-4 border-primary shrink-0"></div>
            <span className="text-sm text-muted-foreground">Loading…</span>
          </div>
        ) : projects.length === 0 ? (
          <div className="text-xs text-muted-foreground py-4">
            No TestPlanIt projects are connected to this Jira integration, or you
            don't have access to them.
          </div>
        ) : (
          <div>
            {projects.length > 1 && (
              <div className="mb-3">
                <label className="block text-xs font-medium mb-2">Project</label>
                <select
                  value={selectedProjectId ?? ''}
                  onChange={(e) => handleProjectChange(e.target.value)}
                  className="w-full px-3 py-2 border border-border rounded text-xs bg-background text-foreground"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="mb-3">
              <label className="block text-xs font-medium mb-2">Template</label>
              <select
                value={selectedTemplateId ?? ''}
                onChange={(e) => setSelectedTemplateId(Number(e.target.value))}
                disabled={templates.length === 0}
                className="w-full px-3 py-2 border border-border rounded text-xs bg-background text-foreground disabled:opacity-50"
              >
                {templates.length === 0 && <option value="">No templates</option>}
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-3">
              <label className="block text-xs font-medium mb-2">
                Destination folder
              </label>
              <div className="space-y-2 mb-2">
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="radio"
                    name="folderMode"
                    checked={folderMode === 'new'}
                    onChange={() => setFolderMode('new')}
                    className="h-3.5 w-3.5"
                  />
                  <span>
                    Create new folder{issueKey ? ` “${issueKey}”` : ''}
                  </span>
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="radio"
                    name="folderMode"
                    checked={folderMode === 'existing'}
                    onChange={() => setFolderMode('existing')}
                    disabled={folders.length === 0}
                    className="h-3.5 w-3.5"
                  />
                  <span
                    className={
                      folders.length === 0 ? 'text-muted-foreground' : ''
                    }
                  >
                    Use an existing folder
                    {folders.length === 0 ? ' (none yet)' : ''}
                  </span>
                </label>
              </div>
              {folderMode === 'existing' && folders.length > 0 && (
                <select
                  value={selectedFolderId ?? ''}
                  onChange={(e) =>
                    setSelectedFolderId(
                      e.target.value ? Number(e.target.value) : null
                    )
                  }
                  className="w-full px-3 py-2 border border-border rounded text-xs bg-background text-foreground"
                >
                <option value="">Select a folder…</option>
                {flattenFolders(folders).map((f) => (
                  <option key={f.id} value={f.id}>
                    {'   '.repeat(f.depth)}
                    {f.name}
                  </option>
                ))}
                </select>
              )}
            </div>

            <div className="mb-3">
              <label className="block text-xs font-medium mb-2">
                How many cases?
              </label>
              <select
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded text-xs bg-background text-foreground"
              >
                {QUANTITY_OPTIONS.map((q) => (
                  <option key={q.value} value={q.value}>
                    {q.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="mb-3">
              <label className="block text-xs font-medium mb-2">
                Additional guidance (optional)
              </label>
              <textarea
                value={userNotes}
                onChange={(e) => setUserNotes(e.target.value)}
                rows={3}
                placeholder="e.g. focus on edge cases and error handling"
                className="w-full px-3 py-2 border border-border rounded text-xs bg-background text-foreground"
              />
            </div>

            <label className="flex items-center gap-2 mb-3 text-xs">
              <input
                type="checkbox"
                checked={autoGenerateTags}
                onChange={(e) => setAutoGenerateTags(e.target.checked)}
                className="h-4 w-4"
              />
              <span>Auto-generate tags</span>
            </label>

            {readinessIssue && (
              <div className="bg-yellow-50 border border-yellow-200 rounded p-3 mb-3 text-xs">
                <div className="flex items-start gap-2">
                  <DynamicIcon
                    name="AlertTriangle"
                    className="h-4 w-4 text-yellow-600 mt-0.5 shrink-0"
                  />
                  <p className="text-yellow-800">{readinessIssue}</p>
                </div>
              </div>
            )}

            <button
              onClick={handleGenerate}
              disabled={!canGenerate}
              className="flex items-center justify-center gap-1 w-full px-3 py-2 bg-brand text-white rounded text-xs font-medium hover:bg-brand-hover active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-150"
            >
              <DynamicIcon name="Sparkles" className="h-3 w-3" />
              <span>Generate</span>
            </button>
          </div>
        ))}

      {/* GENERATING (cases stream in live) */}
      {step === 'generating' && (
        <div className="py-2">
          <div className="flex items-center gap-3 mb-3">
            <div className="animate-spin rounded-full h-5 w-5 border-b-4 border-primary shrink-0"></div>
            <span className="text-sm text-muted-foreground">
              Generating test cases
              {generated.length > 0 ? ` (${generated.length} so far)` : ''}…
            </span>
          </div>
          {generated.map((tc) => (
            <div
              key={tc.id}
              className="testplanit-card border rounded-md mb-1 p-2 text-sm font-medium truncate"
              title={tc.name}
            >
              {tc.name}
            </div>
          ))}
        </div>
      )}

      {/* PREVIEW */}
      {step === 'preview' && (
        <div>
          {warnings.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded p-2 mb-3 text-xs text-yellow-800">
              {warnings.length} warning(s) during generation.
            </div>
          )}
          <p className="text-xs text-muted-foreground mb-2">
            Review and select the cases to save.
          </p>
          <div className="mb-3">
            {generated.map((tc) => (
              <PreviewCaseRow
                key={tc.id}
                testCase={tc}
                checked={selectedCases.has(tc.id)}
                onToggle={() => toggleCase(tc.id)}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setStep('configure')}
              className="flex items-center gap-1 px-3 py-2 border border-testplanit-border rounded text-xs font-medium hover:bg-violet-50 hover:text-violet-700 hover:border-violet-300 dark:hover:bg-violet-900 dark:hover:text-violet-100 dark:hover:border-violet-700 active:scale-95 transition-all duration-150"
            >
              <DynamicIcon name="ChevronLeft" className="h-3 w-3" />
              <span>Back</span>
            </button>
            <button
              onClick={handleSave}
              disabled={selectedCount === 0}
              className="flex items-center justify-center gap-1 flex-1 px-3 py-2 bg-brand text-white rounded text-xs font-medium hover:bg-brand-hover active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-150"
            >
              <DynamicIcon name="Save" className="h-3 w-3" />
              <span>
                Save {selectedCount} case{selectedCount === 1 ? '' : 's'}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* SAVING */}
      {step === 'saving' && (
        <div className="flex items-center gap-3 py-6">
          <div className="animate-spin rounded-full h-5 w-5 border-b-4 border-primary shrink-0"></div>
          <span className="text-sm text-muted-foreground">Saving…</span>
        </div>
      )}

      {/* DONE */}
      {step === 'done' && importResult && (
        <div>
          <div className="bg-green-50 border border-green-200 rounded p-3 mb-3 text-xs">
            <div className="flex items-start gap-2">
              <DynamicIcon
                name="CheckCircle"
                className="h-4 w-4 text-green-600 mt-0.5 shrink-0"
              />
              <p className="text-green-800">
                Imported {importResult.importedCount} test case
                {importResult.importedCount === 1 ? '' : 's'} and linked them to
                this issue.
              </p>
            </div>
          </div>
          {importResult.errors && importResult.errors.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded p-2 mb-3 text-xs text-yellow-800">
              {importResult.errors.map((e, i) => (
                <p key={i}>{e}</p>
              ))}
            </div>
          )}
          <button
            onClick={() => onImported()}
            className="w-full px-3 py-2 bg-brand text-white rounded text-xs font-medium hover:bg-brand-hover active:scale-95 transition-all duration-150"
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
};

// Main app component
const App = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [testData, setTestData] = useState(null);
  const [instanceUrl, setInstanceUrl] = useState(null);
  const [showGenerate, setShowGenerate] = useState(false);
  // Eligibility gate for the Generate button (app parity): the button only
  // shows when the mapped user can actually generate into a ready project.
  const [generationContext, setGenerationContext] = useState(null);
  const [canGenerate, setCanGenerate] = useState(false);

  const bridge = React.useMemo(() => createForgeBridge(), []);

  const handleImported = () => {
    setShowGenerate(false);
    setLoading(true);
    loadTestInfo();
  };

  const loadGenerationEligibility = async () => {
    try {
      const ctx = await invoke('getGenerationContext');
      if (ctx.error) {
        setCanGenerate(false);
        return;
      }
      setGenerationContext(ctx);
      const ready =
        ctx.readiness &&
        ctx.readiness.hasActiveLlm &&
        ctx.readiness.hasRepository &&
        ctx.readiness.hasDefaultWorkflow;
      setCanGenerate(Boolean(ctx.selectedProjectId) && Boolean(ready));
    } catch {
      setCanGenerate(false);
    }
  };

  useEffect(() => {
    loadTestInfo();
    loadGenerationEligibility();
  }, []);

  const loadTestInfo = async () => {
    try {
      const response = await bridge.getTestInfo();
      console.log('Response from resolver:', response);

      if (response.error) {
        setError(response.error);
        if (response.notConfigured) {
          // Show configuration message
          setTestData({ notConfigured: true });
        }
      } else {
        setTestData(response);
        setInstanceUrl(response.instanceUrl);
      }
    } catch (err) {
      console.error('Error loading test info:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const openTestCaseUrl = (testCaseId, projectId) => {
    if (!instanceUrl) return;
    bridge.openUrl(buildTestCaseUrl(instanceUrl, testCaseId, projectId));
  };

  const openSessionUrl = (sessionId, projectId) => {
    if (!instanceUrl) return;
    bridge.openUrl(buildSessionUrl(instanceUrl, sessionId, projectId));
  };

  const openTestRunUrl = (testRunId, projectId, opts) => {
    if (!instanceUrl) return;
    bridge.openUrl(buildTestRunUrl(instanceUrl, testRunId, projectId, opts));
  };

  const openTestPlanIt = () => {
    bridge.openUrl(instanceUrl || 'https://testplanit.com');
  };

  // Configuration UI Component (shown when not configured)
  const ConfigurationUI = () => {
    const [configUrl, setConfigUrl] = useState('');
    const [configApiKey, setConfigApiKey] = useState('');
    const [configSaving, setConfigSaving] = useState(false);
    const [configError, setConfigError] = useState(null);
    const [configTesting, setConfigTesting] = useState(false);
    const [testResult, setTestResult] = useState(null);
    const [currentUrl, setCurrentUrl] = useState(null);
    const [configLoading, setConfigLoading] = useState(true);

    // Load current settings on mount
    useEffect(() => {
      loadCurrentSettings();
    }, []);

    const loadCurrentSettings = async () => {
      try {
        const response = await invoke('getSettings');
        console.log('Current settings:', response);
        if (response.instanceUrl) {
          setCurrentUrl(response.instanceUrl);
          setConfigUrl(response.instanceUrl);
        }
        if (response.apiKey) {
          setConfigApiKey(response.apiKey);
        }
      } catch (err) {
        console.error('Error loading current settings:', err);
      } finally {
        setConfigLoading(false);
      }
    };

    const handleClearSettings = async () => {
      try {
        await invoke('clearSettings');
        setCurrentUrl(null);
        setConfigUrl('');
        setConfigApiKey('');
        setTestResult(null);
        setConfigError(null);
      } catch (err) {
        setConfigError(err.message);
      }
    };

    const handleTestConnection = async () => {
      if (!configUrl) {
        setConfigError('Please enter a URL');
        return;
      }
      if (!configApiKey) {
        setConfigError('Please enter an API key');
        return;
      }

      setConfigTesting(true);
      setConfigError(null);
      setTestResult(null);

      try {
        const response = await invoke('testConnection', { instanceUrl: configUrl, apiKey: configApiKey });
        setTestResult(response);
      } catch (err) {
        setTestResult({ success: false, message: err.message });
      } finally {
        setConfigTesting(false);
      }
    };

    const handleSave = async () => {
      if (!configUrl) {
        setConfigError('Please enter a URL');
        return;
      }
      if (!configApiKey) {
        setConfigError('Please enter an API key');
        return;
      }

      setConfigSaving(true);
      setConfigError(null);

      try {
        const response = await invoke('saveSettings', { instanceUrl: configUrl, apiKey: configApiKey.trim() });
        if (response.success) {
          // Reload test info after successful save
          setLoading(true);
          await loadTestInfo();
        } else {
          setConfigError(response.error || 'Failed to save configuration');
        }
      } catch (err) {
        setConfigError(err.message);
      } finally {
        setConfigSaving(false);
      }
    };

    return (
      <div className="p-4 testplanit-bg">
        <div className="bg-card rounded-lg border border-border p-4">
          <div className="flex items-center gap-2 mb-3">
            <DynamicIcon name="Settings" className="h-5 w-5 text-primary" />
            <h3 className="text-sm font-semibold">Configure TestPlanIt</h3>
          </div>

          {error && (
            <div className="bg-yellow-50 border border-yellow-200 rounded p-3 mb-4 text-xs">
              <div className="flex items-start gap-2">
                <DynamicIcon name="AlertTriangle" className="h-4 w-4 text-yellow-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-yellow-800 font-medium">Connection Error</p>
                  <p className="text-yellow-700 mt-1">{error}</p>
                </div>
              </div>
            </div>
          )}

          {currentUrl && (
            <div className="bg-blue-50 border border-blue-200 rounded p-3 mb-4 text-xs">
              <div className="flex items-start gap-2">
                <DynamicIcon name="Info" className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="text-blue-800 font-medium">Currently configured URL:</p>
                  <p className="text-blue-700 mt-1 font-mono break-all">{currentUrl}</p>
                  <button
                    onClick={handleClearSettings}
                    className="text-blue-600 hover:text-blue-800 underline mt-2"
                  >
                    Clear and reconfigure
                  </button>
                </div>
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground mb-4">
            {currentUrl ? 'Update your TestPlanIt instance URL below:' : 'Enter your TestPlanIt instance URL to connect this Jira panel.'}
          </p>

          <div className="mb-3">
            <label className="block text-xs font-medium mb-2">TestPlanIt Instance URL</label>
            <input
              type="text"
              value={configUrl}
              onChange={(e) => {
                setConfigUrl(e.target.value);
                setConfigError(null);
                setTestResult(null);
              }}
              placeholder="https://demo.testplanit.com"
              disabled={configLoading}
              className="w-full px-3 py-2 border border-border rounded text-xs focus:outline-hidden focus:ring-2 focus:ring-primary bg-background text-foreground disabled:opacity-50"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Must be a *.testplanit.com subdomain
            </p>
          </div>

          <div className="mb-3">
            <label className="block text-xs font-medium mb-2">Forge API Key</label>
            <input
              type="password"
              value={configApiKey}
              onChange={(e) => {
                setConfigApiKey(e.target.value);
                setConfigError(null);
                setTestResult(null);
              }}
              placeholder="Enter your Forge integration API key"
              disabled={configLoading}
              className="w-full px-3 py-2 border border-border rounded text-xs focus:outline-hidden focus:ring-2 focus:ring-primary bg-background text-foreground disabled:opacity-50"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Generate in TestPlanIt: Admin &gt; Integrations &gt; Jira &gt; Forge API Key
            </p>
          </div>

          <div className="flex gap-2 mb-3">
            <button
              onClick={handleTestConnection}
              disabled={configTesting || !configUrl || !configApiKey}
              className="flex items-center gap-1 px-3 py-2 border border-border rounded text-xs font-medium hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {configTesting ? (
                <>
                  <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-current"></div>
                  <span>Testing...</span>
                </>
              ) : (
                <>
                  <DynamicIcon name="TestTube" className="h-3 w-3" />
                  <span>Test Connection</span>
                </>
              )}
            </button>

            <button
              onClick={handleSave}
              disabled={configSaving || !configUrl || !configApiKey}
              className="flex items-center gap-1 px-3 py-2 bg-primary text-primary-foreground rounded text-xs font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {configSaving ? (
                <>
                  <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-current"></div>
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <DynamicIcon name="Save" className="h-3 w-3" />
                  <span>Save & Connect</span>
                </>
              )}
            </button>
          </div>

          {testResult && (
            <div className={`rounded p-3 mb-3 text-xs ${testResult.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
              <div className="flex items-start gap-2">
                <DynamicIcon name={testResult.success ? 'CheckCircle' : 'XCircle'} className={`h-4 w-4 mt-0.5 ${testResult.success ? 'text-green-600' : 'text-red-600'}`} />
                <p className={testResult.success ? 'text-green-800' : 'text-red-800'}>{testResult.message}</p>
              </div>
            </div>
          )}

          {configError && (
            <div className="bg-red-50 border border-red-200 rounded p-3 text-xs">
              <div className="flex items-start gap-2">
                <DynamicIcon name="AlertCircle" className="h-4 w-4 text-red-600 mt-0.5" />
                <p className="text-red-800">{configError}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="p-4 testplanit-bg">
        <div className="flex items-center gap-3 mb-4">
          <div className="animate-spin rounded-full h-5 w-5 border-b-4 border-primary shrink-0 text-primary-900"></div>
          <span className="text-sm text-muted-foreground">Loading test information...</span>
        </div>
      </div>
    );
  }

  if (error || testData?.notConfigured) {
    // Always show configuration UI when there's an error or not configured
    // This is more user-friendly than showing a generic error message
    return <ConfigurationUI />;
  }

  if (showGenerate) {
    return (
      <GenerateTestCasesFlow
        onClose={() => setShowGenerate(false)}
        onImported={handleImported}
        initialContext={generationContext}
      />
    );
  }

  const generateButton = (small) =>
    canGenerate ? (
      <button
        className={
          small
            ? 'flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium bg-brand text-white hover:bg-brand-hover active:scale-95 transition-all duration-150'
            : 'flex items-center justify-center gap-1 bg-brand text-white px-4 py-2 rounded-lg text-sm font-medium shadow-sm hover:bg-brand-hover hover:shadow-md active:scale-95 transition-all duration-150'
        }
        onClick={() => setShowGenerate(true)}
      >
        <DynamicIcon name="Sparkles" className={small ? 'h-3 w-3' : 'h-4 w-4'} />
        Generate Test Cases
      </button>
    ) : null;

  return (
    <PanelSections
      testData={testData}
      onOpenTestCase={openTestCaseUrl}
      onOpenSession={openSessionUrl}
      onOpenTestRun={openTestRunUrl}
      onOpenHome={openTestPlanIt}
      actions={generateButton(true)}
      emptyActions={generateButton(false)}
    />
  );
};

// Initialize the app
const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}