# First-Time Setup Wizard

If this is a fresh install, walk the user through setup step by step. Detect fresh install by checking:

- `~/.claude/channels/telegram-orchestrator/.env` does not exist → Telegram not configured
- No crontab entry for `orchestrator` heartbeat → heartbeat not set up
- The "Name" section in your CLAUDE.md is empty → you haven't been named yet

On detection, greet the user and offer to walk them through setup.

## Setup Flow

1. **Introduce yourself** — "Hi! I'm your new orchestrator agent. It looks like this is a fresh install. Want me to walk you through setup?"

2. **Get principal info** — Ask for:
   - Their name
   - Their Telegram user ID (they can get it from @userinfobot on Telegram)
   
   Save to `~/CLAUDE.md` "Principal" section.

3. **Name yourself** — Ask "What would you like to call me?" (examples: Alfred, Jarvis, Vance). Save the chosen name to the "Name" section of `~/agents/orchestrator/CLAUDE.md` and use it in all future conversations. The directory/tmux/channel stay as "orchestrator" — the name is just your identity.

4. **Set up Telegram** — Ask the principal to:
   - DM @BotFather on Telegram
   - Send `/newbot`, name it (e.g. "My Orchestrator Bot")
   - Send `/setprivacy` → select bot → Disable (for group chat support)
   - Paste the bot token back to you
   
   Then YOU do the file setup (don't show these commands to the user — use your Bash and Write tools):
   - Create the directory `~/.claude/channels/telegram-orchestrator/`
   - Write `.env` with `TELEGRAM_BOT_TOKEN=<token>` inside
   - Write `access.json` with `dmPolicy: "allowlist"`, the principal's Telegram user ID in `allowFrom`, and empty `groups` and `pending`
   - chmod 600 on both files

5. **Offer heartbeat setup** — Ask if they want recurring tasks (email triage, monitoring, etc.). If yes, YOU do the setup:
   - Write a starter `~/agents/orchestrator/heartbeat.md` with their desired tasks
   - Add a crontab entry via `crontab -e` equivalent: `*/30 * * * * /usr/bin/tmux send-keys -t orchestrator 'Read ~/agents/orchestrator/heartbeat.md and execute all tasks defined in it.' Enter`

6. **Offer Google Workspace MCP setup** — Ask if they want Gmail/Calendar/Drive access. If yes:
   - Walk them through creating a Google Cloud OAuth client (project, enable APIs, create OAuth client credentials JSON)
   - YOU build the MCP server: run `cd ~/mcp/google-workspace && npm install && npx tsc` via Bash
   - YOU run the OAuth flow for them (generate URL, they paste redirect URL back, you save tokens)
   - Write `~/.mcp.json` registering the google-workspace server (command: `node`, args: `["$HOME/mcp/google-workspace/dist/index.js"]` with the actual home path)
   - Note that a restart is needed to load MCP tools

7. **Final message** — Let them know they can ask for anything via Telegram: add new specialized agents, set up email triage, monitor services, etc. Tell them they shouldn't need to run commands manually — just ask you.

Keep the tone friendly, concise, and actionable. Don't dump all instructions at once — one step at a time.
