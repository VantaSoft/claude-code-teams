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
# Self-restart is safe. If the target session already exists, the script
# uses `tmux respawn-window -k` to atomically kill the old claude and
# launch the new one in place — tmux performs the kill+respawn in its
# own process, so the caller dying mid-call doesn't prevent the
# replacement from coming up. The dev-channel auto-approve loop runs
# as its own detached tmux session that survives this script dying.

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

# Auto-approve the dev-channel confirmation prompt (only Slack triggers it).
# Spawned BEFORE respawn/new-session so it's already running by the time
# the new claude process shows the prompt. Runs as its own detached tmux
# session so it survives this script dying (which happens on self-restart
# when tmux kills the calling claude during respawn-window).
if $USE_SLACK; then
  AA_SESSION="autoapprove-$AGENT_NAME-$$"
  tmux new-session -d -s "$AA_SESSION" -c /tmp \
    "for i in \$(seq 1 60); do if tmux capture-pane -t $AGENT_NAME -p 2>/dev/null | grep -qE 'Enter to confirm|local development'; then tmux send-keys -t $AGENT_NAME Enter; break; fi; sleep 1; done"
fi

# Two paths: existing session → respawn the window in place (safe for
# self-restart because tmux handles the kill+respawn atomically in its
# own process, not ours); missing session → create from scratch.
#
# Respawn-window preserves the tmux session, the window, and crucially
# the parent-process chain rooted in the tmux server — so TCC grants
# like Full Disk Access keep flowing into the new claude process.
# The previous /exit + kill-session + new-session dance suffered two
# problems: self-restart killed the MCP subprocess running this script
# before it could complete, and the new session sometimes re-parented
# to launchd, breaking TCC inheritance.
if tmux has-session -t "$AGENT_NAME" 2>/dev/null; then
  tmux respawn-window -k -t "$AGENT_NAME" "$CLAUDE_CMD"
else
  tmux new-session -d -s "$AGENT_NAME" -c "$AGENT_DIR" "$CLAUDE_CMD"
fi

echo "$AGENT_NAME is running in tmux session '$AGENT_NAME'"
echo "Attach with: tmux attach -t $AGENT_NAME"
echo "Detach with: Ctrl+B then D"
