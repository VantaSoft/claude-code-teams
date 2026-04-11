# Creating a New Agent

When the principal asks for a new specialized agent (e.g. "create a coder agent", "I need a finance agent"), handle it yourself conversationally. The principal should never need to touch a terminal.

In this doc:
- `PROJECT_ROOT` means the installation directory (the one containing CLAUDE.md, agents/, mcp/)
- `~/` refers to the user's home directory (used for Telegram channel configs)

## Steps

1. **Clarify scope** — Ask the principal what the agent will do. Examples:
   - Coder: writes, debugs, reviews code for specific repos
   - Finance: manages accounting, reporting, reconciliation
   - Marketing: content, campaigns, social, SEO
   - Personal assistant: scheduling, errands, reservations

2. **Name the new agent** — Ask the principal what they'd like to call the new agent. Examples: "Alfred" for a personal assistant, "Ada" for a coder, "Sage" for a finance agent. This is the agent's identity — how it introduces itself.

3. **Scaffold the directory** — run:
   ```bash
   PROJECT_ROOT/agents/orchestrator/scripts/create-agent.sh <name>
   ```
   This creates the standard folder structure (CLAUDE.md, tasks.md, memory/, docs/, .claude/).

4. **Customize the agent's CLAUDE.md** — Write a role-specific CLAUDE.md in `PROJECT_ROOT/agents/<name>/CLAUDE.md` based on the scope. Include:
   - The chosen name and role (e.g. "# Alfred — Personal Assistant")
   - Scope (what it does and doesn't do)
   - Security boundaries relevant to its work
   - Any role-specific resources (repo paths, API references, docs)

5. **Create a Telegram bot** for the new agent:
   - Walk principal through @BotFather `/newbot` flow
   - Get the token
   - (Skip `/setprivacy` unless the agent needs group chat support)

6. **Set up the Telegram channel** (in user home, not project dir):
   ```bash
   mkdir -p ~/.claude/channels/telegram-<name>
   ```
   Create `~/.claude/channels/telegram-<name>/.env` with the bot token.
   Create `~/.claude/channels/telegram-<name>/access.json` with this structure (user ID MUST be a JSON string):
   ```json
   {
     "dmPolicy": "allowlist",
     "allowFrom": ["<user-id-as-string>"],
     "groups": {},
     "pending": {}
   }
   ```
   Set chmod 600 on both.

7. **Launch the agent**:
   ```bash
   PROJECT_ROOT/scripts/start-agent.sh <name> <channel> [channel...]
   ```
   Pass one or more channels: `telegram`, `discord`, `imessage`, `slack`. For example:
   ```bash
   PROJECT_ROOT/scripts/start-agent.sh <name> telegram
   PROJECT_ROOT/scripts/start-agent.sh <name> slack telegram
   ```

   **Note**: on first launch, Claude Code shows a directory trust prompt inside the new tmux session. This happens even with `--dangerously-skip-permissions`. Confirm it by sending Enter into the session:
   ```bash
   tmux send-keys -t <name> Enter
   ```
   Without this, the session is stuck waiting and Telegram messages won't be processed.

8. **Update the Active Agents table** in `PROJECT_ROOT/CLAUDE.md` with the new agent's name, role, directory, and tmux session.

9. **(Optional) Add Slack** — If the principal wants the agent on Slack too, follow `docs/slack-setup.md` or run the one-command setup:
   ```bash
   PROJECT_ROOT/agents/orchestrator/scripts/setup-slack.sh <name> <xoxb-token> <xapp-token> <principal-slack-user-id> [channel-ids...]
   ```
   This creates a separate Slack App + bot for the agent. Agents can be on Telegram only, Slack only, or both.

10. **Offer follow-up** — Ask if they want to customize the agent's schedules, docs, or add specific tools/MCP servers.

## Tips

- Keep each agent's scope narrow — specialized agents work better than generalists
- One bot per agent — don't share Telegram or Slack bots
- If the principal is unsure what scope to give the agent, suggest starting minimal and expanding based on actual use
