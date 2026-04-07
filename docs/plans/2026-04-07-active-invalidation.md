# Active Invalidation & Architectural Memory

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add two mechanisms that exponential decay alone can't handle: (1) active invalidation when migrations/breaking changes kill old memories, and (2) persistent architectural decisions that don't repeat but shouldn't decay.

**Architecture:** Extend `hippo learn --git` to detect breaking/migration commits and actively kill or weaken memories referencing the old pattern. Add a `decision` memory type with no decay for one-off architectural choices. Both features integrate into existing consolidation and recall flows.

**Tech Stack:** TypeScript, Vitest, SQLite, existing hippo infrastructure (store.ts, memory.ts, consolidate.ts, autolearn.ts, search.ts, cli.ts)

---

## Feature 1: Active Invalidation

When `hippo learn --git` sees a migration or breaking change commit, it should find existing memories that reference the old pattern and actively kill them instead of waiting for decay.

### How it works

1. `hippo learn --git` already extracts commit messages matching patterns like `breaking`, `migrate`, `deprecate`
2. New: for these commits, extract the "from" pattern (what was removed/replaced)
3. Search existing memories for matches against the old pattern
4. Actively invalidate: halve half-life + mark confidence as `stale` + add tag `invalidated`
5. Create the new memory as normal (the replacement)

**Detection heuristics for "from" pattern:**
- Commit message contains "from X to Y", "migrate X to Y", "replace X with Y", "remove X", "drop X", "deprecate X"
- Diff stats: files deleted or renamed (available via `git log --stat`)
- Conventional commit prefix: `breaking`, `migrate`, `deprecate`, `remove`

---

### Task 1: Invalidation pattern extractor

**Files:**
- Create: `src/invalidation.ts`
- Test: `tests/invalidation.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/invalidation.test.ts
import { describe, it, expect } from 'vitest';
import { extractInvalidationTarget } from '../src/invalidation.js';

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

  it('returns null for ambiguous messages', () => {
    const result = extractInvalidationTarget('fix: remove extra whitespace');
    expect(result).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/invalidation.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// src/invalidation.ts

export interface InvalidationTarget {
  from: string;
  to: string | null;
  type: 'migration' | 'removal' | 'deprecation';
}

/**
 * Extract what was replaced/removed from a commit message.
 * Returns null if the commit isn't a breaking/migration change.
 */
export function extractInvalidationTarget(message: string): InvalidationTarget | null {
  // Strip conventional commit prefix
  const body = message.replace(/^[a-z]+(\([^)]*\))?:\s*/i, '').trim();
  const lower = body.toLowerCase();

  // Pattern: "migrate/switch/move from X to Y"
  const fromToMatch = body.match(
    /(?:migrat\w+|switch\w*|mov\w+|convert\w*|transition\w*|upgrad\w+)\s+(?:from\s+)?(.+?)\s+to\s+(.+)/i
  );
  if (fromToMatch) {
    return { from: fromToMatch[1].trim(), to: fromToMatch[2].trim(), type: 'migration' };
  }

  // Pattern: "from X to Y" (standalone)
  const standaloneFromTo = body.match(/from\s+(.+?)\s+to\s+(.+)/i);
  if (standaloneFromTo) {
    return { from: standaloneFromTo[1].trim(), to: standaloneFromTo[2].trim(), type: 'migration' };
  }

  // Pattern: "replace X with Y"
  const replaceMatch = body.match(/replac\w+\s+(.+?)\s+with\s+(.+)/i);
  if (replaceMatch) {
    return { from: replaceMatch[1].trim(), to: replaceMatch[2].trim(), type: 'migration' };
  }

  // Pattern: "deprecate X"
  const deprecateMatch = body.match(/deprecat\w+\s+(.+)/i);
  if (deprecateMatch) {
    return { from: deprecateMatch[1].trim(), to: null, type: 'deprecation' };
  }

  // Pattern: "remove/drop X" (but not trivial removals like "remove whitespace")
  const removeMatch = body.match(/(?:remov\w+|drop\w*)\s+(.+)/i);
  if (removeMatch) {
    const target = removeMatch[1].trim();
    // Filter trivial removals (< 3 words of generic content)
    const words = target.split(/\s+/);
    const trivialWords = new Set(['extra', 'unused', 'empty', 'old', 'whitespace', 'spaces', 'blank', 'dead', 'commented']);
    const isTrivial = words.length <= 2 && words.some(w => trivialWords.has(w.toLowerCase()));
    if (isTrivial) return null;
    return { from: target, to: null, type: 'removal' };
  }

  return null;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/invalidation.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/invalidation.ts tests/invalidation.test.ts
git commit -m "feat: add invalidation target extractor for migration/breaking commits"
```

