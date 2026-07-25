import React, { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { DynamicIcon } from './DynamicIcon';
import { formatDuration } from '../formatters';

// Test case row component
export const TestCaseRow = ({ testCase, onOpen, onOpenTestRun }) => {
  const [expanded, setExpanded] = useState(false);

  const getIcon = (source, isDeleted) => {
    if (isDeleted) return <DynamicIcon name="Trash2" className="h-4 w-4 shrink-0" />;
    if (source === 'JUNIT') return <DynamicIcon name="Bot" className="h-4 w-4 shrink-0" />;
    return <DynamicIcon name="ListChecks" className="h-4 w-4 shrink-0" />;
  };

  const getStatusStyle = (statusColor) => {
    if (statusColor) {
      return {
        backgroundColor: statusColor,
        color: 'white',
        borderColor: statusColor
      };
    }
    // Fallback for cases without color data
    return {
      backgroundColor: 'var(--ds-background-neutral, #6B7280)',
      color: 'var(--ds-text-inverse, white)',
      borderColor: 'var(--ds-border-neutral, #6B7280)'
    };
  };

  const getResultBadgeStyle = (resultColor) => {
    if (resultColor) {
      return {
        backgroundColor: resultColor,
        color: 'white',
        borderColor: resultColor
      };
    }
    return {
      backgroundColor: 'var(--ds-background-neutral, #6B7280)',
      color: 'var(--ds-text-inverse, white)',
      borderColor: 'var(--ds-border-neutral, #6B7280)'
    };
  };

  const handleTitleClick = (e) => {
    e.stopPropagation();
    onOpen(testCase.id, testCase.projectId);
  };

  const toggleExpanded = (e) => {
    e.stopPropagation();
    setExpanded(!expanded);
  };

  return (
    <div className="testplanit-card border rounded-md transition-colors">
      <div className="flex items-center justify-between p-2 testplanit-hover">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {getIcon(testCase.source, testCase.isDeleted)}
          <button
            className="text-sm font-medium testplanit-primary flex-1 truncate text-left"
            onClick={handleTitleClick}
            title={testCase.name}
          >
            {testCase.name}
          </button>
          {(testCase.estimate || testCase.forecastManual || testCase.forecastAutomated) && (
            <div className="flex items-center gap-1">
              {testCase.estimate && (
                <span className="text-xs testplanit-text-muted testplanit-muted-bg px-2 py-1 rounded">
                  Est: {formatDuration(testCase.estimate)}
                </span>
              )}
              {testCase.forecastManual && (
                <span className="text-xs testplanit-primary testplanit-muted-bg px-2 py-1 rounded">
                  Forecast: {formatDuration(testCase.forecastManual)}
                </span>
              )}
              {testCase.forecastAutomated && (
                <span className="text-xs testplanit-primary testplanit-muted-bg px-2 py-1 rounded">
                  Auto: {formatDuration(Math.round(testCase.forecastAutomated))}
                </span>
              )}
            </div>
          )}
          <div className="flex items-center gap-2">
            {/* Workflow State */}
            <span
              className="text-xs px-2 py-1 rounded-md border font-medium flex items-center justify-center gap-1 w-20"
              style={getStatusStyle(testCase.statusColor)}
              title={testCase.status}
            >
              <DynamicIcon name={testCase.statusIcon} className="h-3 w-3 shrink-0" style={{ color: 'white' }} />
              <span className="truncate">{testCase.status}</span>
            </span>
            {/* Test Result Status Badge */}
            {testCase.lastResult && (
              <span
                className="text-xs px-2 py-1 rounded-md border font-medium flex items-center justify-center w-20"
                style={getResultBadgeStyle(testCase.lastResultColor)}
                title={testCase.lastResult}
              >
                <span className="truncate">{testCase.lastResult}</span>
              </span>
            )}
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
            {testCase.resultHistory && testCase.resultHistory.length > 0 ? (
              <div className="bg-card rounded border-border border justify-center">
                {/* Table Header */}
                <div className="grid grid-cols-12 gap-2 px-2 py-1 bg-muted/30 border-b border-border text-xs font-medium text-muted-foreground rounded-t items-center">
                  <div className="col-span-3">Test Run</div>
                  <div className="col-span-2">Status</div>
                  <div className="col-span-2">Executed By</div>
                  <div className="col-span-2">Executed At</div>
                  <div className="col-span-1">Edited</div>
                  <div className="col-span-1">Duration</div>
                  <div className="col-span-1">Version</div>
                </div>
                {/* Table Rows */}
                {testCase.resultHistory.map((result, index) => {
                  // Use the actual test run completion status from the API
                  const isTestRunCompleted = result.testRunIsCompleted || false;

                  return (
                    <div key={index} className={`grid grid-cols-12 gap-2 px-2 py-2 text-xs items-center border-b border-border last:border-b-0 hover:bg-muted/50 ${isTestRunCompleted ? 'completed-test-run' : ''}`}>
                      <div className="col-span-3">
                        <div className="flex items-center gap-1 min-w-0">
                          <DynamicIcon name="PlayCircle" className="h-3 w-3 text-muted-foreground shrink-0" />
                          {result.testRunId && result.testRunId !== null ? (
                            <button
                              className="truncate font-medium text-primary hover:text-primary/80 hover:underline text-left min-w-0"
                              title={result.testRunName}
                              onClick={() => onOpenTestRun?.(result.testRunId, testCase.projectId, { selectedCaseId: testCase.id })}
                            >
                              {result.testRunName}
                            </button>
                          ) : (
                            <span className="truncate font-medium min-w-0" title={result.testRunName}>
                              {result.testRunName}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="col-span-2 flex justify-start">
                        <span
                          className="px-2 py-1 rounded-md border font-medium inline-flex items-center justify-center w-16"
                          style={{
                            backgroundColor: result.statusColor || 'var(--ds-background-neutral, #6B7280)',
                            color: 'var(--ds-text-inverse, white)',
                            borderColor: result.statusColor || 'var(--ds-border-neutral, #6B7280)',
                            fontSize: '10px'
                          }}
                          title={result.status}
                        >
                          <span className="truncate">{result.status}</span>
                        </span>
                      </div>
                      <div className="col-span-2 min-w-0">
                        <span className="truncate text-xs block" title={result.executedBy?.name}>
                          {result.executedBy?.name || 'Unknown'}
                        </span>
                      </div>
                      <div className="col-span-2 min-w-0">
                        <span className="text-xs text-muted-foreground truncate block" title={new Date(result.executedAt).toLocaleString()}>
                          {formatDistanceToNow(new Date(result.executedAt), { addSuffix: true })}
                        </span>
                      </div>
                      <div className="col-span-1 flex items-center justify-center">
                        {result.editedBy ? (
                          <DynamicIcon name="History" className="h-3 w-3 text-muted-foreground" title={`Edited by ${result.editedBy.name}`} />
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </div>
                      <div className="col-span-1 flex items-center justify-center min-w-0">
                        {result.elapsed ? (
                          <span className="text-xs text-muted-foreground truncate" title={formatDuration(result.elapsed)}>
                            {formatDuration(result.elapsed)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </div>
                      <div className="col-span-1 flex items-center justify-center">
                        <span className="text-xs font-medium text-muted-foreground">
                          {result.testRunCaseVersion || '-'}
                        </span>
                      </div>
                  </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground text-center py-4">No test results available</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
