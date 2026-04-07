import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';
import { captureError, extractLessons, deduplicateLesson, fetchGitLog, isGitRepo } from '../src/autolearn.js';
import { initStore, writeEntry, readEntry } from '../src/store.js';
import { createMemory } from '../src/memory.js';
import { extractInvalidationTarget, invalidateMatching } from '../src/invalidation.js';

// ---------------------------------------------------------------------------
// captureError
// ---------------------------------------------------------------------------

describe('captureError', () => {
  it('creates a memory entry with error tags', () => {
    const entry = captureError(1, 'TypeError: Cannot read property x', 'npm test');
    expect(entry.tags).toContain('error');
    expect(entry.tags).toContain('autolearn');
    expect(entry.content).toContain('npm test');
    expect(entry.content).toContain('TypeError');
  });

  it('truncates stderr to 500 chars', () => {
    const longStderr = 'x'.repeat(600);
    const entry = captureError(2, longStderr, 'cmd');
    expect(entry.content.length).toBeLessThan(700);
    expect(entry.content).toContain('truncated');
  });

  it('includes exit code in content', () => {
    const entry = captureError(127, 'command not found', 'badcmd');
    expect(entry.content).toContain('exit 127');
  });

  it('sets emotional_valence to negative', () => {
    const entry = captureError(1, 'err', 'cmd');
    expect(entry.emotional_valence).toBe('negative');
  });

  it('short stderr passes through unchanged', () => {
    const stderr = 'short error';
    const entry = captureError(1, stderr, 'cmd');
    expect(entry.content).toContain('short error');
    expect(entry.content).not.toContain('truncated');
  });
});

// ---------------------------------------------------------------------------
// extractLessons
// ---------------------------------------------------------------------------

describe('extractLessons', () => {
  it('extracts lessons from fix commits', () => {
    const log = [
      'abc1234 fix: null pointer in cache refresh',
      'def5678 feat: add new dashboard',
      'ghi9012 Fix broken pipeline logic',
    ].join('\n');

    const lessons = extractLessons(log);
    expect(lessons.length).toBe(2);
    expect(lessons.some((l) => l.includes('null pointer'))).toBe(true);
    expect(lessons.some((l) => l.includes('broken pipeline'))).toBe(true);
  });

  it('extracts lessons from revert commits', () => {
    const log = 'abc1234 revert bad deploy changes';
    const lessons = extractLessons(log);
    expect(lessons.length).toBe(1);
    expect(lessons[0]).toContain('bad deploy');
  });

  it('extracts lessons from bug/bugfix commits', () => {
    const log = [
      'abc1234 bugfix: race condition in scheduler',
      'def5678 bug in auth token refresh',
    ].join('\n');

    const lessons = extractLessons(log);
    expect(lessons.length).toBe(2);
  });

  it('ignores non-matching commits', () => {
    const log = [
      'abc1234 feat: add dark mode',
      'ghi9012 docs: readme update',
      'jkl3456 ci: update pipeline',
    ].join('\n');

    const lessons = extractLessons(log);
    expect(lessons.length).toBe(0);
  });

  it('returns empty array for empty log', () => {
    expect(extractLessons('')).toEqual([]);
  });

  it('extracts lessons from multi-repo combined output', () => {
    // Simulate concatenated git logs from multiple repos
    const repoALog = [
      'aaa1111 fix: broken auth flow in login page',
      'bbb2222 feat: add search bar',
    ].join('\n');

    const repoBLog = [
      'ccc3333 hotfix: database connection pool exhaustion',
      'ddd4444 chore: bump dependencies',
      'eee5555 revert: rolled back bad migration',
    ].join('\n');

    const lessonsA = extractLessons(repoALog);
    const lessonsB = extractLessons(repoBLog);

    expect(lessonsA.length).toBe(1);
    expect(lessonsA[0]).toContain('broken auth flow');

    expect(lessonsB.length).toBe(3);
    expect(lessonsB.some((l) => l.includes('connection pool'))).toBe(true);
    expect(lessonsB.some((l) => l.includes('bad migration'))).toBe(true);
    expect(lessonsB.some((l) => l.includes('bump dependencies'))).toBe(true);

    // Combined set has no overlap
    const all = [...lessonsA, ...lessonsB];
    expect(new Set(all).size).toBe(all.length);
  });
});

// ---------------------------------------------------------------------------
// deduplicateLesson
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// HOOKS config (verified by reading source)
// ---------------------------------------------------------------------------

