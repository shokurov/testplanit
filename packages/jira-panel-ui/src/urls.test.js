import { describe, expect, it } from 'vitest';
import { buildSessionUrl, buildTestCaseUrl, buildTestRunUrl } from './urls';

const base = 'https://tp.example.com';

describe('url builders', () => {
  it('builds project-scoped and fallback test case urls', () => {
    expect(buildTestCaseUrl(base, 5, 2)).toBe(`${base}/projects/repository/2/5`);
    expect(buildTestCaseUrl(base, 5, null)).toBe(`${base}/test-cases/5`);
  });

  it('builds session urls', () => {
    expect(buildSessionUrl(base, 7, 2)).toBe(`${base}/projects/sessions/2/7`);
    expect(buildSessionUrl(base, 7, undefined)).toBe(`${base}/sessions/7`);
  });

  it('builds run urls with optional selected case', () => {
    expect(buildTestRunUrl(base, 9, 2)).toBe(`${base}/projects/runs/2/9`);
    expect(buildTestRunUrl(base, 9, 2, { selectedCaseId: 5 }))
      .toBe(`${base}/projects/runs/2/9?selectedCase=5&view=status`);
    expect(buildTestRunUrl(base, 9, null)).toBe(`${base}/test-runs/9`);
  });
});
