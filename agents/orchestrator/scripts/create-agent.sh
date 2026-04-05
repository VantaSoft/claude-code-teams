#!/bin/bash
set -e

AGENT_NAME="${1:?Usage: ./create-agent.sh <agent-name>}"

# Project root is 3 levels up from this script: scripts/ -> orchestrator/ -> agents/ -> root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

AGENT_DIR="$PROJECT_ROOT/agents/$AGENT_NAME"

if [ -d "$AGENT_DIR" ]; then
  echo "Error: Agent directory $AGENT_DIR already exists"
  exit 1
fi

echo "Creating agent: $AGENT_NAME at $AGENT_DIR"

# Create agent directory structure
mkdir -p "$AGENT_DIR/memory"
mkdir -p "$AGENT_DIR/docs"
mkdir -p "$AGENT_DIR/.claude"

# Create CLAUDE.md
cat > "$AGENT_DIR/CLAUDE.md" << EOF
# $AGENT_NAME

## Scope

TODO: Define this agent's scope.

## Security Boundaries

- Never execute destructive operations without confirmation.

## Tasks

Track your work in ./tasks.md. Use markdown checkboxes (\`- [ ]\` / \`- [x]\`).

## Resources

- Docs: ./docs/
EOF

# Create empty tasks.md
cat > "$AGENT_DIR/tasks.md" << EOF
# $AGENT_NAME Tasks
EOF

# Seed MEMORY.md with the reply-channel feedback pointer
cat > "$AGENT_DIR/memory/MEMORY.md" << EOF
# Memory Index

- [Always reply via Telegram](feedback_always_reply_telegram.md) — if prompt source is plugin:telegram:telegram, reply via mcp__plugin_telegram_telegram__reply
EOF

# Seed the reply-channel feedback memory (agents drift from CLAUDE.md on short replies)
cat > "$AGENT_DIR/memory/feedback_always_reply_telegram.md" << 'EOF'
---
name: Always reply via Telegram when prompt came from Telegram
description: If the user prompt carried source="plugin:telegram:telegram", every reply MUST go through mcp__plugin_telegram_telegram__reply
type: feedback
---

When the incoming user message is wrapped in <channel source="plugin:telegram:telegram" chat_id="..." ...>, the reply MUST go through mcp__plugin_telegram_telegram__reply. Terminal text is invisible — the user is on Telegram.

**Why:** The rule is in ~/CLAUDE.md but agents drift, especially on short replies. A memory entry adds an extra attention hook every turn.

**How to apply:** Check the channel source of the most recent user message before every response. Short replies ("ok", "done") are the highest-risk moments. No trailing terminal text after the reply tool — that's invisible too.
EOF

# Set autoMemoryDirectory and enabled plugins (per-agent, not global)
cat > "$AGENT_DIR/.claude/settings.local.json" << EOF
{
  "autoMemoryDirectory": "$AGENT_DIR/memory",
  "enabledPlugins": {
    "telegram@claude-plugins-official": true
  }
}
EOF

echo ""
echo "Agent '$AGENT_NAME' created at $AGENT_DIR"
echo ""
echo "Next steps:"
echo "  1. Edit $AGENT_DIR/CLAUDE.md to define the agent's role"
echo "  2. Create a Telegram bot via @BotFather (disable privacy mode for groups)"
echo "  3. Set up Telegram channel:"
echo "     mkdir -p ~/.claude/channels/telegram-$AGENT_NAME"
echo "     Create .env with: TELEGRAM_BOT_TOKEN=<your-token>"
echo "     Create access.json with allowlist (your Telegram user ID)"
echo "  4. Start with: $SCRIPT_DIR/start-agent.sh $AGENT_NAME"
echo "  5. Update Active Agents table in $PROJECT_ROOT/CLAUDE.md"
