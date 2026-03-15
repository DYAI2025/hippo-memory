import { describe, it, expect } from 'vitest';
import { calculateStrength, createMemory, applyOutcome, Layer } from '../src/memory.js';

describe('Strength formula', () => {
  it('returns 1.0 for a pinned memory regardless of age', () => {
    const entry = createMemory('pinned fact', { pinned: true });
    const oldDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000); // 1 year ago
    // Manually age it
    const aged = { ...entry, last_retrieved: oldDate.toISOString() };
    expect(calculateStrength(aged)).toBe(1.0);
  });

  it('decays over time (no retrieval)', () => {
    const entry = createMemory('ephemeral note');
    const now = new Date();

    // Simulate 7 days passing (one full half-life for default)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const aged = { ...entry, last_retrieved: sevenDaysAgo.toISOString() };

    const s = calculateStrength(aged, now);
    // At half-life, base decay = 0.5; with retrieval_count=0 and neutral valence:
    // retrieval_boost = 1 + 0.1*log2(1) = 1
    // emotional_mult = 1.0
    // so s ≈ 0.5
    expect(s).toBeCloseTo(0.5, 1);
  });

  it('has higher strength when recently retrieved', () => {
    const now = new Date();
    const oldDate = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000); // 2 weeks ago

    const entry1 = createMemory('memory A', { layer: Layer.Episodic });
    const e1 = { ...entry1, last_retrieved: now.toISOString(), retrieval_count: 5 };
    const e2 = { ...entry1, last_retrieved: oldDate.toISOString(), retrieval_count: 0 };

    expect(calculateStrength(e1, now)).toBeGreaterThan(calculateStrength(e2, now));
  });

  it('error-tagged memory has longer half-life', () => {
    const errorMem = createMemory('cache failure', { tags: ['error'] });
    const neutralMem = createMemory('some info');

    expect(errorMem.half_life_days).toBeGreaterThan(neutralMem.half_life_days);
  });

  it('emotional multiplier boosts strength for critical memories', () => {
    const now = new Date();
    // Age the memories by 10 days so decay < 1, giving emotional multiplier room to show
    const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();

    const critical = createMemory('critical failure', { emotional_valence: 'critical' });
    const neutral = createMemory('neutral note', { emotional_valence: 'neutral' });

    const crit = { ...critical, last_retrieved: tenDaysAgo };
    const neut = { ...neutral, last_retrieved: tenDaysAgo };

    // Both have same decay, but critical has 2x emotional multiplier
    expect(calculateStrength(crit, now)).toBeGreaterThan(calculateStrength(neut, now));
  });

  it('strength is clamped to [0, 1]', () => {
    const entry = createMemory('test', { emotional_valence: 'critical', pinned: false });
    const s = calculateStrength(entry);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });
});

describe('applyOutcome', () => {
  it('positive outcome increases half-life by 5', () => {
    const entry = createMemory('some memory');
    const before = entry.half_life_days;
    const updated = applyOutcome(entry, true);
    expect(updated.half_life_days).toBe(before + 5);
    expect(updated.outcome_score).toBe(1);
  });

  it('negative outcome decreases half-life by 3', () => {
    const entry = createMemory('some memory');
    const before = entry.half_life_days;
    const updated = applyOutcome(entry, false);
    expect(updated.half_life_days).toBe(before - 3);
    expect(updated.outcome_score).toBe(-1);
  });

  it('half-life never drops below 1', () => {
    const entry = createMemory('new note');
    const low = { ...entry, half_life_days: 2 };
    const updated = applyOutcome(low, false);
    expect(updated.half_life_days).toBeGreaterThanOrEqual(1);
  });
});
