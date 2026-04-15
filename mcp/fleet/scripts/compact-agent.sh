#!/bin/bash
# Send /compact to an agent's tmux session to compress its context.
# Usage: compact-agent.sh <agent-name>
#
# Uses `tmux send-keys -l` (literal mode) — same approach as message-agent.sh.
# Deterministic; no race between paste and Enter.
set -e

AGENT="${1:?Usage: compact-agent.sh <agent-name>}"

if ! tmux has-session -t "$AGENT" 2>/dev/null; then
  echo "Error: no tmux session named '$AGENT' (is the agent running?)" >&2
  exit 1
fi

tmux send-keys -l -t "$AGENT" "/compact"
# Give Claude Code time to accept the literal input before submitting.
# Without this delay, if the agent is mid-turn, Enter races the input
# field and the /compact ends up queued as unsent draft text.
sleep 5
tmux send-keys -t "$AGENT" Enter

echo "Sent /compact to $AGENT"
