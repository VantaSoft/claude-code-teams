# Slack Setup

Per-agent deployment guide for the Slack channel plugin (`mcp/slack-channel/`).
Each agent gets its own Slack App + bot + tokens. The plugin runs in-process (like Telegram), no separate listener needed.

Takes ~5 minutes per agent once you've done it once.

## Prerequisites (one-time, across the whole host)

- Bun installed (`curl -fsSL https://bun.sh/install | bash` or `brew install oven-sh/bun/bun`).
- `mcp/slack-channel/` has dependencies: `cd PROJECT_ROOT/mcp/slack-channel && bun install`.
- `start-agent.sh` auto-detects Slack: if `~/.claude/channels/slack-<agent>/.env` exists, it adds `--dangerously-load-development-channels server:slack` and sets `SLACK_STATE_DIR`.

## Per-agent steps

Replace `<agent>` with the agent's name (matches the tmux session + folder name).

### 1. Create a Slack App

At https://api.slack.com/apps, **Create New App > From a manifest**, paste the JSON from `PROJECT_ROOT/slack-manifest.json` (change `AGENT_NAME` and `AGENT_ROLE` to the agent's display name and role).

Key setting: `messages_tab_enabled: true` + `messages_tab_read_only_enabled: false` under `app_home` is what enables DMs. Without this, "sending messages has been turned off" appears in the DM tab.

After creating:
1. **Generate app-level token**: Settings > Basic Information > App-Level Tokens > Generate Token with `connections:write` scope. That's `SLACK_APP_TOKEN` (xapp-).
2. **Install to workspace**, copy **Bot User OAuth Token** from OAuth & Permissions. That's `SLACK_BOT_TOKEN` (xoxb-).
3. **Invite the bot** to each channel it should listen in: `/invite @<bot-name>`.

### 2. Run the setup script

```bash
PROJECT_ROOT/agents/orchestrator/scripts/setup-slack.sh <agent> <xoxb-token> <xapp-token> <your-slack-user-id> [channel-ids...]
```

This one command:
- Creates `~/.claude/channels/slack-<agent>/` with `.env` (tokens) and `access.json` (DM allowlist + channels), both chmod 600
- Merges a `slack` MCP server entry into the agent's `.mcp.json`
- Restarts the agent via `start-agent.sh`
- Auto-approves the one-time dev-channel confirmation prompt

### 3. Live test

DM the bot (or post in an allowlisted channel with `@<bot>`). Expected:

- A channel tag appears in the agent's tmux pane as a user prompt.
- The agent's UserPromptSubmit reminder hook (`channel-reply-reminder`) fires and injects a reminder pointing at `mcp__channel-slack__slack_reply` with the right `channel_id`.
- The agent responds via `slack_reply` and the reply lands in Slack.

## Finding Slack IDs

Always use Slack IDs, not human-readable names (#board, @username, etc.).

- **Channel ID** (starts with `C`): In Slack, right-click the channel name > "View channel details" > scroll to the bottom.
- **Group DM ID** (starts with `G`): Same as above, open the conversation details.
- **User ID** (starts with `U`): Click someone's profile picture > "..." > "Copy member ID".

## Adding a channel after initial setup

1. Get the channel ID (see above).
2. Invite the bot to the channel: `/invite @<bot-name>`.
3. Add the channel ID to the `channels` array in `~/.claude/channels/slack-<agent>/access.json`.
4. No restart needed. The plugin re-reads access.json on every message.

## Removing Slack from an agent

1. Delete the `slack` entry from `PROJECT_ROOT/agents/<agent>/.mcp.json`.
2. (Optional) Revoke tokens in the Slack App's Install App page.
3. Restart the agent's tmux session.

## Process architecture

Each Slack-enabled agent runs 2 extra bun processes (in addition to Telegram's 2):

| Process | Role |
|---------|------|
| Slack MCP parent | Slack MCP server loader |
| Slack MCP child | Slack Socket Mode + WebClient |

### Graceful shutdown

`start-agent.sh` sends `/exit` to Claude Code before killing the tmux session. This gives Claude Code a chance to shut down its child MCP processes cleanly. Without this, orphan bun processes hold the Socket Mode WebSocket and block subsequent restarts.

**Never use `killall bun`** — it kills ALL agents' MCP processes, causing a fleet-wide crash.

## Troubleshooting

- **Agent restarted but `slack_reply` tool not available:** Check `.mcp.json` exists at the agent's working directory and that `~/.claude/channels/slack-<agent>/.env` has both tokens. Look for MCP errors in the agent's Claude Code startup output.
- **"Development channel" prompt blocks startup:** Approve remotely with `tmux send-keys -t <agent> Enter`. One-time per agent.
- **Bot doesn't respond in a channel:** Ensure the bot is invited to the channel (`/invite @bot`) AND the channel ID is in access.json's `channels` array.
- **Bot doesn't respond to DMs:** Check `dmPolicy` is `"allowlist"` and the user's ID is in `allowFromUsers`. Also verify `messages_tab_enabled: true` in the app manifest.
- **Inbound dead, no errors:** Check for orphan bun processes. Restart the agent with `start-agent.sh` (uses `/exit` for clean shutdown).
