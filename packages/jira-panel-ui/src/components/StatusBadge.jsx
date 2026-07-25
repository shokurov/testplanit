import React from 'react';
import { DynamicIcon } from './DynamicIcon';

// Status badge component using backend color data
export const StatusBadge = ({ status, statusColor, icon, className = "", width = "w-20" }) => {
  const badgeStyle = statusColor ? {
    backgroundColor: statusColor,
    color: 'var(--ds-text-inverse, white)',
    borderColor: statusColor
  } : {
    backgroundColor: 'var(--ds-background-neutral, #6B7280)',
    color: 'var(--ds-text-inverse, white)',
    borderColor: 'var(--ds-border-neutral, #6B7280)'
  };

  return (
    <span
      className={`inline-flex items-center justify-center px-2 py-1 rounded-md text-xs font-medium border gap-1 ${width} ${className}`}
      style={badgeStyle}
      title={status} // Show full text on hover
    >
      {icon && <DynamicIcon name={icon} className="h-3 w-3 shrink-0" style={{ color: 'white' }} />}
      <span className="truncate">{status}</span>
    </span>
  );
};
