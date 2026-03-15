/**
 * Hippo public API - re-exports for programmatic use.
 */

export { MemoryEntry, Layer, EmotionalValence, calculateStrength, createMemory, applyOutcome, generateId } from './memory.js';
export { search, hybridSearch, markRetrieved, estimateTokens, textOverlap, SearchResult } from './search.js';
export { initStore, loadAllEntries, writeEntry, readEntry, deleteEntry, loadIndex, rebuildIndex } from './store.js';
export { consolidate, ConsolidationResult } from './consolidate.js';
export { captureError, extractLessons, deduplicateLesson } from './autolearn.js';
export {
  getGlobalRoot,
  initGlobal,
  promoteToGlobal,
  searchBoth,
  syncGlobalToLocal,
} from './shared.js';
export {
  isEmbeddingAvailable,
  getEmbedding,
  cosineSimilarity,
  loadEmbeddingIndex,
  saveEmbeddingIndex,
  embedMemory,
  embedAll,
} from './embeddings.js';
export { loadConfig, saveConfig, HippoConfig } from './config.js';
