#!/usr/bin/env bun
/**
 * fleet — stdio MCP server exposing cross-agent primitives any agent might
 * need, plus orchestrator-only provisioning tools intended for the
 * designated orchestrator agent.
 *
 * Tool surface:
 *   restart_agent(agent, channels) — launch or restart an agent in tmux
 *   compact_agent(agent)           — send /compact to an agent's tmux session
 *   message_agent(agent, message)  — type a message into an agent's tmux session
 *   context_check(agent?)          — token usage for one or all agents
 *   agent_status(agent?)           — working / idle / waiting_input snapshot
 *   list_mcps(agent?, verbose?)    — MCP servers each agent has configured
 *   list_schedules(agent?)         — list cron schedules across the fleet
 *   sync_schedules()               — re-install MANAGED crontab block
 *   history_search(agent, pattern) — grep an agent's past session jsonl
 *   create_agent(agent)            — scaffold a new PROJECT_ROOT/agents/<agent>/
 *
 * Shell scripts for tmux orchestration (restart/compact/message/create
 * agent) live under this MCP's own scripts/ subdir. context_check,
 * agent_status, list_mcps, list_schedules, and sync_schedules are
 * implemented inline in TypeScript — they only need to read files,
 * parse frontmatter, and rewrite crontab, no subprocess shell needed.
 *
 * Not exposed as a tool: Slack app provisioning (setup-slack.sh). That
 * script takes two Slack tokens as CLI args; wiring it into an MCP tool
 * would leak the tokens into the caller's Claude Code session jsonl. It's
 * a rare one-time provisioning step, so it stays as a standalone script at
 * PROJECT_ROOT/agents/orchestrator/scripts/setup-slack.sh that the user
 * runs manually when adding a new agent.
 *
 * Path resolution:
 *   - AGENTS_DIR = $AGENTS_DIR env var, OR <this server.ts dir>/../../agents
 *     (the standard CCT layout where this MCP lives at
 *      PROJECT_ROOT/mcp/fleet/server.ts and agents live at PROJECT_ROOT/agents/)
 *   - SCRIPTS_DIR = <this server.ts dir>/scripts
 *   - PROJECTS_DIR (Claude Code session jsonl) = ~/.claude/projects/
 *   - The project-dir prefix for session jsonl encodes the absolute agent
 *     path with / replaced by -. We compute it from AGENTS_DIR at startup.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { spawnSync } from "node:child_process";
import { closeSync, createReadStream, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const AGENTS_DIR = resolve(process.env.AGENTS_DIR ?? join(__dirname, "..", "..", "agents"));
const SCRIPTS_DIR = join(__dirname, "scripts");
const PROJECTS_DIR = join(homedir(), ".claude", "projects");
// Claude Code encodes absolute project paths by replacing / with -. The
// prefix is `-<abs agents dir>/` with the trailing slash turning into nothing
// (agent name appended verbatim afterwards).
const PROJECT_DIR_PREFIX = AGENTS_DIR.replace(/\//g, "-") + "-";
const CONTEXT_WINDOW = Number(process.env.CONTEXT_WINDOW ?? 1_000_000);

const RESTART_SCRIPT = join(SCRIPTS_DIR, "restart-agent.sh");
const COMPACT_SCRIPT = join(SCRIPTS_DIR, "compact-agent.sh");
const MESSAGE_SCRIPT = join(SCRIPTS_DIR, "message-agent.sh");
const CREATE_AGENT_SCRIPT = join(SCRIPTS_DIR, "create-agent.sh");

// --- helpers -----------------------------------------------------------

const AGENT_NAME_RE = /^[a-z][a-z0-9_-]{0,30}$/;
function isValidAgentName(s: string): boolean {
  return AGENT_NAME_RE.test(s);
}

function listAgents(): string[] {
  return readdirSync(AGENTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

function run(cmd: string, args: string[]): { ok: boolean; text: string } {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  const stdout = r.stdout?.trim() ?? "";
  const stderr = r.stderr?.trim() ?? "";
  const ok = r.status === 0;
  const text = [stdout, stderr].filter(Boolean).join("\n") || (ok ? "ok" : "failed");
  return { ok, text };
}

function latestJsonl(agent: string): string | null {
  const dir = join(PROJECTS_DIR, `${PROJECT_DIR_PREFIX}${agent}`);
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return null;
  }
  if (files.length === 0) return null;
  return files
    .map((f) => ({ path: join(dir, f), mtime: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0].path;
}

type Usage = {
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

function lastUsage(file: string): { usage: Usage; ts: string | null } | null {
  // Read only the last ~256KB of the session jsonl — long-lived sessions
  // can grow to many MB and we only care about the tail. A usage entry is
  // always well under 1KB, so 256KB is >250 entries of slack.
  const TAIL_BYTES = 256 * 1024;
  let text: string;
  try {
    const size = statSync(file).size;
    if (size <= TAIL_BYTES) {
      text = readFileSync(file, "utf8");
    } else {
      const fd = openSync(file, "r");
      try {
        const buf = Buffer.alloc(TAIL_BYTES);
        readSync(fd, buf, 0, TAIL_BYTES, size - TAIL_BYTES);
        text = buf.toString("utf8");
        // Drop the leading partial line (likely mid-JSON).
        const nl = text.indexOf("\n");
        if (nl >= 0) text = text.slice(nl + 1);
      } finally {
        closeSync(fd);
      }
    }
  } catch {
    return null;
  }
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line) continue;
    try {
      const entry = JSON.parse(line);
      const usage: Usage | undefined = entry.message?.usage;
      if (entry.type === "assistant" && usage && typeof usage.input_tokens === "number") {
        return { usage, ts: entry.timestamp ?? null };
      }
    } catch {
      // skip malformed line
    }
  }
  return null;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function contextCheck(agent?: string): string {
  const agents = agent ? [agent] : listAgents();
  const rows: { agent: string; total: number; ts: string | null; note?: string }[] = [];
  for (const a of agents) {
    const file = latestJsonl(a);
    if (!file) {
      rows.push({ agent: a, total: 0, ts: null, note: "no jsonl" });
      continue;
    }
    const last = lastUsage(file);
    if (!last) {
      rows.push({ agent: a, total: 0, ts: null, note: "no assistant usage" });
      continue;
    }
    const u = last.usage;
    const total =
      (u.input_tokens ?? 0) +
      (u.cache_read_input_tokens ?? 0) +
      (u.cache_creation_input_tokens ?? 0);
    rows.push({ agent: a, total, ts: last.ts });
  }
  rows.sort((a, b) => b.total - a.total);
  const nameW = Math.max(5, ...rows.map((r) => r.agent.length));
  const out: string[] = [];
  for (const r of rows) {
    const name = r.agent.padEnd(nameW);
    if (r.note) {
      out.push(`${name}  —         (${r.note})`);
      continue;
    }
    const size = fmtTokens(r.total).padStart(7);
    const p = `${((r.total / CONTEXT_WINDOW) * 100).toFixed(0)}%`.padStart(4);
    const ageNote = r.ts ? `  last: ${r.ts}` : "";
    out.push(`${name}  ${size}  ${p}${ageNote}`);
  }
  return out.join("\n");
}

// --- agent_status: parse tmux pane text ------------------------------

type AgentStatus = {
  agent: string;
  session: "running" | "missing";
  state?: "working" | "idle" | "waiting_input" | "unknown";
  spinner?: { label: string; elapsed: string; tokens: number | null };
  last_tool_call?: { tool: string; summary: string } | null;
  last_message_snippet?: string | null;
  pending_input?: boolean;
  pending_input_reason?: string | null;
};

function captureAgentPane(agent: string, lines = 60): string | null {
  const has = spawnSync("tmux", ["has-session", "-t", agent], { encoding: "utf8" });
  if (has.status !== 0) return null;
  const cap = spawnSync("tmux", ["capture-pane", "-t", agent, "-S", `-${lines}`, "-p"], { encoding: "utf8" });
  if (cap.status !== 0) return null;
  return cap.stdout ?? "";
}

function parseAgentStatus(agent: string, paneText: string | null): AgentStatus {
  if (paneText === null) return { agent, session: "missing" };

  const lines = paneText.split("\n").map((l) => l.replace(/\s+$/, ""));

  // Spinner line: e.g. "✻ Architecting… (4m 50s · ↓ 9.4k tokens · thought for 1s)"
  const spinnerRe = /^[^A-Za-z0-9\s]\s+(\w[\w\-]*)[…\.]+\s*\((\d+m?\s*\d*s?)\s*·\s*↓\s*([\d.]+[kKmM]?)\s*tokens?/;
  let spinner: AgentStatus["spinner"] | undefined;
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(spinnerRe);
    if (m) {
      const tokStr = m[3].toLowerCase();
      const num = parseFloat(tokStr);
      const mult = tokStr.endsWith("k") ? 1_000 : tokStr.endsWith("m") ? 1_000_000 : 1;
      spinner = { label: m[1], elapsed: m[2].trim(), tokens: Number.isFinite(num) ? Math.round(num * mult) : null };
      break;
    }
  }

  let pendingReason: string | null = null;
  for (const line of lines) {
    if (/How is Claude doing this session/i.test(line)) {
      pendingReason = "feedback rating prompt";
      break;
    }
    if (/Approve\s*\?|Permission required|Allow this/i.test(line)) {
      pendingReason = "permission request";
      break;
    }
    if (/Do you want to proceed|Press Enter to confirm/i.test(line)) {
      pendingReason = "confirmation prompt";
      break;
    }
  }

  let hasInputPrompt = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^❯\s*/.test(lines[i])) {
      hasInputPrompt = true;
      break;
    }
  }

  // Last tool call: lines like `⏺ Bash(ls)` or `⏺ slack - reply (MCP)(channel_id="...")`.
  // Tool names may have an optional " (MCP)" suffix before the argument paren.
  const toolCallRe = /^⏺\s+(\w[\w\s\-]*?)(?:\s*\(MCP\))?\(([^)]*)/;
  let lastToolCall: AgentStatus["last_tool_call"] = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(toolCallRe);
    if (m) {
      lastToolCall = { tool: m[1].trim(), summary: (m[2] ?? "").slice(0, 120) };
      break;
    }
  }

  let lastMessage: string | null = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (l.startsWith("⏺ ") && !toolCallRe.test(l)) {
      lastMessage = l.slice(2).trim().slice(0, 200);
      if (lastMessage) break;
    }
  }

  let state: NonNullable<AgentStatus["state"]> = "unknown";
  if (pendingReason) {
    state = "waiting_input";
  } else if (spinner) {
    state = "working";
  } else if (hasInputPrompt) {
    state = "idle";
  }

  return {
    agent,
    session: "running",
    state,
    spinner,
    last_tool_call: lastToolCall,
    last_message_snippet: lastMessage,
    pending_input: !!pendingReason,
    pending_input_reason: pendingReason,
  };
}

