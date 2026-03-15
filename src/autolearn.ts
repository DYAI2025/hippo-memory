/**
 * Auto-learn from errors and git history.
 * Zero required dependencies - everything is stdlib.
 */

import { createMemory, Layer, MemoryEntry } from './memory.js';
import { textOverlap } from './search.js';
import { loadAllEntries } from './store.js';

// ---------------------------------------------------------------------------
// captureError
// ---------------------------------------------------------------------------

/**
 * Create a MemoryEntry that captures a failed command's context.
 * Truncates stderr to 500 chars to keep memory size bounded.
 */
export function captureError(exitCode: number, stderr: string, command: string): MemoryEntry {
  const truncated = stderr.length > 500 ? stderr.slice(0, 500) + '...(truncated)' : stderr;
  const content = `Command failed (exit ${exitCode}): ${command}\n\nStderr:\n${truncated}`;

  return createMemory(content, {
    layer: Layer.Episodic,
    tags: ['error', 'autolearn'],
    emotional_valence: 'negative',
    source: 'autolearn',
  });
}

// ---------------------------------------------------------------------------
// extractLessons
// ---------------------------------------------------------------------------

// Matches commit subjects that indicate a fix, revert, or bug
const FIX_PATTERN = /\b(fix|fixes|fixed|revert|reverts|reverted|bug|bugfix|hotfix|patch)\b/i;

/**
 * Parse git log output and extract lessons from fix/revert/bug commits.
 * Expects lines in the format: "HASH SUBJECT" (one commit per line).
 * Use: git log --oneline --no-merges
 */
export function extractLessons(gitLog: string): string[] {
  const lessons: string[] = [];

  for (const rawLine of gitLog.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    // git log --oneline: "<hash> <subject>"
    const spaceIdx = line.indexOf(' ');
    if (spaceIdx === -1) continue;

    const subject = line.slice(spaceIdx + 1).trim();
    if (!FIX_PATTERN.test(subject)) continue;

    // Build a lesson sentence from the commit subject
    const lesson = formatLesson(subject);
    if (lesson) lessons.push(lesson);
  }

  return lessons;
}

function formatLesson(subject: string): string {
  // Normalise: strip common prefixes like "fix:", "Fix:", "chore(fix):", etc.
  const cleaned = subject
    .replace(/^(fix|bug|patch|hotfix|revert)[:\s(]+/i, '')
    .replace(/^[\w-]+\([^)]+\):\s*/i, '') // "scope(context): ..."
    .trim();

  if (cleaned.length < 5) return '';
  return `Lesson from git: ${cleaned}`;
}

// ---------------------------------------------------------------------------
// deduplicateLesson
// ---------------------------------------------------------------------------

/**
 * Returns true if a similar memory already exists in the store (overlap > 0.7).
 * Avoids flooding the store with near-duplicate git lessons.
 */
export function deduplicateLesson(hippoRoot: string, lesson: string): boolean {
  const entries = loadAllEntries(hippoRoot);

  for (const entry of entries) {
    const overlap = textOverlap(lesson, entry.content);
    if (overlap > 0.7) return true;
  }

  return false;
}
