#!/bin/bash
set -e

AGENT_NAME="${1:?Usage: ./start-agent.sh <agent-name>}"

# Project root is 3 levels up from this script: scripts/ -> orchestrator/ -> agents/ -> root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

AGENT_DIR="$PROJECT_ROOT/agents/$AGENT_NAME"
TELEGRAM_STATE="$HOME/.claude/channels/telegram-$AGENT_NAME"
SLACK_STATE="$HOME/.claude/channels/slack-$AGENT_NAME"

if [ ! -d "$AGENT_DIR" ]; then
  echo "Error: Agent directory $AGENT_DIR does not exist"
  exit 1
fi

if [ ! -f "$TELEGRAM_STATE/.env" ]; then
  echo "Error: Telegram config not found at $TELEGRAM_STATE/.env"
  exit 1
fi

# Build env vars and channel flags
ENV_VARS="TELEGRAM_STATE_DIR=$TELEGRAM_STATE"
CHANNELS="--channels plugin:telegram@claude-plugins-official"

# Auto-detect Slack channel plugin
if [ -f "$SLACK_STATE/.env" ]; then
  ENV_VARS="$ENV_VARS SLACK_STATE_DIR=$SLACK_STATE"
  CHANNELS="$CHANNELS --dangerously-load-development-channels server:slack"
  echo "Slack channel detected for $AGENT_NAME"
fi

tmux kill-session -t "$AGENT_NAME" 2>/dev/null || true
tmux new-session -d -s "$AGENT_NAME" -c "$AGENT_DIR" \
  "$ENV_VARS claude --continue $CHANNELS --dangerously-skip-permissions || $ENV_VARS claude $CHANNELS --dangerously-skip-permissions"

# If Slack is enabled, poll for the dev-channel confirmation prompt and auto-approve.
# Checks once per second for up to 60 seconds. No-op if the prompt never appears.
if [ -f "$SLACK_STATE/.env" ]; then
  (
    for i in $(seq 1 60); do
      if tmux capture-pane -t "$AGENT_NAME" -p 2>/dev/null | grep -q "Enter to confirm"; then
        tmux send-keys -t "$AGENT_NAME" Enter
        echo "Auto-approved dev-channel prompt for $AGENT_NAME"
        break
      fi
      sleep 1
    done
  ) &
fi

echo "$AGENT_NAME is running in tmux session '$AGENT_NAME'"
echo "Attach with: tmux attach -t $AGENT_NAME"
echo "Detach with: Ctrl+B then D"
