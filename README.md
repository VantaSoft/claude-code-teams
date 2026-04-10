# Claude Code Teams

A template for running persistent Claude Code agents as a team, reachable via Telegram and/or Slack.

Each agent runs in a tmux session with its own identity, memory, docs, and messaging channel (Telegram bot, Slack bot, or both). Agents share MCP servers for things like Gmail, Calendar, Drive, and Slack. Recurring tasks run via OS-level crontab that pokes each agent's session on a schedule.

## Quick Start

```bash
cd ~    # or wherever you want to install
curl -fsSL https://cct.vantasoft.com/install.sh | bash
cd claude-code-teams/agents/orchestrator
claude --dangerously-skip-permissions
```

When Claude launches, say hi — any first message triggers the wizard. The orchestrator will walk you through installing the Telegram plugin, creating your bot, and relaunching itself under tmux with Telegram connected.

## Prerequisites

- Claude Code CLI ([anthropic.com/claude-code](https://www.anthropic.com/claude-code))
- `git` (already on most Macs/Linux boxes)
- A Telegram account (for initial setup; Slack can be added later)

The orchestrator will install `tmux` and `node` for you on first launch if they're missing.

### Where to Run It

We recommend a **Mac Mini** (or any always-on home server). A **cloud VM** (EC2, DigitalOcean, etc.) works fine too. The key requirements are:
- Always-on — agents need to stay running to receive Telegram messages and fire scheduled tasks
- Persistent storage — agent memory, Telegram configs, OAuth tokens live on disk
- You can SSH in for occasional maintenance

## What You Get

- **Orchestrator agent** — Chief of Staff pattern, reachable via Telegram and/or Slack
- **Google Workspace MCP server** — Gmail, Calendar, Drive tools (read + write)
- **Slack channel MCP server** — Slack integration via Socket Mode (no public URL needed)
- **Schedules system** — Per-task .md files with cron frontmatter, synced to OS crontab (email triage, briefings, monitoring)
- **Telegram integration** — via Claude Code's official Telegram plugin
- **Slack integration** — via the included Slack channel MCP server (Socket Mode + WebClient)
- **Scripts** — Create new agents, start/restart existing ones, one-command Slack setup

## Architecture

```
claude-code-teams/          # The install directory
├── CLAUDE.md              # Shared config inherited by all agents
├── agents/
│   └── orchestrator/      # Chief of staff (reference agent)
│       ├── CLAUDE.md
│       ├── tasks.md
│       ├── schedules/      # One .md per recurring task, with cron frontmatter
│       ├── docs/
│       ├── memory/
│       ├── scripts/
│       │   ├── start-agent.sh
│       │   ├── create-agent.sh
│       │   └── sync-schedules.sh
│       └── .claude/
└── mcp/
    ├── google-workspace/  # Gmail, Calendar, Drive MCP server
    └── slack-channel/     # Slack integration (Socket Mode + WebClient)

~/.claude/channels/         # Telegram/Slack bot configs (user home)
~/.config/                  # OAuth tokens, etc. (user home)
~/.mcp.json                 # MCP server registry (user home, created during setup)
```

Each agent:
- Runs in its own tmux session
- Has its own Telegram bot and/or Slack bot
- Has its own memory folder (persists across conversations)
- Inherits the project root `CLAUDE.md` (shared) + its own `CLAUDE.md` (role-specific)

## Adding Slack

Any agent can be connected to Slack (in addition to or instead of Telegram). See `agents/orchestrator/docs/slack-setup.md` for the full guide, or use the one-command setup:

```bash
agents/orchestrator/scripts/setup-slack.sh <agent> <xoxb-token> <xapp-token> <your-slack-user-id> [channel-ids...]
```

This creates a Slack App per agent using Socket Mode (no public URL or webhook needed). Agents can be on Telegram only, Slack only, or both simultaneously.

## Adding More Agents

Just ask your orchestrator via Telegram: "Add a coder agent" or "I need a finance agent." The orchestrator will scaffold the directory, walk you through creating a Telegram bot for it, configure the channel, and launch it.

You shouldn't need to run scripts manually — the orchestrator handles orchestration.

## Back Up Your Team

Your agent team accumulates state over time: CLAUDE.md files, schedules, agent-specific docs, memory files, learned triage rules. **Fork this repo** and push your team's state to your fork regularly for:

- **Disaster recovery** if your host crashes
- **Version history** to see how your agents evolved
- **Cross-device consistency** to spin up your team on a new host
- **Upstream updates** to pull template improvements into your fork

Ask your orchestrator to set up a nightly `git push` schedule.

## License

MIT
