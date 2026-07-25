import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDcBridge } from './dcBridge';

describe('createDcBridge', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    container.dataset.issueKey = 'DEMO-1';
    container.dataset.issueId = '10001';
    delete window.AJS;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute('data-color-mode');
    document.querySelectorAll('meta[name="ajs-issue-key"]').forEach((m) => m.remove());
  });

  it('reads issue context from the container dataset', () => {
    const bridge = createDcBridge(container);
    expect(bridge.getIssueContext()).toEqual({ issueKey: 'DEMO-1', issueId: '10001' });
  });

  it('treats unresolved velocity literals as absent and falls back to the AJS meta issue key', () => {
    container.dataset.issueKey = '$!issueKey';
    container.dataset.issueId = '$issue.id';
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'ajs-issue-key');
    meta.setAttribute('content', 'META-42');
    document.head.appendChild(meta);

    const bridge = createDcBridge(container);

    expect(bridge.getIssueContext()).toEqual({ issueKey: 'META-42', issueId: null });
  });

  it('falls back to AJS.Meta.get when the container attributes are blank', () => {
    container.dataset.issueKey = '';
    container.dataset.issueId = '';
    window.AJS = { Meta: { get: (name) => (name === 'issue-key' ? 'AJS-7' : null) } };

    const bridge = createDcBridge(container);

    expect(bridge.getIssueContext()).toEqual({ issueKey: 'AJS-7', issueId: null });
  });

  it('fetches panel data from the plugin REST with the AJS context path', async () => {
    window.AJS = { contextPath: () => '/jira' };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ testCases: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const bridge = createDcBridge(container);
    const data = await bridge.getTestInfo();

    expect(fetchMock).toHaveBeenCalledWith(
      '/jira/rest/testplanit/1.0/panel?issueKey=DEMO-1&issueId=10001',
      expect.objectContaining({ headers: { Accept: 'application/json' } })
    );
    expect(data).toEqual({ testCases: [] });
  });

  it('maps HTTP errors to the { error } shape the panel understands', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: () => Promise.resolve({ error: 'Failed to fetch test info: 500' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const bridge = createDcBridge(container);
    const data = await bridge.getTestInfo();

    expect(data).toEqual({ error: 'Failed to fetch test info: 500' });
  });

  it('synthesizes an error when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const bridge = createDcBridge(container);
    const data = await bridge.getTestInfo();

    expect(data.error).toContain('offline');
  });

  it('opens urls in a new tab', () => {
    const openMock = vi.fn();
    vi.stubGlobal('open', openMock);

    const bridge = createDcBridge(container);
    bridge.openUrl('https://tp.example.com/x');

    expect(openMock).toHaveBeenCalledWith('https://tp.example.com/x', '_blank', 'noopener');
  });

  it('reports the Jira color mode', () => {
    const bridge = createDcBridge(container);
    expect(bridge.getTheme()).toBe('light');
    document.documentElement.setAttribute('data-color-mode', 'dark');
    expect(bridge.getTheme()).toBe('dark');
  });
});
