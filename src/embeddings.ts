/**
 * Optional embedding-based semantic search using @xenova/transformers.
 * If the library is not installed, all functions degrade gracefully.
 * Zero required dependencies.
 */

import * as fs from 'fs';
import * as path from 'path';
import { MemoryEntry } from './memory.js';

const EMBEDDING_INDEX_FILE = 'embeddings.json';
const DEFAULT_MODEL = 'Xenova/all-MiniLM-L6-v2';

// ---------------------------------------------------------------------------
// Availability check
// ---------------------------------------------------------------------------

let _available: boolean | null = null;
let _pipeline: ((text: string) => Promise<{ data: Float32Array }>) | null = null;

/**
 * Check (once) whether @xenova/transformers is importable.
 * Caches the result so subsequent calls are instant.
 */
export async function isEmbeddingAvailable(): Promise<boolean> {
  if (_available !== null) return _available;

  try {
    // Dynamic import - will throw if not installed
    const mod = await import('@xenova/transformers');
    // Warm up the pipeline with the default model
    const { pipeline } = mod as { pipeline: (task: string, model: string) => Promise<(text: string) => Promise<{ data: Float32Array }>> };
    _pipeline = await pipeline('feature-extraction', DEFAULT_MODEL);
    _available = true;
  } catch {
    _available = false;
  }

  return _available;
}

// ---------------------------------------------------------------------------
// Embedding generation
// ---------------------------------------------------------------------------

/**
 * Get embedding vector for a text string.
 * Throws if embeddings are not available - callers must check first.
 */
export async function getEmbedding(text: string): Promise<number[]> {
  if (!_available || !_pipeline) {
    throw new Error('Embeddings not available - install @xenova/transformers');
  }

  const output = await _pipeline(text);
  // output.data is a Float32Array; convert to plain number[]
  return Array.from(output.data);
}

// ---------------------------------------------------------------------------
// Cosine similarity
// ---------------------------------------------------------------------------

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ---------------------------------------------------------------------------
// Index persistence
// ---------------------------------------------------------------------------

export function loadEmbeddingIndex(hippoRoot: string): Record<string, number[]> {
  const indexPath = path.join(hippoRoot, EMBEDDING_INDEX_FILE);
  if (!fs.existsSync(indexPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(indexPath, 'utf8')) as Record<string, number[]>;
  } catch {
    return {};
  }
}

export function saveEmbeddingIndex(hippoRoot: string, index: Record<string, number[]>): void {
  const indexPath = path.join(hippoRoot, EMBEDDING_INDEX_FILE);
  fs.writeFileSync(indexPath, JSON.stringify(index), 'utf8');
}

// ---------------------------------------------------------------------------
// Per-entry embedding
// ---------------------------------------------------------------------------

/**
 * Embed a single memory entry and cache the vector.
 */
export async function embedMemory(hippoRoot: string, entry: MemoryEntry): Promise<void> {
  const available = await isEmbeddingAvailable();
  if (!available) return;

  const index = loadEmbeddingIndex(hippoRoot);
  if (index[entry.id]) return; // already embedded

  const vector = await getEmbedding(entry.content);
  index[entry.id] = vector;
  saveEmbeddingIndex(hippoRoot, index);
}

/**
 * Embed all entries that don't have a cached vector yet.
 * Returns the count of newly embedded entries.
 */
export async function embedAll(hippoRoot: string): Promise<number> {
  const available = await isEmbeddingAvailable();
  if (!available) return 0;

  // Import loadAllEntries lazily to avoid circular dep issues at module load
  const { loadAllEntries } = await import('./store.js');
  const entries = loadAllEntries(hippoRoot);
  const index = loadEmbeddingIndex(hippoRoot);

  let count = 0;
  for (const entry of entries) {
    if (index[entry.id]) continue;

    try {
      const vector = await getEmbedding(entry.content);
      index[entry.id] = vector;
      count++;
    } catch {
      // Skip individual failures silently
    }
  }

  if (count > 0) saveEmbeddingIndex(hippoRoot, index);
  return count;
}
