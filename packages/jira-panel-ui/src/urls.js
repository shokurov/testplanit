// Locale-neutral TestPlanIt URLs — the app's middleware handles locale detection.
export const buildTestCaseUrl = (instanceUrl, testCaseId, projectId) =>
  projectId
    ? `${instanceUrl}/projects/repository/${projectId}/${testCaseId}`
    : `${instanceUrl}/test-cases/${testCaseId}`;

export const buildSessionUrl = (instanceUrl, sessionId, projectId) =>
  projectId
    ? `${instanceUrl}/projects/sessions/${projectId}/${sessionId}`
    : `${instanceUrl}/sessions/${sessionId}`;

export const buildTestRunUrl = (instanceUrl, testRunId, projectId, opts = {}) => {
  const base = projectId
    ? `${instanceUrl}/projects/runs/${projectId}/${testRunId}`
    : `${instanceUrl}/test-runs/${testRunId}`;
  return opts.selectedCaseId
    ? `${base}?selectedCase=${opts.selectedCaseId}&view=status`
    : base;
};
