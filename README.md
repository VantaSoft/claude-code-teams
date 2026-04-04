# Claude Code Teams

A template for running persistent Claude Code agents as a team, reachable via Telegram.

Each agent runs in a tmux session with its own identity, memory, docs, and Telegram bot. Agents share MCP servers for things like Gmail, Calendar, and Drive. Recurring tasks run via OS-level crontab that pokes each agent's session on a schedule.

## What You Get

- **One orchestrator agent** out of the box (Chief of Staff pattern)
- **Google Workspace MCP server** with Gmail, Calendar, and Drive tools (read + write)
- **Heartbeat system** for recurring tasks (email triage, morning briefings, monitoring)
- **Scripts** to create, start, and restart agents
- **Telegram integration** via Claude Code's official Telegram plugin

## Architecture

```
~/
├── CLAUDE.md              # Shared config inherited by all agents
├── .mcp.json              # MCP server registry (shared)
├── agents/
│   └── orchestrator/      # Chief of staff (reference agent)
│       ├── CLAUDE.md
│       ├── tasks.md
│       ├── heartbeat.md   # (create when you add recurring tasks)
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

## Quick Start

See [SETUP.md](SETUP.md) for the full walkthrough.

Short version:
1. Clone into `~/` so files land at the right paths
2. Install Claude Code
3. Create a Telegram bot via @BotFather
4. Set up the Telegram channel config
5. Start the orchestrator
6. (Optional) Set up Google Workspace MCP for email/calendar access

## Heartbeat — Recurring Tasks

Each agent can have a `heartbeat.md` with recurring tasks. An OS-level crontab entry types the heartbeat prompt into the agent's tmux session every 30 minutes:

```
*/30 * * * * /usr/bin/tmux send-keys -t orchestrator 'Read ~/agents/orchestrator/heartbeat.md and execute all tasks defined in it.' Enter
```

This survives restarts, the 7-day Claude Code cron expiry, and session crashes.

## Adding More Agents

```bash
~/agents/orchestrator/scripts/create-agent.sh coder
```

Scaffolds a new agent directory. Then create a Telegram bot for it, set up the channel, and launch.

## License

MIT
