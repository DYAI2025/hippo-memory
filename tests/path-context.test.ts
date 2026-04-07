import { describe, it, expect } from 'vitest';
import { extractPathTags, pathOverlapScore } from '../src/path-context.js';

describe('extractPathTags', () => {
  it('extracts meaningful segments from Unix path', () => {
    const tags = extractPathTags('/home/user/projects/my-app/src/api');
    expect(tags).toContain('path:projects');
    expect(tags).toContain('path:my-app');
    expect(tags).toContain('path:src');
    expect(tags).toContain('path:api');
    expect(tags).not.toContain('path:home');
    expect(tags).not.toContain('path:user');
  });

  it('extracts meaningful segments from Windows path', () => {
    const tags = extractPathTags('C:\\Users\\dev\\projects\\hippo\\src');
    expect(tags).toContain('path:projects');
    expect(tags).toContain('path:hippo');
    expect(tags).toContain('path:src');
    expect(tags).not.toContain('path:users');
    expect(tags).not.toContain('path:c:');
  });

  it('filters noise directories', () => {
    const tags = extractPathTags('/home/user/node_modules/.git/dist');
    expect(tags).not.toContain('path:node_modules');
    expect(tags).not.toContain('path:.git');
    expect(tags).not.toContain('path:dist');
  });

  it('keeps last 4 meaningful segments', () => {
    const tags = extractPathTags('/aa/bb/cc/dd/ee/ff/gg/hh');
    expect(tags).toHaveLength(4);
    expect(tags).toContain('path:ee');
    expect(tags).toContain('path:ff');
    expect(tags).toContain('path:gg');
    expect(tags).toContain('path:hh');
  });

  it('returns empty for root or trivial paths', () => {
    const tags = extractPathTags('/');
    expect(tags).toHaveLength(0);
  });
});

describe('pathOverlapScore', () => {
  it('returns 1.0 for exact match', () => {
    const tags = ['path:src', 'path:api'];
    expect(pathOverlapScore(tags, tags)).toBe(1.0);
  });

  it('returns partial score for partial match', () => {
    const memTags = ['path:my-app', 'path:src', 'path:api'];
    const curTags = ['path:my-app', 'path:src', 'path:tests'];
    const score = pathOverlapScore(memTags, curTags);
    expect(score).toBeCloseTo(2/3);
  });

  it('returns 0 for no match', () => {
    const memTags = ['path:frontend', 'path:components'];
    const curTags = ['path:backend', 'path:api'];
    expect(pathOverlapScore(memTags, curTags)).toBe(0);
  });

  it('returns 0 when either has no path tags', () => {
    expect(pathOverlapScore([], ['path:src'])).toBe(0);
    expect(pathOverlapScore(['path:src'], [])).toBe(0);
  });
});
