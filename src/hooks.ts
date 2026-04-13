/**
 * JSON-hook install/uninstall for AI coding tools.
 *
 * Currently supports Claude Code and OpenCode, which share the same
 * SessionStart/SessionEnd schema. Hippo installs two entries:
 *   - SessionEnd: `hippo session-end --log-file <path>` - spawns a detached
 *     child that runs `hippo sleep` then `hippo capture --last-session`
 *     in sequence, writing both outputs to the log file. The parent returns
 *     in <100ms so the TUI teardown can't kill the child before it finishes.
 *   - SessionStart: `hippo last-sleep --path <path>` - prints the log written
 *     by the previous session's detached worker and then clears it, so the
 *     user actually sees what was consolidated.
 *
 * Earlier forms are detected and migrated automatically:
 *   - < 0.20.2: `Stop` hook firing `hippo sleep` on every assistant turn.
 *   - < 0.21.0: bare `hippo sleep` in SessionEnd, no `--log-file`.
 *   - 0.22.x: separate sleep + capture SessionEnd entries. Ran in parallel
 *     and were both SIGTERM'd by TUI teardown, so completion lines rarely
 *     made it to the log. 0.23.0+ collapses them into the single
 *     `hippo session-end` entry above.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type JsonHookTarget = 'claude-code' | 'opencode';

export interface JsonHookPaths {
  settings: string;
  logFile: string;
  display: string;
}

export interface InstallResult {
  target: JsonHookTarget;
  settingsPath: string;
  installedSessionEnd: boolean;
  installedSessionStart: boolean;
  migratedFromStop: boolean;
  migratedLegacySessionEnd: boolean;
  migratedSplitSessionEnd: boolean;
}

export interface ToolDetection {
  name: string;
  configDir: string;
  detected: boolean;
  kind: 'json-hook' | 'markdown-instruction' | 'plugin';
  notes?: string;
}

const HIPPO_SLEEP_MARKER = 'hippo sleep';
const HIPPO_LAST_SLEEP_MARKER = 'hippo last-sleep';
const HIPPO_CAPTURE_MARKER = 'hippo capture --last-session';
const HIPPO_SESSION_END_MARKER = 'hippo session-end';

function homeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

/**
 * Default log path consumed by `hippo last-sleep`. Shared fallback when
 * a caller doesn't pass --path explicitly.
 */
export function defaultSleepLogPath(): string {
  return path.join(homeDir(), '.hippo', 'logs', 'last-sleep.log');
}

export function resolveJsonHookPaths(target: JsonHookTarget): JsonHookPaths {
  const home = homeDir();
  const logsDir = path.join(home, '.hippo', 'logs');
  switch (target) {
    case 'claude-code':
      return {
        settings: path.join(home, '.claude', 'settings.json'),
        logFile: path.join(logsDir, 'claude-code-sleep.log'),
        display: 'Claude Code',
      };
    case 'opencode':
      return {
        settings: path.join(home, '.config', 'opencode', 'opencode.json'),
        logFile: path.join(logsDir, 'opencode-sleep.log'),
        display: 'OpenCode',
      };
  }
}

function hookArrayContains(hookArray: unknown, marker: string): boolean {
  if (!Array.isArray(hookArray)) return false;
  return JSON.stringify(hookArray).includes(marker);
}

function hasCurrentSessionEnd(hookArray: unknown): boolean {
  return hookArrayContains(hookArray, HIPPO_SESSION_END_MARKER);
}

/**
 * Returns true when `hooks.SessionEnd` still contains either of the legacy
 * v0.22.x split entries (bare `hippo sleep` / `hippo capture --last-session`)
 * without the current consolidated `hippo session-end` entry.
 */
function hasLegacySplitSessionEnd(hookArray: unknown): boolean {
  if (!Array.isArray(hookArray)) return false;
  const serialized = JSON.stringify(hookArray);
  const hasSleep = serialized.includes(HIPPO_SLEEP_MARKER);
  const hasCapture = serialized.includes(HIPPO_CAPTURE_MARKER);
  return (hasSleep || hasCapture) && !serialized.includes(HIPPO_SESSION_END_MARKER);
}

