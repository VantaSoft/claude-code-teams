# Disaster Recovery

After a host crash or reboot, follow these steps to restore all agents.

## Quick Start

```bash
# SSH into the host:
cd ~/agents/orchestrator
claude --continue --dangerously-skip-permissions
# Then tell the orchestrator: "Read docs/disaster-recovery.md and start all agents"
```

## Step-by-Step Recovery

### 1. Verify the host is healthy

```bash
tmux list-sessions          # Should be empty after a crash
ls ~/.claude/channels/      # Telegram configs should exist
```

### 2. Start all agents

Run start-agent.sh for each agent:
```bash
~/agents/orchestrator/scripts/start-agent.sh orchestrator
~/agents/orchestrator/scripts/start-agent.sh <other-agent>
```

### 3. Verify agents are running

```bash
tmux list-sessions
```

### 4. Test Telegram connectivity

Message each bot on Telegram to confirm they respond.

## What Survives a Crash

| What | Where | Survives? |
|------|-------|-----------|
| Code, config, docs | Git repo | Yes |
| Agent memory | ~/agents/*/memory/ (git tracked) | Yes |
| Telegram channel configs | ~/.claude/channels/ | Yes (on disk) |
| Google OAuth tokens | ~/.config/google-workspace-mcp/ | Yes (on disk) |
| MCP server source | ~/mcp/ (git tracked) | Yes |
| Bot tokens (.env) | ~/.claude/channels/telegram-*/.env | Yes (on disk, not git tracked) |
| Crontab (heartbeats) | user crontab | Yes |

## What We Lose

| What | Impact | Recovery |
|------|--------|----------|
| tmux sessions | All agents go down | Run start-agent.sh for each |
| Conversation context | --continue may not find last session | Agents start fresh if session files lost |
| MCP server dist/ | Build artifacts not git tracked | `cd ~/mcp/<server> && npm install && npx tsc` |
| In-flight work | Any mid-task work is lost | Agents resume from last known state |

## If MCP Server Needs Rebuilding

```bash
cd ~/mcp/google-workspace
npm install
npx tsc
```

## If Telegram Configs Are Lost

Bot tokens must be regenerated via @BotFather. For each agent, recreate:
- `~/.claude/channels/telegram-<agent>/.env` with `TELEGRAM_BOT_TOKEN=<token>`
- `~/.claude/channels/telegram-<agent>/access.json` with principal's Telegram user ID in allowFrom

## If Google OAuth Tokens Are Lost

Re-run the setup flow:
1. Credentials file should still be at `~/.config/google-workspace-mcp/credentials.json`
2. If `tokens.json` or `tokens-<account>.json` is missing, run the setup flow for each account:
   ```bash
   cd ~/mcp/google-workspace && node dist/setup.js <account-name>
   ```
3. Open the generated OAuth URL, sign in, approve. Tokens will be saved automatically.
