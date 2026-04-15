#!/bin/bash
# Set up Slack for an agent in one shot.
# Usage: setup-slack.sh <agent-name> <xoxb-bot-token> <xapp-app-token> <principal-slack-user-id> [channel-ids...]
#
# Example:
#   setup-slack.sh orchestrator xoxb-... xapp-... UXXXXXXXXXX
#   setup-slack.sh coder xoxb-... xapp-... UXXXXXXXXXX C05MEDFB3TJ C02A3HN2AAE
set -e

AGENT="${1:?Usage: setup-slack.sh <agent> <xoxb-token> <xapp-token> <principal-user-id> [channel-ids...]}"
BOT_TOKEN="${2:?Missing xoxb- bot token}"
APP_TOKEN="${3:?Missing xapp- app token}"
PRINCIPAL_ID="${4:?Missing principal Slack user ID (starts with U)}"
shift 4
CHANNELS=("$@")

# Project root is 3 levels up from this script: scripts/ -> orchestrator/ -> agents/ -> root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

STATE_DIR="$HOME/.claude/channels/slack-$AGENT"
AGENT_DIR="$PROJECT_ROOT/agents/$AGENT"
MCP_JSON="$AGENT_DIR/.mcp.json"

if [ ! -d "$AGENT_DIR" ]; then
  echo "Error: Agent directory $AGENT_DIR does not exist"
  exit 1
fi

# 1. Validate bot token before writing anything
echo "Validating bot token..."
AUTH_RESULT=$(SLACK_BOT_TOKEN="$BOT_TOKEN" bun -e "
  const { WebClient } = require('@slack/web-api');
  const web = new WebClient(process.env.SLACK_BOT_TOKEN);
  web.auth.test().then(r => {
    console.log(JSON.stringify({ ok: true, user: r.user, team: r.team }));
  }).catch(e => {
    console.log(JSON.stringify({ ok: false, error: e.message }));
    process.exit(1);
  });
" 2>/dev/null) || {
  echo "Error: Bot token validation failed. Check that the xoxb- token is correct and the app is installed to your workspace."
  exit 1
}
echo "Token valid: $(echo "$AUTH_RESULT" | jq -r '.user // "unknown"') @ $(echo "$AUTH_RESULT" | jq -r '.team // "unknown"')"

# 2. Create state dir + tokens
mkdir -p "$STATE_DIR"
cat > "$STATE_DIR/.env" <<EOF
SLACK_BOT_TOKEN=$BOT_TOKEN
SLACK_APP_TOKEN=$APP_TOKEN
EOF
chmod 600 "$STATE_DIR/.env"

# 3. Build channels JSON array
CH_JSON="[]"
if [ ${#CHANNELS[@]} -gt 0 ]; then
  CH_JSON=$(printf '%s\n' "${CHANNELS[@]}" | jq -R . | jq -s .)
fi

# 4. Write access.json
cat > "$STATE_DIR/access.json" <<EOF
{
  "dmPolicy": "allowlist",
  "allowFromUsers": ["$PRINCIPAL_ID"],
  "channels": $CH_JSON,
  "ackReaction": ""
}
EOF
chmod 600 "$STATE_DIR/access.json"

# 5. Write .mcp.json (merge if exists)
SLACK_MCP_DIR="$PROJECT_ROOT/mcp/slack-channel"
if [ -f "$MCP_JSON" ]; then
  jq --arg sd "$STATE_DIR" --arg mcp "$SLACK_MCP_DIR" '.mcpServers.slack = {
    "command": "bun",
    "args": ["run", "--cwd", $mcp, "--shell=bun", "--silent", "start"],
    "env": { "SLACK_STATE_DIR": $sd }
  }' "$MCP_JSON" > "$MCP_JSON.tmp" && mv "$MCP_JSON.tmp" "$MCP_JSON"
else
  cat > "$MCP_JSON" <<MCPEOF
{
  "mcpServers": {
    "slack": {
      "command": "bun",
      "args": ["run", "--cwd", "$SLACK_MCP_DIR", "--shell=bun", "--silent", "start"],
      "env": {
        "SLACK_STATE_DIR": "$STATE_DIR"
      }
    }
  }
}
MCPEOF
fi

# 6. Seed Slack reply memory (reinforces the hook for reply routing)
MEMORY_DIR="$AGENT_DIR/memory"
MEMORY_INDEX="$MEMORY_DIR/MEMORY.md"
MEMORY_FILE="$MEMORY_DIR/feedback_always_reply_slack.md"
if [ ! -f "$MEMORY_FILE" ]; then
  mkdir -p "$MEMORY_DIR"
  cat > "$MEMORY_FILE" << 'MEMEOF'
---
name: Always reply via Slack when prompt came from Slack
description: If the user prompt carried source="slack", every reply MUST go through mcp__channel-slack__slack_reply
type: feedback
---

When the incoming user message is wrapped in <channel source="slack" channel_id="..." ...>, the reply MUST go through mcp__channel-slack__slack_reply. Terminal text is invisible — the user is on Slack.

**Why:** The rule is in CLAUDE.md but agents drift, especially on short replies. A memory entry adds an extra attention hook every turn.

**How to apply:** Check the channel source of the most recent user message before every response. Short replies ("ok", "done") are the highest-risk moments. No trailing terminal text after the reply tool — that's invisible too. For threaded messages (thread_ts present), pass thread_ts to the reply tool.
MEMEOF
  echo "Seeded Slack reply memory at $MEMORY_FILE"

  # Append to MEMORY.md index if not already referenced
  if [ -f "$MEMORY_INDEX" ] && ! grep -q "feedback_always_reply_slack" "$MEMORY_INDEX"; then
    echo "- [Always reply via Slack](feedback_always_reply_slack.md) — if prompt source is slack, reply via mcp__channel-slack__slack_reply" >> "$MEMORY_INDEX"
  fi
fi

# 7. Restart agent with slack enabled.
# Note: this only enables slack. If $AGENT was already listening on other
# channels (telegram, discord, imessage), you'll need to restart manually
# with the full channel list, e.g.:
#   $PROJECT_ROOT/mcp/fleet/scripts/restart-agent.sh $AGENT slack telegram
echo "Restarting $AGENT with slack..."
"$PROJECT_ROOT/mcp/fleet/scripts/restart-agent.sh" "$AGENT" slack

# 8. Approve dev-channel prompt (first time)
sleep 7
if tmux capture-pane -t "$AGENT" -p 2>/dev/null | grep -qE "Enter to confirm|local development"; then
  tmux send-keys -t "$AGENT" Enter
  echo "Approved dev-channel prompt for $AGENT"
else
  echo "No dev-channel prompt (already approved or not yet shown)"
fi

# 9. Smoke test — send a test DM to the principal
sleep 5
echo "Sending smoke test DM to $PRINCIPAL_ID..."
SMOKE_RESULT=$(SLACK_BOT_TOKEN="$BOT_TOKEN" bun -e "
  const { WebClient } = require('@slack/web-api');
  const web = new WebClient(process.env.SLACK_BOT_TOKEN);
  web.chat.postMessage({
    channel: '$PRINCIPAL_ID',
    text: 'Slack setup complete for *$AGENT*. This bot is live and ready.'
  }).then(() => {
    console.log('ok');
  }).catch(e => {
    console.log('fail: ' + e.message);
  });
" 2>/dev/null)

if [ "$SMOKE_RESULT" = "ok" ]; then
  echo "Smoke test passed — check your Slack DMs"
else
  echo "Warning: smoke test DM failed ($SMOKE_RESULT). The agent may still work — check tmux session."
fi

echo "Slack setup complete for $AGENT"
