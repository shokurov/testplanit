import React, { useState } from 'react';
import { DynamicIcon } from './DynamicIcon';
import { StatusBadge } from './StatusBadge';
import { formatElapsedTime } from '../formatters';

// Session row component
export const SessionRow = ({ session, onOpen }) => {
  const [expanded, setExpanded] = useState(false);

  // Use display items from API (like SessionResultsSummary)
  const displayItems = session.displayItems || [];
  const hasResults = displayItems.length > 0;
  const resultSummary = hasResults
    ? session.hasElapsed
      ? `${session.total} results`
      : `${session.total} results (no time)`
    : 'No results';

  const handleTitleClick = (e) => {
    e.stopPropagation();
    onOpen(session.id, session.projectId);
  };

  const toggleExpanded = (e) => {
    e.stopPropagation();
    setExpanded(!expanded);
  };

  return (
    <div className="testplanit-card border rounded-md mb-1 transition-colors">
      <div className="flex items-center justify-between p-2 testplanit-hover">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <DynamicIcon name="Compass" className="h-4 w-4 shrink-0" />
          <button
            className="text-sm font-medium testplanit-primary flex-1 truncate text-left"
            onClick={handleTitleClick}
            title={session.name}
          >
            {session.name}
          </button>
          <div className="flex items-center gap-2">
            <span className="text-xs testplanit-text-muted testplanit-muted-bg px-2 py-1 rounded">
              {resultSummary}
            </span>
            <StatusBadge
              status={session.status}
              statusColor={session.statusColor}
              icon={session.statusIcon}
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
                {hasResults ? (
                  <>
                    {/* Status Bar Visualization */}
                    <div className="flex flex-col space-y-1">
                      <div className="flex h-2.5 w-full rounded-full overflow-hidden bg-muted">
                        {/* Individual segments for each session result with actual status colors (like SessionResultsSummary) */}
                        {displayItems.map((result, index) => {
                          const color = result.status?.color?.value || '#9ca3af';

                          // Calculate width based on elapsed time if available, otherwise equal distribution
                          let width;
                          if (session.hasElapsed) {
                            if (result.elapsed && result.elapsed > 0) {
                              width = `${Math.max(5, (result.elapsed / session.totalElapsed) * 100)}%`;
                            } else {
                              width = '5%'; // Minimum width for results with no elapsed time
                            }
                          } else {
                            width = `${100 / displayItems.length}%`; // Equal distribution
                          }

                          return (
                            <div
                              key={`${result.id}-${index}`}
                              className="h-full transition-all border-x-[0.5px] border-primary-foreground"
                              style={{
                                backgroundColor: color,
                                width: width,
                                minWidth: '4px'
                              }}
                              title={`Result ${index + 1}: ${result.status?.name}${result.elapsed ? ` (${result.elapsed}s)` : ''}`}
                            />
                          );
                        })}
                      </div>
                      <div className="text-xs testplanit-text-muted">
                        Total: {session.total} results{session.summaryText ? ` (${session.summaryText})` : ''}
                      </div>
                      {session.hasElapsed && session.totalElapsed > 0 && (
                        <div className="text-xs testplanit-text-muted mt-1 space-y-1">
                          <div className="flex items-center gap-1">
                            <DynamicIcon name="Timer" className="h-3 w-3" />
                            <span>Time Spent: {formatElapsedTime(session.totalElapsed)}</span>
                          </div>
                          {session.estimate && (
                            <div className="flex items-center gap-1">
                              {session.totalElapsed > session.estimate ? (
                                <>
                                  <DynamicIcon name="ClockAlert" className="h-3 w-3 text-red-500" />
                                  <span className="text-red-500">
                                    Over the Estimate by: {formatElapsedTime(session.totalElapsed - session.estimate)}
                                  </span>
                                </>
                              ) : (
                                <>
                                  <DynamicIcon name="AlarmClockPlus" className="h-3 w-3" />
                                  <span>
                                    Remaining: {formatElapsedTime(session.estimate - session.totalElapsed)}
                                  </span>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="text-xs testplanit-text-muted text-center py-4">
                    No session results recorded yet
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
