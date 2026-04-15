#!/bin/bash
# Send a message to another agent's tmux session.
# Usage: message-agent.sh <agent-name> "<message>"
#
# Uses `tmux send-keys -l` (literal mode) to type the message one byte at a
# time into the target session. This is slower than `paste-buffer` for long
# messages but is deterministic — each keystroke is processed by Claude
# Code's input field in order, so the trailing `send-keys Enter` never fires
# before the input field is ready. No race, no buffer-sits-unsent bugs.
#
# Multi-line messages: embedded newlines are preserved in-place. Claude
# Code's input field treats them as in-buffer line breaks (like option+enter),
# NOT as submit-enter. Verified 2026-04-11 — a 3-line literal string landed
# in the buffer unsubmitted.
set -e

AGENT="${1:?Usage: message-agent.sh <agent-name> \"<message>\"}"
MSG="${2:?Usage: message-agent.sh <agent-name> \"<message>\"}"

if ! tmux has-session -t "$AGENT" 2>/dev/null; then
  echo "Error: no tmux session named '$AGENT' (is the agent running?)" >&2
  exit 1
fi

# Type the message literally, pause to let Claude Code accept the input
# (otherwise the submit Enter can race the input field if the agent is
# mid-turn, leaving the text queued as unsent draft), then submit.
tmux send-keys -l -t "$AGENT" "$MSG"
sleep 5
tmux send-keys -t "$AGENT" Enter

echo "Sent to $AGENT"
