// Flatten a folder list into a depth-ordered array (children nested under
// parents), mirroring the app's hierarchical FolderSelect. Native <option>
// elements can't nest, so depth drives leading indentation in the label.
export const flattenFolders = (folders) => {
  const byParent = new Map();
  for (const f of folders || []) {
    const key = f.parentId == null ? 'root' : f.parentId;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(f);
  }
  const out = [];
  const walk = (key, depth) => {
    for (const f of byParent.get(key) || []) {
      out.push({ id: f.id, name: f.name, depth });
      walk(f.id, depth + 1);
    }
  };
  walk('root', 0);
  return out;
};

// Utility function to format duration in seconds to human readable format
export const formatDuration = (seconds) => {
  if (!seconds || seconds <= 0) return null;

  const days = Math.floor(seconds / (24 * 60 * 60));
  const hours = Math.floor((seconds % (24 * 60 * 60)) / (60 * 60));
  const mins = Math.floor((seconds % (60 * 60)) / 60);
  const secs = seconds % 60;

  const parts = [];
  if (days > 0) parts.push(`${days} day${days !== 1 ? 's' : ''}`);
  if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
  if (mins > 0) parts.push(`${mins} minute${mins !== 1 ? 's' : ''}`);
  if (secs > 0 && days === 0 && hours === 0) parts.push(`${secs} second${secs !== 1 ? 's' : ''}`);

  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts.join(', ');
  return `${parts.slice(0, -1).join(', ')}, ${parts[parts.length - 1]}`;
};

// Utility function to format time like TestPlanIt's ElapsedTime component
export const formatElapsedTime = (totalSeconds) => {
  if (!totalSeconds || totalSeconds <= 0) return 'No time recorded';

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  const parts = [];
  if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
  if (minutes > 0) parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);
  if (seconds > 0) parts.push(`${seconds} second${seconds !== 1 ? 's' : ''}`);

  return parts.join(', ');
};
