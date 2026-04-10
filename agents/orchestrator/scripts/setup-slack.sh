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

# 1. Create state dir + tokens
mkdir -p "$STATE_DIR"
cat > "$STATE_DIR/.env" <<EOF
SLACK_BOT_TOKEN=$BOT_TOKEN
SLACK_APP_TOKEN=$APP_TOKEN
EOF
chmod 600 "$STATE_DIR/.env"

# 2. Build channels JSON array
CH_JSON="[]"
if [ ${#CHANNELS[@]} -gt 0 ]; then
  CH_JSON=$(printf '%s\n' "${CHANNELS[@]}" | jq -R . | jq -s .)
fi

# 3. Write access.json
cat > "$STATE_DIR/access.json" <<EOF
{
  "dmPolicy": "allowlist",
  "allowFromUsers": ["$PRINCIPAL_ID"],
  "channels": $CH_JSON,
  "ackReaction": ""
}
EOF
chmod 600 "$STATE_DIR/access.json"

# 4. Write .mcp.json (merge if exists)
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

# 5. Restart agent
echo "Restarting $AGENT..."
"$SCRIPT_DIR/start-agent.sh" "$AGENT"

# 6. Approve dev-channel prompt (first time)
sleep 7
if tmux capture-pane -t "$AGENT" -p 2>/dev/null | grep -q "Enter to confirm"; then
  tmux send-keys -t "$AGENT" Enter
  echo "Approved dev-channel prompt for $AGENT"
else
  echo "No dev-channel prompt (already approved or not yet shown)"
fi

echo "Slack setup complete for $AGENT"
