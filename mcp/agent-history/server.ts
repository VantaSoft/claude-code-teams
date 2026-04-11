#!/usr/bin/env bun
/**
 * agent-history — stdio MCP server exposing a single tool that greps an
 * agent's Claude Code session jsonl for past events. Useful for recalling
 * things that have been pushed out of an agent's live context by compaction
 * or just by time.
 *
 * Single tool: `search`
 *   agent  — required string, which agent's jsonl to search (e.g. "vance")
 *   pattern — required string, substring or regex to match within entry content
 *   since  — optional ISO timestamp (e.g. "2026-04-10T00:00:00Z"), filter start
 *   until  — optional ISO timestamp, filter end (exclusive)
 *   types  — optional array of entry types to include. Default:
 *            ["user", "assistant", "tool_result"]. Pass ["*"] or set raw=true
 *            to include every entry type (permission-mode, file-history,
 *            queue-operation, etc.).
 *   raw    — optional boolean, shortcut for types=["*"]
 *   limit  — optional int, max matches to return (default 50)
 *   regex  — optional boolean, treat pattern as a JavaScript regex (default
 *            false — plain case-insensitive substring match)
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Where the agent project dirs live. One dir per project path, each
// containing one or more .jsonl session files.
const PROJECTS_DIR = join(homedir(), '.claude', 'projects')

// Agent name → project dir path. Claude Code encodes the absolute project
// path by replacing `/` with `-`, so `<AGENTS_DIR>/vance` becomes
// `-Users-...-agents-vance` under ~/.claude/projects/.
//
// Resolution order:
//   1. $AGENTS_DIR env var (explicit override)
//   2. <server.ts dir>/../../agents  — the standard CCT layout where this
//      MCP server lives at PROJECT_ROOT/mcp/agent-history/server.ts and
//      agents live at PROJECT_ROOT/agents/
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const AGENTS_DIR = resolve(process.env.AGENTS_DIR || join(__dirname, '..', '..', 'agents'))
const PROJECT_DIR_PREFIX = AGENTS_DIR.replace(/\//g, '-') + '-'

// Types of entries we consider "meaningful" for normal searches. The jsonl
// contains a lot of bookkeeping noise (permission-mode changes, file-history
// snapshots, queue-operation duplicates, deferred_tools_delta updates) that
// rarely matters to a human reading the history.
const DEFAULT_TYPES = new Set(['user', 'assistant', 'tool_result'])

// --- jsonl utilities ---

type JsonlEntry = Record<string, any>

function projectDirForAgent(agent: string): string {
  return join(PROJECTS_DIR, `${PROJECT_DIR_PREFIX}${agent}`)
}

function listJsonlFiles(agent: string): string[] {
  const dir = projectDirForAgent(agent)
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => join(dir, f))
      .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs)
  } catch {
    return []
  }
}

function parseJsonl(path: string): JsonlEntry[] {
  const raw = readFileSync(path, 'utf8')
  const out: JsonlEntry[] = []
  for (const line of raw.split('\n')) {
    if (!line) continue
    try {
      out.push(JSON.parse(line))
    } catch {
      // Ignore malformed lines (partial writes at the tail, etc.).
    }
  }
  return out
}

// Extract a searchable text blob from an entry. Different entry shapes:
//   user:      message.content can be string OR array of content parts
//              (text, tool_result, image, etc.)
//   assistant: message.content is usually an array of content parts
//              (text, tool_use, thinking)
//   tool_result: (nested inside a user message's content array — we walk it)
// We stringify everything into one flat text blob and run the pattern against
// it. This is less precise than field-aware matching but keeps the tool
// simple and means "search for the word foo" Just Works regardless of where
// foo lives in the structure.
function entryText(entry: JsonlEntry): string {
  const parts: string[] = []

  const pushContent = (c: any): void => {
    if (c == null) return
    if (typeof c === 'string') {
      parts.push(c)
      return
    }
    if (Array.isArray(c)) {
      for (const item of c) pushContent(item)
      return
    }
    if (typeof c === 'object') {
      // Content-part objects (text, tool_use, tool_result, thinking, image).
      if (c.type === 'text' && typeof c.text === 'string') parts.push(c.text)
      else if (c.type === 'tool_use') {
        if (c.name) parts.push(`<tool_use:${c.name}>`)
        if (c.input) parts.push(JSON.stringify(c.input))
      } else if (c.type === 'tool_result') {
        if (c.tool_use_id) parts.push(`<tool_result:${c.tool_use_id}>`)
        pushContent(c.content)
      } else if (c.type === 'thinking' && typeof c.thinking === 'string') {
        parts.push(c.thinking)
      } else if (c.type === 'image') {
        parts.push('<image>')
      } else {
        // Unknown object — stringify as a fallback so grep still works.
        parts.push(JSON.stringify(c))
      }
    }
  }

  if (entry.message) {
    pushContent(entry.message.content)
  } else if (typeof entry.content === 'string') {
    parts.push(entry.content)
  } else if (entry.content != null) {
    pushContent(entry.content)
  }

  return parts.join(' ')
}

function entryTimestamp(entry: JsonlEntry): string | null {
  // Most entries carry a `timestamp` field. Some bookkeeping entries
  // (permission-mode, file-history-snapshot) don't. Return null if missing
  // so the time filter can decide to keep or skip them.
  return entry.timestamp || entry.message?.timestamp || null
}

function entryRole(entry: JsonlEntry): string {
  // Prefer the outer `type` (user/assistant/...) which matches what the API
  // sends. Fall back to `message.role` for older entries.
  return entry.type || entry.message?.role || 'unknown'
}

// Format a single matched entry as human-readable text. Keeps output compact
// by truncating very long content blocks.
function formatEntry(entry: JsonlEntry, maxChars: number = 400): string {
  const ts = entryTimestamp(entry) ?? 'no-ts'
  const role = entryRole(entry)
  let text = entryText(entry)
  if (text.length > maxChars) text = text.slice(0, maxChars) + '…'
  text = text.replace(/\s+/g, ' ').trim()
  return `[${ts}] [${role}] ${text}`
}

// --- search handler ---

type SearchParams = {
  agent: string
  pattern: string
  since?: string
  until?: string
  types?: string[]
  raw?: boolean
  limit?: number
  regex?: boolean
}

function search(params: SearchParams): string {
  const { agent, pattern } = params
  const limit = params.limit ?? 50
  const typeFilter =
    params.raw || params.types?.includes('*')
      ? null // null = match any type
      : new Set(params.types ?? Array.from(DEFAULT_TYPES))

  const sinceMs = params.since ? Date.parse(params.since) : -Infinity
  const untilMs = params.until ? Date.parse(params.until) : Infinity

  const files = listJsonlFiles(agent)
  if (files.length === 0) {
    return `No jsonl files found for agent "${agent}" at ${projectDirForAgent(agent)}`
  }

  let matcher: (s: string) => boolean
  if (params.regex) {
    try {
      const re = new RegExp(pattern, 'i')
      matcher = (s) => re.test(s)
    } catch (e) {
      return `Invalid regex: ${(e as Error).message}`
    }
  } else {
    const needle = pattern.toLowerCase()
    matcher = (s) => s.toLowerCase().includes(needle)
  }

  const matches: JsonlEntry[] = []
  let scanned = 0

  for (const file of files) {
    const entries = parseJsonl(file)
    for (const entry of entries) {
      scanned++
      // Type filter.
      if (typeFilter && !typeFilter.has(entryRole(entry))) continue
      // Time filter — skip entries without timestamps if a range was requested.
      const ts = entryTimestamp(entry)
      if (params.since || params.until) {
        if (!ts) continue
        const tMs = Date.parse(ts)
        if (Number.isNaN(tMs) || tMs < sinceMs || tMs >= untilMs) continue
      }
      // Content filter.
      const text = entryText(entry)
      if (!text) continue
      if (!matcher(text)) continue
      matches.push(entry)
      if (matches.length >= limit) break
    }
    if (matches.length >= limit) break
  }

  if (matches.length === 0) {
    return `No matches for "${pattern}" in ${files.length} jsonl file(s) (${scanned} entries scanned).`
  }

  const lines: string[] = [
    `Found ${matches.length} match(es) for "${pattern}" in ${files.length} jsonl file(s) (${scanned} entries scanned).`,
    '',
  ]
  for (const entry of matches) lines.push(formatEntry(entry))
  return lines.join('\n')
}

// --- MCP plumbing ---

const mcp = new Server(
  { name: 'agent-history', version: '0.1.0' },
  {
    capabilities: { tools: {} },
    instructions:
      'agent-history exposes a single `search` tool that greps an agent\'s Claude Code session jsonl for past events. Use it to recall things that have been pushed out of live context by compaction or by time.',
  },
)

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'search',
      description:
        "Search an agent's Claude Code session history (the jsonl under ~/.claude/projects/). Returns matching entries with timestamps, role, and a truncated excerpt. Useful for recalling things an agent has forgotten due to compaction or long conversations.",
      inputSchema: {
        type: 'object',
        properties: {
          agent: {
            type: 'string',
            description:
              'The agent name (e.g. "vance", "sofia"). Matches the folder under ~/team/agents/.',
          },
          pattern: {
            type: 'string',
            description:
              'Text pattern to search for. Case-insensitive substring match by default. Set regex=true to use a JavaScript regex.',
          },
          since: {
            type: 'string',
            description:
              'Optional ISO 8601 timestamp. Only return entries with timestamps >= this value (e.g. "2026-04-10T00:00:00Z").',
          },
          until: {
            type: 'string',
            description:
              'Optional ISO 8601 timestamp. Only return entries with timestamps < this value.',
          },
          types: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Entry types to include. Default: ["user", "assistant", "tool_result"]. Pass ["*"] or set raw=true to include all bookkeeping entry types.',
          },
          raw: {
            type: 'boolean',
            description: 'Shortcut for types=["*"]. Includes all entry types, including bookkeeping noise.',
          },
          limit: {
            type: 'integer',
            description: 'Max number of matches to return. Default: 50.',
          },
          regex: {
            type: 'boolean',
            description: 'Treat pattern as a JavaScript regex (case-insensitive). Default: false (plain substring match).',
          },
        },
        required: ['agent', 'pattern'],
      },
    },
  ],
}))

mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params
  if (name !== 'search') {
    return {
      content: [{ type: 'text', text: `unknown tool: ${name}` }],
      isError: true,
    }
  }
  const a = (args ?? {}) as Record<string, unknown>
  try {
    const result = search({
      agent: String(a.agent ?? ''),
      pattern: String(a.pattern ?? ''),
      since: a.since != null ? String(a.since) : undefined,
      until: a.until != null ? String(a.until) : undefined,
      types: Array.isArray(a.types) ? (a.types as string[]) : undefined,
      raw: a.raw === true,
      limit: typeof a.limit === 'number' ? a.limit : undefined,
      regex: a.regex === true,
    })
    return { content: [{ type: 'text', text: result }] }
  } catch (e) {
    return {
      content: [{ type: 'text', text: `search failed: ${(e as Error).message}` }],
      isError: true,
    }
  }
})

const transport = new StdioServerTransport()
await mcp.connect(transport)
