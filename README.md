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

Ask your orchestrator to set up a nightly `git push` heartbeat task.

## Prerequisites

- Claude Code CLI ([anthropic.com/claude-code](https://www.anthropic.com/claude-code))
- `tmux`, `git`, `node`
- A Telegram account

### Where to Run It

We recommend a **Mac Mini** (or any always-on home server). A **cloud VM** (EC2, DigitalOcean, etc.) works fine too. The key requirements are:
- Always-on — agents need to stay running to receive Telegram messages and fire heartbeat tasks
- Persistent storage — agent memory, Telegram configs, OAuth tokens live on disk
- You can SSH in for occasional maintenance

## What You Get

- **Orchestrator agent** — Chief of Staff pattern, reachable via Telegram
- **Google Workspace MCP server** — Gmail, Calendar, Drive tools (read + write)
- **Heartbeat system** — Recurring tasks (email triage, briefings, monitoring) via OS crontab
- **Telegram integration** — via Claude Code's official Telegram plugin
- **Scripts** — Create new agents, start/restart existing ones

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

## Adding More Agents

Just ask your orchestrator via Telegram: "Add a coder agent" or "I need a finance agent." The orchestrator will scaffold the directory, walk you through creating a Telegram bot for it, configure the channel, and launch it.

You shouldn't need to run scripts manually — the orchestrator handles orchestration.

## License

MIT