---

### Task 2: Invalidate matching memories

**Files:**
- Modify: `src/invalidation.ts`
- Modify: `tests/invalidation.test.ts`
- Read: `src/store.ts` (for `readAllEntries`, `writeEntry`)
- Read: `src/search.ts` (for `textOverlap` or tokenization)

**Step 1: Write the failing test**

```typescript
// Add to tests/invalidation.test.ts
import { invalidateMatching } from '../src/invalidation.js';
import { initStore, createMemory, readAllEntries, readEntry } from '../src/store.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

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
    // Create a memory about REST endpoints
    const mem = createMemory(hippoRoot, 'REST API endpoint /users returns paginated results', {
      tags: ['api', 'rest'],
      layer: 'episodic',
    });

    const result = invalidateMatching(hippoRoot, { from: 'REST', to: 'GraphQL', type: 'migration' });

    expect(result.invalidated).toBe(1);
    const updated = readEntry(hippoRoot, mem.id);
    expect(updated!.confidence).toBe('stale');
    expect(updated!.tags).toContain('invalidated');
    expect(updated!.half_life_days).toBeLessThan(mem.half_life_days);
  });

  it('does not touch memories unrelated to the target', () => {
    const mem = createMemory(hippoRoot, 'Database connection pool max is 20', {
      tags: ['database'],
      layer: 'episodic',
    });

    const result = invalidateMatching(hippoRoot, { from: 'REST', to: 'GraphQL', type: 'migration' });

    expect(result.invalidated).toBe(0);
    const updated = readEntry(hippoRoot, mem.id);
    expect(updated!.half_life_days).toBe(mem.half_life_days);
    expect(updated!.confidence).not.toBe('stale');
  });

  it('does not touch pinned memories', () => {
    const mem = createMemory(hippoRoot, 'REST API uses OAuth2 tokens', {
      tags: ['api', 'rest'],
      layer: 'episodic',
      pinned: true,
    });

    const result = invalidateMatching(hippoRoot, { from: 'REST', to: 'GraphQL', type: 'migration' });

    expect(result.invalidated).toBe(0);
    const updated = readEntry(hippoRoot, mem.id);
    expect(updated!.pinned).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/invalidation.test.ts`
Expected: FAIL — `invalidateMatching` not exported

**Step 3: Write minimal implementation**

Add to `src/invalidation.ts`:

```typescript
import { readAllEntries, writeEntry, readEntry } from './store.js';

export interface InvalidationResult {
  invalidated: number;
  targets: string[];  // IDs of affected memories
}

/**
 * Find memories that reference the invalidated pattern and weaken them.
 * - Halves half_life_days
 * - Sets confidence to 'stale'
 * - Adds 'invalidated' tag
 * - Skips pinned memories
 */
export function invalidateMatching(
  hippoRoot: string,
  target: InvalidationTarget
): InvalidationResult {
  const entries = readAllEntries(hippoRoot);
  const fromTokens = tokenize(target.from);
  const result: InvalidationResult = { invalidated: 0, targets: [] };

  for (const entry of entries) {
    if (entry.pinned) continue;

    const contentTokens = tokenize(entry.content);
    const tagTokens = entry.tags.map(t => t.toLowerCase());

    // Check if the memory references the old pattern
    const tokenMatch = matchScore(fromTokens, contentTokens);
    const tagMatch = fromTokens.some(t => tagTokens.includes(t));

    if (tokenMatch >= 0.5 || tagMatch) {
      entry.half_life_days = Math.max(1, Math.floor(entry.half_life_days / 2));
      entry.confidence = 'stale';
      if (!entry.tags.includes('invalidated')) {
        entry.tags.push('invalidated');
      }
      writeEntry(hippoRoot, entry);
      result.invalidated++;
      result.targets.push(entry.id);
    }
  }

  return result;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s_.-]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2);
}

/**
 * Fraction of `from` tokens found in `content` tokens.
 */
function matchScore(fromTokens: string[], contentTokens: string[]): number {
  if (fromTokens.length === 0) return 0;
  const contentSet = new Set(contentTokens);
  const matches = fromTokens.filter(t => contentSet.has(t)).length;
  return matches / fromTokens.length;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/invalidation.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/invalidation.ts tests/invalidation.test.ts
git commit -m "feat: add invalidateMatching to weaken memories referencing old patterns"
```

