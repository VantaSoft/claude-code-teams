#!/bin/bash
# Start (or restart) a single agent in a tmux session.
#
# Usage: start-agent.sh <agent-name> <channel> [channel...]
# Channels: telegram, discord, imessage, slack
#
# Example:
#   start-agent.sh orchestrator slack
#   start-agent.sh orchestrator slack telegram
#
# Channels are explicit positional args — no auto-detection from state dirs.
# That keeps "what channels does this agent listen on" obvious from the
# command line and prevents stale .env files from accidentally re-enabling
# channels you thought you'd turned off.
#
# FOOTGUN — DO NOT loop this over the full fleet from inside the orchestrator's
# own session. Calling `start-agent.sh orchestrator ...` (or whatever agent is
# running the loop) sends `/exit` to that tmux session, which kills the shell
# running the loop, which means agents after it never restart. Either:
#   (a) filter the orchestrator out of the fleet loop and restart it last
#       from a separate detached process, or
#   (b) wrap the loop in `nohup ... &` / `disown` so it survives.

set -e

AGENT_NAME="${1:?Usage: start-agent.sh <agent-name> <channel> [channel...]}"
shift

if [ $# -eq 0 ]; then
  echo "Error: no channels specified" >&2
  echo "Usage: start-agent.sh <agent-name> <channel> [channel...]" >&2
  echo "Channels: telegram, discord, imessage, slack" >&2
  exit 1
fi

# Project root is 1 level up from this script: scripts/ -> root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

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

# Graceful shutdown: send /exit to Claude Code so it can clean up child
# processes (MCP servers, channel plugins). Without this, orphan bun
# processes hold Socket Mode connections and block subsequent restarts.
if tmux has-session -t "$AGENT_NAME" 2>/dev/null; then
  echo "Gracefully stopping existing session..."
  tmux send-keys -t "$AGENT_NAME" "/exit" Enter 2>/dev/null || true
  sleep 3
  tmux kill-session -t "$AGENT_NAME" 2>/dev/null || true
fi

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

echo "Starting $AGENT_NAME with channels:$([ "$USE_TELEGRAM" = true ] && echo " telegram")$([ "$USE_DISCORD" = true ] && echo " discord")$([ "$USE_IMESSAGE" = true ] && echo " imessage")$([ "$USE_SLACK" = true ] && echo " slack")"

tmux new-session -d -s "$AGENT_NAME" -c "$AGENT_DIR" \
  "$ENV_VARS claude --continue $CHANNELS --dangerously-skip-permissions || $ENV_VARS claude $CHANNELS --dangerously-skip-permissions"

# Auto-approve the dev-channel confirmation prompt (only Slack triggers it).
if $USE_SLACK; then
  (
    approved=false
    for i in $(seq 1 60); do
      if tmux capture-pane -t "$AGENT_NAME" -p 2>/dev/null | grep -qE "Enter to confirm|local development"; then
        tmux send-keys -t "$AGENT_NAME" Enter
        echo "Auto-approved dev-channel prompt for $AGENT_NAME"
        approved=true
        break
      fi
      sleep 1
    done
    if ! $approved; then
      echo "Warning: dev-channel prompt not detected after 60s for $AGENT_NAME."
      echo "  The agent may be waiting for manual approval. Try: tmux send-keys -t $AGENT_NAME Enter"
    fi
  ) &
fi

echo "$AGENT_NAME is running in tmux session '$AGENT_NAME'"
echo "Attach with: tmux attach -t $AGENT_NAME"
echo "Detach with: Ctrl+B then D"
