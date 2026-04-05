#!/bin/bash
# Send a one-line message to another agent's tmux session.
# Usage: message-agent.sh <agent-name> "<message>"
set -e

AGENT="${1:?Usage: message-agent.sh <agent-name> \"<message>\"}"
MSG="${2:?Usage: message-agent.sh <agent-name> \"<message>\"}"

if ! tmux has-session -t "$AGENT" 2>/dev/null; then
  echo "Error: no tmux session named '$AGENT' (is the agent running?)" >&2
  exit 1
fi

tmux send-keys -t "$AGENT" "$MSG" Enter
echo "Sent to $AGENT"
