import { beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
const open = vi.fn();
const navigate = vi.fn();
vi.mock('@forge/bridge', () => ({
  invoke: (...args) => invoke(...args),
  router: { open: (...args) => open(...args), navigate: (...args) => navigate(...args) },
}));

import { createForgeBridge } from './forgeBridge';

describe('createForgeBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates getTestInfo to the resolver', async () => {
    invoke.mockResolvedValue({ testCases: [] });
    const bridge = createForgeBridge();
    await expect(bridge.getTestInfo()).resolves.toEqual({ testCases: [] });
    expect(invoke).toHaveBeenCalledWith('getTestInfo');
  });

  it('opens urls via router.open first', async () => {
    open.mockResolvedValue(undefined);
    const bridge = createForgeBridge();
    await bridge.openUrl('https://tp.example.com');
    expect(open).toHaveBeenCalledWith('https://tp.example.com');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('falls back to router.navigate when open fails', async () => {
    open.mockRejectedValue(new Error('sandbox'));
    navigate.mockResolvedValue(undefined);
    const bridge = createForgeBridge();
    await bridge.openUrl('https://tp.example.com');
    expect(navigate).toHaveBeenCalledWith('https://tp.example.com');
  });
});
