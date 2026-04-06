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

# Use load-buffer + paste-buffer to avoid tmux's bracketed paste mode
# which triggers a "Pasted text" confirmation prompt in Claude Code
# for long messages. send-keys Enter submits after pasting.
printf '%s' "$MSG" | tmux load-buffer -
tmux paste-buffer -d -t "$AGENT"
tmux send-keys -t "$AGENT" Enter
echo "Sent to $AGENT"
