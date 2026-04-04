# Claude Code Teams

A template for running persistent Claude Code agents as a team, reachable via Telegram.

Each agent runs in a tmux session with its own identity, memory, docs, and Telegram bot. Agents share MCP servers for things like Gmail, Calendar, and Drive. Recurring tasks run via OS-level crontab that pokes each agent's session on a schedule.

## Quick Start

```bash
curl -fsSL https://raw.githubusercontent.com/VantaSoft/claude-code-teams/main/install.sh | bash
cd ~/agents/orchestrator
claude --dangerously-skip-permissions
```

The orchestrator agent will guide you through the rest — Telegram bot setup, Google OAuth (optional), heartbeat configuration.

## Prerequisites

- Claude Code CLI ([anthropic.com/claude-code](https://www.anthropic.com/claude-code))
- `tmux`, `git`, `node`
- A Telegram account

## What You Get

- **Orchestrator agent** — Chief of Staff pattern, reachable via Telegram
- **Google Workspace MCP server** — Gmail, Calendar, Drive tools (read + write)
- **Heartbeat system** — Recurring tasks via OS crontab
- **Scripts** — Create new agents, start/restart existing ones
- **Telegram integration** via Claude Code's official Telegram plugin

## Architecture

```
~/
├── CLAUDE.md              # Shared config inherited by all agents
├── .mcp.json              # MCP server registry (created during setup)
├── agents/
│   └── orchestrator/      # Chief of staff (reference agent)
│       ├── CLAUDE.md
│       ├── tasks.md
│       ├── heartbeat.md   # Created when you add recurring tasks
│       ├── docs/
│       ├── memory/
│       ├── scripts/
│       │   ├── start-agent.sh
│       │   └── create-agent.sh
│       └── .claude/
└── mcp/
    └── google-workspace/  # Gmail, Calendar, Drive MCP server
```

Each agent:
- Runs in its own tmux session
- Has its own Telegram bot
- Has its own memory folder (persists across conversations)
- Inherits `~/CLAUDE.md` (shared) + its own `CLAUDE.md` (role-specific)

## Heartbeat — Recurring Tasks

Each agent can have a `heartbeat.md` with recurring tasks. An OS-level crontab entry types the heartbeat prompt into the agent's tmux session every 30 minutes:

```
*/30 * * * * /usr/bin/tmux send-keys -t orchestrator 'Read ~/agents/orchestrator/heartbeat.md and execute all tasks defined in it.' Enter
```

This survives restarts, the 7-day Claude Code cron expiry, and session crashes.

## Adding More Agents

From within your orchestrator session, ask it to create a new agent, or run:

```bash
~/agents/orchestrator/scripts/create-agent.sh coder
```

Then set up a Telegram bot for the new agent and launch it.

## Manual Setup

If you'd rather set up everything manually, see [SETUP.md](SETUP.md).

## License

MIT
