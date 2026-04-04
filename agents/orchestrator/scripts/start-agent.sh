#!/bin/bash
set -e

AGENT_NAME="${1:?Usage: ./start-agent.sh <agent-name>}"
AGENT_DIR="$HOME/agents/$AGENT_NAME"
TELEGRAM_STATE="$HOME/.claude/channels/telegram-$AGENT_NAME"

if [ ! -d "$AGENT_DIR" ]; then
  echo "Error: Agent directory $AGENT_DIR does not exist"
  exit 1
fi

if [ ! -f "$TELEGRAM_STATE/.env" ]; then
  echo "Error: Telegram config not found at $TELEGRAM_STATE/.env"
  exit 1
fi

tmux kill-session -t "$AGENT_NAME" 2>/dev/null || true
tmux new-session -d -s "$AGENT_NAME" -c "$AGENT_DIR" \
  "TELEGRAM_STATE_DIR=$TELEGRAM_STATE claude --continue --channels plugin:telegram@claude-plugins-official --dangerously-skip-permissions || TELEGRAM_STATE_DIR=$TELEGRAM_STATE claude --channels plugin:telegram@claude-plugins-official --dangerously-skip-permissions"

echo "$AGENT_NAME is running in tmux session '$AGENT_NAME'"
echo "Attach with: tmux attach -t $AGENT_NAME"
echo "Detach with: Ctrl+B then D"
