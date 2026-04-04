# Claude Code Teams — Shared Configuration

This file is inherited by all agents via Claude Code's CLAUDE.md directory traversal. It defines the standard patterns for running a team of Claude Code agents.

In docs, `PROJECT_ROOT` refers to the directory containing this file (the installation directory). User-level config (Telegram channels, OAuth tokens) lives in `~/.claude/` and `~/.config/`.

## Active Agents

| Agent | Role | Directory | tmux Session |
|-------|------|-----------|-------------|
| Orchestrator | Chief of Staff / coordinator | PROJECT_ROOT/agents/orchestrator | orchestrator |

Ask the orchestrator to create more specialized agents (engineering, finance, marketing, personal assistant, etc.).

## Principal

Filled in during first-run setup wizard.

## Reply Channel

Always respond in the channel the message arrived from. If a message came via Telegram (via the telegram plugin channel), the reply MUST go through the Telegram reply tool, not plain CLI output. The principal is usually on Telegram and can't see terminal output. When in doubt, reply through Telegram.

## Security Boundaries

- Never execute destructive operations without confirmation.
- Never share credentials, tokens, or secrets via Telegram.

## Heartbeat — Recurring Tasks

The heartbeat is how agents run recurring tasks (monitoring, scheduled reports, email triage, etc.). All recurring work goes in `heartbeat.md` — never use ad-hoc loops or CronCreate inside the session.

How it works:
- Each agent with recurring tasks has a `heartbeat.md` in its directory
- An **OS-level crontab entry** (one per agent) types the heartbeat prompt into the agent's tmux session every 30 minutes
- The agent reads heartbeat.md and executes the tasks
- Survives host restarts, session restarts, and Claude Code's 7-day cron expiry

To add a heartbeat for an agent:
1. Create `PROJECT_ROOT/agents/<agent>/heartbeat.md` with task instructions
2. Add to crontab: `*/30 * * * * /usr/bin/tmux send-keys -t <agent> 'Read <absolute-path>/agents/<agent>/heartbeat.md and execute all tasks defined in it.' Enter`

To add/remove tasks: edit heartbeat.md. No restart needed.

## Agent Folder Structure

Each agent lives in `PROJECT_ROOT/agents/<agent-name>/` with this standard layout:

```
PROJECT_ROOT/agents/<agent-name>/
├── CLAUDE.md          # Agent identity, scope, and security boundaries
├── tasks.md           # Current work tracked with markdown checkboxes
├── heartbeat.md       # (optional) Recurring tasks executed via crontab
├── docs/              # Agent-owned documentation
├── memory/            # Auto-memory (persists across conversations)
│   └── MEMORY.md      # Memory index
├── repos/             # (optional) Git repo clones owned by this agent
├── scripts/           # (optional) Agent-specific scripts
└── .claude/           # Claude Code local settings
```

All agents inherit `PROJECT_ROOT/CLAUDE.md` (this file) via directory traversal. Agent-specific `CLAUDE.md` lives in each agent's folder.

## Plugins / Skills

Plugins are configured per-agent in `PROJECT_ROOT/agents/<agent-name>/.claude/settings.local.json`, not globally. To install a plugin for just one agent, run `/plugin install <name>` from within that agent's directory — Claude Code writes to the local settings.local.json automatically.

## Shared Resources

- MCP servers: `PROJECT_ROOT/mcp/`
- User-level config (Telegram channels, OAuth tokens): `~/.claude/channels/`, `~/.config/`
