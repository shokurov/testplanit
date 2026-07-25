import React, { useState } from 'react';
import { DynamicIcon } from './DynamicIcon';
import { StatusBadge } from './StatusBadge';

// Test run row component
export const TestRunRow = ({ testRun, onOpen }) => {
  const [expanded, setExpanded] = useState(false);

  // Use display items from API (like TestRunCasesSummary)
  const displayItems = testRun.displayItems || [];
  const passedCount = displayItems.filter(item => item.status?.name === 'Passed').length;
  const passRate = testRun.total > 0 ? Math.round((passedCount / testRun.total) * 100) : 0;

  const handleTitleClick = (e) => {
    e.stopPropagation();
    onOpen(testRun.id, testRun.projectId);
  };

  const toggleExpanded = (e) => {
    e.stopPropagation();
    setExpanded(!expanded);
  };

  return (
    <div className="testplanit-card border rounded-md mb-1 transition-colors">
      <div className="flex items-center justify-between p-2 testplanit-hover">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <DynamicIcon name="PlayCircle" className="h-4 w-4 shrink-0" />
          <button
            className="text-sm font-medium testplanit-primary flex-1 truncate text-left"
            onClick={handleTitleClick}
            title={testRun.name}
          >
            {testRun.name}
          </button>
          <div className="flex items-center gap-2">
            <span className="text-xs testplanit-text-muted testplanit-muted-bg px-2 py-1 rounded">
              {passRate}% passed
            </span>
            <span className="text-xs testplanit-text-muted testplanit-muted-bg px-2 py-1 rounded">
              {testRun.total} cases
            </span>
            <StatusBadge
              status={testRun.status}
              statusColor={testRun.statusColor}
              icon={testRun.statusIcon}
            />
          </div>
        </div>
        <button
          className="text-muted-foreground hover:text-primary p-1 rounded hover:bg-primary/10 transition-colors ml-2"
          onClick={toggleExpanded}
        >
          {expanded ? <DynamicIcon name="ChevronDown" className="h-4 w-4" /> : <DynamicIcon name="ChevronRight" className="h-4 w-4" />}
        </button>
      </div>
      {expanded && (
        <div className="border-t border-border bg-muted/30">
          <div className="p-2">
            <div className="testplanit-card rounded border-border border p-3">
              <div className="flex flex-col space-y-3">
                {/* Status Bar Visualization */}
                <div className="flex flex-col space-y-1">
                  <div className="flex h-2.5 w-full rounded-full overflow-hidden bg-muted">
                    {/* Individual segments for each test case with actual status colors (like TestRunCasesSummary) */}
                    {displayItems.map((item, index) => {
                      const color = item.status?.color?.value || '#9ca3af';
                      return (
                        <div
                          key={`${item.id}-${index}`}
                          className="h-full transition-all border-x-[0.5px] border-primary-foreground"
                          style={{
                            backgroundColor: color,
                            width: `${100 / displayItems.length}%`,
                            minWidth: '4px'
                          }}
                          title={`${item.testCaseName}: ${item.status?.name}`}
                        />
                      );
                    })}
                  </div>
                  <div className="text-xs testplanit-text-muted">
                    Total: {testRun.total} cases{testRun.summaryText ? ` (${testRun.summaryText})` : ''}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
