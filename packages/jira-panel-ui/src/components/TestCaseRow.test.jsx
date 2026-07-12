import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { TestCaseRow } from './TestCaseRow';

const testCase = {
  id: 5,
  projectId: 2,
  name: 'Login works',
  status: 'Ready',
  statusColor: '#10b981',
  resultHistory: [
    {
      testRunId: 9,
      testRunName: 'Sprint 12 run',
      status: 'Passed',
      statusColor: '#10b981',
      executedAt: new Date().toISOString(),
      executedBy: { name: 'QA' },
    },
  ],
};

describe('TestCaseRow', () => {
  it('opens the case via onOpen', () => {
    const onOpen = vi.fn();
    render(<TestCaseRow testCase={testCase} onOpen={onOpen} />);
    fireEvent.click(screen.getByTitle('Login works'));
    expect(onOpen).toHaveBeenCalledWith(5, 2);
  });

  it('opens a history test run via onOpenTestRun with the selected case', () => {
    const onOpenTestRun = vi.fn();
    render(<TestCaseRow testCase={testCase} onOpen={() => {}} onOpenTestRun={onOpenTestRun} />);
    // expand the row (chevron is the last button in the header)
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[buttons.length - 1]);
    fireEvent.click(screen.getByTitle('Sprint 12 run'));
    expect(onOpenTestRun).toHaveBeenCalledWith(9, 2, { selectedCaseId: 5 });
  });
});
