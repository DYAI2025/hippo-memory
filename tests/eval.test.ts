import { describe, it, expect } from 'vitest';
import { mrr, recallAtK, ndcgAtK, runEval, bootstrapCorpus } from '../src/eval.js';
import { createMemory } from '../src/memory.js';

// ---------------------------------------------------------------------------
// Metric math — hand-computed expected values
// ---------------------------------------------------------------------------

describe('mrr', () => {
  it('returns 1 when the first result is relevant', () => {
    expect(mrr(['a', 'b', 'c'], ['a'])).toBe(1);
  });

  it('returns 1/rank when a relevant item is further down', () => {
    expect(mrr(['x', 'y', 'a'], ['a'])).toBe(1 / 3);
    expect(mrr(['x', 'a', 'y'], ['a'])).toBe(1 / 2);
  });

  it('returns 0 when no relevant item is in the list', () => {
    expect(mrr(['x', 'y', 'z'], ['a'])).toBe(0);
  });

  it('uses only the first relevant hit, not the highest-ranked repeat', () => {
    expect(mrr(['x', 'a', 'b'], ['a', 'b'])).toBe(1 / 2);
  });

  it('returns 0 when expected is empty', () => {
    expect(mrr(['a', 'b'], [])).toBe(0);
  });
});

describe('recallAtK', () => {
  it('counts fraction of expected found in top-K', () => {
    expect(recallAtK(['a', 'b', 'c'], ['a', 'b'], 5)).toBe(1);
    expect(recallAtK(['a', 'x', 'y'], ['a', 'b'], 5)).toBe(1 / 2);
    expect(recallAtK(['x', 'y', 'z'], ['a', 'b'], 5)).toBe(0);
  });

  it('is bounded by K', () => {
    // Expected 'b' is at position 4 (0-indexed=3), outside top-3
    expect(recallAtK(['x', 'a', 'y', 'b'], ['a', 'b'], 3)).toBe(1 / 2);
  });

  it('returns 0 when expected is empty', () => {
    expect(recallAtK(['a'], [], 5)).toBe(0);
  });
});

describe('ndcgAtK', () => {
  it('returns 1 when relevant items are at top positions', () => {
    // expected at positions 0 and 1 = ideal ranking
    expect(ndcgAtK(['a', 'b', 'x', 'y'], ['a', 'b'], 10)).toBeCloseTo(1, 6);
  });

  it('penalises relevant items at lower positions', () => {
    // single relevant at position 3 (discount log2(5)) vs ideal at position 1 (log2(2))
    const result = ndcgAtK(['x', 'y', 'z', 'a'], ['a'], 10);
    expect(result).toBeCloseTo((1 / Math.log2(5)) / (1 / Math.log2(2)), 6);
    expect(result).toBeLessThan(1);
  });

  it('returns 0 when no relevant items in top-K', () => {
    expect(ndcgAtK(['x', 'y'], ['a'], 10)).toBe(0);
  });

  it('caps IDCG at K even when expected has more items', () => {
    // Expected has 5 items, K=2 → ideal can fit only 2
    const result = ndcgAtK(['a', 'b'], ['a', 'b', 'c', 'd', 'e'], 2);
    expect(result).toBeCloseTo(1, 6);
  });
});

// ---------------------------------------------------------------------------
// runEval end-to-end on an in-memory store
// ---------------------------------------------------------------------------

describe('runEval', () => {
  it('scores per-case and aggregates summary metrics', async () => {
    const m1 = createMemory('FRED cache silently dropped the TIPS series');
    const m2 = createMemory('Python dict ordering is guaranteed in 3.7+');
    const m3 = createMemory('backfill script skipped rows before 2023-01-01');
    const entries = [m1, m2, m3];

    const cases = [
      { id: 'c1', query: 'FRED cache TIPS', expectedIds: [m1.id] },
      { id: 'c2', query: 'Python dict ordering', expectedIds: [m2.id] },
    ];

    const summary = await runEval(cases, entries);
    expect(summary.cases).toHaveLength(2);
    expect(summary.meanMrr).toBe(1);           // both cases hit at rank 1
    expect(summary.meanRecallAt5).toBe(1);
    expect(summary.meanNdcgAt10).toBeCloseTo(1, 6);
    expect(summary.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('reports zero metrics when no expected id is recalled', async () => {
    const m1 = createMemory('FRED cache silently dropped the TIPS series');
    const cases = [
      { id: 'c1', query: 'unrelated query that matches nothing', expectedIds: ['mem_nonexistent'] },
    ];
    const summary = await runEval(cases, [m1]);
    expect(summary.meanMrr).toBe(0);
    expect(summary.meanRecallAt10).toBe(0);
    expect(summary.meanNdcgAt10).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// bootstrapCorpus
// ---------------------------------------------------------------------------

describe('bootstrapCorpus', () => {
  it('produces one case per memory with opening-words query and its id expected', () => {
    const m1 = createMemory('The FRED cache silently dropped the TIPS series after refresh');
    const m2 = createMemory('Python dict ordering is guaranteed in Python 3.7+');
    const corpus = bootstrapCorpus([m1, m2]);
    expect(corpus).toHaveLength(2);
    expect(corpus[0].expectedIds).toEqual([m1.id]);
    expect(corpus[0].query.split(/\s+/).length).toBeLessThanOrEqual(8);
  });

  it('skips memories with fewer than 3 substantive words', () => {
    // "fix now" = 2 substantive words (>2 chars each), so filtered out
    const tiny = createMemory('fix now');
    const full = createMemory('The cache reliably drops entries under load');
    const corpus = bootstrapCorpus([tiny, full]);
    expect(corpus).toHaveLength(1);
    expect(corpus[0].expectedIds).toEqual([full.id]);
  });

  it('respects maxCases cap', () => {
    const entries = Array.from({ length: 10 }, (_, i) =>
      createMemory(`memory number ${i} about various topics here`),
    );
    const corpus = bootstrapCorpus(entries, 3);
    expect(corpus).toHaveLength(3);
  });
});
