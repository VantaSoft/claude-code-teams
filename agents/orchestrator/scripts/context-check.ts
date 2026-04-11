#!/usr/bin/env bun
/**
 * context-check — report current Claude Code context usage for each agent
 * in the fleet. Finds the newest session jsonl for each agent, locates the
 * most recent assistant entry with a `message.usage` block, and sums the
 * three token counts Claude Code sends back (input + cache_read +
 * cache_creation) to approximate the full prompt size of that turn.
 *
 * Resolution order for the agents dir:
 *   1. $AGENTS_DIR env var
 *   2. <script dir>/../../..  — the standard CCT layout where this script
 *      lives at PROJECT_ROOT/agents/orchestrator/scripts/context-check.ts
 *      and agents live at PROJECT_ROOT/agents/
 *
 * Usage:
 *   bun PROJECT_ROOT/agents/orchestrator/scripts/context-check.ts            # all agents
 *   bun PROJECT_ROOT/agents/orchestrator/scripts/context-check.ts vance      # one agent
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// PROJECT_ROOT/agents/ directory — resolved from env or script location.
const AGENTS_DIR = resolve(
  process.env.AGENTS_DIR || join(__dirname, '..', '..', '..', 'agents'),
)
const PROJECTS_DIR = join(homedir(), '.claude', 'projects')

// Claude Code encodes an absolute project path by replacing `/` with `-`.
// So `<AGENTS_DIR>/vance` → `~/.claude/projects/-Users-...-agents-vance/`.
const PROJECT_DIR_PREFIX = AGENTS_DIR.replace(/\//g, '-') + '-'

// Context window. Override with $CONTEXT_WINDOW if your fleet uses a
// different model. Default 1M matches Claude Opus 4.6 1M.
const CONTEXT_WINDOW = Number(process.env.CONTEXT_WINDOW || 1_000_000)

function listAgents(): string[] {
  return readdirSync(AGENTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
}

function latestJsonl(agent: string): string | null {
  const dir = join(PROJECTS_DIR, `${PROJECT_DIR_PREFIX}${agent}`)
  let files: string[]
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
  } catch {
    return null
  }
  if (files.length === 0) return null
  const sorted = files
    .map((f) => ({ path: join(dir, f), mtime: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
  return sorted[0].path
}

type Usage = {
  input_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  output_tokens?: number
}

function lastUsage(file: string): { usage: Usage; ts: string | null } | null {
  // Walk lines in reverse so we find the most recent assistant entry fast.
  const lines = readFileSync(file, 'utf8').split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (!line) continue
    try {
      const entry = JSON.parse(line)
      const usage: Usage | undefined = entry.message?.usage
      if (entry.type === 'assistant' && usage && typeof usage.input_tokens === 'number') {
        return { usage, ts: entry.timestamp ?? null }
      }
    } catch {
      // malformed line — skip
    }
  }
  return null
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function pct(n: number): string {
  return `${((n / CONTEXT_WINDOW) * 100).toFixed(0)}%`
}

const wantedAgents = process.argv.slice(2)
const agents = wantedAgents.length > 0 ? wantedAgents : listAgents()

const rows: { agent: string; total: number; ts: string | null; note?: string }[] = []

for (const agent of agents) {
  const file = latestJsonl(agent)
  if (!file) {
    rows.push({ agent, total: 0, ts: null, note: 'no jsonl' })
    continue
  }
  const last = lastUsage(file)
  if (!last) {
    rows.push({ agent, total: 0, ts: null, note: 'no assistant usage' })
    continue
  }
  const u = last.usage
  const total =
    (u.input_tokens ?? 0) +
    (u.cache_read_input_tokens ?? 0) +
    (u.cache_creation_input_tokens ?? 0)
  rows.push({ agent, total, ts: last.ts })
}

rows.sort((a, b) => b.total - a.total)

const nameW = Math.max(5, ...rows.map((r) => r.agent.length))
for (const r of rows) {
  const name = r.agent.padEnd(nameW)
  if (r.note) {
    console.log(`${name}  —         (${r.note})`)
    continue
  }
  const size = fmtTokens(r.total).padStart(7)
  const p = pct(r.total).padStart(4)
  const ageNote = r.ts ? `  last: ${r.ts}` : ''
  console.log(`${name}  ${size}  ${p}${ageNote}`)
}
