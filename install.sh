#!/bin/bash
# Claude Code Teams installer
# Usage: curl -fsSL https://cct.vantasoft.com/install.sh | bash

set -e

REPO_URL="https://github.com/VantaSoft/claude-code-teams.git"
BRANCH="main"

echo "╔══════════════════════════════════════════════╗"
echo "║       Claude Code Teams — Installer         ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# Check prerequisites
command -v git >/dev/null 2>&1 || { echo "Error: git is required"; exit 1; }
command -v tmux >/dev/null 2>&1 || { echo "Error: tmux is required"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "Error: node is required (for MCP servers)"; exit 1; }
command -v claude >/dev/null 2>&1 || { echo "Error: claude CLI not found. Install from https://www.anthropic.com/claude-code"; exit 1; }

# Safety: refuse to overwrite the specific paths we create
for f in "$HOME/agents/orchestrator" "$HOME/mcp/google-workspace"; do
  if [ -e "$f" ]; then
    echo "Error: $f already exists. Aborting to avoid overwriting."
    echo "If you want to reinstall, back up and remove these paths first."
    exit 1
  fi
done

# Clone into temp dir
TMP_DIR=$(mktemp -d)
echo "→ Cloning $REPO_URL..."
git clone --quiet --depth 1 --branch "$BRANCH" "$REPO_URL" "$TMP_DIR"

# Place files
echo "→ Installing to \$HOME..."
mkdir -p "$HOME/agents" "$HOME/mcp"

if [ ! -e "$HOME/CLAUDE.md" ]; then
  cp "$TMP_DIR/CLAUDE.md" "$HOME/CLAUDE.md"
else
  echo "  (skipping ~/CLAUDE.md — already exists)"
fi
cp -r "$TMP_DIR/agents/orchestrator" "$HOME/agents/orchestrator"
cp -r "$TMP_DIR/mcp/google-workspace" "$HOME/mcp/google-workspace"

# Make scripts executable
chmod +x "$HOME/agents/orchestrator/scripts/"*.sh

# Create ~/.mcp.json with the Google Workspace server pre-configured
if [ ! -e "$HOME/.mcp.json" ]; then
  cat > "$HOME/.mcp.json" <<EOF
{
  "mcpServers": {
    "google-workspace": {
      "command": "node",
      "args": ["$HOME/mcp/google-workspace/dist/index.js"]
    }
  }
}
EOF
fi

# Clean up
rm -rf "$TMP_DIR"

echo ""
echo "✓ Installed."
echo ""
echo "Next step:"
echo "  cd ~/agents/orchestrator && claude --dangerously-skip-permissions"
echo ""
echo "The orchestrator will guide you through the rest — Telegram bot, Google OAuth, heartbeat."
