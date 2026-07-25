// DC implementation of the panel bridge contract (see
// @testplanit/jira-panel-ui bridge.jsx). Talks to this plugin's own REST
// module; Jira handles the user session cookie.
const contextPath = () =>
  (window.AJS && typeof window.AJS.contextPath === 'function' && window.AJS.contextPath()) ||
  window.contextPath ||
  '';

// An unresolved velocity reference renders as literal text ("$issueKey"), a
// resolved-but-empty one as "". Treat both as absent.
const cleanAttr = (value) => (value && !value.includes('$') ? value : null);

// Fallback when the container attributes are blank: Jira issue pages expose
// the current issue key via AJS meta (an `ajs-issue-key` meta tag).
const metaIssueKey = () => {
  if (window.AJS && window.AJS.Meta && typeof window.AJS.Meta.get === 'function') {
    const key = window.AJS.Meta.get('issue-key');
    if (key) return key;
  }
  const meta = document.querySelector('meta[name="ajs-issue-key"]');
  return (meta && meta.getAttribute('content')) || null;
};

export const createDcBridge = (container) => {
  const issueKey = cleanAttr(container.dataset.issueKey) || metaIssueKey();
  const issueId = cleanAttr(container.dataset.issueId);

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
