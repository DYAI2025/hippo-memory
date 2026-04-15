import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { consolidate } from '../src/consolidate.js';
import { initStore, writeEntry, loadAllEntries, readEntry, listMemoryConflicts } from '../src/store.js';
import { createMemory, Layer } from '../src/memory.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hippo-consolidate-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('Decay pass', () => {
  it('removes entries below the strength threshold', () => {
    initStore(tmpDir);

    // Create an entry that's very old (strength will be effectively 0)
    const entry = createMemory('ancient memory');
    const veryOldDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000 * 10).toISOString(); // 10 years
    const ancient = { ...entry, last_retrieved: veryOldDate, pinned: false };
    writeEntry(tmpDir, ancient);

    const result = consolidate(tmpDir, { now: new Date() });
    expect(result.removed).toBeGreaterThan(0);

    const remaining = loadAllEntries(tmpDir);
    expect(remaining.find((e) => e.id === ancient.id)).toBeUndefined();
  });

  it('keeps pinned entries regardless of age', () => {
    initStore(tmpDir);

    const entry = createMemory('permanent rule', { pinned: true });
    const veryOldDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000 * 10).toISOString();
    const ancient = { ...entry, last_retrieved: veryOldDate, pinned: true };
    writeEntry(tmpDir, ancient);

    const result = consolidate(tmpDir, { now: new Date() });

    const remaining = loadAllEntries(tmpDir);
    const found = remaining.find((e) => e.id === ancient.id);
    expect(found).toBeDefined();
  });

  it('dry-run does not remove entries', () => {
    initStore(tmpDir);

    const entry = createMemory('ancient memory');
    const veryOldDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000 * 10).toISOString();
    const ancient = { ...entry, last_retrieved: veryOldDate, pinned: false };
    writeEntry(tmpDir, ancient);

    const result = consolidate(tmpDir, { dryRun: true, now: new Date() });
    expect(result.dryRun).toBe(true);
    expect(result.removed).toBeGreaterThan(0);

    // Entry should still be on disk
    const remaining = loadAllEntries(tmpDir);
    expect(remaining.find((e) => e.id === ancient.id)).toBeDefined();
  });

  it('persists stale confidence for old non-verified memories during sleep', () => {
    initStore(tmpDir);

    const entry = createMemory('stale memory candidate', { confidence: 'observed', tags: ['error'] });
    const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    const staleCandidate = { ...entry, last_retrieved: oldDate, confidence: 'observed' as const };
    writeEntry(tmpDir, staleCandidate);

    consolidate(tmpDir, { now: new Date() });

    const loaded = readEntry(tmpDir, staleCandidate.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.confidence).toBe('stale');
  });
});

