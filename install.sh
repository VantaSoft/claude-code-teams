#!/bin/bash
# Claude Code Teams installer
# Usage: curl -fsSL https://cct.vantasoft.com/install.sh | bash

set -e

REPO_URL="https://github.com/VantaSoft/claude-code-teams.git"
BRANCH="main"

echo ""
echo "    ┌┬┐    ┌┬┐    ┌┬┐    ┌┬┐"
echo "   [•_•]  [•_•]  [•_•]  [•_•]"
echo "    /|\\    /|\\    /|\\    /|\\ "
echo ""
echo "       Claude Code Teams"
echo ""

INSTALL_DIR="${INSTALL_DIR:-$(pwd)/claude-code-teams}"

# Check prerequisites (minimal — orchestrator installs tmux/node on first launch if missing)
command -v git >/dev/null 2>&1 || { echo "Error: git is required"; exit 1; }
command -v claude >/dev/null 2>&1 || { echo "Error: claude CLI not found. Install from https://www.anthropic.com/claude-code"; exit 1; }

# Safety: refuse to overwrite
if [ -e "$INSTALL_DIR" ]; then
  echo "Error: $INSTALL_DIR already exists. Aborting to avoid overwriting."
  echo "Move or remove it first, or set INSTALL_DIR=/some/other/path"
  exit 1
fi

echo "→ Installing to $INSTALL_DIR..."
git clone --quiet --depth 1 --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
rm -rf "$INSTALL_DIR/.git"

# Make scripts executable
chmod +x "$INSTALL_DIR/install.sh" "$INSTALL_DIR/agents/orchestrator/scripts/"*.sh 2>/dev/null || true

echo ""
echo "✓ Installed to $INSTALL_DIR"
echo ""
echo "Launching orchestrator..."
echo ""

# Launch claude in the orchestrator directory. Redirect stdin from TTY so it
# works even when install.sh is piped from curl.
cd "$INSTALL_DIR/agents/orchestrator"
exec claude --dangerously-skip-permissions < /dev/tty