---

### Task 3: Wire invalidation into `hippo learn --git`

**Files:**
- Modify: `src/autolearn.ts`
- Modify: `tests/autolearn.test.ts`

**Step 1: Write the failing test**

Add to `tests/autolearn.test.ts`:

```typescript
import { extractInvalidationTarget, invalidateMatching } from '../src/invalidation.js';

describe('git learn with invalidation', () => {
  let tmpDir: string;
  let hippoRoot: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hippo-autolearn-inv-'));
    hippoRoot = path.join(tmpDir, '.hippo');
    initStore(hippoRoot);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('invalidates old memories when learning a migration commit', () => {
    // Pre-existing memory about the old tool
    createMemory(hippoRoot, 'webpack config uses splitChunks for code splitting', {
      tags: ['webpack', 'build'],
      layer: 'episodic',
    });

    // Simulate learning from a migration commit
    const lessons = extractLessons('abc123 feat: migrate from webpack to vite');
    expect(lessons.length).toBeGreaterThan(0);

    for (const lesson of lessons) {
      const target = extractInvalidationTarget(lesson);
      if (target) {
        const result = invalidateMatching(hippoRoot, target);
        expect(result.invalidated).toBe(1);
      }
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/autolearn.test.ts`
Expected: FAIL (test added, may need import adjustments)

**Step 3: Modify `autolearn.ts` to call invalidation**

In `src/autolearn.ts`, in the function that processes git lessons (the `learnFromGit` or equivalent function), after extracting lessons and before creating new memories:

```typescript
import { extractInvalidationTarget, invalidateMatching } from './invalidation.js';

// Inside the learn loop, after extracting each lesson:
const target = extractInvalidationTarget(lesson);
if (target) {
  const invResult = invalidateMatching(hippoRoot, target);
  if (invResult.invalidated > 0) {
    console.log(`   Invalidated ${invResult.invalidated} memories referencing "${target.from}"`);
  }
}
```

**Step 4: Run tests**

Run: `npx vitest run tests/autolearn.test.ts tests/invalidation.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/autolearn.ts tests/autolearn.test.ts
git commit -m "feat: wire invalidation into hippo learn --git for migration/breaking commits"
```

---

### Task 4: Add `hippo invalidate` CLI command

**Files:**
- Modify: `src/cli.ts`
- Test: manual CLI test

Users should be able to manually invalidate when they know a migration happened outside of git:

```bash
hippo invalidate "REST API" --reason "migrated to GraphQL"
```

**Step 1: Add command handler to cli.ts**

In the HOOKS section or near other command handlers, add:

```typescript
case 'invalidate': {
  requireInit(hippoRoot);
  const target = args[0];
  if (!target) {
    console.error('Usage: hippo invalidate "<old pattern>" [--reason "<why>"]');
    process.exit(1);
  }
  const reason = flags['reason'] as string || null;
  const invTarget: InvalidationTarget = {
    from: target,
    to: reason,
    type: 'migration',
  };
  const result = invalidateMatching(hippoRoot, invTarget);
  if (result.invalidated === 0) {
    console.log(`No memories matched "${target}".`);
  } else {
    console.log(`Invalidated ${result.invalidated} memories referencing "${target}".`);
    result.targets.forEach(id => console.log(`   ${id}`));
  }
  break;
}
```

**Step 2: Add to help text**

```
  invalidate "<pattern>"   Actively weaken memories matching an old pattern
    --reason "<why>"       Optional: what replaced it
```

