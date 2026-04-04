# Setup Guide

Step-by-step guide to bring up your first Claude Code agent team.

## Prerequisites

- A host (Linux/macOS) with:
  - Claude Code CLI installed ([anthropic.com/claude-code](https://www.anthropic.com/claude-code))
  - `tmux`
  - `git`
  - `node` (for MCP servers)
- A Telegram account
- A Google account (optional, for Gmail/Calendar/Drive integration)

## 1. Clone the Repo

Clone directly into your home directory so paths align with `~/agents/`, `~/mcp/`, etc.

```bash
cd ~
git clone https://github.com/vantasoft/claude-code-teams.git temp
mv temp/.git .git
mv temp/* temp/.[^.]* . 2>/dev/null
rmdir temp
```

Or, if starting fresh: fork the repo, then clone into `~/` as its working directory.

## 2. Edit the Shared CLAUDE.md

Open `~/CLAUDE.md` and fill in your principal section — who the agents serve, Telegram chat ID, etc.

Your Telegram chat ID: send `/start` to [@userinfobot](https://t.me/userinfobot) to get yours.

## 3. Create a Telegram Bot for the Orchestrator

1. DM [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot`, follow prompts to name it (e.g. "My Orchestrator Bot")
3. Copy the bot token (looks like `123456789:ABCdef...`)
4. **Important**: Send `/setprivacy`, select your bot, choose **Disable**. This lets the bot see all group messages, not just @mentions.

## 4. Configure the Telegram Channel

```bash
mkdir -p ~/.claude/channels/telegram-orchestrator
```

Create `~/.claude/channels/telegram-orchestrator/.env`:
```
TELEGRAM_BOT_TOKEN=<your-bot-token>
```

Create `~/.claude/channels/telegram-orchestrator/access.json` (replace with your Telegram user ID):
```json
{
  "dmPolicy": "allowlist",
  "allowFrom": ["YOUR_TELEGRAM_USER_ID"],
  "groups": {},
  "pending": {}
}
```

Secure the files:
```bash
chmod 600 ~/.claude/channels/telegram-orchestrator/.env
chmod 600 ~/.claude/channels/telegram-orchestrator/access.json
```

## 5. Start the Orchestrator

```bash
~/agents/orchestrator/scripts/start-agent.sh orchestrator
```

The orchestrator will start in a tmux session. DM your bot on Telegram — it should respond.

**First launch note**: Claude Code shows a directory-trust prompt. Approve it remotely with:
```bash
tmux send-keys -t orchestrator Enter
```

## 6. (Optional) Set Up Google Workspace MCP

Gives your agents Gmail, Calendar, and Drive tools.

### 6a. Create a Google Cloud OAuth Client

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create or select a project
3. Enable APIs: **Gmail API**, **Google Calendar API**, **Google Drive API**
4. Configure OAuth consent screen (External, test mode is fine for personal use)
5. Add your email as a test user
6. Credentials → Create OAuth 2.0 Client ID → Desktop app
7. Download the JSON file

### 6b. Save Credentials

```bash
mkdir -p ~/.config/google-workspace-mcp
mv ~/Downloads/client_secret_*.json ~/.config/google-workspace-mcp/credentials.json
```

### 6c. Build the MCP Server

```bash
cd ~/mcp/google-workspace
npm install
npx tsc
```

### 6d. Authorize Your Google Account

```bash
node dist/setup.js default
```

This prints an OAuth URL. Open it in a browser, sign in, approve. The callback writes tokens to `~/.config/google-workspace-mcp/tokens.json`.

### 6e. Register the MCP Server

Create `~/.mcp.json`:
```json
{
  "mcpServers": {
    "google-workspace": {
      "command": "node",
      "args": ["/home/YOUR_USER/mcp/google-workspace/dist/index.js"]
    }
  }
}
```

(Replace `YOUR_USER` with your actual username, e.g. `ubuntu`.)

Restart the orchestrator to load the new MCP server:
```bash
~/agents/orchestrator/scripts/start-agent.sh orchestrator
```

## 7. (Optional) Set Up Heartbeat

For recurring tasks (email triage, morning briefings, monitoring):

1. Create `~/agents/orchestrator/heartbeat.md` describing the tasks
2. Add a crontab entry:
   ```bash
   crontab -e
   ```
   Append:
   ```
   */30 * * * * /usr/bin/tmux send-keys -t orchestrator 'Read ~/agents/orchestrator/heartbeat.md and execute all tasks defined in it.' Enter
   ```

The agent will execute heartbeat tasks every 30 minutes.

## 8. Adding More Agents

```bash
~/agents/orchestrator/scripts/create-agent.sh coder
```

Scaffolds a new agent at `~/agents/coder/`. Then repeat steps 3-5 for the new agent (create bot, set up channel, launch).

## Troubleshooting

**Bot not responding**: Check the tmux session for errors (`tmux attach -t orchestrator`), verify the bot token is correct, confirm your Telegram user ID is in the allowlist.

**MCP tools not available**: Restart the agent after updating `~/.mcp.json`. The MCP server is spawned when the session starts.

**Heartbeat not firing**: Check `crontab -l` to verify the entry exists. Verify the tmux session name matches the agent name.

**Agent not inheriting shared CLAUDE.md**: Make sure `~/CLAUDE.md` exists and the agent's working directory is inside `~/agents/<name>/`. Claude Code traverses up from the working directory.
