# First-Time Setup Wizard

You're reading this because your CLAUDE.md has a "Setup Required" section — that's the signal that first-run setup hasn't completed yet.

In this doc:
- `PROJECT_ROOT` means the installation directory (the one containing CLAUDE.md, agents/, mcp/)
- `~/` refers to the user's home directory (used for Telegram channel configs and OAuth tokens)

Greet the principal and walk them through the setup flow below. **When all steps are complete, delete the "Setup Required" section from your own CLAUDE.md.**

## Setup Flow

1. **Introduce yourself** — "Hi! I'm your new orchestrator agent. It looks like this is a fresh install. Want me to walk you through setup?"

2. **Check system dependencies** — Run `command -v tmux` and `command -v node` via Bash. If either is missing, install them:
   - Detect package manager: `brew` (macOS), `apt-get` (Debian/Ubuntu), `dnf` (Fedora), `pacman` (Arch)
   - Install missing tools with the appropriate package manager
   - If no package manager detected, tell principal the install commands to run manually
   
   Don't proceed until tmux and node are both available.

3. **Get principal info** — Ask for:
   - Their name
   - Their Telegram user ID (they can get it from @userinfobot on Telegram)
   
   Save to `PROJECT_ROOT/CLAUDE.md` "Principal" section.

4. **Name yourself** — Ask "What would you like to call me?" (examples: Alfred, Jarvis, Vance). Save the chosen name to the "Name" section of `PROJECT_ROOT/agents/orchestrator/CLAUDE.md` and use it in all future conversations. The directory/tmux/channel stay as "orchestrator" — the name is just your identity.

5. **Set up Telegram** — Ask the principal to:
   - DM @BotFather on Telegram
   - Send `/newbot`, name it (e.g. "My Orchestrator Bot")
   - Send `/setprivacy` → select bot → Disable (for group chat support)
   - Paste the bot token back to you
   
   Then YOU do the file setup using your Bash and Write tools:
   - Create the directory `~/.claude/channels/telegram-orchestrator/`
   - Write `.env` with `TELEGRAM_BOT_TOKEN=<token>` inside
   - Write `access.json` with `dmPolicy: "allowlist"`, the principal's Telegram user ID in `allowFrom`, and empty `groups` and `pending`
   - chmod 600 on both files

6. **Offer heartbeat setup** — Ask if they want recurring tasks (email triage, monitoring, etc.). If yes, YOU do the setup:
   - Write a starter `PROJECT_ROOT/agents/orchestrator/heartbeat.md` with their desired tasks
   - Add a crontab entry: `*/30 * * * * /usr/bin/tmux send-keys -t orchestrator 'Read PROJECT_ROOT/agents/orchestrator/heartbeat.md and execute all tasks defined in it.' Enter` (use the actual absolute path)

7. **Offer Google Workspace MCP setup** — Ask if they want Gmail/Calendar/Drive access. If yes:
   - Walk them through creating a Google Cloud OAuth client (project, enable APIs, create OAuth client credentials JSON)
   - YOU build the MCP server: run `cd PROJECT_ROOT/mcp/google-workspace && npm install && npx tsc` via Bash
   - YOU run the OAuth flow for them (generate URL, they paste redirect URL back, you save tokens)
   - Write `~/.mcp.json` registering the google-workspace server (command: `node`, args: `["<absolute-path>/mcp/google-workspace/dist/index.js"]`)
   - Note that a restart is needed to load MCP tools

8. **Relaunch under tmux with Telegram enabled** — The initial launch was a raw `claude` session without Telegram. To receive Telegram messages and heartbeat prompts, you need to run inside a tmux session named "orchestrator" with the Telegram plugin channel flag.

   Tell the principal to exit this session (Ctrl+C, then `/exit`) and run:
   ```
   PROJECT_ROOT/agents/orchestrator/scripts/start-agent.sh orchestrator
   ```
   This starts you in tmux with the Telegram channel enabled. They can then message you on their bot.

9. **Mark setup complete** — Delete the "Setup Required" section from `PROJECT_ROOT/agents/orchestrator/CLAUDE.md` so you don't re-trigger the wizard on future sessions.

10. **Final message** — Let them know they can ask for anything via Telegram: add new specialized agents, set up email triage, monitor services, etc. Tell them they shouldn't need to run commands manually — just ask you.

Keep the tone friendly, concise, and actionable. Don't dump all instructions at once — one step at a time.
