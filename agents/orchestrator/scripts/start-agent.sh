#!/bin/bash
set -e

AGENT_NAME="${1:?Usage: ./start-agent.sh <agent-name> [telegram] [slack]}"
shift

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

# Determine which channels to enable.
# If explicit channels are passed as arguments, use only those.
# Otherwise, auto-detect based on which state dirs have a .env file.
REQUESTED_CHANNELS=("$@")

USE_TELEGRAM=false
USE_SLACK=false

if [ ${#REQUESTED_CHANNELS[@]} -gt 0 ]; then
  for ch in "${REQUESTED_CHANNELS[@]}"; do
    case "$ch" in
      telegram) USE_TELEGRAM=true ;;
      slack)    USE_SLACK=true ;;
      *)        echo "Warning: unknown channel '$ch' (expected 'telegram' or 'slack')" ;;
    esac
  done
else
  # Auto-detect
  [ -f "$TELEGRAM_STATE/.env" ] && USE_TELEGRAM=true
  [ -f "$SLACK_STATE/.env" ] && USE_SLACK=true
fi

# Validate that requested channels have config
if $USE_TELEGRAM && [ ! -f "$TELEGRAM_STATE/.env" ]; then
  echo "Error: Telegram requested but config not found at $TELEGRAM_STATE/.env"
  exit 1
fi
if $USE_SLACK && [ ! -f "$SLACK_STATE/.env" ]; then
  echo "Error: Slack requested but config not found at $SLACK_STATE/.env"
  exit 1
fi

if ! $USE_TELEGRAM && ! $USE_SLACK; then
  echo "Error: No channels configured. Set up Telegram and/or Slack first."
  echo "  Telegram: ~/.claude/channels/telegram-$AGENT_NAME/.env"
  echo "  Slack:    ~/.claude/channels/slack-$AGENT_NAME/.env"
  exit 1
fi

# Build env vars and channel flags
ENV_VARS=""
CHANNELS=""

if $USE_TELEGRAM; then
  ENV_VARS="TELEGRAM_STATE_DIR=$TELEGRAM_STATE"
  CHANNELS="--channels plugin:telegram@claude-plugins-official"
  echo "Telegram channel enabled for $AGENT_NAME"
fi

if $USE_SLACK; then
  ENV_VARS="$ENV_VARS SLACK_STATE_DIR=$SLACK_STATE"
  CHANNELS="$CHANNELS --dangerously-load-development-channels server:slack"
  echo "Slack channel enabled for $AGENT_NAME"
fi

# Trim leading space from concatenation
ENV_VARS="$(echo "$ENV_VARS" | sed 's/^ *//')"
CHANNELS="$(echo "$CHANNELS" | sed 's/^ *//')"

# Graceful shutdown: send /exit to Claude Code so it can clean up child
# processes (MCP servers, channel plugins). Without this, orphan bun
# processes hold Socket Mode connections and block subsequent restarts.
if tmux has-session -t "$AGENT_NAME" 2>/dev/null; then
  echo "Gracefully stopping existing session..."
  tmux send-keys -t "$AGENT_NAME" "/exit" Enter 2>/dev/null || true
  sleep 3
  tmux kill-session -t "$AGENT_NAME" 2>/dev/null || true
fi

tmux new-session -d -s "$AGENT_NAME" -c "$AGENT_DIR" \
  "$ENV_VARS claude --continue $CHANNELS --dangerously-skip-permissions || $ENV_VARS claude $CHANNELS --dangerously-skip-permissions"

# If Slack is enabled, poll for the dev-channel confirmation prompt and auto-approve.
# Checks once per second for up to 60 seconds. No-op if the prompt never appears.
if $USE_SLACK; then
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
