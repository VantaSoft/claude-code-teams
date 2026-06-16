---
name: create-agent
description: Use when asked to create, set up, or spin up a new agent. Covers the full lifecycle from folder creation to first message.
---

# Create a New Agent

Follow these steps in order. Do NOT skip steps. Ask the user for any information you don't have.

## Step 1: Gather requirements

Before creating anything, confirm these with the user:
- **Name** (will be the folder name, tmux session, and Slack bot display name)
- **Role** (one-line description, e.g. "Marketing Agent")
- **Personality** (if any - tone, catchphrases, cultural background)
- **Scope** (what domains/responsibilities does this agent cover?)
- **Channels** (Slack only? Slack + Telegram? Which Slack channels?)
- **MCPs needed** (fleet, google-workspace, etc.)

## Step 2: Create folder structure

Create `PROJECT_ROOT/agents/<name>/` with:
- `CLAUDE.md` - agent identity and scope
- `memory/MEMORY.md` - empty memory index
- `docs/` - reference material
- `routines/` - recurring tasks
- `.claude/settings.local.json` - agent-specific settings
- `.mcp.json` - MCP server configuration

## Step 3: Write CLAUDE.md

Use this template:

```markdown
# <Name> - <Role>

You are <Name>, a <role>. Persistent agent on the host machine, reachable via Slack.

## Personality

<Personality description if applicable.>

## Scope

- <Bullet list of responsibilities>

## Security Boundaries

- Never execute destructive operations without confirmation.
- Never proactively share credentials, tokens, or secrets in Slack.
- <Role-specific boundaries>

## Tasks

<Task tracking instructions per your setup.>

## Resources

- Docs: PROJECT_ROOT/agents/<name>/docs/
```

## Step 4: Write settings.local.json

```json
{
  "skipDangerousModePermissionPrompt": true,
  "autoMemoryDirectory": "PROJECT_ROOT/agents/<name>/memory",
  "cleanupPeriodDays": 3650,
  "enabledPlugins": {},
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bun PROJECT_ROOT/hooks/channel-reply-reminder.ts"
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "matcher": "compact",
        "hooks": [
          {
            "type": "command",
            "command": "bun PROJECT_ROOT/hooks/reclaude-steer.ts post-compact",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

Replace `PROJECT_ROOT` with the actual installation path.

- `cleanupPeriodDays: 3650` keeps Claude Code from deleting old session transcripts for 10 years, so the fleet `recall` tool can full-text search the agent's whole history.
- The **SessionStart** (`matcher: "compact"`) hook injects post-compaction recovery guidance (reclaude's `reclaude-steer.ts`). There is intentionally no PreCompact hook — this harness build's hook schema has no PreCompact variant for `additionalContext`, so a PreCompact steering hook only fails validation. Continuity is carried by `.claude/active-task.md` + this recovery hook.

> **Tip:** `fleet:create_agent` (which runs `mcp/fleet/scripts/create-agent.sh`) writes this exact `settings.local.json`, both reclaude skills (Step 4b), and the `.mcp.json` automatically. These manual steps are the fallback / reference for what that script produces.

## Step 4b: Scaffold the reclaude skills

Every agent gets the two reclaude skills. `recall` is a thin pointer to the fleet `recall` tool (no substitution). `llm-wiki` drives the shared second-brain vault and needs the vault path substituted in:

```bash
mkdir -p PROJECT_ROOT/agents/<name>/.claude/skills/recall \
         PROJECT_ROOT/agents/<name>/.claude/skills/llm-wiki
cp PROJECT_ROOT/skills/recall/SKILL.md \
   PROJECT_ROOT/agents/<name>/.claude/skills/recall/SKILL.md
sed "s|{{VAULT_PATH}}|PROJECT_ROOT/llm-wiki|g" \
  PROJECT_ROOT/skills/llm-wiki/SKILL.md \
  > PROJECT_ROOT/agents/<name>/.claude/skills/llm-wiki/SKILL.md
```

Replace `PROJECT_ROOT` and `<name>` with the actual values.

## Step 5: Write .mcp.json

Always include `slack` and `fleet`. Add others based on requirements.

```json
{
  "mcpServers": {
    "slack": {
      "command": "bun",
      "args": ["run", "--cwd", "PROJECT_ROOT/mcp/slack-channel", "--shell=bun", "--silent", "start"],
      "env": {
        "SLACK_STATE_DIR": "~/.claude/channels/slack-<name>"
      }
    },
    "fleet": {
      "command": "bun",
      "args": ["run", "--cwd", "PROJECT_ROOT/mcp/fleet", "--shell=bun", "--silent", "start"]
    }
  }
}
```

Replace `PROJECT_ROOT` with the actual installation path.

## Step 6: Generate Slack manifest

Show the user this JSON manifest to create at https://api.slack.com/apps:

```json
{
  "display_information": {
    "name": "<Name>",
    "description": "<Role>",
    "background_color": "#2c2d30"
  },
  "features": {
    "app_home": { "home_tab_enabled": false, "messages_tab_enabled": true, "messages_tab_read_only_enabled": false },
    "bot_user": { "display_name": "<Name>", "always_online": true }
  },
  "oauth_config": {
    "scopes": {
      "bot": ["chat:write", "reactions:read", "reactions:write", "files:read", "files:write", "users:read", "channels:history", "groups:history", "im:history", "mpim:history"]
    }
  },
  "settings": {
    "event_subscriptions": { "bot_events": ["message.channels", "message.groups", "message.im", "message.mpim", "reaction_added"] },
    "interactivity": { "is_enabled": false },
    "org_deploy_enabled": false,
    "socket_mode_enabled": true,
    "token_rotation_enabled": false
  }
}
```

**Wait for the user to create the app and provide:**
1. Bot User OAuth Token (`xoxb-...`)
2. App-Level Token (`xapp-...`) with `connections:write` scope

## Step 7: Set up Slack channel state

Once the user provides the tokens:

1. Create the directory: `~/.claude/channels/slack-<name>/`
2. Write `.env`:
   ```
   SLACK_BOT_TOKEN=xoxb-...
   SLACK_APP_TOKEN=xapp-...
   ```
3. Write `access.json`:
   ```json
   {
     "dmPolicy": "allowlist",
     "allowFromUsers": ["<user-slack-id>"],
     "channels": ["<channel-ids>"],
     "ackReaction": "eyes"
   }
   ```
   - Set `allowFromUsers` to the Slack user IDs of principals (admins/owners)
   - Set `channels` to the Slack channel IDs the agent should listen to

## Step 8: Update shared CLAUDE.md

Add the new agent to the Active Agents table in `PROJECT_ROOT/CLAUDE.md`.

## Step 9: Start the agent

```
fleet:restart_agent(<name>, ["slack"])
```

Or with Telegram: `["slack", "telegram"]`

## Step 10: Sync routines

If the agent has any routine files, run `fleet:sync_routines`.

## Step 11: Verify

Ask the user to DM the new bot on Slack. It should react with the ack emoji and respond.
