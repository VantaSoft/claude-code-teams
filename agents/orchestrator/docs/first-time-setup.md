# First-Time Setup Wizard

You're reading this because your CLAUDE.md has a "Setup Required" section — that's the signal that first-run setup hasn't completed yet.

In this doc:
- `PROJECT_ROOT` means the installation directory (the one containing CLAUDE.md, agents/, mcp/)
- `~/` refers to the user's home directory (used for Telegram channel configs and OAuth tokens)

Greet the principal briefly and walk them through the setup flow below. **When all steps are complete, delete the "Setup Required" section from your own CLAUDE.md.**

## Setup Flow

1. **Introduce yourself and dive in** — Open with a brief introduction: you're their new AI Chief of Staff and you need a few things to get set up. No "do you want me to walk you through this?" question — just start.

2. **Check system dependencies** — Run `command -v tmux` and `command -v node` via Bash. If either is missing, install them:
   - Detect package manager: `brew` (macOS), `apt-get` (Debian/Ubuntu), `dnf` (Fedora), `pacman` (Arch)
   - Install missing tools with the appropriate package manager
   - If no package manager detected, tell principal the install commands to run manually
   
   Don't proceed until tmux and node are both available.

3. **Get principal's name** — Ask "What's your name?" Save to `PROJECT_ROOT/CLAUDE.md` "Principal" section.

4. **Name yourself** — Ask "What would you like to call me?" (examples: Alfred, Jarvis, Vance). Save the chosen name to the "Name" section of `PROJECT_ROOT/agents/orchestrator/CLAUDE.md` and use it in all future conversations. The directory/tmux/channel stay as "orchestrator" — the name is just your identity.

5. **Set up Telegram** — First, give the principal a heads-up: "We'll set up your Telegram bot now. This current session won't be able to receive Telegram messages — after we're done, you'll exit this session and relaunch me under tmux with the Telegram channel connected."
   
   Then ask them to:
   - DM @BotFather on Telegram
   - Send `/newbot`, name it (e.g. "My Orchestrator Bot")
   - Send `/setprivacy` → select bot → Disable (for group chat support)
   - Paste the bot token back to you
   
   After they paste the token, ask "What's your Telegram user ID? You can get it by DMing @userinfobot on Telegram."
   
   Then YOU do the file setup using your Bash and Write tools:
   - Create the directory `~/.claude/channels/telegram-orchestrator/`
   - Write `.env` with `TELEGRAM_BOT_TOKEN=<token>` inside
   - Write `access.json` with `dmPolicy: "allowlist"`, the principal's Telegram user ID in `allowFrom`, and empty `groups` and `pending`
   - chmod 600 on both files
   - Save their Telegram user ID to `PROJECT_ROOT/CLAUDE.md` "Principal" section

6. **Relaunch under tmux with Telegram enabled** — The initial launch was a raw `claude` session without Telegram. To receive Telegram messages, you need to run inside a tmux session with the Telegram plugin channel flag.

   Tell the principal to exit this session (Ctrl+C, then `/exit`) and run:
   ```
   PROJECT_ROOT/agents/orchestrator/scripts/start-agent.sh orchestrator
   ```
   This starts you in tmux with the Telegram channel enabled. They can then message you on their bot.

7. **Mark setup complete** — Delete the "Setup Required" section from `PROJECT_ROOT/agents/orchestrator/CLAUDE.md` so you don't re-trigger the wizard on future sessions.

8. **Final message** — Let them know they can ask for anything via Telegram: add new specialized agents, set up email triage, monitor services, etc. Tell them they shouldn't need to run commands manually — just ask you.

Keep the tone friendly, concise, and actionable. **Ask one question at a time.** Don't bundle multiple questions into a single message. Wait for the principal's answer before asking the next question.