function agentStatus(agent?: string): string {
  const agents = agent ? [agent] : listAgents();
  const results = agents.map((a) => parseAgentStatus(a, captureAgentPane(a)));
  return JSON.stringify(results.length === 1 ? results[0] : results, null, 2);
}

// --- schedules: load, list, sync to crontab ---------------------------

// Walk every agent's schedules/ directory, parse the cron frontmatter
// out of each .md, and return a flat list. Pure-TS reader; shared by
// list_schedules and sync_schedules so the parser only lives in one
// place.
type Schedule = { agent: string; name: string; file: string; cron: string };

function loadSchedules(agent?: string): Schedule[] {
  const agents = agent ? [agent] : listAgents();
  const rows: Schedule[] = [];
  for (const a of agents) {
    const dir = join(AGENTS_DIR, a, "schedules");
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".md"));
    } catch { continue; }
    for (const f of files.sort()) {
      const file = join(dir, f);
      let raw: string;
      try { raw = readFileSync(file, "utf8"); } catch { continue; }
      const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---/);
      if (!fmMatch) continue;
      const cronLine = fmMatch[1].split("\n").find((l) => /^\s*cron\s*:/.test(l));
      if (!cronLine) continue;
      const cron = cronLine
        .replace(/^\s*cron\s*:\s*/, "")
        .replace(/\s*(#.*)?$/, "")
        .replace(/^["']|["']$/g, "")
        .trim();
      if (!cron) continue;
      rows.push({ agent: a, name: f.replace(/\.md$/, ""), file, cron });
    }
  }
  return rows;
}

function listSchedules(agent?: string): string {
  const rows = loadSchedules(agent);
  if (rows.length === 0) return "(no schedules found)";
  const agentW = Math.max(5, ...rows.map((r) => r.agent.length));
  const nameW = Math.max(4, ...rows.map((r) => r.name.length));
  const cronW = Math.max(4, ...rows.map((r) => r.cron.length));
  const lines: string[] = [];
  lines.push(`${"agent".padEnd(agentW)}  ${"name".padEnd(nameW)}  ${"cron".padEnd(cronW)}`);
  lines.push(`${"-".repeat(agentW)}  ${"-".repeat(nameW)}  ${"-".repeat(cronW)}`);
  for (const r of rows) {
    lines.push(`${r.agent.padEnd(agentW)}  ${r.name.padEnd(nameW)}  ${r.cron.padEnd(cronW)}`);
  }
  return lines.join("\n");
}

// Regenerate the MANAGED block in the user's crontab from current
// schedule .md files. Preserves any non-managed crontab entries
// (between the markers, exclusive on both sides). Atomically rewrites
// via `crontab -` reading from stdin.
const CRON_BEGIN = "# BEGIN MANAGED: agent-schedules";
const CRON_END = "# END MANAGED: agent-schedules";
// tmux install path varies per host. Default to the common Homebrew
// location on macOS; callers can override via TMUX_BIN env var.
const TMUX_BIN = process.env.TMUX_BIN ?? "/usr/local/bin/tmux";

function syncSchedules(): string {
  const rows = loadSchedules();
  const blockLines: string[] = [
    CRON_BEGIN,
    "# Generated by fleet:sync_schedules — do not edit by hand",
    "# Edit schedule files in PROJECT_ROOT/agents/<agent>/schedules/*.md and re-run the tool",
  ];
  for (const r of rows) {
    // The cron command types the prompt literally into the agent's tmux
    // pane, sleeps 5s so Claude Code's input field accepts the input
    // (avoids racing the input field when the agent is mid-turn), then
    // sends Enter. The prompt is single-quoted; we escape any embedded
    // single quotes by closing, escaping, and reopening the quoted
    // string ('\'').
    const prompt = `Read ${r.file} and execute tasks defined in it.`;
    const escapedPrompt = prompt.replace(/'/g, `'\\''`);
    const shCommand =
      `${TMUX_BIN} send-keys -l -t ${r.agent} '${escapedPrompt}'; ` +
      `sleep 5; ${TMUX_BIN} send-keys -t ${r.agent} Enter`;
    blockLines.push(`${r.cron} /bin/sh -c "${shCommand}"`);
  }
  blockLines.push(CRON_END);
  const newBlock = blockLines.join("\n");

  // Read the current crontab. crontab -l exits non-zero with "no crontab
  // for <user>" when empty — treat that as an empty starting point.
  const cur = spawnSync("crontab", ["-l"], { encoding: "utf8" });
  const current = cur.status === 0 ? cur.stdout ?? "" : "";

  // Strip any existing MANAGED block.
  const stripped: string[] = [];
  let inBlock = false;
  for (const line of current.split("\n")) {
    if (line === CRON_BEGIN) { inBlock = true; continue; }
    if (line === CRON_END) { inBlock = false; continue; }
    if (!inBlock) stripped.push(line);
  }
  // Drop trailing empty lines so the join below produces a clean diff.
  while (stripped.length > 0 && stripped[stripped.length - 1] === "") stripped.pop();

  const newCrontab = stripped.length > 0
    ? `${stripped.join("\n")}\n\n${newBlock}\n`
    : `${newBlock}\n`;

  const install = spawnSync("crontab", ["-"], { input: newCrontab, encoding: "utf8" });
  if (install.status !== 0) {
    throw new Error(`crontab install failed: ${install.stderr?.trim() || install.stdout?.trim() || `exit ${install.status}`}`);
  }
  return `Synced ${rows.length} schedule(s) to crontab`;
}

// --- list_mcps: read each agent's .mcp.json --------------------------

function listMcps(agent?: string, verbose = false): string {
  const agents = agent ? [agent] : listAgents();
  const lines: string[] = [];
  for (const a of agents) {
    const path = join(AGENTS_DIR, a, ".mcp.json");
    let mcps: Record<string, any> | null = null;
    try {
      const raw = readFileSync(path, "utf8");
      const j = JSON.parse(raw);
      mcps = j.mcpServers ?? {};
    } catch {
      lines.push(`${a}: (no .mcp.json or parse error)`);
      continue;
    }
    const names = Object.keys(mcps ?? {}).sort();
    if (!verbose) {
      lines.push(`${a}: ${names.length > 0 ? names.join(", ") : "(none)"}`);
    } else {
      lines.push(`${a}:`);
      for (const n of names) {
        const e = mcps![n];
        const cmd = [e.command, ...(e.args ?? [])].join(" ");
        lines.push(`  ${n} — ${cmd}`);
      }
      if (names.length === 0) lines.push("  (none)");
    }
  }
  return lines.join("\n");
}

// --- history_search ---------------------------------------------------
//
// Grep an agent's Claude Code session jsonl for past events. Useful for
// recalling things pushed out of live context by compaction or time.
// Merged in from the former stand-alone `agent-history` MCP.

type JsonlEntry = Record<string, any>;

const HISTORY_DEFAULT_TYPES = new Set(["user", "assistant", "tool_result"]);
const HISTORY_MAX_SCANNED = 200_000;
const HISTORY_MAX_PATTERN_LENGTH = 500;

function historyJsonlFiles(agent: string): string[] {
  const dir = join(PROJECTS_DIR, `${PROJECT_DIR_PREFIX}${agent}`);
  try {
    const entries = readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => {
        const path = join(dir, f);
        return { path, mtime: statSync(path).mtimeMs };
      });
    entries.sort((a, b) => b.mtime - a.mtime);
    return entries.map((e) => e.path);
  } catch {
    return [];
  }
}

async function* streamJsonl(path: string): AsyncGenerator<JsonlEntry> {
  const stream = createReadStream(path, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line) continue;
      try {
        yield JSON.parse(line);
      } catch {
        // Ignore malformed lines (partial writes at the tail, etc.).
      }
    }
  } finally {
    rl.close();
  }
}

function historyEntryText(entry: JsonlEntry): string {
  const parts: string[] = [];
  const pushContent = (c: any): void => {
    if (c == null) return;
    if (typeof c === "string") { parts.push(c); return; }
    if (Array.isArray(c)) { for (const item of c) pushContent(item); return; }
    if (typeof c === "object") {
      if (c.type === "text" && typeof c.text === "string") parts.push(c.text);
      else if (c.type === "tool_use") {
        if (c.name) parts.push(`<tool_use:${c.name}>`);
        if (c.input) parts.push(JSON.stringify(c.input));
      } else if (c.type === "tool_result") {
        if (c.tool_use_id) parts.push(`<tool_result:${c.tool_use_id}>`);
        pushContent(c.content);
      } else if (c.type === "thinking" && typeof c.thinking === "string") {
        parts.push(c.thinking);
      } else if (c.type === "image") {
        parts.push("<image>");
      } else {
        const fb = JSON.stringify(c);
        parts.push(fb.length > 2000 ? fb.slice(0, 2000) : fb);
      }
    }
  };
  if (entry.message) pushContent(entry.message.content);
  else if (typeof entry.content === "string") parts.push(entry.content);
  else if (entry.content != null) pushContent(entry.content);
  return parts.join(" ");
}

function historyEntryTimestamp(entry: JsonlEntry): string | null {
  return entry.timestamp || entry.message?.timestamp || null;
}

function historyEntryRole(entry: JsonlEntry): string {
  return entry.type || entry.message?.role || "unknown";
}

function formatHistoryEntry(entry: JsonlEntry, maxChars = 400): string {
  const ts = historyEntryTimestamp(entry) ?? "no-ts";
  const role = historyEntryRole(entry);
  let text = historyEntryText(entry);
  if (text.length > maxChars) text = text.slice(0, maxChars) + "…";
  text = text.replace(/\s+/g, " ").trim();
  return `[${ts}] [${role}] ${text}`;
}

type HistorySearchParams = {
  agent: string;
  pattern: string;
  since?: string;
  until?: string;
  types?: string[];
  raw?: boolean;
  limit?: number;
  regex?: boolean;
};

async function historySearch(params: HistorySearchParams): Promise<string> {
  const { agent, pattern } = params;
  const limit = params.limit ?? 50;

  if (!isValidAgentName(agent)) return `Invalid agent name "${agent}".`;
  if (!pattern) return "pattern is required";
  if (pattern.length > HISTORY_MAX_PATTERN_LENGTH) {
    return `Pattern too long (${pattern.length} chars). Max: ${HISTORY_MAX_PATTERN_LENGTH}.`;
  }

  const typeFilter =
    params.raw || params.types?.includes("*")
      ? null
      : new Set(params.types ?? Array.from(HISTORY_DEFAULT_TYPES));

  const sinceMs = params.since ? Date.parse(params.since) : -Infinity;
  const untilMs = params.until ? Date.parse(params.until) : Infinity;

  const files = historyJsonlFiles(agent);
  if (files.length === 0) {
    return `No jsonl files found for agent "${agent}" at ${join(PROJECTS_DIR, `${PROJECT_DIR_PREFIX}${agent}`)}`;
  }

  let matcher: (s: string) => boolean;
  if (params.regex) {
    try {
      const re = new RegExp(pattern, "i");
      matcher = (s) => re.test(s);
    } catch (e) {
      return `Invalid regex: ${(e as Error).message}`;
    }
  } else {
    const needle = pattern.toLowerCase();
    matcher = (s) => s.toLowerCase().includes(needle);
  }

  const matches: JsonlEntry[] = [];
  let scanned = 0;
  let truncatedScan = false;

  outer: for (const file of files) {
    for await (const entry of streamJsonl(file)) {
      scanned++;
      if (scanned > HISTORY_MAX_SCANNED) { truncatedScan = true; break outer; }
      if (typeFilter && !typeFilter.has(historyEntryRole(entry))) continue;
      const ts = historyEntryTimestamp(entry);
      if (params.since || params.until) {
        if (!ts) continue;
        const tMs = Date.parse(ts);
        if (Number.isNaN(tMs) || tMs < sinceMs || tMs >= untilMs) continue;
      }
      const text = historyEntryText(entry);
      if (!text) continue;
      if (!matcher(text)) continue;
      matches.push(entry);
      if (matches.length >= limit) break outer;
    }
  }

  const scanNote = truncatedScan ? ` (scan capped at ${HISTORY_MAX_SCANNED})` : "";
  if (matches.length === 0) {
    return `No matches for "${pattern}" in ${files.length} jsonl file(s) (${scanned} entries scanned${scanNote}).`;
  }
  const lines: string[] = [
    `Found ${matches.length} match(es) for "${pattern}" in ${files.length} jsonl file(s) (${scanned} entries scanned${scanNote}).`,
    "",
  ];
  for (const entry of matches) lines.push(formatHistoryEntry(entry));
  return lines.join("\n");
}

// --- MCP plumbing ------------------------------------------------------

const mcp = new Server(
  { name: "fleet", version: "0.1.0" },
  {
    capabilities: { tools: {} },
    instructions:
      "fleet exposes cross-agent primitives (restart_agent, compact_agent, message_agent, context_check, agent_status, list_mcps, list_schedules, history_search) and orchestrator-only tools (sync_schedules, create_agent). restart/compact/message require explicit principal approval before use on another agent — see the shared CLAUDE.md messaging-other-agents section. sync_schedules and create_agent are orchestrator-only; only the orchestrator agent should call them. history_search greps an agent's Claude Code session jsonl so you can recall events pushed out of live context by compaction or time. Slack provisioning is not exposed as a tool on purpose; run PROJECT_ROOT/agents/orchestrator/scripts/setup-slack.sh manually when adding a new agent.",
  },
);

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "restart_agent",
      description:
        "Launch or restart an agent in a tmux session with the given channels (slack, telegram, discord, imessage). Safe for self-restart: when the target session already exists, restart-agent.sh uses `tmux respawn-window -k` to atomically kill the old claude and launch the new one in place — tmux handles the kill+respawn in its own process, so the caller dying mid-call doesn't prevent the replacement from coming up. The new claude loads with `--continue` and picks up the prior session history. The dev-channel auto-approve loop runs in a detached sibling tmux session that survives the caller's death.",
      inputSchema: {
        type: "object",
        properties: {
          agent: { type: "string", description: 'Agent name, e.g. "orchestrator"' },
          channels: {
            type: "array",
            items: { type: "string" },
            description: 'Channels to enable, e.g. ["slack", "telegram"]. At least one required.',
          },
        },
        required: ["agent", "channels"],
      },
    },
    {
      name: "compact_agent",
      description:
        "Send /compact to another agent's tmux session to compress its context. The slash command fires on the agent's next turn boundary. Use when context_check shows an agent above ~50%.",
      inputSchema: {
        type: "object",
        properties: {
          agent: { type: "string", description: "Agent name. Must have a running tmux session." },
        },
        required: ["agent"],
      },
    },
    {
      name: "message_agent",
      description:
        "Type a one-line message into another agent's tmux session. The receiving agent reads it as terminal input and responds in its own session. Use for cross-agent handoffs. Requires prior principal approval before sending — do not message another agent on your own initiative.",
      inputSchema: {
        type: "object",
        properties: {
          agent: { type: "string", description: "Agent name." },
          message: { type: "string", description: "The message body. Write it like a clear one-line instruction or ask." },
        },
        required: ["agent", "message"],
      },
    },
    {
      name: "context_check",
      description:
        "Report Claude Code context usage for each agent under PROJECT_ROOT/agents/. Walks each agent's newest session jsonl, finds the last assistant entry with a usage block, and sums input + cache_read + cache_creation tokens against the context window (default 1M). Pass an agent name to check just one; omit for the whole fleet.",
      inputSchema: {
        type: "object",
        properties: {
          agent: { type: "string", description: "Optional agent name. Omit to check all agents." },
        },
      },
    },
    {
      name: "agent_status",
      description:
        "Snapshot what an agent's Claude Code session is doing right now, parsed from its tmux pane. Returns state (working/idle/waiting_input/unknown), current spinner (label, elapsed, tokens), last tool call, last assistant message snippet, and whether a blocking prompt (rating, permission, confirmation) is pending. Pass an agent name for one; omit for the whole fleet.",
      inputSchema: {
        type: "object",
        properties: {
          agent: { type: "string", description: "Optional agent name. Omit to check all agents." },
        },
      },
    },
    {
      name: "list_mcps",
      description:
        "Report which MCP servers each agent has configured in its .mcp.json. Pass an agent name to check just one; omit for the whole fleet. Set verbose=true to include the full command+args for each MCP (useful for debugging wiring issues); default is just the server names.",
      inputSchema: {
        type: "object",
        properties: {
          agent: { type: "string", description: "Optional agent name. Omit to check all agents." },
          verbose: { type: "boolean", description: "Default false. Set true to include the full command line for each MCP." },
        },
      },
    },
    {
      name: "sync_schedules",
      description:
        "Re-install the MANAGED crontab block by scanning PROJECT_ROOT/agents/*/schedules/*.md for cron frontmatter and regenerating the managed block in the user crontab. Preserves any non-managed entries. Safe to run repeatedly. Orchestrator-only.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "list_schedules",
      description:
        "List every recurring schedule across the fleet by reading PROJECT_ROOT/agents/*/schedules/*.md and parsing the cron frontmatter. Returns a table of agent, schedule name, and cron expression. Pure file read — does not consult crontab. Pass an agent name to filter to one agent; omit for the whole fleet.",
      inputSchema: {
        type: "object",
        properties: {
          agent: { type: "string", description: "Optional agent name. Omit to list schedules for all agents." },
        },
      },
    },
    {
      name: "history_search",
      description:
        "Search an agent's Claude Code session history (the jsonl files under ~/.claude/projects/) for past events. Returns matching entries with timestamps, role, and a truncated excerpt. Useful for recalling things an agent has forgotten due to compaction or long conversations. Case-insensitive substring match by default; set regex=true for a JavaScript regex. Default entry types: user, assistant, tool_result — pass raw=true or types=['*'] to include bookkeeping entry types.",
      inputSchema: {
        type: "object",
        properties: {
          agent: { type: "string", description: 'Agent name (e.g. "orchestrator"). Matches the folder under PROJECT_ROOT/agents/.' },
          pattern: { type: "string", description: "Text pattern. Case-insensitive substring match by default." },
          since: { type: "string", description: 'Optional ISO 8601 timestamp. Only entries with timestamps >= this (e.g. "2026-04-10T00:00:00Z").' },
          until: { type: "string", description: "Optional ISO 8601 timestamp. Only entries with timestamps < this." },
          types: { type: "array", items: { type: "string" }, description: 'Entry types to include. Default ["user","assistant","tool_result"]. ["*"] = all.' },
          raw: { type: "boolean", description: "Shortcut for types=['*']. Include all bookkeeping entry types." },
          limit: { type: "integer", description: "Max matches. Default 50." },
          regex: { type: "boolean", description: "Treat pattern as a JavaScript regex (case-insensitive). Default false." },
        },
        required: ["agent", "pattern"],
      },
    },
    {
      name: "create_agent",
      description:
        "Scaffold a new agent folder at PROJECT_ROOT/agents/<agent>/ with CLAUDE.md, memory/, docs/, schedules/, and .claude/. Fails if the directory already exists. Does NOT wire up Slack or start the agent — run PROJECT_ROOT/agents/orchestrator/scripts/setup-slack.sh manually (it's kept as a standalone script because it takes Slack tokens) and then call restart_agent after.",
      inputSchema: {
        type: "object",
        properties: {
          agent: { type: "string", description: 'New agent name, e.g. "olivia"' },
        },
        required: ["agent"],
      },
    },
  ],
}));

mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = (args ?? {}) as Record<string, unknown>;

  try {
    if (name === "restart_agent") {
      const agent = String(a.agent ?? "");
      const channels = Array.isArray(a.channels) ? (a.channels as string[]) : [];
      if (!agent || channels.length === 0)
        return { content: [{ type: "text", text: "agent and at least one channel are required" }], isError: true };
      if (!isValidAgentName(agent))
        return { content: [{ type: "text", text: `invalid agent name: ${agent}` }], isError: true };
      for (const ch of channels) {
        if (typeof ch !== "string" || !/^[a-z][a-z0-9_-]{0,20}$/.test(ch))
          return { content: [{ type: "text", text: `invalid channel: ${ch}` }], isError: true };
      }
      // Self-restart is safe. restart-agent.sh uses `tmux respawn-window
      // -k` when the target session already exists, which kills the old
      // claude and launches the new one atomically from tmux's own
      // process — not from this MCP subprocess. So even if the caller
      // is the target and dies mid-call, tmux has already committed to
      // spawning the replacement. The dev-channel auto-approve loop
      // runs in its own detached tmux session that survives this
      // script dying for the same reason.
      const r = run(RESTART_SCRIPT, [agent, ...channels]);
      return { content: [{ type: "text", text: r.text }], isError: !r.ok };
    }

    if (name === "compact_agent") {
      const agent = String(a.agent ?? "");
      if (!agent) return { content: [{ type: "text", text: "agent is required" }], isError: true };
      if (!isValidAgentName(agent))
        return { content: [{ type: "text", text: `invalid agent name: ${agent}` }], isError: true };
      const r = run(COMPACT_SCRIPT, [agent]);
      return { content: [{ type: "text", text: r.text }], isError: !r.ok };
    }

    if (name === "message_agent") {
      const agent = String(a.agent ?? "");
      const message = String(a.message ?? "");
      if (!agent || !message)
        return { content: [{ type: "text", text: "agent and message are required" }], isError: true };
      if (!isValidAgentName(agent))
        return { content: [{ type: "text", text: `invalid agent name: ${agent}` }], isError: true };
      const r = run(MESSAGE_SCRIPT, [agent, message]);
      return { content: [{ type: "text", text: r.text }], isError: !r.ok };
    }

    if (name === "context_check") {
      const agent = a.agent != null ? String(a.agent) : undefined;
      if (agent && !isValidAgentName(agent))
        return { content: [{ type: "text", text: `invalid agent name: ${agent}` }], isError: true };
      return { content: [{ type: "text", text: contextCheck(agent) }] };
    }

    if (name === "agent_status") {
      const agent = a.agent != null ? String(a.agent) : undefined;
      if (agent && !isValidAgentName(agent))
        return { content: [{ type: "text", text: `invalid agent name: ${agent}` }], isError: true };
      return { content: [{ type: "text", text: agentStatus(agent) }] };
    }

    if (name === "list_mcps") {
      const agent = a.agent != null ? String(a.agent) : undefined;
      if (agent && !isValidAgentName(agent))
        return { content: [{ type: "text", text: `invalid agent name: ${agent}` }], isError: true };
      const verbose = a.verbose === true;
      return { content: [{ type: "text", text: listMcps(agent, verbose) }] };
    }

    if (name === "sync_schedules") {
      try {
        return { content: [{ type: "text", text: syncSchedules() }] };
      } catch (e) {
        return { content: [{ type: "text", text: (e as Error).message }], isError: true };
      }
    }

    if (name === "list_schedules") {
      const agent = a.agent != null ? String(a.agent) : undefined;
      if (agent && !isValidAgentName(agent))
        return { content: [{ type: "text", text: `invalid agent name: ${agent}` }], isError: true };
      return { content: [{ type: "text", text: listSchedules(agent) }] };
    }

    if (name === "history_search") {
      const agent = String(a.agent ?? "");
      const pattern = String(a.pattern ?? "");
      if (!agent || !pattern)
        return { content: [{ type: "text", text: "agent and pattern are required" }], isError: true };
      const result = await historySearch({
        agent,
        pattern,
        since: a.since != null ? String(a.since) : undefined,
        until: a.until != null ? String(a.until) : undefined,
        types: Array.isArray(a.types) ? (a.types as string[]) : undefined,
        raw: a.raw === true,
        limit: typeof a.limit === "number" ? a.limit : undefined,
        regex: a.regex === true,
      });
      return { content: [{ type: "text", text: result }] };
    }

    if (name === "create_agent") {
      const agent = String(a.agent ?? "");
      if (!agent) return { content: [{ type: "text", text: "agent is required" }], isError: true };
      if (!isValidAgentName(agent))
        return { content: [{ type: "text", text: `invalid agent name: ${agent}` }], isError: true };
      const r = run("/bin/bash", [CREATE_AGENT_SCRIPT, agent]);
      return { content: [{ type: "text", text: r.text }], isError: !r.ok };
    }

    return { content: [{ type: "text", text: `unknown tool: ${name}` }], isError: true };
  } catch (e) {
    return {
      content: [{ type: "text", text: `${name} failed: ${(e as Error).message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await mcp.connect(transport);
