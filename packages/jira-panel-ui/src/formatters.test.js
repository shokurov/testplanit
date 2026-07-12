import { describe, expect, it } from 'vitest';
import { formatDuration, formatElapsedTime, flattenFolders } from './formatters';

describe('formatDuration', () => {
  it('returns null for empty/zero', () => {
    expect(formatDuration(0)).toBeNull();
    expect(formatDuration(null)).toBeNull();
  });
  it('formats compound durations', () => {
    expect(formatDuration(60)).toBe('1 minute');
    expect(formatDuration(3661)).toBe('1 hour, 1 minute');
    expect(formatDuration(90061)).toBe('1 day, 1 hour, 1 minute');
  });
});

describe('formatElapsedTime', () => {
  it('handles zero', () => {
    expect(formatElapsedTime(0)).toBe('No time recorded');
  });
  it('formats h/m/s', () => {
    expect(formatElapsedTime(3725)).toBe('1 hour, 2 minutes, 5 seconds');
  });
});

describe('flattenFolders', () => {
  it('orders children under parents with depth', () => {
    const flat = flattenFolders([
      { id: 1, parentId: null, name: 'root-a' },
      { id: 2, parentId: 1, name: 'child' },
      { id: 3, parentId: null, name: 'root-b' },
    ]);
    expect(flat).toEqual([
      { id: 1, name: 'root-a', depth: 0 },
      { id: 2, name: 'child', depth: 1 },
      { id: 3, name: 'root-b', depth: 0 },
    ]);
  });
});
