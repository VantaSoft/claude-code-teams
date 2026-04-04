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

2. **Scaffold the directory** — run:
   ```bash
   PROJECT_ROOT/agents/orchestrator/scripts/create-agent.sh <name>
   ```
   This creates the standard folder structure (CLAUDE.md, tasks.md, memory/, docs/, .claude/).

3. **Customize the agent's CLAUDE.md** — Write a role-specific CLAUDE.md in `PROJECT_ROOT/agents/<name>/CLAUDE.md` based on the scope. Include:
   - Agent identity and role
   - Scope (what it does and doesn't do)
   - Security boundaries relevant to its work
   - Any role-specific resources (repo paths, API references, docs)

4. **Create a Telegram bot** for the new agent:
   - Walk principal through @BotFather `/newbot` flow
   - Get the token
   - Disable privacy mode via `/setprivacy` if the agent will be in group chats

5. **Set up the Telegram channel** (in user home, not project dir):
   ```bash
   mkdir -p ~/.claude/channels/telegram-<name>
   ```
   Create `~/.claude/channels/telegram-<name>/.env` with the bot token.
   Create `~/.claude/channels/telegram-<name>/access.json` with the principal's Telegram user ID in allowFrom.
   Set chmod 600 on both.

6. **Launch the agent**:
   ```bash
   PROJECT_ROOT/agents/orchestrator/scripts/start-agent.sh <name>
   ```

7. **Update the Active Agents table** in `PROJECT_ROOT/CLAUDE.md` with the new agent's name, role, directory, and tmux session.

8. **Offer follow-up** — Ask if they want to customize the agent's heartbeat, docs, or add specific tools/MCP servers.

## Tips

- Keep each agent's scope narrow — specialized agents work better than generalists
- One bot per agent — don't share Telegram bots
- If the principal is unsure what scope to give the agent, suggest starting minimal and expanding based on actual use
