#!/bin/bash
set -e

AGENT_NAME="${1:?Usage: ./create-agent.sh <agent-name>}"
AGENT_DIR="$HOME/agents/$AGENT_NAME"

if [ -d "$AGENT_DIR" ]; then
  echo "Error: Agent directory $AGENT_DIR already exists"
  exit 1
fi

echo "Creating agent: $AGENT_NAME"

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

Track your work in ~/agents/$AGENT_NAME/tasks.md. Use markdown checkboxes (\`- [ ]\` / \`- [x]\`).

## Resources

- Docs: ~/agents/$AGENT_NAME/docs/
EOF

# Create empty tasks.md
cat > "$AGENT_DIR/tasks.md" << EOF
# $AGENT_NAME Tasks
EOF

# Create empty MEMORY.md
cat > "$AGENT_DIR/memory/MEMORY.md" << EOF
EOF

# Set autoMemoryDirectory to agent-local path
cat > "$AGENT_DIR/.claude/settings.local.json" << EOF
{
  "autoMemoryDirectory": "~/agents/$AGENT_NAME/memory"
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
echo "  4. Start with: ~/agents/orchestrator/scripts/start-agent.sh $AGENT_NAME"
echo "  5. Update Active Agents table in ~/CLAUDE.md"
