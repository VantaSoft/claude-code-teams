# Claude Code Teams

A template for running persistent Claude Code agents as a team, reachable via the messaging channel of your choice.

**Supported channels:**
- **Telegram** — via Claude Code's official channel plugin
- **iMessage** — via Claude Code's official channel plugin (macOS only)
- **Discord** — via Claude Code's official channel plugin
- **Slack** — via the included `mcp/slack-channel` MCP server (Socket Mode, no public URL needed)

Telegram, iMessage, and Discord ride on first-party Claude Code plugins. Slack is a custom MCP server shipped with this repo. You can run any combination — agents can be on one channel, several, or all of them simultaneously.

Each agent runs in a tmux session with its own identity, memory, docs, and messaging credentials. Agents share MCP servers for things like Gmail, Calendar, Drive, and Slack. Recurring tasks run via OS-level crontab that pokes each agent's session on a schedule.

## Quick Start

```bash
cd ~    # or wherever you want to install
curl -fsSL https://cct.vantasoft.com/install.sh | bash
cd claude-code-teams/agents/orchestrator
claude --dangerously-skip-permissions
```

When Claude launches, say hi — any first message triggers the wizard. The orchestrator will walk you through picking a channel, configuring it, and relaunching itself under tmux with that channel connected.

## Prerequisites

- Claude Code CLI ([anthropic.com/claude-code](https://www.anthropic.com/claude-code))
- `git` (already on most Macs/Linux boxes)
- An account with the messaging service you want to use (Telegram, iMessage, Discord, or Slack)

The orchestrator will install `tmux` and `node` for you on first launch if they're missing.

### Where to Run It

We recommend a **Mac Mini** (or any always-on home server). A **cloud VM** (EC2, DigitalOcean, etc.) works fine too. The key requirements are:
- Always-on — agents need to stay running to receive inbound messages and fire scheduled tasks
- Persistent storage — agent memory, channel configs, OAuth tokens live on disk
- You can SSH in for occasional maintenance

(iMessage requires macOS specifically. The other channels work on Linux too.)

## What You Get

- **Orchestrator agent** — Chief of Staff pattern, reachable via your chosen channel(s)
- **Channel integrations:**
  - Telegram, iMessage, Discord — via Claude Code's first-party plugins
  - Slack — via the included `mcp/slack-channel` MCP server (Socket Mode + WebClient, with auto-react progress indicator)
- **Google Workspace MCP server** — Gmail, Calendar, Drive tools (read + write)
- **Schedules system** — Per-task `.md` files with cron frontmatter, synced to OS crontab (email triage, briefings, monitoring)
- **Fleet MCP** — Orchestration primitives available to every agent as MCP tools: start, compact, message, context-check, agent-status, list-mcps, sync-schedules, create-agent

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
│       ├── scripts/        # Orchestrator-specific tooling
│       │   └── setup-slack.sh   # Kept as standalone script (takes tokens)
│       └── .claude/
├── hooks/                  # Shared Claude Code hooks (channel-reply-reminder, etc.)
└── mcp/
    ├── fleet/              # Cross-agent primitives + orchestrator tools (includes history_search for session jsonl)
    │   ├── server.ts       # MCP server (TypeScript)
    │   └── scripts/        # Shell scripts the fleet MCP shells out to
    │       ├── restart-agent.sh
    │       ├── compact-agent.sh
    │       ├── message-agent.sh
    │       └── create-agent.sh
    ├── google-workspace/  # Gmail, Calendar, Drive, Docs
    └── slack-channel/     # Slack integration (Socket Mode + WebClient)

~/.claude/channels/         # Telegram/Discord/iMessage/Slack channel configs (user home)
~/.config/                  # OAuth tokens, etc. (user home)
```

Each agent:
- Runs in its own tmux session
- Has its own channel credentials (one or more of Telegram, iMessage, Discord, Slack)
- Has its own memory folder (persists across conversations)
- Inherits the project root `CLAUDE.md` (shared) + its own `CLAUDE.md` (role-specific)

## Adding Slack

Any agent can be connected to Slack (in addition to or instead of any other channel). See `agents/orchestrator/docs/slack-setup.md` for the full guide, or use the one-command setup. Kept as a standalone shell script (rather than a fleet MCP tool) because it takes Slack tokens as arguments, which shouldn't land in an MCP tool call jsonl:

```bash
agents/orchestrator/scripts/setup-slack.sh <agent> <xoxb-token> <xapp-token> <your-slack-user-id> [channel-ids...]
```

This creates a Slack App per agent using Socket Mode (no public URL or webhook needed). Agents can be on any combination of channels — Telegram only, Slack only, both, or all four (Telegram + iMessage + Discord + Slack) simultaneously.

## Adding More Agents

Just ask your orchestrator: "Add a coder agent" or "I need a finance agent." The orchestrator will scaffold the directory, walk you through creating credentials for the new agent's channel(s), configure them, and launch it.

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
