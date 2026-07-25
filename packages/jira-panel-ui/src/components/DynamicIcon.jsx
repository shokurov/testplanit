import React from 'react';
import * as LucideIcons from 'lucide-react';

// Dynamic icon component that maps icon names to Lucide React icons
export const DynamicIcon = ({ name, className = "h-4 w-4", style }) => {
  if (!name) return null;

  // Convert icon name to PascalCase for Lucide React
  // Handle common transformations: kebab-case, snake_case, etc.
  const toPascalCase = (str) => {
    return str
      .split(/[-_\s]/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('');
  };

  // Try different variations of the icon name
  const iconVariations = [
    name, // exact match
    toPascalCase(name), // PascalCase
    name.charAt(0).toUpperCase() + name.slice(1), // Capitalize first letter
    name.toLowerCase(), // lowercase
    name.toUpperCase(), // uppercase
  ];

  // Special mappings for common single-character or symbol icons
  const specialMappings = {
    '●': 'Circle',
    '○': 'Circle',
    '◯': 'Circle',
    '◐': 'PauseCircle',
    '✓': 'Check',
    '✗': 'X',
    '!': 'AlertTriangle',
    '⏸': 'Pause',
    '▶': 'Play',
    '⏹': 'Square',
    '🕐': 'Clock',
    // Single letter common mappings
    'o': 'Circle',
    'c': 'Check',
    'x': 'X',
    'p': 'Play',
    's': 'Square',
    't': 'Clock'
  };

  // Check special mappings first
  if (specialMappings[name]) {
    iconVariations.unshift(specialMappings[name]);
  }

  // Try to find the icon in Lucide React
  let IconComponent = null;
  for (const variation of iconVariations) {
    if (LucideIcons[variation]) {
      IconComponent = LucideIcons[variation];
      break;
    }
  }

  // Fallback to Circle if no icon found
  if (!IconComponent) {
    IconComponent = LucideIcons.Circle;
  }

  return <IconComponent className={className} style={style} />;
};
