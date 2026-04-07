# Hippo Roadmap: Explicit Working Memory, Session Continuity, and Operational Stability

> **Status: COMPLETED.** All PRs (1-4) shipped in v0.9.0. This roadmap is archived for reference. See CHANGELOG.md for current feature history.

## Why this roadmap changed
The first draft was directionally right but too generic.
After inspecting the real `hippo` repo, the immediate gaps are narrower and the best first PR is smaller.

Hippo is already stronger than a plain markdown-memory system in long-term recall. The weak spots are:
- active task continuity
- session continuity and handoff polish
- SQLite lock behaviour under concurrent plugin calls
- explainability and ergonomics around recall and handoff

The right move is still to incorporate Karpathy-style explicit working state, but **not** as PR1.
PR1 should fix production pain first.

---

## Current repo reality
The repo is in better shape than a greenfield memory project.
It already has:
- SQLite backbone
- schema v4
- WAL mode already enabled at the DB level
- BM25 + embedding hybrid retrieval
- `task_snapshots` and `session_events` tables already present
- a working OpenClaw plugin/tool surface

That means the roadmap should build on existing structure, not duplicate it.

---

## Design stance
Use a hybrid memory model:

1. **Explicit working state** for current-task continuity
2. **Session/handoff artifacts** for resume and background runs
3. **Hippo long-term semantic memory** for durable recall
4. **Explainable recall UX** so the system is easy to trust

Karpathy-style memory should become Hippo's **front-end working state layer**.
Hippo should remain the **semantic long-term retrieval engine** underneath.

---

# Priority order

## PR1: Operational stability and UX guardrails
Ship this first.

### Why PR1 is not the full working-memory layer
The most immediate production pain is not lack of a buffer. It is:
- `SQLITE_BUSY` contention under concurrent plugin calls
- missing `--limit` controls on recall/context
- duplicate context injection on reconnect

Those are small, high-leverage fixes that unblock everything else.

### PR1 scope
1. **SQLite lock hardening**
   - add `PRAGMA busy_timeout = 5000`
   - add `PRAGMA synchronous = NORMAL`
   - add `PRAGMA wal_autocheckpoint = 100`
   - apply these in `openHippoDb`

2. **Consolidation write batching**
   - stop doing many open/close cycles during `consolidate()`
   - batch writes into one connection and one transaction where possible

3. **Recall/context limits**
   - add `--limit` flag to `recall`
   - add `--limit` flag to `context`

4. **Plugin injection dedup guard**
   - prevent double injection of context on reconnect or repeated hook entry

### Likely files to touch in PR1
Exact names should follow the current repo layout, but expect changes around:
- DB open/connection helper, e.g. `openHippoDb`
- consolidation path
- recall/context command parsing
- OpenClaw plugin hook path for `before_prompt_build`

### PR1 acceptance checklist
- [ ] concurrent plugin reads/writes no longer fail immediately with `SQLITE_BUSY`
- [ ] recall supports `--limit`
- [ ] context supports `--limit`
- [ ] repeated reconnect/hook execution does not inject duplicate context
- [ ] one integration test proves busy-timeout behaviour under concurrent access
- [ ] one integration test proves deduped plugin injection

### PR1 size target
Keep it small.
This should be a low-risk patch, roughly a few focused edits, not a repo-wide architecture rewrite.

---

# PR2: Session continuity and handoff surface
After stability, make session state resumable.

## Goal
Turn the existing `task_snapshots` and `session_events` foundations into an actual continuity system.

## Current gap
The tables exist, but the flow is incomplete:
- no proper session start/end lifecycle
- no robust auto-generated session id when plugin context is null
- no first-class `hippo handoff` command that emits a ready-to-inject summary block

## What to add
### New type
- `SessionHandoff`

Suggested shape:

```ts
interface SessionHandoff {
  version: 1;
  sessionId: string;
  repoRoot?: string;
  taskId?: string;
  summary: string;
  nextAction?: string;
  artifacts?: string[];
  updatedAt: string;
}
```

### New commands
- `hippo handoff create`
- `hippo handoff latest`
- `hippo handoff show <id>`
- `hippo session latest`
- `hippo session resume`

### Plugin behaviour
- record explicit `session_start`
- record explicit `session_end`
- if session context is missing, generate a stable fallback session id
- inject latest handoff summary at `before_prompt_build` when appropriate

### Likely files/modules
Add or extend modules in the current command/session area, for example:
- `src/session/*`
- `src/handoff/*`
- plugin hook integration under the OpenClaw-facing layer

### Acceptance checklist
- [ ] a session can be started and closed explicitly
- [ ] a missing plugin session context no longer drops continuity data on the floor
- [ ] `hippo handoff latest` returns a compact, ready-to-inject summary
- [ ] the plugin can resume from the latest session/handoff without transcript archaeology

