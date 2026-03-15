import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  initStore,
  writeEntry,
  readEntry,
  deleteEntry,
  loadAllEntries,
  loadIndex,
  rebuildIndex,
} from '../src/store.js';
import { createMemory, Layer } from '../src/memory.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hippo-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('remember + recall round-trip', () => {
  it('writes a memory and reads it back intact', () => {
    initStore(tmpDir);

    const entry = createMemory('FRED cache silently dropped TIPS', {
      tags: ['error', 'data-pipeline'],
      layer: Layer.Episodic,
    });

    writeEntry(tmpDir, entry);

    const loaded = readEntry(tmpDir, entry.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(entry.id);
    expect(loaded!.content).toBe('FRED cache silently dropped TIPS');
    expect(loaded!.tags).toContain('error');
    expect(loaded!.tags).toContain('data-pipeline');
    expect(loaded!.layer).toBe(Layer.Episodic);
  });

  it('preserves numeric fields accurately', () => {
    initStore(tmpDir);

    const entry = createMemory('test memory');
    const custom = { ...entry, retrieval_count: 7, half_life_days: 14, strength: 0.7654 };
    writeEntry(tmpDir, custom);

    const loaded = readEntry(tmpDir, entry.id);
    expect(loaded!.retrieval_count).toBe(7);
    expect(loaded!.half_life_days).toBe(14);
    expect(loaded!.strength).toBeCloseTo(0.7654, 3);
  });

  it('handles pinned flag correctly', () => {
    initStore(tmpDir);

    const entry = createMemory('pinned rule', { pinned: true });
    writeEntry(tmpDir, entry);

    const loaded = readEntry(tmpDir, entry.id);
    expect(loaded!.pinned).toBe(true);
  });

  it('returns null for non-existent id', () => {
    initStore(tmpDir);
    expect(readEntry(tmpDir, 'mem_nonexistent')).toBeNull();
  });
});

describe('index management', () => {
  it('updates index on write', () => {
    initStore(tmpDir);
    const entry = createMemory('index test');
    writeEntry(tmpDir, entry);

    const index = loadIndex(tmpDir);
    expect(index.entries[entry.id]).toBeDefined();
    expect(index.entries[entry.id].id).toBe(entry.id);
  });

  it('removes from index on delete', () => {
    initStore(tmpDir);
    const entry = createMemory('delete me');
    writeEntry(tmpDir, entry);

    deleteEntry(tmpDir, entry.id);

    const index = loadIndex(tmpDir);
    expect(index.entries[entry.id]).toBeUndefined();
  });

  it('rebuild restores index from disk', () => {
    initStore(tmpDir);

    const e1 = createMemory('memory one');
    const e2 = createMemory('memory two');
    writeEntry(tmpDir, e1);
    writeEntry(tmpDir, e2);

    // Corrupt the index
    const indexPath = path.join(tmpDir, 'index.json');
    fs.writeFileSync(indexPath, JSON.stringify({ version: 1, entries: {}, last_retrieval_ids: [] }));

    rebuildIndex(tmpDir);

    const index = loadIndex(tmpDir);
    expect(Object.keys(index.entries)).toHaveLength(2);
    expect(index.entries[e1.id]).toBeDefined();
    expect(index.entries[e2.id]).toBeDefined();
  });
});

describe('loadAllEntries', () => {
  it('returns all stored entries', () => {
    initStore(tmpDir);
    const entries = [
      createMemory('first'),
      createMemory('second'),
      createMemory('third'),
    ];
    for (const e of entries) writeEntry(tmpDir, e);

    const all = loadAllEntries(tmpDir);
    expect(all).toHaveLength(3);
  });

  it('returns empty array for fresh store', () => {
    initStore(tmpDir);
    expect(loadAllEntries(tmpDir)).toHaveLength(0);
  });
});
