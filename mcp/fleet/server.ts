#!/usr/bin/env bun
/**
 * fleet — stdio MCP server exposing cross-agent primitives any agent might
 * need, plus orchestrator-only provisioning tools intended for the
 * designated orchestrator agent.
 *
 * Tool surface:
 *   start_agent(agent, channels)   — launch or restart an agent in tmux
 *   compact_agent(agent)           — send /compact to an agent's tmux session
 *   message_agent(agent, message)  — type a message into an agent's tmux session
 *   context_check(agent?)          — token usage for one or all agents
 *   agent_status(agent?)           — working / idle / waiting_input snapshot
 *   list_mcps(agent?, verbose?)    — MCP servers each agent has configured
 *   sync_schedules()               — re-install MANAGED crontab block
 *   create_agent(agent)            — scaffold a new PROJECT_ROOT/agents/<agent>/
 *
 * Shell scripts that do the actual work live under this MCP's own
 * scripts/ subdir. context_check, agent_status, and list_mcps are
 * implemented inline in TypeScript — they only need to read files and
 * introspect tmux panes, no subprocess shell needed.
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
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
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

const START_SCRIPT = join(SCRIPTS_DIR, "start-agent.sh");
const COMPACT_SCRIPT = join(SCRIPTS_DIR, "compact-agent.sh");
const MESSAGE_SCRIPT = join(SCRIPTS_DIR, "message-agent.sh");
const SYNC_SCHEDULES = join(SCRIPTS_DIR, "sync-schedules.sh");
const CREATE_AGENT_SCRIPT = join(SCRIPTS_DIR, "create-agent.sh");

// --- helpers -----------------------------------------------------------

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
  const lines = readFileSync(file, "utf8").split("\n");
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

  let lastToolCall: AgentStatus["last_tool_call"] = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/^⏺\s+([A-Za-z][\w\-\s\(\)]*?)\(([^)]*)/);
    if (m) {
      lastToolCall = { tool: m[1].trim(), summary: (m[2] ?? "").slice(0, 120) };
      break;
    }
  }

  let lastMessage: string | null = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (l.startsWith("⏺ ") && !/^⏺\s+[A-Za-z][\w\-\s\(\)]*?\(/.test(l)) {
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

// --- MCP plumbing ------------------------------------------------------

const mcp = new Server(
  { name: "fleet", version: "0.1.0" },
  {
    capabilities: { tools: {} },
    instructions:
      "fleet exposes cross-agent primitives (start_agent, compact_agent, message_agent, context_check, agent_status, list_mcps) and orchestrator-only tools (sync_schedules, create_agent). start/compact/message require explicit principal approval before use on another agent — see the shared CLAUDE.md messaging-other-agents section. sync_schedules and create_agent are orchestrator-only; only the orchestrator agent should call them. Slack provisioning is not exposed as a tool on purpose; run PROJECT_ROOT/agents/orchestrator/scripts/setup-slack.sh manually when adding a new agent.",
  },
);

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "start_agent",
      description:
        "Launch or restart an agent in a tmux session with the given channels (slack, telegram, discord, imessage). Channels are explicit positional args — no auto-detection. FOOTGUN: never call this on the orchestrator from inside the orchestrator's own session without wrapping in nohup; it will kill the calling shell.",
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
      name: "create_agent",
      description:
        "Scaffold a new agent folder at PROJECT_ROOT/agents/<agent>/ with CLAUDE.md, memory/, docs/, schedules/, and .claude/. Fails if the directory already exists. Does NOT wire up Slack or start the agent — run PROJECT_ROOT/agents/orchestrator/scripts/setup-slack.sh manually (it's kept as a standalone script because it takes Slack tokens) and then call start_agent after.",
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
    if (name === "start_agent") {
      const agent = String(a.agent ?? "");
      const channels = Array.isArray(a.channels) ? (a.channels as string[]) : [];
      if (!agent || channels.length === 0)
        return { content: [{ type: "text", text: "agent and at least one channel are required" }], isError: true };
      const r = run(START_SCRIPT, [agent, ...channels]);
      return { content: [{ type: "text", text: r.text }], isError: !r.ok };
    }

    if (name === "compact_agent") {
      const agent = String(a.agent ?? "");
      if (!agent) return { content: [{ type: "text", text: "agent is required" }], isError: true };
      const r = run(COMPACT_SCRIPT, [agent]);
      return { content: [{ type: "text", text: r.text }], isError: !r.ok };
    }

    if (name === "message_agent") {
      const agent = String(a.agent ?? "");
      const message = String(a.message ?? "");
      if (!agent || !message)
        return { content: [{ type: "text", text: "agent and message are required" }], isError: true };
      const r = run(MESSAGE_SCRIPT, [agent, message]);
      return { content: [{ type: "text", text: r.text }], isError: !r.ok };
    }

    if (name === "context_check") {
      const agent = a.agent != null ? String(a.agent) : undefined;
      return { content: [{ type: "text", text: contextCheck(agent) }] };
    }

    if (name === "agent_status") {
      const agent = a.agent != null ? String(a.agent) : undefined;
      return { content: [{ type: "text", text: agentStatus(agent) }] };
    }

    if (name === "list_mcps") {
      const agent = a.agent != null ? String(a.agent) : undefined;
      const verbose = a.verbose === true;
      return { content: [{ type: "text", text: listMcps(agent, verbose) }] };
    }

    if (name === "sync_schedules") {
      const r = run("/bin/bash", [SYNC_SCHEDULES]);
      return { content: [{ type: "text", text: r.text }], isError: !r.ok };
    }

    if (name === "create_agent") {
      const agent = String(a.agent ?? "");
      if (!agent) return { content: [{ type: "text", text: "agent is required" }], isError: true };
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
