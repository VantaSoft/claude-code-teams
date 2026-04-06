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

**Avoid same-minute collisions**: cron types prompts into tmux via `send-keys`. If two schedules fire at the exact same minute, the two prompts get typed near-simultaneously and can concatenate into a single garbled input, causing the agent to do a mashup of both tasks (or skip one). When picking a cron expression, offset by 1-2 minutes from other schedules that could land on the same minute. Example: don't use `0 8 * * *` if `*/30 * * * *` already runs at `:00` — use `2 8 * * *` instead.

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

## Hooks

Shared Claude Code hooks live at `PROJECT_ROOT/hooks/`. Each agent registers the hooks it wants in its own `.claude/settings.local.json`.

Currently shipping:

- `hooks/channel-reply-reminder.ts` — UserPromptSubmit hook. Parses channel tags on inbound prompts (`<channel source="plugin:telegram:telegram" chat_id="..." ...>`) and injects a short reminder telling the agent to reply via the channel's MCP reply tool. Defense-in-depth for the Reply Channel rule. `create-agent.sh` wires it into every scaffolded agent automatically.

See `hooks/README.md` for details and adding new hooks.

## Messaging Other Agents

Agents can send one-line messages into each other's tmux sessions. This is how cross-agent coordination happens (e.g. a marketing agent asks the orchestrator to sync schedules; the orchestrator asks a coding agent to clone a repo).

```bash
PROJECT_ROOT/agents/orchestrator/scripts/message-agent.sh <agent-name> "<message>"
```

The script looks up the tmux session by agent name and types the message in followed by Enter. The receiving agent sees the text as terminal input (no `<channel>` tag), processes it, and responds in its own terminal. Use this pattern — do NOT try to call another agent's Telegram bot, edit their files directly, or talk to their tmux session yourself.

**Message style:** Write it like a clear one-line instruction or ask, e.g. "<agent-A> added `PROJECT_ROOT/agents/<agent-A>/schedules/<name>.md` (cron: 0 14 * * 1). Please run `PROJECT_ROOT/agents/orchestrator/scripts/sync-schedules.sh` to install the cron entry." The receiver is another Claude agent and will read, reason, and act.

**When to use:** Cross-agent dependencies (schedule syncs, repo clones, handoffs), status pings, or any workflow the other agent owns. Use it sparingly — each message interrupts the other agent's turn.

## Shared Resources

- MCP servers: `PROJECT_ROOT/mcp/`
- User-level config (Telegram channels, OAuth tokens): `~/.claude/channels/`, `~/.config/`
