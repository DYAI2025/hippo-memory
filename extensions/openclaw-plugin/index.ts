/**
 * Hippo Memory - OpenClaw Plugin
 *
 * Auto-injects relevant memory context at session start,
 * captures errors during sessions, and runs consolidation.
 *
 * Config lives under plugins.entries.hippo-memory.config
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve, join } from 'path';

interface HippoConfig {
  budget?: number;
  autoContext?: boolean;
  autoLearn?: boolean;
  autoSleep?: boolean;
  framing?: 'observe' | 'suggest' | 'assert';
  root?: string;
}

function getConfig(api: any): HippoConfig {
  try {
    const entries = api.config?.plugins?.entries?.['hippo-memory'];
    return entries?.config ?? {};
  } catch {
    return {};
  }
}

function findHippoRoot(workspace?: string, configRoot?: string): string | null {
  if (configRoot && existsSync(configRoot)) return configRoot;

  const candidates = [
    workspace ? join(workspace, '.hippo') : null,
    process.env.HIPPO_ROOT,
    join(process.env.USERPROFILE || process.env.HOME || '', '.hippo'),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function runHippo(args: string, cwd?: string): string {
  try {
    const result = execSync(`hippo ${args}`, {
      cwd: cwd || process.cwd(),
      timeout: 30000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.trim();
  } catch (err: any) {
    return err.stdout?.trim() || err.message || 'hippo command failed';
  }
}

export default function register(api: any) {
  const logger = api.logger ?? console;

  // --- Tool: hippo_recall ---
  api.registerTool({
    name: 'hippo_recall',
    description:
      'Retrieve relevant memories from the project memory store. Returns memories ranked by relevance, strength, and recency within the token budget. Use at session start or when you need context about a topic.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'What to search for in memory (natural language)',
        },
        budget: {
          type: 'number',
          description: 'Max tokens to return (default: 1500)',
        },
      },
      required: ['query'],
    },
    async execute(_id: string, params: { query: string; budget?: number }) {
      const cfg = getConfig(api);
      const budget = params.budget ?? cfg.budget ?? 1500;
      const framing = cfg.framing ?? 'observe';
      const result = runHippo(
        `recall "${params.query.replace(/"/g, '\\"')}" --budget ${budget} --framing ${framing}`,
      );
      return { content: [{ type: 'text', text: result || 'No relevant memories found.' }] };
    },
  });

  // --- Tool: hippo_remember ---
  api.registerTool({
    name: 'hippo_remember',
    description:
      'Store a new memory. Use when you learn something non-obvious, hit an error, or discover a useful pattern. Memories decay over time unless retrieved. Errors get 2x half-life.',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'The memory to store (1-2 sentences, specific and concrete)',
        },
        error: {
          type: 'boolean',
          description: 'Mark as error memory (doubles half-life)',
        },
        pin: {
          type: 'boolean',
          description: 'Pin memory (never decays)',
        },
        tag: {
          type: 'string',
          description: 'Optional tag for categorization',
        },
      },
      required: ['text'],
    },
    async execute(
      _id: string,
      params: { text: string; error?: boolean; pin?: boolean; tag?: string },
    ) {
      let args = `remember "${params.text.replace(/"/g, '\\"')}"`;
      if (params.error) args += ' --error';
      if (params.pin) args += ' --pin';
      if (params.tag) args += ` --tag ${params.tag}`;
      const result = runHippo(args);
      return { content: [{ type: 'text', text: result || 'Memory stored.' }] };
    },
  });

  // --- Tool: hippo_outcome ---
  api.registerTool({
    name: 'hippo_outcome',
    description:
      'Report whether recalled memories were useful. Strengthens good memories (+5 days half-life) and weakens bad ones (-3 days). Call after completing work.',
    parameters: {
      type: 'object',
      properties: {
        good: {
          type: 'boolean',
          description: 'true = memories helped, false = memories were irrelevant',
        },
      },
      required: ['good'],
    },
    async execute(_id: string, params: { good: boolean }) {
      const flag = params.good ? '--good' : '--bad';
      const result = runHippo(`outcome ${flag}`);
      return { content: [{ type: 'text', text: result || 'Outcome recorded.' }] };
    },
  });

  // --- Tool: hippo_status ---
  api.registerTool(
    {
      name: 'hippo_status',
      description:
        'Check memory health: counts, strengths, at-risk memories, last consolidation time.',
      parameters: {
        type: 'object',
        properties: {},
      },
      async execute() {
        const result = runHippo('status');
        return { content: [{ type: 'text', text: result || 'No hippo store found.' }] };
      },
    },
    { optional: true },
  );

  // --- Tool: hippo_context ---
  api.registerTool(
    {
      name: 'hippo_context',
      description:
        'Smart context injection: auto-detects current task from git state and returns relevant memories. Use at the start of any session.',
      parameters: {
        type: 'object',
        properties: {
          budget: {
            type: 'number',
            description: 'Max tokens (default: 1500)',
          },
        },
      },
      async execute(_id: string, params: { budget?: number }) {
        const cfg = getConfig(api);
        const budget = params.budget ?? cfg.budget ?? 1500;
        const framing = cfg.framing ?? 'observe';
        const result = runHippo(`context --auto --budget ${budget} --framing ${framing}`);
        return { content: [{ type: 'text', text: result || 'No context available.' }] };
      },
    },
    { optional: true },
  );

  // --- Hook: auto-inject context at session start ---
  api.on(
    'before_prompt_build',
    (_event: any, _ctx: any) => {
      const cfg = getConfig(api);
      if (cfg.autoContext === false) return {};

      const budget = cfg.budget ?? 1500;
      const framing = cfg.framing ?? 'observe';

      try {
        const context = runHippo(`context --auto --budget ${budget} --framing ${framing}`);
        if (context && context.length > 10 && !context.includes('No hippo store')) {
          return {
            appendSystemContext: `\n\n## Project Memory (Hippo)\n${context}`,
          };
        }
      } catch (err) {
        logger.debug?.('[hippo] context injection skipped:', err);
      }
      return {};
    },
    { priority: 5 },
  );

  logger.info?.('[hippo] Memory plugin registered (tools: hippo_recall, hippo_remember, hippo_outcome, hippo_status, hippo_context)');
}
