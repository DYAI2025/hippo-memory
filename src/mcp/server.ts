#!/usr/bin/env node
/**
 * Hippo Memory MCP Server
 *
 * Exposes hippo memory as MCP tools over stdio transport.
 * Works with any MCP-compatible client: Cursor, Windsurf, Cline, Claude Desktop, etc.
 *
 * Usage: hippo mcp (or npx hippo-memory mcp)
 */

import { execSync } from 'child_process';

// ── MCP protocol types ──

interface McpRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface McpResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string };
}

// ── Helpers ──

function runHippo(args: string): string {
  try {
    return execSync(`hippo ${args}`, {
      timeout: 30000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (err: any) {
    return err.stdout?.trim() || err.message || 'hippo command failed';
  }
}

function send(msg: McpResponse): void {
  const json = JSON.stringify(msg);
  const header = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n`;
  process.stdout.write(header + json);
}

// ── Tool definitions ──

const TOOLS = [
  {
    name: 'hippo_recall',
    description:
      'Retrieve relevant memories from the project memory store. Returns memories ranked by relevance, strength, and recency within the token budget. Use at session start or when you need context about a topic.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'What to search for in memory (natural language)' },
        budget: { type: 'number', description: 'Max tokens to return (default: 1500)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'hippo_remember',
    description:
      'Store a new memory. Use when you learn something non-obvious, hit an error, or discover a useful pattern. Memories decay over time unless retrieved. Errors get 2x half-life.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        text: {
          type: 'string',
          description: 'The memory to store (1-2 sentences, specific and concrete)',
        },
        error: { type: 'boolean', description: 'Mark as error memory (doubles half-life)' },
        pin: { type: 'boolean', description: 'Pin memory (never decays)' },
        tag: { type: 'string', description: 'Optional tag for categorization' },
      },
      required: ['text'],
    },
  },
  {
    name: 'hippo_outcome',
    description:
      'Report whether recalled memories were useful. Strengthens good memories (+5 days half-life) and weakens bad ones (-3 days). Call after completing work.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        good: {
          type: 'boolean',
          description: 'true = memories helped, false = memories were irrelevant',
        },
      },
      required: ['good'],
    },
  },
  {
    name: 'hippo_context',
    description:
      'Smart context injection: auto-detects current task from git state and returns relevant memories. Use at the start of any session.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        budget: { type: 'number', description: 'Max tokens (default: 1500)' },
      },
    },
  },
  {
    name: 'hippo_status',
    description:
      'Check memory health: counts, strengths, at-risk memories, last consolidation time.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'hippo_learn',
    description:
      'Scan recent git commits for lessons from fix/revert/bug patterns. Run after coding sessions.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        days: { type: 'number', description: 'Days to scan back (default: 7)' },
      },
    },
  },
];

// ── Tool execution ──

function executeTool(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'hippo_recall': {
      const query = String(args.query || '').replace(/"/g, '\\"');
      const budget = Number(args.budget) || 1500;
      return runHippo(`recall "${query}" --budget ${budget}`);
    }
    case 'hippo_remember': {
      const text = String(args.text || '').replace(/"/g, '\\"');
      let cmd = `remember "${text}"`;
      if (args.error) cmd += ' --error';
      if (args.pin) cmd += ' --pin';
      if (args.tag) cmd += ` --tag ${args.tag}`;
      return runHippo(cmd);
    }
    case 'hippo_outcome': {
      return runHippo(`outcome ${args.good ? '--good' : '--bad'}`);
    }
    case 'hippo_context': {
      const budget = Number(args.budget) || 1500;
      return runHippo(`context --auto --budget ${budget}`);
    }
    case 'hippo_status': {
      return runHippo('status');
    }
    case 'hippo_learn': {
      const days = Number(args.days) || 7;
      return runHippo(`learn --git --days ${days}`);
    }
    default:
      return `Unknown tool: ${name}`;
  }
}

// ── Request handling ──

function handleRequest(req: McpRequest): McpResponse {
  const { id, method, params } = req;

  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'hippo-memory', version: '0.4.0' },
        },
      };

    case 'notifications/initialized':
      // No response needed for notifications
      return { jsonrpc: '2.0', id, result: {} };

    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: TOOLS } };

    case 'tools/call': {
      const toolName = (params as any)?.name;
      const toolArgs = (params as any)?.arguments ?? {};
      const output = executeTool(toolName, toolArgs);
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: output || 'Done.' }],
        },
      };
    }

    default:
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      };
  }
}

// ── Stdio transport ──

let buffer = '';

process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk: string) => {
  buffer += chunk;

  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) break;

    const header = buffer.slice(0, headerEnd);
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      buffer = buffer.slice(headerEnd + 4);
      continue;
    }

    const contentLength = parseInt(match[1], 10);
    const bodyStart = headerEnd + 4;
    if (buffer.length < bodyStart + contentLength) break;

    const body = buffer.slice(bodyStart, bodyStart + contentLength);
    buffer = buffer.slice(bodyStart + contentLength);

    try {
      const req = JSON.parse(body) as McpRequest;
      if (req.method && !req.method.startsWith('notifications/')) {
        const res = handleRequest(req);
        send(res);
      } else if (req.method) {
        handleRequest(req); // handle but don't send response for notifications
      }
    } catch (err) {
      // Skip malformed messages
    }
  }
});

process.stdin.on('end', () => process.exit(0));

// Prevent unhandled errors from crashing the server
process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});
