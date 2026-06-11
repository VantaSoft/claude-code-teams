#!/bin/bash
# Launch or restart a single agent in a tmux session.
#
# Usage: restart-agent.sh <agent-name> <channel> [channel...]
# Channels: telegram, discord, imessage, slack
#
# Example:
#   restart-agent.sh orchestrator slack
#   restart-agent.sh orchestrator slack telegram
#
# Channels are explicit positional args — no auto-detection from state dirs.
# That keeps "what channels does this agent listen on" obvious from the
# command line and prevents stale .env files from accidentally re-enabling
# channels you thought you'd turned off.
#
# DESIGN: this script is meant to be run BY the long-lived `fleet-rebooter`
# tmux session (fleet MCP's restart_agent send-keys the command into it),
# never inline inside the agent being restarted. Running from the rebooter
# means the script lives OUTSIDE the target's process tree, so kill-session +
# new-session can tear the target down and bring it back without the script
# killing itself. The fresh new-session also gets its own PTY, avoiding the
# ENXIO fork failure that respawn-window hit. new-session keeps the new claude
# parented under the resident tmux server (not launchd), preserving TCC /
# Full Disk Access. Do NOT call this inline-as-self; route through the rebooter.

set -e

AGENT_NAME="${1:?Usage: restart-agent.sh <agent-name> <channel> [channel...]}"
shift

if [ $# -eq 0 ]; then
  echo "Error: no channels specified" >&2
  echo "Usage: restart-agent.sh <agent-name> <channel> [channel...]" >&2
  echo "Channels: telegram, discord, imessage, slack" >&2
  exit 1
fi

# Project root is 3 levels up from this script: scripts/ -> fleet/ -> mcp/ -> root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

AGENT_DIR="$PROJECT_ROOT/agents/$AGENT_NAME"
if [ ! -d "$AGENT_DIR" ]; then
  echo "Error: Agent directory $AGENT_DIR does not exist" >&2
  exit 1
fi

USE_TELEGRAM=false
USE_DISCORD=false
USE_IMESSAGE=false
USE_SLACK=false

for ch in "$@"; do
  case "$ch" in
    telegram) USE_TELEGRAM=true ;;
    discord)  USE_DISCORD=true ;;
    imessage) USE_IMESSAGE=true ;;
    slack)    USE_SLACK=true ;;
    *)        echo "Error: unknown channel '$ch' (expected: telegram, discord, imessage, slack)" >&2; exit 1 ;;
  esac
done

# Validate that requested channels have config (where applicable).
TELEGRAM_STATE="$HOME/.claude/channels/telegram-$AGENT_NAME"
DISCORD_STATE="$HOME/.claude/channels/discord-$AGENT_NAME"
SLACK_STATE="$HOME/.claude/channels/slack-$AGENT_NAME"

if $USE_TELEGRAM && [ ! -f "$TELEGRAM_STATE/.env" ]; then
  echo "Error: telegram requested but $TELEGRAM_STATE/.env not found" >&2
  exit 1
fi
if $USE_DISCORD && [ ! -f "$DISCORD_STATE/.env" ]; then
  echo "Error: discord requested but $DISCORD_STATE/.env not found" >&2
  exit 1
fi
if $USE_SLACK && [ ! -f "$SLACK_STATE/.env" ]; then
  echo "Error: slack requested but $SLACK_STATE/.env not found" >&2
  exit 1
fi
# imessage has no state dir — it reads ~/Library/Messages/chat.db directly.

# Build env vars and channel flags from the requested channels.
ENV_VARS=""
CHANNELS=""

if $USE_TELEGRAM; then
  ENV_VARS="$ENV_VARS TELEGRAM_STATE_DIR=$TELEGRAM_STATE"
  CHANNELS="$CHANNELS --channels plugin:telegram@claude-plugins-official"
fi
if $USE_DISCORD; then
  ENV_VARS="$ENV_VARS DISCORD_STATE_DIR=$DISCORD_STATE"
  CHANNELS="$CHANNELS --channels plugin:discord@claude-plugins-official"
fi
if $USE_IMESSAGE; then
  CHANNELS="$CHANNELS --channels plugin:imessage@claude-plugins-official"
fi
if $USE_SLACK; then
  ENV_VARS="$ENV_VARS SLACK_STATE_DIR=$SLACK_STATE"
  CHANNELS="$CHANNELS --dangerously-load-development-channels server:slack"
fi

# Trim leading whitespace from concatenation.
ENV_VARS="$(echo "$ENV_VARS" | sed 's/^ *//')"
CHANNELS="$(echo "$CHANNELS" | sed 's/^ *//')"

CLAUDE_CMD="$ENV_VARS claude --continue $CHANNELS --dangerously-skip-permissions || $ENV_VARS claude $CHANNELS --dangerously-skip-permissions"

