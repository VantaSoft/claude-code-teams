# Claude Code Teams — Shared Configuration

This file is inherited by all agents via Claude Code's CLAUDE.md directory traversal. It defines the standard patterns for running a team of Claude Code agents.

In docs, `PROJECT_ROOT` refers to the directory containing this file (the installation directory). User-level config (Telegram channels, OAuth tokens) lives in `~/.claude/` and `~/.config/`.

## Reply Channel (Critical)

**Before producing any response, check the channel source of the incoming message.** If it came via Telegram (`source="plugin:telegram:telegram"`), the reply MUST go through the Telegram reply tool (`mcp__plugin_telegram_telegram__reply`). Plain text output is invisible to the principal — they are on Telegram, not the terminal.

The habit: send a Telegram reply FIRST (even just "on it"), then do the work. Every time.

Only respond via terminal when the incoming message arrived via terminal (no `<channel>` tag).

## Active Agents

| Agent | Role | Directory | tmux Session |
|-------|------|-----------|-------------|
| Orchestrator | Chief of Staff / coordinator | PROJECT_ROOT/agents/orchestrator | orchestrator |

Ask the orchestrator to create more specialized agents (engineering, finance, marketing, personal assistant, etc.).

## Principal

Filled in during first-run setup wizard.

## Security Boundaries

- Never execute destructive operations without confirmation.
- Never share credentials, tokens, or secrets via Telegram.

## Schedules — Recurring Tasks

Each agent can have a `schedules/` folder containing one `.md` file per recurring task. Each file declares its own cron expression via YAML frontmatter. Never use ad-hoc `/loop` or CronCreate inside the session for recurring tasks.

```
PROJECT_ROOT/agents/<agent>/schedules/
├── spam-triage.md       # cron: */30 * * * *
├── morning-briefing.md  # cron: 0 14 * * *   (e.g. 7am PDT)
└── git-backup.md        # cron: 0 8 * * *    (e.g. 1am PDT)
```

**Schedule file format:**
```markdown
---
cron: "*/30 * * * *"
---
# Task Title

...task instructions...
```

**How it works:**
- An OS-level crontab entry per schedule file types its prompt into the agent's tmux session on the specified cadence
- The agent reads the file and executes the tasks
- `PROJECT_ROOT/agents/orchestrator/scripts/sync-schedules.sh` reads all `PROJECT_ROOT/agents/*/schedules/*.md`, extracts cron frontmatter, and writes the crontab MANAGED block
- **Only the orchestrator runs sync-schedules.sh** — it's the orchestrator's responsibility. Other agents create their own schedule files and ask the orchestrator to sync.

**Time zone**: crontab runs in system timezone. Document any conversion (e.g. PT → UTC) in a frontmatter comment.

**To add a schedule (as a non-orchestrator agent):**
1. Create `PROJECT_ROOT/agents/<your-agent>/schedules/<name>.md` with cron frontmatter
2. Ask the orchestrator to run `sync-schedules.sh`

**To add a schedule (as the orchestrator):**
1. Create the file
2. Run `PROJECT_ROOT/agents/orchestrator/scripts/sync-schedules.sh` yourself

## Agent Folder Structure

Each agent lives in `PROJECT_ROOT/agents/<agent-name>/` with this standard layout:

```
PROJECT_ROOT/agents/<agent-name>/
├── CLAUDE.md          # Agent identity, scope, and security boundaries
├── tasks.md           # Current work tracked with markdown checkboxes
├── schedules/         # (optional) One .md per recurring task, each with cron frontmatter
├── docs/              # Agent-owned documentation
├── memory/            # Auto-memory (persists across conversations)
│   └── MEMORY.md      # Memory index
├── repos/             # (optional) Git repo clones owned by this agent
├── scripts/           # (optional) Agent-specific scripts
└── .claude/           # Claude Code local settings
```

All agents inherit `PROJECT_ROOT/CLAUDE.md` (this file) via directory traversal. Agent-specific `CLAUDE.md` lives in each agent's folder.

## Docs Folder

Each agent has a `docs/` folder for durable reference material that doesn't belong in memory or CLAUDE.md. The three surfaces have different jobs:

- **CLAUDE.md** — identity, scope, standing rules. Always loaded into every turn's context. Keep it tight.
- **memory/** — short facts about the user, project state, feedback, and reference pointers. Indexed in MEMORY.md, auto-loaded. Personal to the agent.
- **docs/** — multi-paragraph reference material the agent opens on demand: checklists, workflows, external-policy summaries, design rationale, setup walkthroughs. Not auto-loaded; re-read when relevant.

**When to write a new doc:**
- The content is too long for CLAUDE.md (would bloat context every turn).
- It needs to be re-read in full before a specific recurring action (e.g. a pre-push scrub checklist, a disaster-recovery runbook).
- It summarizes an external source that might drift (compliance docs, third-party API behavior) and you want one authoritative local copy.
- It's stable reference, not a volatile fact about the user or project.

**When NOT to write a doc:**
- A one-line memory entry would do.
- The content is identity/scope (belongs in CLAUDE.md).
- It duplicates material already in another agent's docs or in the repo.

**Maintenance:**
- Review docs when you touch adjacent work. Stale guidance is worse than no guidance — update or delete.
- Docs are agent-internal by default. Don't reference them from files intended for outside audiences unless you plan to keep the docs public.
- Prefer deletion over leaving stale docs around.

## Plugins / Skills

Plugins are configured per-agent in `PROJECT_ROOT/agents/<agent-name>/.claude/settings.local.json`, not globally. To install a plugin for just one agent, run `/plugin install <name>` from within that agent's directory — Claude Code writes to the local settings.local.json automatically.

## Shared Resources

- MCP servers: `PROJECT_ROOT/mcp/`
- User-level config (Telegram channels, OAuth tokens): `~/.claude/channels/`, `~/.config/`
