# Hippo + Codex (OpenAI) Integration

Codex does not currently give Hippo a true `SessionEnd` hook in the same way Claude Code and OpenCode do, so Hippo uses a launcher wrapper for Codex session-end consolidation.

## What the Codex integration does

Hippo's Codex integration now does two things:

1. Patches `AGENTS.md` in the current project if it exists, so the agent still runs `hippo context`, `hippo remember`, and `hippo outcome` during normal work.
2. Wraps the detected `codex` launcher in place and writes metadata in `~/.hippo/integrations/codex.json`.

The wrapper starts the real Codex binary, waits for the session to exit, then spawns a detached Hippo worker that runs:

1. `hippo sleep`
2. `hippo capture --last-session --transcript <codex session file>`

Both commands tee output to `~/.hippo/logs/codex-sleep.log`.

On the next wrapped Codex start, Hippo prints that log via `hippo last-sleep` before launching the real Codex process, so you can see what was consolidated.

## Install and updates

Hippo now attempts this automatically on install and update. If Hippo was installed before Codex, common Hippo commands will also try to self-heal the integration the next time they run.

You can still run the manual repair path:

```bash
hippo hook install codex
```

Hippo renames the original launcher to a sibling backup such as `codex.hippo-real.cmd` or `codex.hippo-real.exe`, then drops a wrapper at the command path that users already invoke. No extra `PATH` step is required.

## Session source

Hippo captures Codex sessions from the real session transcript files under `~/.codex/sessions/`, not just from `history.jsonl`.

The wrapper records the `history.jsonl` byte offset at launch, finds the new `session_id` written during that run, resolves the matching transcript file in `~/.codex/sessions/...`, and feeds that transcript to `hippo capture --last-session`.

This gives Hippo access to both user messages and assistant responses from the Codex rollout transcript.

## Notes

- This wrapper path is specific to Codex. Claude Code and OpenCode keep using native `SessionStart`/`SessionEnd` hooks.
- OpenClaw keeps using the Hippo plugin path, not the Codex wrapper.
- If no local `.hippo/` store exists in the working directory, Hippo cannot consolidate project memory there. Run `hippo init` inside the repo first.