describe('Merge pass', () => {
  it('merges highly similar episodic entries into a semantic memory', () => {
    initStore(tmpDir);

    // Two very similar episodic entries
    const e1 = createMemory('cache refresh failure data pipeline error', { layer: Layer.Episodic });
    const e2 = createMemory('cache refresh failure data pipeline problem', { layer: Layer.Episodic });
    writeEntry(tmpDir, e1);
    writeEntry(tmpDir, e2);

    const result = consolidate(tmpDir, { now: new Date() });

    expect(result.merged).toBeGreaterThan(0);
    expect(result.semanticCreated).toBeGreaterThan(0);

    const all = loadAllEntries(tmpDir);
    const semantics = all.filter((e) => e.layer === Layer.Semantic);
    expect(semantics.length).toBeGreaterThan(0);
  });

  it('does not merge dissimilar entries', () => {
    initStore(tmpDir);

    const e1 = createMemory('Python dict ordering is guaranteed since 3.7', { layer: Layer.Episodic });
    const e2 = createMemory('Gold model uses TIPS 10y inflation signal', { layer: Layer.Episodic });
    writeEntry(tmpDir, e1);
    writeEntry(tmpDir, e2);

    const result = consolidate(tmpDir, { now: new Date() });
    expect(result.merged).toBe(0);
    expect(result.semanticCreated).toBe(0);
  });

  it('detects overlapping contradictory memories and records open conflicts', () => {
    initStore(tmpDir);

    const a = createMemory('The feature flag is enabled for production users', {
      layer: Layer.Episodic,
      tags: ['feature-flag', 'prod'],
    });
    const b = createMemory('The feature flag is disabled for production users', {
      layer: Layer.Episodic,
      tags: ['feature-flag', 'prod'],
    });
    writeEntry(tmpDir, a);
    writeEntry(tmpDir, b);

    consolidate(tmpDir, { now: new Date() });

    const conflicts = listMemoryConflicts(tmpDir);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].reason).toMatch(/enabled\/disabled mismatch|negation polarity mismatch/i);

    const loadedA = readEntry(tmpDir, a.id);
    const loadedB = readEntry(tmpDir, b.id);
    expect(loadedA?.conflicts_with).toContain(b.id);
    expect(loadedB?.conflicts_with).toContain(a.id);
  });

  it('detects reworded contradictions, not just near-duplicate wording', () => {
    initStore(tmpDir);

    const a = createMemory('API auth must be enabled in prod', {
      layer: Layer.Episodic,
      tags: ['auth', 'prod'],
    });
    const b = createMemory('Disable API auth in prod', {
      layer: Layer.Episodic,
      tags: ['auth', 'prod'],
    });
    writeEntry(tmpDir, a);
    writeEntry(tmpDir, b);

    consolidate(tmpDir, { now: new Date() });

    const conflicts = listMemoryConflicts(tmpDir);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].reason).toMatch(/enabled\/disabled mismatch|always\/never mismatch|negation polarity mismatch/i);
  });

  it('preserves contradiction detection across multiple polarity patterns', () => {
    initStore(tmpDir);

    const pairs = [
      [
        'Always use Sled for local storage',
        'Never use Sled for local storage',
      ],
      [
        'API auth must be enabled in prod',
        'Disable API auth in prod',
      ],
      [
        'Production deploys must require approval',
        'Production deploys should not require approval',
      ],
      [
        'Metrics endpoint is available in staging',
        'Metrics endpoint is missing in staging',
      ],
      [
        'Background sync works on iOS',
        'Background sync is broken on iOS',
      ],
    ] as const;

    for (const [left, right] of pairs) {
      const caseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hippo-consolidate-case-'));
      try {
        initStore(caseDir);

        const a = createMemory(left, { layer: Layer.Episodic, tags: ['conflict-check'] });
        const b = createMemory(right, { layer: Layer.Episodic, tags: ['conflict-check'] });
        writeEntry(caseDir, a);
        writeEntry(caseDir, b);

        consolidate(caseDir, { now: new Date() });

        const conflicts = listMemoryConflicts(caseDir);
        expect(conflicts, `${left} <> ${right}`).toHaveLength(1);
      } finally {
        fs.rmSync(caseDir, { recursive: true, force: true });
      }
    }
  });

  it('does not flag unrelated policy memories just because they share tags and opposite polarity words', () => {
    initStore(tmpDir);

    const a = createMemory('Always create a worktree when working in exemem-workspace', {
      layer: Layer.Episodic,
      tags: ['feedback', 'policy'],
    });
    const b = createMemory('Never touch other agents worktrees', {
      layer: Layer.Episodic,
      tags: ['feedback', 'policy'],
    });
    writeEntry(tmpDir, a);
    writeEntry(tmpDir, b);

    consolidate(tmpDir, { now: new Date() });

    expect(listMemoryConflicts(tmpDir)).toHaveLength(0);
    expect(readEntry(tmpDir, a.id)?.conflicts_with ?? []).toEqual([]);
    expect(readEntry(tmpDir, b.id)?.conflicts_with ?? []).toEqual([]);
  });

  it('does not flag the unrelated wording pairs reported in PR #11', () => {
    initStore(tmpDir);

    const pairs = [
      [
        'Always create a worktree when working in exemem-workspace',
        "Don't touch other agents' worktrees",
      ],
      [
        'Schema service owns schema creation',
        'Schemas are global',
      ],
      [
        'Multi-node dogfood snapshots',
        'Dogfood database snapshot',
      ],
    ] as const;

    const ids = pairs.flatMap(([left, right], index) => {
      const leftEntry = createMemory(left, {
        layer: Layer.Episodic,
        tags: [`pair-${index}`, 'feedback', 'policy'],
      });
      const rightEntry = createMemory(right, {
        layer: Layer.Episodic,
        tags: [`pair-${index}`, 'feedback', 'policy'],
      });
      writeEntry(tmpDir, leftEntry);
      writeEntry(tmpDir, rightEntry);
      return [leftEntry.id, rightEntry.id];
    });

    consolidate(tmpDir, { now: new Date() });

    expect(listMemoryConflicts(tmpDir)).toHaveLength(0);
    for (const id of ids) {
      expect(readEntry(tmpDir, id)?.conflicts_with ?? []).toEqual([]);
    }
  });

  it('resolves open conflicts when the contradiction disappears', () => {
    initStore(tmpDir);

    const a = createMemory('The feature flag is enabled for production users', {
      layer: Layer.Episodic,
      tags: ['feature-flag', 'prod'],
    });
    const b = createMemory('The feature flag is disabled for production users', {
      layer: Layer.Episodic,
      tags: ['feature-flag', 'prod'],
    });
    writeEntry(tmpDir, a);
    writeEntry(tmpDir, b);

    consolidate(tmpDir, { now: new Date() });
    expect(listMemoryConflicts(tmpDir)).toHaveLength(1);

    writeEntry(tmpDir, { ...b, content: 'The feature flag is enabled for production users' });
    consolidate(tmpDir, { now: new Date() });

    expect(listMemoryConflicts(tmpDir)).toHaveLength(0);
    expect(readEntry(tmpDir, a.id)?.conflicts_with ?? []).toEqual([]);
    expect(readEntry(tmpDir, b.id)?.conflicts_with ?? []).toEqual([]);
  });
});
