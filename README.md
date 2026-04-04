# Claude Code Teams

A template for running persistent Claude Code agents as a team, reachable via Telegram.

Each agent runs in a tmux session with its own identity, memory, docs, and Telegram bot. Agents share MCP servers for things like Gmail, Calendar, and Drive. Recurring tasks run via OS-level crontab that pokes each agent's session on a schedule.

## Quick Start

```bash
curl -fsSL https://cct.vantasoft.com/install.sh | bash
cd ~/agents/orchestrator
claude --dangerously-skip-permissions
```

The orchestrator agent will guide you through the rest — Telegram bot setup, Google OAuth (optional), heartbeat configuration.

## Recommended: Fork This Repo & Back Up Your Team

Your agent team will accumulate significant state over time: custom CLAUDE.md files, heartbeat tasks, agent-specific docs, memory files, learned rules for email triage, and more. **Fork this repo to your own GitHub account or organization**, then push your team's state to your fork regularly.

This gives you:
- **Disaster recovery** — if your host crashes or you need to migrate, your team's state is safe on GitHub
- **Version history** — see how your agents evolved, roll back changes
- **Cross-device consistency** — spin up your team on a new host by cloning your fork
- **Upstream updates** — pull new template improvements from this repo into your fork

Add a heartbeat task that runs `git push` nightly (see `agents/orchestrator/docs/disaster-recovery.md` for patterns).

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

Just ask your orchestrator via Telegram: "Add a coder agent" or "I need a finance agent." The orchestrator will scaffold the directory, walk you through creating a Telegram bot for it, configure the channel, and launch it.

You shouldn't need to run scripts manually — the orchestrator handles orchestration.

## License

MIT
