# First-Time Setup Wizard

You're reading this because your CLAUDE.md has a "Setup Required" section — that's the signal that first-run setup hasn't completed yet.

In this doc:
- `PROJECT_ROOT` means the installation directory (the one containing CLAUDE.md, agents/, mcp/)
- `~/` refers to the user's home directory (used for Telegram channel configs and OAuth tokens)

Greet the principal briefly and walk them through the setup flow below. **When all steps are complete, delete the "Setup Required" section from your own CLAUDE.md.**

## Setup Flow

1. **Introduce yourself and dive in** — Open with a brief introduction: you're their new AI Chief of Staff and you need a few things to get set up. No "do you want me to walk you through this?" question — just start.

2. **Check system dependencies** — Run `command -v tmux`, `command -v node`, and `command -v bun` via Bash. If any are missing, install them:
   - Detect package manager: `brew` (macOS), `apt-get` (Debian/Ubuntu), `dnf` (Fedora), `pacman` (Arch)
   - tmux and node: install with the package manager
   - bun: install via `brew install oven-sh/bun/bun` (macOS) or `curl -fsSL https://bun.sh/install | bash` (Linux)
   - If no package manager detected, tell principal the install commands to run manually
   
   **Bun is required** — the Telegram plugin runs on Bun. Without it, the plugin appears to start but silently drops incoming messages.
   
   Don't proceed until tmux, node, and bun are all available.

3. **Get principal's name** — Ask "What's your name?" Save to `PROJECT_ROOT/CLAUDE.md` "Principal" section.

4. **Name yourself** — Ask "What would you like to call me?" (examples: Alfred, Jarvis, Vance). Save the chosen name to the "Name" section of `PROJECT_ROOT/agents/orchestrator/CLAUDE.md` and use it in all future conversations. The directory/tmux/channel stay as "orchestrator" — the name is just your identity.

5. **Install the Telegram plugin** — The Telegram plugin needs to be installed before you can run under tmux with the Telegram channel. Run via Bash:
   ```bash
   claude plugin install telegram@claude-plugins-official
   ```
   (If this fails or the command doesn't exist, tell the principal and ask them to run `/plugin install telegram@claude-plugins-official` themselves.)

6. **Set up the Telegram bot** — Give the principal a heads-up: "We'll set up your Telegram bot now. After this, I'll relaunch myself under tmux with the Telegram channel connected, then you can message me via Telegram."
   
   Ask them to:
   - DM @BotFather on Telegram
   - Send `/newbot`, name it (e.g. "My Orchestrator Bot")
   - Paste the bot token back to you
   
   (Skip `/setprivacy` for now — that's only needed for group chats. Can be added later.)
   
   After they paste the token, ask "What's your Telegram user ID? You can get it by DMing @userinfobot on Telegram."
   
   Then YOU do the file setup using your Bash and Write tools:
   - Create the directory `~/.claude/channels/telegram-orchestrator/`
   - Write `.env` with `TELEGRAM_BOT_TOKEN=<token>` inside
   - Write `access.json` with this exact structure:
     ```json
     {
       "dmPolicy": "allowlist",
       "allowFrom": ["<user-id-as-string>"],
       "groups": {},
       "pending": {}
     }
     ```
     **Critical**: the user ID in `allowFrom` MUST be a JSON string (in quotes), not a number. The plugin compares as strings and silently drops messages if the ID is a numeric literal.
   - chmod 600 on both files
   - Save their Telegram user ID to `PROJECT_ROOT/CLAUDE.md` "Principal" section

7. **Mark setup complete** — Delete the "Setup Required" section from `PROJECT_ROOT/agents/orchestrator/CLAUDE.md` so you don't re-trigger the wizard on future sessions.

8. **Relaunch under tmux** — Tell the principal "I'm going to relaunch myself under tmux now. This session will end; I'll come back in a new session with Telegram connected. Message me on your new bot once I'm up."
   
   Then run via Bash:
   ```bash
   PROJECT_ROOT/agents/orchestrator/scripts/start-agent.sh orchestrator
   ```
   (Use the actual absolute path.) This starts a new tmux session with the Telegram channel enabled.
   
   **After launching, send Enter to the new tmux session to confirm the directory trust prompt**:
   ```bash
   tmux send-keys -t orchestrator Enter
   ```
   Without this, the new session is stuck waiting on a Claude Code trust prompt and Telegram messages won't be processed. This current (raw) session will terminate shortly after.

9. **Final message** — Before the session ends, tell them to message you on Telegram. Once they do, you'll have full context and can handle future requests (adding new agents, setting up email triage, monitoring services, etc.) without them needing to run commands manually.

Keep the tone friendly, concise, and actionable. **Ask one question at a time.** Don't bundle multiple questions into a single message. Wait for the principal's answer before asking the next question.
