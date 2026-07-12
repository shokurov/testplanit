import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { PanelSections } from './PanelSections';

describe('PanelSections', () => {
  it('renders the empty state with home link and emptyActions slot', () => {
    const onOpenHome = vi.fn();
    render(
      <PanelSections
        testData={{ testCases: [], sessions: [], testRuns: [] }}
        onOpenHome={onOpenHome}
        emptyActions={<button>Generate</button>}
      />
    );
    expect(screen.getByText('No tests linked to this issue yet')).toBeTruthy();
    expect(screen.getByText('Generate')).toBeTruthy();
    fireEvent.click(screen.getByText('Link tests in TestPlanIt'));
    expect(onOpenHome).toHaveBeenCalled();
  });

  it('renders sections with counts and collapses them', () => {
    render(
      <PanelSections
        testData={{
          testCases: [{ id: 1, name: 'c1', status: 'Ready' }],
          sessions: [],
          testRuns: [{ id: 9, name: 'r1', status: 'Active', total: 0, displayItems: [] }],
        }}
        onOpenTestCase={() => {}}
        onOpenTestRun={() => {}}
        onOpenHome={() => {}}
      />
    );
    expect(screen.getByText('Test Cases (1)')).toBeTruthy();
    expect(screen.getByText('Test Runs (1)')).toBeTruthy();
    fireEvent.click(screen.getByText('Test Cases (1)'));
    expect(screen.queryByTitle('c1')).toBeNull();
  });
});