echo "Starting $AGENT_NAME with channels:$([ "$USE_TELEGRAM" = true ] && echo " telegram")$([ "$USE_DISCORD" = true ] && echo " discord")$([ "$USE_IMESSAGE" = true ] && echo " imessage")$([ "$USE_SLACK" = true ] && echo " slack")"

# Serialize concurrent restarts. The fleet-rebooter session executes restart
# requests via tmux send-keys, and back-to-back requests could otherwise race
# on tmux state. mkdir is atomic on macOS (no flock here). Per-agent lock so
# different agents can restart in parallel; stale lock (>2min) is reclaimed.
LOCK_DIR="/tmp/restart-agent-$AGENT_NAME.lock"
for _i in $(seq 1 60); do
  if mkdir "$LOCK_DIR" 2>/dev/null; then break; fi
  if [ -n "$(find "$LOCK_DIR" -maxdepth 0 -mmin +2 2>/dev/null)" ]; then
    rmdir "$LOCK_DIR" 2>/dev/null || true
  fi
  sleep 0.5
done
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

# Auto-approve the dev-channel confirmation prompt (only Slack triggers it).
# Spawned BEFORE the new session so it's already polling by the time the new
# claude process shows the prompt. Runs as its own detached tmux session.
if $USE_SLACK; then
  AA_SESSION="autoapprove-$AGENT_NAME-$$"
  tmux new-session -d -s "$AA_SESSION" -c /tmp \
    "for i in \$(seq 1 60); do if tmux capture-pane -t $AGENT_NAME -p 2>/dev/null | grep -qE 'Enter to confirm|local development'; then tmux send-keys -t $AGENT_NAME Enter; break; fi; sleep 1; done"
fi

# kill-session + new-session (NOT respawn-window). This script is invoked by
# the long-lived `fleet-rebooter` session, so it runs OUTSIDE the target
# agent's process tree — killing the target can't kill this script. A fresh
# new-session also allocates its own PTY, sidestepping the ENXIO
# ("Device not configured") fork failure that `respawn-window -k` hit when it
# tried to reuse the pane's PTY mid-teardown.
#
# TCC note: `tmux new-session` parents the new claude under the EXISTING tmux
# server (which the always-on rebooter keeps alive), NOT launchd — so Full
# Disk Access / iMessage grants keep inheriting. The old launchd re-parenting
# bug only happened when the server itself exited; with the rebooter resident,
# it never does.
if tmux has-session -t "$AGENT_NAME" 2>/dev/null; then
  # Reap the target's descendant process tree BEFORE killing the session.
  # `tmux kill-session` only SIGHUPs the pane shell; grandchild bun/node MCP
  # servers (e.g. `bun server.ts`) survive as orphans, keep their WebSocket
  # connections alive, and would steal inbound events from the replacement.
  PANE_PID=$(tmux list-panes -t "$AGENT_NAME" -F '#{pane_pid}' 2>/dev/null | head -1)
  if [ -n "$PANE_PID" ]; then
    # Spare this script's own ancestor chain (defense-in-depth). When run from
    # the rebooter the script is not in the target's tree, so this matches
    # nothing; it's a guard in case the script is ever run inline-as-self.
    SELF_PIDS=" "; p=$$
    while [ -n "$p" ] && [ "$p" != "$PANE_PID" ] && [ "$p" -gt 1 ] 2>/dev/null; do
      SELF_PIDS="$SELF_PIDS$p "; p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' ')
    done
    DESCENDANTS=$(pgrep -P "$PANE_PID" 2>/dev/null)
    for dpid in $DESCENDANTS; do
      DESCENDANTS="$DESCENDANTS $(pgrep -P "$dpid" 2>/dev/null)"
    done
    # Kill deepest children first (reverse order) to avoid re-parenting.
    for dpid in $(echo "$DESCENDANTS" | tr ' ' '\n' | sort -rn | uniq); do
      case "$SELF_PIDS" in *" $dpid "*) continue ;; esac
      kill "$dpid" 2>/dev/null || true
    done
    sleep 0.5
    for dpid in $(echo "$DESCENDANTS" | tr ' ' '\n' | sort -rn | uniq); do
      case "$SELF_PIDS" in *" $dpid "*) continue ;; esac
      kill -9 "$dpid" 2>/dev/null || true
    done
  fi
  tmux kill-session -t "$AGENT_NAME" 2>/dev/null || true
fi
tmux new-session -d -s "$AGENT_NAME" -c "$AGENT_DIR" "$CLAUDE_CMD"

echo "$AGENT_NAME is running in tmux session '$AGENT_NAME'"
echo "Attach with: tmux attach -t $AGENT_NAME"
echo "Detach with: Ctrl+B then D"
