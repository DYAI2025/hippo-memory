import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { extractInvalidationTarget, invalidateMatching } from '../src/invalidation.js';
import { initStore, writeEntry, readEntry } from '../src/store.js';
import { createMemory } from '../src/memory.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('extractInvalidationTarget', () => {
  it('extracts "from" target in "migrate X to Y"', () => {
    const result = extractInvalidationTarget('feat: migrate from REST to GraphQL');
    expect(result).toEqual({ from: 'REST', to: 'GraphQL', type: 'migration' });
  });

  it('extracts "from" target in "replace X with Y"', () => {
    const result = extractInvalidationTarget('refactor: replace Moment.js with date-fns');
    expect(result).toEqual({ from: 'Moment.js', to: 'date-fns', type: 'migration' });
  });

  it('extracts target in "remove X"', () => {
    const result = extractInvalidationTarget('chore: remove legacy auth middleware');
    expect(result).toEqual({ from: 'legacy auth middleware', to: null, type: 'removal' });
  });

  it('extracts target in "drop X"', () => {
    const result = extractInvalidationTarget('breaking: drop Python 3.8 support');
    expect(result).toEqual({ from: 'Python 3.8 support', to: null, type: 'removal' });
  });

  it('extracts target in "deprecate X"', () => {
    const result = extractInvalidationTarget('chore: deprecate v1 API endpoints');
    expect(result).toEqual({ from: 'v1 API endpoints', to: null, type: 'deprecation' });
  });

  it('extracts "from X to Y" without verb prefix', () => {
    const result = extractInvalidationTarget('feat: switch from webpack to vite');
    expect(result).toEqual({ from: 'webpack', to: 'vite', type: 'migration' });
  });

  it('returns null for normal commits', () => {
    const result = extractInvalidationTarget('fix: correct off-by-one in pagination');
    expect(result).toBeNull();
  });

  it('returns null for ambiguous removals', () => {
    const result = extractInvalidationTarget('fix: remove extra whitespace');
    expect(result).toBeNull();
  });
});

describe('invalidateMatching', () => {
  let tmpDir: string;
  let hippoRoot: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hippo-invalidation-'));
    hippoRoot = path.join(tmpDir, '.hippo');
    initStore(hippoRoot);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('weakens memories matching the invalidation target', () => {
    const mem = createMemory('REST API endpoint /users returns paginated results', {
      tags: ['api', 'rest'],
    });
    writeEntry(hippoRoot, mem);

    const result = invalidateMatching(hippoRoot, { from: 'REST', to: 'GraphQL', type: 'migration' });

    expect(result.invalidated).toBe(1);
    const updated = readEntry(hippoRoot, mem.id);
    expect(updated!.confidence).toBe('stale');
    expect(updated!.tags).toContain('invalidated');
    expect(updated!.half_life_days).toBeLessThan(mem.half_life_days);
  });

  it('does not touch unrelated memories', () => {
    const mem = createMemory('Database connection pool max is 20', {
      tags: ['database'],
    });
    writeEntry(hippoRoot, mem);

    const result = invalidateMatching(hippoRoot, { from: 'REST', to: 'GraphQL', type: 'migration' });

    expect(result.invalidated).toBe(0);
    const updated = readEntry(hippoRoot, mem.id);
    expect(updated!.half_life_days).toBe(mem.half_life_days);
  });

  it('does not touch pinned memories', () => {
    const mem = createMemory('REST API uses OAuth2 tokens', {
      tags: ['api', 'rest'],
      pinned: true,
    });
    writeEntry(hippoRoot, mem);

    const result = invalidateMatching(hippoRoot, { from: 'REST', to: 'GraphQL', type: 'migration' });

    expect(result.invalidated).toBe(0);
  });
});
