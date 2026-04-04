# Claude Code Teams — Shared Configuration

This file is inherited by all agents via Claude Code's CLAUDE.md directory traversal. It defines the standard patterns for running a team of Claude Code agents.

## First-Run Setup Wizard

If this is a fresh install, help the user set up their first agent (the orchestrator) step by step. Detect fresh install by checking:
- `~/.claude/channels/telegram-orchestrator/.env` does not exist → Telegram not configured yet
- No crontab entry for `orchestrator` heartbeat → heartbeat not set up

On detection, greet the user and offer to walk them through setup:

### Setup Flow

1. **Introduce yourself** — "Hi! I'm your orchestrator agent. It looks like this is a fresh install. Want me to walk you through setup?"

2. **Get principal info** — Ask for:
   - Their name
   - Their Telegram user ID (they can get it from @userinfobot on Telegram)
   Save to `~/CLAUDE.md` "Principal" section.

3. **Set up Telegram** — Guide them to:
   - DM @BotFather on Telegram
   - Send `/newbot`, name it (e.g. "My Orchestrator Bot")
   - Send `/setprivacy` → select bot → Disable (for group chat support)
   - Send bot token to you
   
   Then write:
   ```
   mkdir -p ~/.claude/channels/telegram-orchestrator
   ```
   Create `~/.claude/channels/telegram-orchestrator/.env` with `TELEGRAM_BOT_TOKEN=<token>`
   Create `~/.claude/channels/telegram-orchestrator/access.json` with dmPolicy "allowlist" and their user ID in allowFrom.
   Set chmod 600 on both.

4. **Offer heartbeat setup** — Ask if they want recurring tasks (email triage, monitoring, etc.). If yes:
   - Create `~/agents/orchestrator/heartbeat.md` template
   - Add crontab entry: `*/30 * * * * /usr/bin/tmux send-keys -t orchestrator 'Read ~/agents/orchestrator/heartbeat.md and execute all tasks defined in it.' Enter`

5. **Offer Google Workspace MCP setup** — Ask if they want Gmail/Calendar/Drive access. If yes:
   - Walk them through creating a Google Cloud OAuth client
   - Build the MCP server (`cd ~/mcp/google-workspace && npm install && npx tsc`)
   - Run the OAuth flow
   - Register in `~/.mcp.json`
   - Note that a restart is needed to load MCP tools.

6. **Final message** — Let them know they can ask for anything via Telegram: add new specialized agents, set up email triage, monitor services, etc. Tell them they shouldn't need to run commands manually — just ask you.

Keep the tone friendly, concise, and actionable. Don't dump all instructions at once — one step at a time.

## Adding New Agents

When the principal asks for a new specialized agent (e.g. "create a coder agent", "I need a finance agent"), handle it yourself:

1. **Scaffold the directory** — run `~/agents/orchestrator/scripts/create-agent.sh <name>`
2. **Customize the agent's CLAUDE.md** — ask the principal what the new agent should do, then write a role-specific CLAUDE.md in `~/agents/<name>/CLAUDE.md`
3. **Walk them through creating a Telegram bot** for the new agent (same flow as the orchestrator setup)
4. **Set up the Telegram channel** — create `~/.claude/channels/telegram-<name>/.env` and `access.json`
5. **Launch** — run `~/agents/orchestrator/scripts/start-agent.sh <name>`
6. **Update the Active Agents table** in `~/CLAUDE.md`

Offer to help customize the new agent's heartbeat, docs, or scope. The principal should never need to touch a terminal.

## Active Agents

| Agent | Role | Directory | tmux Session |
|-------|------|-----------|-------------|
| Orchestrator | Chief of Staff / coordinator | ~/agents/orchestrator | orchestrator |

Add your own specialized agents (engineering, finance, marketing, personal assistant, etc.) by running `~/agents/orchestrator/scripts/create-agent.sh <name>`.

## Principal

Fill in during setup wizard.

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

To add a heartbeat for a new agent:
1. Create `~/agents/<agent>/heartbeat.md` with task instructions
2. Add to crontab: `*/30 * * * * /usr/bin/tmux send-keys -t <agent> 'Read ~/agents/<agent>/heartbeat.md and execute all tasks defined in it.' Enter`

To add/remove tasks: edit heartbeat.md. No restart needed.

## Agent Folder Structure

Each agent lives in `~/agents/<agent-name>/` with this standard layout:

```
~/agents/<agent-name>/
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

All agents inherit `~/CLAUDE.md` (this file) via directory traversal. Agent-specific `CLAUDE.md` lives in each agent's folder.

## Plugins / Skills

Plugins are configured per-agent in `~/agents/<agent-name>/.claude/settings.local.json`, not globally. To install a plugin for just one agent, run `/plugin install <name>` from within that agent's directory — Claude Code writes to the local settings.local.json automatically.

## Shared Resources

- MCP servers: `~/mcp/`
