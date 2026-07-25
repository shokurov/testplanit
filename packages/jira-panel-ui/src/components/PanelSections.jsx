import React, { useState } from 'react';
import { DynamicIcon } from './DynamicIcon';
import { TestCaseRow } from './TestCaseRow';
import { SessionRow } from './SessionRow';
import { TestRunRow } from './TestRunRow';

// The read-only panel body: three collapsible sections, empty state, footer.
// Host-specific chrome (loading, errors, configuration, AI generation) stays
// in the host app; `actions`/`emptyActions` are its slots in the layout.
export const PanelSections = ({
  testData,
  onOpenTestCase,
  onOpenSession,
  onOpenTestRun,
  onOpenHome,
  actions = null,
  emptyActions = null,
}) => {
  const [sectionsExpanded, setSectionsExpanded] = useState({
    testCases: true,
    testRuns: true,
    sessions: true,
  });

  const toggleSection = (section) => {
    setSectionsExpanded((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const hasTestCases = testData?.testCases?.length > 0;
  const hasSessions = testData?.sessions?.length > 0;
  const hasTestRuns = testData?.testRuns?.length > 0;

  if (!hasTestCases && !hasSessions && !hasTestRuns) {
    return (
      <div className="p-4 testplanit-bg">
        <div className="bg-card rounded-lg p-6 text-center border border-border">
          <div className="text-4xl mb-3">🔍</div>
          <p className="text-sm text-muted-foreground mb-4">No tests linked to this issue yet</p>
          <div className="flex flex-col items-center gap-2">
            {emptyActions}
            <button
              className="text-sm text-muted-foreground hover:text-primary font-medium hover:underline transition-colors"
              onClick={onOpenHome}
            >
              Link tests in TestPlanIt
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 testplanit-bg">
      {hasTestCases && (
        <div className="mb-4">
          <button
            className="flex items-center gap-2 w-full text-left text-sm font-semibold text-foreground mb-3 uppercase tracking-wide hover:text-primary transition-colors"
            onClick={() => toggleSection('testCases')}
          >
            <DynamicIcon name={sectionsExpanded.testCases ? 'ChevronDown' : 'ChevronRight'} className="h-4 w-4" />
            Test Cases ({testData.testCases.length})
          </button>
          {sectionsExpanded.testCases && (
            <div>
              {testData.testCases.map((testCase, index) => (
                <TestCaseRow
                  key={testCase.id || index}
                  testCase={testCase}
                  onOpen={onOpenTestCase}
                  onOpenTestRun={onOpenTestRun}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {hasTestRuns && (
        <div className="mb-4">
          <button
            className="flex items-center gap-2 w-full text-left text-sm font-semibold text-foreground mb-3 uppercase tracking-wide hover:text-primary transition-colors"
            onClick={() => toggleSection('testRuns')}
          >
            <DynamicIcon name={sectionsExpanded.testRuns ? 'ChevronDown' : 'ChevronRight'} className="h-4 w-4" />
            Test Runs ({testData.testRuns.length})
          </button>
          {sectionsExpanded.testRuns && (
            <div>
              {testData.testRuns.map((testRun, index) => (
                <TestRunRow key={testRun.id || index} testRun={testRun} onOpen={onOpenTestRun} />
              ))}
            </div>
          )}
        </div>
      )}

      {hasSessions && (
        <div className="mb-4">
          <button
            className="flex items-center gap-2 w-full text-left text-sm font-semibold text-foreground mb-3 uppercase tracking-wide hover:text-primary transition-colors"
            onClick={() => toggleSection('sessions')}
          >
            <DynamicIcon name={sectionsExpanded.sessions ? 'ChevronDown' : 'ChevronRight'} className="h-4 w-4" />
            Sessions ({testData.sessions.length})
          </button>
          {sectionsExpanded.sessions && (
            <div>
              {testData.sessions.map((session, index) => (
                <SessionRow key={session.id || index} session={session} onOpen={onOpenSession} />
              ))}
            </div>
          )}
        </div>
      )}

      <div className="border-t border-border pt-4 flex items-center justify-between gap-2">
        <button
          className="text-sm text-muted-foreground hover:text-primary font-medium hover:underline transition-colors"
          onClick={onOpenHome}
        >
          Open TestPlanIt →
        </button>
        {actions}
      </div>
    </div>
  );
};