describe('HOOKS config', () => {
  const cliSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'cli.ts'), 'utf8');

  it('openclaw hook targets AGENTS.md', () => {
    // The openclaw entry in HOOKS should use AGENTS.md, not a skill file
    expect(cliSource).toContain("'openclaw': {");
    expect(cliSource).toContain("file: 'AGENTS.md',");
    // Ensure it does NOT point to the old skill path
    expect(cliSource).not.toContain('.openclaw/skills/hippo/SKILL.md');
  });

  it('openclaw hook content includes key commands', () => {
    expect(cliSource).toContain('hippo context --auto --budget 1500');
    expect(cliSource).toContain('hippo outcome --good');
    expect(cliSource).toContain('hippo learn --git');
  });
});

// ---------------------------------------------------------------------------
// deduplicateLesson
// ---------------------------------------------------------------------------

describe('git repo detection', () => {
  it('treats an empty recent history window as a real git repo, not a missing repo', () => {
    const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hippo-gitlog-'));

    try {
      execSync('git init', { cwd: repoDir, stdio: 'ignore' });
      execSync('git config user.name "Test User"', { cwd: repoDir, stdio: 'ignore' });
      execSync('git config user.email "test@example.com"', { cwd: repoDir, stdio: 'ignore' });
      fs.writeFileSync(path.join(repoDir, 'README.md'), 'hello\n');
      execSync('git add README.md', { cwd: repoDir, stdio: 'ignore' });
      execSync('git commit -m "docs: old commit"', {
        cwd: repoDir,
        stdio: 'ignore',
        env: {
          ...process.env,
          GIT_AUTHOR_DATE: '2020-01-01T00:00:00Z',
          GIT_COMMITTER_DATE: '2020-01-01T00:00:00Z',
        },
      });

      expect(isGitRepo(repoDir)).toBe(true);
      expect(fetchGitLog(repoDir, 1)).toBe('');
    } finally {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
  });

  it('returns false for a non-git directory', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hippo-not-git-'));

    try {
      expect(isGitRepo(dir)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('deduplicateLesson', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hippo-dedup-'));
    initStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns false when no similar memory exists', () => {
    const isDup = deduplicateLesson(tmpDir, 'lesson about cache refresh');
    expect(isDup).toBe(false);
  });

  it('returns true when an identical lesson exists', () => {
    const lesson = 'lesson about cache refresh pipeline error';
    const entry = createMemory(lesson);
    writeEntry(tmpDir, entry);

    const isDup = deduplicateLesson(tmpDir, lesson);
    expect(isDup).toBe(true);
  });

  it('returns true for near-duplicate lesson (>0.7 overlap)', () => {
    const existing = 'lesson about cache refresh pipeline error fix';
    const entry = createMemory(existing);
    writeEntry(tmpDir, entry);

    const similar = 'lesson about cache refresh pipeline error bug';
    const isDup = deduplicateLesson(tmpDir, similar);
    expect(isDup).toBe(true);
  });

  it('returns false for unrelated lesson', () => {
    const existing = 'lesson about cache refresh pipeline error';
    const entry = createMemory(existing);
    writeEntry(tmpDir, entry);

    const unrelated = 'completely different content about authentication tokens jwt';
    const isDup = deduplicateLesson(tmpDir, unrelated);
    expect(isDup).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Invalidation during git learning
// ---------------------------------------------------------------------------

describe('invalidation during git learning', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hippo-inv-learn-'));
    initStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('invalidates old memories when learning a migration commit', () => {
    // Setup: create an existing memory about webpack
    const mem = createMemory('webpack config uses HtmlWebpackPlugin for output', {
      tags: ['webpack', 'build'],
    });
    writeEntry(tmpDir, mem);

    // Extract invalidation target from a migration commit message
    const target = extractInvalidationTarget('feat: migrate from webpack to vite');
    expect(target).not.toBeNull();
    expect(target!.from).toBe('webpack');
    expect(target!.to).toBe('vite');

    // Invalidate matching memories
    const result = invalidateMatching(tmpDir, target!);
    expect(result.invalidated).toBe(1);

    // Verify the old memory was weakened
    const updated = readEntry(tmpDir, mem.id);
    expect(updated).not.toBeNull();
    expect(updated!.tags).toContain('invalidated');
    expect(updated!.confidence).toBe('stale');
    expect(updated!.half_life_days).toBeLessThan(mem.half_life_days);
  });

  it('does not invalidate memories for non-migration commits', () => {
    const mem = createMemory('webpack config uses HtmlWebpackPlugin for output', {
      tags: ['webpack', 'build'],
    });
    writeEntry(tmpDir, mem);

    const target = extractInvalidationTarget('fix: correct off-by-one in pagination');
    expect(target).toBeNull();

    // Memory should remain unchanged
    const updated = readEntry(tmpDir, mem.id);
    expect(updated!.tags).not.toContain('invalidated');
    expect(updated!.half_life_days).toBe(mem.half_life_days);
  });
});
