// DC implementation of the panel bridge contract (see
// @testplanit/jira-panel-ui bridge.jsx). Talks to this plugin's own REST
// module; Jira handles the user session cookie.
const contextPath = () =>
  (window.AJS && typeof window.AJS.contextPath === 'function' && window.AJS.contextPath()) ||
  window.contextPath ||
  '';

export const createDcBridge = (container) => {
  const issueKey = container.dataset.issueKey || null;
  const issueId = container.dataset.issueId || null;

  return {
    getTestInfo: async () => {
      const params = new URLSearchParams();
      if (issueKey) params.set('issueKey', issueKey);
      if (issueId) params.set('issueId', issueId);
      try {
        const response = await fetch(
          `${contextPath()}/rest/testplanit/1.0/panel?${params.toString()}`,
          { headers: { Accept: 'application/json' } }
        );
        const body = await response.json().catch(() => ({}));
        if (!response.ok && !body.error) {
          return { error: `Request failed (${response.status})` };
        }
        return body;
      } catch (err) {
        return { error: err.message || 'Request failed' };
      }
    },

    openUrl: (url) => {
      window.open(url, '_blank', 'noopener');
    },

    getIssueContext: () => ({ issueKey, issueId }),

    getTheme: () =>
      document.documentElement.getAttribute('data-color-mode') === 'dark' ? 'dark' : 'light',
  };
};