export function installJsonHooks(target: JsonHookTarget): InstallResult {
  const { settings: settingsPath, logFile } = resolveJsonHookPaths(target);
  const dir = path.dirname(settingsPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  let settings: Record<string, unknown> = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch {
      return {
        target,
        settingsPath,
        installedSessionEnd: false,
        installedSessionStart: false,
        migratedFromStop: false,
        migratedLegacySessionEnd: false,
        migratedSplitSessionEnd: false,
      };
    }
  }

  if (!settings.hooks) settings.hooks = {};
  const hooks = settings.hooks as Record<string, unknown[]>;

  let migratedFromStop = false;
  if (Array.isArray(hooks.Stop) && hookArrayContains(hooks.Stop, HIPPO_SLEEP_MARKER)) {
    hooks.Stop = hooks.Stop.filter((entry) => !JSON.stringify(entry).includes(HIPPO_SLEEP_MARKER));
    if (hooks.Stop.length === 0) delete hooks.Stop;
    migratedFromStop = true;
  }

  // Migrate legacy SessionEnd forms:
  //   - pre-0.21 bare `hippo sleep`
  //   - 0.21.x+ `hippo sleep --log-file` split across two entries
  //   - 0.22.x `hippo capture --last-session --log-file` second entry
  // All of these get collapsed into the single `hippo session-end` entry.
  let migratedLegacySessionEnd = false;
  let migratedSplitSessionEnd = false;
  if (Array.isArray(hooks.SessionEnd) && hasLegacySplitSessionEnd(hooks.SessionEnd)) {
    const before = hooks.SessionEnd.length;
    hooks.SessionEnd = hooks.SessionEnd.filter((entry) => {
      const s = JSON.stringify(entry);
      return !s.includes(HIPPO_SLEEP_MARKER) && !s.includes(HIPPO_CAPTURE_MARKER);
    });
    if (hooks.SessionEnd.length === 0) delete hooks.SessionEnd;
    // If the removed entries used the log-file pattern (0.21.x-0.22.x) we
    // call it a "split" migration; otherwise it was the older bare form.
    migratedSplitSessionEnd = true;
    migratedLegacySessionEnd = before > 1;
  }

  let installedSessionEnd = false;
  if (!hasCurrentSessionEnd(hooks.SessionEnd)) {
    if (!Array.isArray(hooks.SessionEnd)) hooks.SessionEnd = [];
    hooks.SessionEnd.push({
      hooks: [
        {
          type: 'command',
          command: `hippo session-end --log-file "${logFile}"`,
          timeout: 5,
        },
      ],
    });
    installedSessionEnd = true;
  }

  let installedSessionStart = false;
  if (!hookArrayContains(hooks.SessionStart, HIPPO_LAST_SLEEP_MARKER)) {
    if (!Array.isArray(hooks.SessionStart)) hooks.SessionStart = [];
    hooks.SessionStart.push({
      hooks: [
        {
          type: 'command',
          command: `hippo last-sleep --path "${logFile}"`,
          timeout: 5,
        },
      ],
    });
    installedSessionStart = true;
  }

  if (
    installedSessionEnd ||
    installedSessionStart ||
    migratedFromStop ||
    migratedLegacySessionEnd ||
    migratedSplitSessionEnd
  ) {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  }

  return {
    target,
    settingsPath,
    installedSessionEnd,
    installedSessionStart,
    migratedFromStop,
    migratedLegacySessionEnd,
    migratedSplitSessionEnd,
  };
}

export function uninstallJsonHooks(target: JsonHookTarget): boolean {
  const { settings: settingsPath } = resolveJsonHookPaths(target);
  if (!fs.existsSync(settingsPath)) return false;

  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch {
    return false;
  }

  const hooks = settings.hooks as Record<string, unknown[]> | undefined;
  if (!hooks) return false;

  let changed = false;
  const markersByKey: Record<string, string[]> = {
    SessionEnd: [HIPPO_SESSION_END_MARKER, HIPPO_SLEEP_MARKER, HIPPO_CAPTURE_MARKER],
    SessionStart: [HIPPO_LAST_SLEEP_MARKER],
    Stop: [HIPPO_SLEEP_MARKER],
  };
  for (const [key, markers] of Object.entries(markersByKey)) {
    if (!Array.isArray(hooks[key])) continue;
    const before = hooks[key].length;
    hooks[key] = hooks[key].filter(
      (entry) => !markers.some((m) => JSON.stringify(entry).includes(m)),
    );
    if (hooks[key].length !== before) {
      changed = true;
      if (hooks[key].length === 0) delete hooks[key];
    }
  }

  if (!changed) return false;
  if (Object.keys(hooks).length === 0) delete settings.hooks;
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
  return true;
}

/**
 * Detect which AI coding tools are installed based on config directory presence.
 * Used by `hippo setup` to decide which JSON-hook installs to run.
 */
export function detectInstalledTools(): ToolDetection[] {
  const home = homeDir();
  const exists = (...parts: string[]) => fs.existsSync(path.join(home, ...parts));
  return [
    { name: 'claude-code', configDir: '~/.claude', detected: exists('.claude'), kind: 'json-hook' },
    { name: 'opencode', configDir: '~/.config/opencode', detected: exists('.config', 'opencode'), kind: 'json-hook' },
    { name: 'openclaw', configDir: '~/.openclaw', detected: exists('.openclaw'), kind: 'plugin', notes: 'install via `openclaw plugins install hippo-memory`' },
    { name: 'codex', configDir: '~/.codex', detected: exists('.codex'), kind: 'markdown-instruction', notes: 'no hook API - patches AGENTS.md in the project' },
    { name: 'cursor', configDir: '~/.cursor', detected: exists('.cursor'), kind: 'markdown-instruction', notes: 'no hook API - patches .cursorrules in the project' },
    { name: 'pi', configDir: '~/.pi', detected: exists('.pi'), kind: 'markdown-instruction', notes: 'no hook API - patches AGENTS.md in the project' },
  ];
}
