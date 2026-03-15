/**
 * Cross-agent shared memory via a global ~/.hippo store.
 * Zero required dependencies.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MemoryEntry } from './memory.js';
import { initStore, loadAllEntries, readEntry, writeEntry } from './store.js';
import { search, SearchResult } from './search.js';

// ---------------------------------------------------------------------------
// Global root
// ---------------------------------------------------------------------------

export function getGlobalRoot(): string {
  return path.join(os.homedir(), '.hippo');
}

export function initGlobal(): void {
  initStore(getGlobalRoot());
}

// ---------------------------------------------------------------------------
// promoteToGlobal
// ---------------------------------------------------------------------------

/**
 * Copy a local memory entry into the global store.
 * The entry keeps its original ID - callers should detect conflicts.
 */
export function promoteToGlobal(localRoot: string, id: string): MemoryEntry {
  const entry = readEntry(localRoot, id);
  if (!entry) throw new Error(`Memory not found in local store: ${id}`);

  const globalRoot = getGlobalRoot();
  if (!fs.existsSync(globalRoot)) initGlobal();

  writeEntry(globalRoot, entry);
  return entry;
}

// ---------------------------------------------------------------------------
// searchBoth
// ---------------------------------------------------------------------------

/**
 * Search both local and global stores.
 * Local results are boosted by 1.2x to prefer project-specific memories.
 * Returns a merged list sorted by score descending, respecting token budget.
 */
export function searchBoth(
  query: string,
  localRoot: string,
  globalRoot: string,
  options: { budget?: number; now?: Date } = {}
): SearchResult[] {
  const budget = options.budget ?? 4000;
  const now = options.now ?? new Date();

  const localEntries = fs.existsSync(localRoot) ? loadAllEntries(localRoot) : [];
  const globalEntries = fs.existsSync(globalRoot) ? loadAllEntries(globalRoot) : [];

  // Tag global entries so callers can distinguish them later
  const taggedGlobal = globalEntries.map((e) => ({ ...e, source: `global:${e.source}` }));

  const localResults = search(query, localEntries, { budget, now }).map((r) => ({
    ...r,
    score: r.score * 1.2,
    isGlobal: false,
  }));

  const globalResults = search(query, taggedGlobal, { budget, now }).map((r) => ({
    ...r,
    isGlobal: true,
  }));

  // Merge, deduplicate by ID (local wins), sort by score
  const seen = new Set<string>();
  const merged: Array<SearchResult & { isGlobal: boolean }> = [];

  for (const r of [...localResults, ...globalResults]) {
    if (seen.has(r.entry.id)) continue;
    seen.add(r.entry.id);
    merged.push(r);
  }

  merged.sort((a, b) => b.score - a.score);

  // Respect token budget across merged set
  const results: Array<SearchResult & { isGlobal: boolean }> = [];
  let usedTokens = 0;

  for (const r of merged) {
    if (usedTokens + r.tokens > budget) continue;
    results.push(r);
    usedTokens += r.tokens;
  }

  return results;
}

// ---------------------------------------------------------------------------
// syncGlobalToLocal
// ---------------------------------------------------------------------------

/**
 * Pull all entries from global store into local store.
 * Skips entries already present in local (by ID).
 * Returns the count of newly copied entries.
 */
export function syncGlobalToLocal(localRoot: string, globalRoot: string): number {
  if (!fs.existsSync(globalRoot)) return 0;

  const globalEntries = loadAllEntries(globalRoot);
  const localEntries = loadAllEntries(localRoot);
  const localIds = new Set(localEntries.map((e) => e.id));

  let copied = 0;
  for (const entry of globalEntries) {
    if (localIds.has(entry.id)) continue;
    writeEntry(localRoot, entry);
    copied++;
  }

  return copied;
}