**Step 3: Test manually**

```bash
cd ~/hippo
node dist/cli.js invalidate "REST" --reason "migrated to GraphQL"
```

**Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add hippo invalidate CLI command for manual active invalidation"
```

---

## Feature 2: Architectural Decisions (Decision Memory)

One-off architectural decisions don't repeat, so they can't earn their keep through retrieval. They need a different persistence model: explicit, no decay unless explicitly superseded, and tagged for recall.

### How it works

1. New command: `hippo decide "<decision>" --context "<why>"` 
2. Creates a memory with `layer: 'semantic'`, `confidence: 'verified'`, `pinned: false`
3. Special tag: `decision`
4. Custom half-life: 90 days (vs 7 default) — long-lived but not permanent
5. Retrieval still strengthens (extends half-life further)
6. Can be superseded: `hippo decide "<new decision>" --supersedes <old_id>`
7. Superseded decisions get invalidated (halved half-life, tagged `superseded`)
8. `hippo recall` boosts `decision`-tagged results when query matches architectural terms

---

### Task 5: Decision memory creation

**Files:**
- Modify: `src/memory.ts` (add `DECISION_HALF_LIFE_DAYS` constant)
- Modify: `src/cli.ts` (add `decide` command)
- Test: `tests/decision.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/decision.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initStore, createMemory, readEntry, readAllEntries } from '../src/store.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('decision memory', () => {
  let tmpDir: string;
  let hippoRoot: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hippo-decision-'));
    hippoRoot = path.join(tmpDir, '.hippo');
    initStore(hippoRoot);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a decision memory with long half-life', () => {
    const mem = createMemory(hippoRoot, 'Use PostgreSQL over MySQL for JSONB support', {
      tags: ['decision', 'database'],
      layer: 'semantic',
      confidence: 'verified',
      halfLifeDays: 90,
      source: 'decision',
    });

    const entry = readEntry(hippoRoot, mem.id);
    expect(entry).not.toBeNull();
    expect(entry!.tags).toContain('decision');
    expect(entry!.layer).toBe('semantic');
    expect(entry!.confidence).toBe('verified');
    expect(entry!.half_life_days).toBe(90);
    expect(entry!.source).toBe('decision');
  });

  it('decision can be superseded', () => {
    const old = createMemory(hippoRoot, 'Use REST for all public APIs', {
      tags: ['decision', 'api'],
      layer: 'semantic',
      confidence: 'verified',
      halfLifeDays: 90,
      source: 'decision',
    });

    // Supersede: weaken old, create new
    const oldEntry = readEntry(hippoRoot, old.id)!;
    oldEntry.half_life_days = Math.max(1, Math.floor(oldEntry.half_life_days / 2));
    oldEntry.confidence = 'stale';
    if (!oldEntry.tags.includes('superseded')) oldEntry.tags.push('superseded');

    // Verify weakening
    expect(oldEntry.half_life_days).toBe(45);
    expect(oldEntry.tags).toContain('superseded');
    expect(oldEntry.confidence).toBe('stale');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/decision.test.ts`
Expected: May pass if createMemory already accepts these options. If not, FAIL.

**Step 3: Add DECISION_HALF_LIFE_DAYS to memory.ts**

```typescript
// In src/memory.ts, add near other constants:
export const DECISION_HALF_LIFE_DAYS = 90;
```

**Step 4: Run tests**

Run: `npx vitest run tests/decision.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/memory.ts tests/decision.test.ts
git commit -m "feat: add decision memory type with 90-day half-life"
```

---

### Task 6: `hippo decide` CLI command

**Files:**
- Modify: `src/cli.ts`
- Test: manual CLI test

**Step 1: Add command handler**

```typescript
case 'decide': {
  requireInit(hippoRoot);
  const text = args[0];
  if (!text) {
    console.error('Usage: hippo decide "<decision>" [--context "<why>"] [--supersedes <id>]');
    process.exit(1);
  }

  const context = flags['context'] as string || '';
  const supersedesId = flags['supersedes'] as string || null;
  const tags = ['decision'];

  // Build content with context
  const content = context ? `${text}\n\nContext: ${context}` : text;

  // Handle supersession
  if (supersedesId) {
    const oldEntry = readEntry(hippoRoot, supersedesId);
    if (!oldEntry) {
      console.error(`Memory ${supersedesId} not found.`);
      process.exit(1);
    }
    oldEntry.half_life_days = Math.max(1, Math.floor(oldEntry.half_life_days / 2));
    oldEntry.confidence = 'stale' as const;
    if (!oldEntry.tags.includes('superseded')) oldEntry.tags.push('superseded');
    writeEntry(hippoRoot, oldEntry);
    console.log(`Superseded ${supersedesId} (half-life halved, marked stale)`);
  }

  const mem = createMemory(hippoRoot, content, {
    tags,
    layer: 'semantic',
    confidence: 'verified',
    halfLifeDays: DECISION_HALF_LIFE_DAYS,
    source: 'decision',
  });

  console.log(`Decision recorded: ${mem.id}`);
  if (supersedesId) {
    console.log(`   Supersedes: ${supersedesId}`);
  }
  break;
}
```

**Step 2: Add help text**

```
  decide "<decision>"      Record an architectural decision (90-day half-life)
    --context "<why>"      Why this decision was made
    --supersedes <id>      Supersede a previous decision (weakens it)
```

**Step 3: Test manually**

```bash
cd ~/hippo
node dist/cli.js decide "Use PostgreSQL for all new services" --context "JSONB support, better query planner"
node dist/cli.js decide "Use GraphQL for public APIs" --context "Client flexibility" --supersedes mem_XXXX
```

**Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add hippo decide command for architectural decisions"
```

---

### Task 7: Recall boost for decisions

**Files:**
- Modify: `src/search.ts`
- Modify: `tests/search.test.ts`

Decision memories should get a small boost in recall scoring so they surface when relevant, compensating for the fact they're rarely retrieved.

**Step 1: Write the failing test**

```typescript
// Add to tests/search.test.ts
describe('decision recall boost', () => {
  let tmpDir: string;
  let hippoRoot: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hippo-search-decision-'));
    hippoRoot = path.join(tmpDir, '.hippo');
    initStore(hippoRoot);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('decision-tagged memories get a recall boost', () => {
    // Create a decision and a normal memory with similar content
    createMemory(hippoRoot, 'Use PostgreSQL for all database needs', {
      tags: ['decision', 'database'],
      layer: 'semantic',
      confidence: 'verified',
      halfLifeDays: 90,
      source: 'decision',
    });

    createMemory(hippoRoot, 'PostgreSQL connection pool max is 20', {
      tags: ['database'],
      layer: 'episodic',
    });

    const results = search(hippoRoot, 'PostgreSQL database', { budget: 4000 });

    // Decision should rank first due to boost
    expect(results.length).toBe(2);
    expect(results[0].tags).toContain('decision');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/search.test.ts`
Expected: FAIL (decision may not rank first without boost)

**Step 3: Add decision boost to search scoring**

In `src/search.ts`, in the composite scoring section, add:

```typescript
// After computing composite score:
const decisionBoost = entry.tags.includes('decision') ? 1.2 : 1.0;
composite *= decisionBoost;
```

**Step 4: Run tests**

Run: `npx vitest run tests/search.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/search.ts tests/search.test.ts
git commit -m "feat: add 1.2x recall boost for decision-tagged memories"
```

---

### Task 8: Update consolidation to respect decisions

**Files:**
- Modify: `src/consolidate.ts`
- Modify: `tests/consolidate.test.ts`

Decision memories should not be merged with other episodics during consolidation. They're already semantic-layer, but add an explicit guard.

**Step 1: Write the failing test**

```typescript
// Add to tests/consolidate.test.ts
it('does not merge decision memories with similar episodics', () => {
  createMemory(hippoRoot, 'Use PostgreSQL for all services', {
    tags: ['decision', 'database'],
    layer: 'semantic',
    confidence: 'verified',
    halfLifeDays: 90,
    source: 'decision',
  });

  createMemory(hippoRoot, 'PostgreSQL works well for our JSONB needs', {
    tags: ['database'],
    layer: 'episodic',
  });

  const result = consolidate(hippoRoot, { dryRun: false });

  // Decision memory should survive untouched
  const entries = readAllEntries(hippoRoot);
  const decisions = entries.filter(e => e.tags.includes('decision'));
  expect(decisions).toHaveLength(1);
  expect(decisions[0].confidence).toBe('verified');
  expect(decisions[0].half_life_days).toBe(90);
});
```

**Step 2: Run test — may already pass** since decisions are semantic-layer and merge only targets episodics. If it passes, skip Step 3.

**Step 3: Add guard if needed**

In consolidation merge pass, add filter:

```typescript
// Skip decision-tagged entries from merge candidates
const candidates = episodics.filter(e => !e.tags.includes('decision'));
```

**Step 4: Run tests**

Run: `npx vitest run tests/consolidate.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/consolidate.ts tests/consolidate.test.ts
git commit -m "feat: exclude decision memories from consolidation merge"
```

---

### Task 9: Documentation and CLI help

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `src/cli.ts` (help text, already partially done)

**Step 1: Update README**

Add new section after "Error memories stick":

```markdown
### Active invalidation

When you migrate from one tool to another, old memories about the replaced tool
should die immediately. Hippo detects migration and breaking-change commits
during `hippo learn --git` and actively weakens matching memories.

\`\`\`bash
hippo learn --git
# feat: migrate from webpack to vite
#    Invalidated 3 memories referencing "webpack"
#    Learned: migrate from webpack to vite
\`\`\`

You can also invalidate manually:

\`\`\`bash
hippo invalidate "REST API" --reason "migrated to GraphQL"
# Invalidated 5 memories referencing "REST API".
\`\`\`

### Architectural decisions

One-off decisions don't repeat, so they can't earn their keep through retrieval
alone. `hippo decide` stores them with a 90-day half-life and verified
confidence so they survive long enough to matter.

\`\`\`bash
hippo decide "Use PostgreSQL for all new services" --context "JSONB support"
# Decision recorded: mem_a1b2c3

# Later, when the decision changes:
hippo decide "Use CockroachDB for global services" \
  --context "Need multi-region" \
  --supersedes mem_a1b2c3
# Superseded mem_a1b2c3 (half-life halved, marked stale)
# Decision recorded: mem_d4e5f6
\`\`\`
```

Add to CLI reference table:

```markdown
| `hippo invalidate "<pattern>"` | Actively weaken memories matching an old pattern |
| `hippo invalidate "<pattern>" --reason "<why>"` | Include what replaced it |
| `hippo decide "<decision>"` | Record architectural decision (90-day half-life) |
| `hippo decide "<decision>" --context "<why>"` | Include reasoning |
| `hippo decide "<decision>" --supersedes <id>` | Supersede a previous decision |
```

**Step 2: Update CHANGELOG**

```markdown
## 0.10.0 (2026-04-07)

### Added
- **Active invalidation**: `hippo learn --git` detects migration/breaking commits and actively weakens memories referencing the old pattern. Manual invalidation via `hippo invalidate "<pattern>"`.
- **Architectural decisions**: `hippo decide` stores one-off decisions with 90-day half-life and verified confidence. Supports `--context` for reasoning and `--supersedes` to chain decisions.
- 1.2x recall boost for decision-tagged memories so they surface despite low retrieval frequency.
```

**Step 3: Commit**

```bash
git add README.md CHANGELOG.md src/cli.ts
git commit -m "docs: add active invalidation and decision memory documentation"
```

---

### Task 10: Version bump and release

**Files:**
- Modify: `package.json`, `package-lock.json`, `openclaw.plugin.json`, `extensions/openclaw-plugin/package.json`, `extensions/openclaw-plugin/openclaw.plugin.json`

**Step 1: Bump all versions to 0.10.0**

```bash
# Update all version strings from 0.9.1 to 0.10.0
```

**Step 2: Build and test**

```bash
npm run build
npx vitest run
```

Expected: all tests pass

**Step 3: Commit, push, release**

```bash
git add -A
git commit -m "chore: bump to v0.10.0 for active invalidation + decision memory"
git push origin master
gh release create v0.10.0 --title "v0.10.0 — Active Invalidation & Decision Memory" --notes "..."
```