---

# PR3: Explicit working-memory layer
Do this after stability and basic session continuity.

## Goal
Make current task state explicit, bounded, and model-visible.

## Current gap
A `Layer.Buffer` concept already exists, but nothing writes to it automatically or exposes it cleanly as first-class working memory.

## Proposed storage
Add a dedicated `working_memory` table in a new migration, likely **schema v5**.

Suggested shape:

```sql
CREATE TABLE working_memory (
  id INTEGER PRIMARY KEY,
  scope TEXT NOT NULL,
  session_id TEXT,
  task_id TEXT,
  importance REAL NOT NULL DEFAULT 0,
  content TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

## Proposed module
Add:
- `src/working-memory.ts`

Core functions:
- `wmPush(...)`
- `wmFlush(...)`
- `wmRead(...)`
- `wmClear(...)`

## Behaviour
- bounded buffer
- importance-based eviction
- target max of about 20 entries
- auto-flush on `session_end`
- working memory is for current-state notes, not durable semantic memories

## Commands to add
- `hippo wm push`
- `hippo wm read`
- `hippo wm clear`
- `hippo wm flush`

## Tool/plugin surface
Add one minimal tool first:
- `hippo_wm_push`

Potential follow-ups:
- `hippo_wm_read`
- automatic inclusion of top working-memory items in prompt context before semantic recall

## Acceptance checklist
- [ ] bounded buffer works
- [ ] eviction works by importance
- [ ] session end flush works
- [ ] current-state notes are visible separately from long-term memory recall

---

# PR4: Recall and handoff UX polish
Once the foundations exist, make the system easy to trust.

## Current gaps
- no `--limit` before PR1
- no top-level handoff surface
- no match-reason annotations
- weak inspectability of why a memory was returned

## Additions
### Explainable recall
Add:
- `hippo recall --why`

Return:
- memory text
- score
- reason for match
- source bucket, e.g. durable/recent/working/session

### Better handoff UX
- `hippo handoff latest`
- `hippo current show` if working-memory layer lands
- compact outputs meant to be injected directly into agent context

### Acceptance checklist
- [ ] operator can inspect why recall returned an item
- [ ] handoff output is compact and usable without extra formatting
- [ ] working memory, session continuity, and long-term recall are visibly distinct concepts

---

# Concrete roadmap sequence

## PR1 -- SHIPPED
**Operational stability patch**
- [x] busy_timeout
- [x] synchronous NORMAL
- [x] wal_autocheckpoint
- [x] consolidate batching
- [x] recall/context `--limit`
- [x] plugin dedup guard

## PR2 -- SHIPPED
**Session continuity + handoff**
- [x] session start/end
- [x] fallback session ids
- [x] handoff commands
- [x] handoff injection path

## PR3 -- SHIPPED
**Working-memory layer**
- [x] migration v6 (v5 was session_handoffs)
- [x] `working_memory` table
- [x] `src/working-memory.ts`
- [x] `hippo wm` commands
- [x] minimal `hippo_wm_push` tool

## PR4 -- SHIPPED
**Recall/handoff UX polish**
- [x] `recall --why`
- [x] scoped/annotated outputs
- [x] `hippo current show`

---

# Concrete commands to target
This is the command surface to grow toward.

## PR1
- `hippo recall <query> --limit 10`
- `hippo context --limit 10`

## PR2
- `hippo handoff create`
- `hippo handoff latest`
- `hippo handoff show <id>`
- `hippo session latest`
- `hippo session resume`

## PR3
- `hippo wm push --scope repo --content "..." --importance 0.8`
- `hippo wm read --scope repo`
- `hippo wm clear --scope repo`
- `hippo wm flush --scope repo`

## PR4
- `hippo recall <query> --why --limit 5`

---

# Risks and guardrails

## Risk: building working memory before fixing contention
That would make a flaky write path even hotter.

**Guardrail:** do PR1 first.

## Risk: duplicating existing session tables with new ad hoc files
That would create two broken continuity systems.

**Guardrail:** build session continuity on top of `task_snapshots` and `session_events`, not beside them.

## Risk: letting working memory become long-term memory sludge
That would recreate the markdown-dump problem.

**Guardrail:** bounded buffer + explicit flush semantics + separate long-term memory path.

---

# Blunt recommendation
The repo is already strong enough that the right move is not a grand redesign.

**Do this instead:**
1. fix contention and immediate UX pain
2. finish session continuity on top of the tables that already exist
3. add explicit working memory as a bounded front-end layer
4. improve explainability last

That is the cleanest way to incorporate Karpathy-style memory into Hippo without breaking what already works.
