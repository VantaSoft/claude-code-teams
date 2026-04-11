# First-Time Setup Wizard

You're reading this because your CLAUDE.md has a "Setup Required" section — that's the signal that first-run setup hasn't completed yet.

In this doc:
- `PROJECT_ROOT` means the installation directory (the one containing CLAUDE.md, agents/, mcp/)
- `~/` refers to the user's home directory (used for channel configs and OAuth tokens)

Greet the principal briefly and walk them through the setup flow below. **When all steps are complete, delete the "Setup Required" section from your own CLAUDE.md.**

## Setup Flow

1. **Introduce yourself and dive in** — Open with a brief introduction: you're their new AI Chief of Staff and you need a few things to get set up. No "do you want me to walk you through this?" question — just start.

2. **Check system dependencies** — Run `command -v tmux`, `command -v node`, and `command -v bun` via Bash. If any are missing, install them:
   - Detect package manager: `brew` (macOS), `apt-get` (Debian/Ubuntu), `dnf` (Fedora), `pacman` (Arch)
   - tmux and node: install with the package manager
   - bun: install via `brew install oven-sh/bun/bun` (macOS) or `curl -fsSL https://bun.sh/install | bash` (Linux)
   - If no package manager detected, tell principal the install commands to run manually
   
   **Bun is required** — the Slack channel plugin and Telegram plugin both run on Bun. Without it, plugins appear to start but silently drop incoming messages.
   
   Don't proceed until tmux, node, and bun are all available.

3. **Get principal's name** — Ask "What's your name?" Save to `PROJECT_ROOT/CLAUDE.md` "Principal" section.

4. **Name yourself** — Ask "What would you like to call me?" (examples: Alfred, Jarvis, Vance). Save the chosen name to the "Name" section of `PROJECT_ROOT/agents/orchestrator/CLAUDE.md` and use it in all future conversations. The directory/tmux/channel stay as "orchestrator" — the name is just your identity.

5. **Choose a messaging channel** — Ask "How do you want to reach me — **Slack** or **Telegram**?" Both work; they can add the other one later.

   ### Slack path (steps 5a–5d)

   5a. **Install Slack MCP dependencies** — Run via Bash:
       ```bash
       cd PROJECT_ROOT/mcp/slack-channel && bun install
       ```

   5b. **Create the Slack App** — Walk the principal through creating a Slack App:
       - Go to https://api.slack.com/apps → Create New App → From a manifest
       - Paste the JSON from `PROJECT_ROOT/slack-manifest.json`
       - Replace `AGENT_NAME` with the chosen name (from step 4) and `AGENT_ROLE` with "AI Chief of Staff"
       - After creating:
         1. **Generate app-level token**: Settings → Basic Information → App-Level Tokens → Generate Token with `connections:write` scope. That gives the `SLACK_APP_TOKEN` (starts with `xapp-`).
         2. **Install to workspace**, then copy **Bot User OAuth Token** from OAuth & Permissions. That's the `SLACK_BOT_TOKEN` (starts with `xoxb-`).
       - Ask them to paste both tokens back to you.

   5c. **Get principal's Slack user ID** — Ask "What's your Slack user ID? Click your profile picture in Slack → '...' → 'Copy member ID'." Save it to `PROJECT_ROOT/CLAUDE.md` "Principal" section.

   5d. **Run setup script** — Run via Bash:
       ```bash
       PROJECT_ROOT/agents/orchestrator/scripts/setup-slack.sh orchestrator <xoxb-token> <xapp-token> <user-id>
       ```
       (Use the actual absolute path and real token values.)

       The script validates the bot token, creates the state directory at `~/.claude/channels/slack-orchestrator/`, writes the MCP config to `.mcp.json`, seeds a Slack reply memory, restarts the agent under tmux, and sends a smoke test DM.

       If the principal wants the bot in specific channels too, they can pass channel IDs as extra arguments. Channels can also be added later (see `docs/slack-setup.md`).

   ### Telegram path (steps 5e–5h)

   5e. **Install the Telegram plugin** — Run via Bash:
       ```bash
       claude plugin install telegram@claude-plugins-official
       ```
       (If this fails or the command doesn't exist, tell the principal and ask them to run `/plugin install telegram@claude-plugins-official` themselves.)

   5f. **Create the Telegram bot** — Walk the principal through @BotFather:
       - DM @BotFather on Telegram
       - Send `/newbot`, name it (e.g. "My Orchestrator Bot")
       - Paste the bot token back to you
       (Skip `/setprivacy` for now — that's only needed for group chats.)

   5g. **Get principal's Telegram user ID** — Ask "What's your Telegram user ID? You can get it by DMing @userinfobot on Telegram." Save it to `PROJECT_ROOT/CLAUDE.md` "Principal" section.

   5h. **Set up the Telegram channel** — YOU do the file setup using your Bash and Write tools:
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

6. **Mark setup complete** — Delete the "Setup Required" section from `PROJECT_ROOT/agents/orchestrator/CLAUDE.md` so you don't re-trigger the wizard on future sessions.

7. **Relaunch under tmux** — Tell the principal "I'm going to relaunch myself under tmux now. This session will end; I'll come back in a new session with [Slack/Telegram] connected. Message me on your new bot once I'm up."
   
   Then run via Bash, passing the channel name as a positional arg:
   ```bash
   PROJECT_ROOT/scripts/start-agent.sh orchestrator telegram
   ```
   (Use the actual absolute path.) Channels: `telegram`, `discord`, `imessage`, `slack`. Pass multiple to enable several at once. This starts a new tmux session with the requested channel(s) enabled.
   
   **After launching, send Enter to the new tmux session to confirm the directory trust prompt**:
   ```bash
   tmux send-keys -t orchestrator Enter
   ```
   Without this, the new session is stuck waiting on a Claude Code trust prompt and messages won't be processed. This current (raw) session will terminate shortly after.

   **Note:** If the principal chose Slack, `setup-slack.sh` in step 5d already handled the tmux relaunch. In that case, skip this step and just tell the principal to message you on Slack.

8. **Final message** — Before the session ends, tell them to message you on their chosen channel. Once they do, you'll have full context and can handle future requests (adding new agents, setting up email triage, monitoring services, etc.) without them needing to run commands manually.

Keep the tone friendly, concise, and actionable. **Ask one question at a time.** Don't bundle multiple questions into a single message. Wait for the principal's answer before asking the next question.
