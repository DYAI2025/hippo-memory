import * as path from 'path';

/**
 * Extract meaningful path segments from a directory path.
 * Returns tags like ['path:src', 'path:api', 'path:my-project'].
 * Filters out noise (node_modules, .git, Users, home dirs, drive letters).
 */
export function extractPathTags(dirPath: string): string[] {
  const normalized = dirPath.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);

  const noise = new Set([
    'users', 'home', 'documents', 'desktop', 'downloads',
    'node_modules', '.git', '.hippo', 'dist', 'build',
    'c:', 'd:', 'tmp', 'temp', 'var', 'usr', 'opt', 'etc',
    'appdata', 'local', 'roaming', 'program files', 'program files (x86)',
  ]);

  return segments
    .filter(s => s.length >= 2 && !noise.has(s.toLowerCase()))
    .slice(-4)  // keep last 4 meaningful segments (most specific)
    .map(s => `path:${s.toLowerCase()}`);
}

/**
 * Compute path overlap score between two sets of path tags.
 * Returns 0..1 where 1 = perfect match.
 */
export function pathOverlapScore(memoryPathTags: string[], currentPathTags: string[]): number {
  if (memoryPathTags.length === 0 || currentPathTags.length === 0) return 0;

  const memSet = new Set(memoryPathTags);
  const matches = currentPathTags.filter(t => memSet.has(t)).length;

  // Weight toward the memory's path tags (what fraction of the memory's context matches)
  return matches / memoryPathTags.length;
}
