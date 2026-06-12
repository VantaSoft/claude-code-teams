# Claude Code Teams — Shared Configuration

This file is inherited by all agents via Claude Code's CLAUDE.md directory traversal. It defines the standard patterns for running a team of Claude Code agents.

In docs, `PROJECT_ROOT` refers to the directory containing this file (the installation directory). User-level config (Telegram channels, OAuth tokens) lives in `~/.claude/` and `~/.config/`.

## Reply Channel (Critical)

**Before producing any response, check the channel source of the incoming message.** Reply via the correct channel tool — plain text output is invisible to users on Telegram or Slack.

| Source | Reply tool | Routing ID |
|--------|-----------|------------|
| `plugin:telegram:telegram` | `mcp__plugin_telegram_telegram__reply` | `chat_id` |
| `slack` | `mcp__channel-slack__slack_reply` | `channel_id` |

The habit: send a channel reply FIRST (even just "on it"), then do the work. Every time.

Only respond via terminal when the incoming message arrived via terminal (no `<channel>` tag).

For Slack threads: if the inbound message includes `thread_ts`, pass it to the reply tool to respond in the same thread.

**Silent-response rule.** When you choose not to respond to a Slack message, react with an emoji (thumbsup, eyes, white_check_mark, etc.) so the sender knows you saw it. Silent non-responses are indistinguishable from dropped messages.

**Progress indicator (👀 → done).** If `ackReaction` is set in your Slack `access.json` (default: `eyes`), every inbound Slack message is automatically reacted with that emoji by the slack-channel plugin when it arrives — that's your "working" signal, visible to all channel members. When you call `slack_reply` back to that same channel, the plugin automatically removes the reaction, which flips the indicator to "done". You don't need to call `remove_reaction` yourself.

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
- The `fleet` MCP's `sync_schedules` tool reads all `PROJECT_ROOT/agents/*/schedules/*.md`, extracts cron frontmatter, and writes the crontab MANAGED block
- **Only the orchestrator runs sync_schedules** — it's the orchestrator's responsibility. Other agents create their own schedule files and ask the orchestrator to sync.

**Time zone**: crontab runs in system timezone. Document any conversion (e.g. PT → UTC) in a frontmatter comment.

**Avoid same-minute collisions**: cron types prompts into tmux via `send-keys`. If two schedules fire at the exact same minute, the two prompts get typed near-simultaneously and can concatenate into a single garbled input, causing the agent to do a mashup of both tasks (or skip one). When picking a cron expression, offset by 1-2 minutes from other schedules that could land on the same minute. Example: don't use `0 8 * * *` if `*/30 * * * *` already runs at `:00` — use `2 8 * * *` instead.

**To add a schedule (as a non-orchestrator agent):**
1. Create `PROJECT_ROOT/agents/<your-agent>/schedules/<name>.md` with cron frontmatter
2. Ask the orchestrator to call `fleet:sync_schedules`

**To add a schedule (as the orchestrator):**
1. Create the file
2. Call the `fleet:sync_schedules` tool

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

## Knowledge surfaces

This workspace bundles **reclaude** (persistent memory for Claude Code). Knowledge lives in four places, each with a distinct job:

- **CLAUDE.md** — identity, scope, standing rules. Always loaded into every turn's context. Keep it tight.
- **memory/** — short facts about the user, project state, feedback, and reference pointers. Indexed in MEMORY.md, auto-loaded. Personal to the agent.
- **llm-wiki** (`PROJECT_ROOT/llm-wiki/`) — durable, cross-project knowledge: concepts, tool evaluations, architecture lessons, distilled research. Shared across agents, written via the `llm-wiki` skill. This is the home for process docs / runbooks — not a per-agent `docs/` folder.
- **recall** — full-text search over every past session transcript (the fleet `recall` tool). Use it to recover what was discussed/decided before, rather than guessing.

The reclaude protocol below governs how these are curated.

<!-- reclaude:begin -->
# Memory protocol

Persist to auto memory proactively (without being asked) when you learn:
user corrections ("don't use sudo for docker"), environment facts, project
conventions, commands that actually worked, tool quirks and workarounds,
and completed-milestone notes ("migrated X to Y on <date>").
Skip: trivia, anything re-discoverable via search or the recall skill,
raw data dumps, and session-specific ephemera (temp paths, one-off context).

Keep MEMORY.md a dense INDEX under ~150 lines (hard load cap is 200 lines /
25KB — beyond that it silently isn't loaded). Push detail into topic files
(debugging.md, conventions.md, decisions.md) and link them from MEMORY.md.
When MEMORY.md approaches the cap, consolidate: merge overlapping entries
into denser ones and delete stale entries — exactly as you would defragment
a config file. Compact, information-dense entries; never narrative prose.

# Working-state journal

For any task longer than a few turns, maintain `.claude/active-task.md` in
the project: goal, plan, decisions made (with rejected alternatives), files
touched, exact commands used, current blocker, next step. Update it WHEN
STATE CHANGES, not at the end of the session. After a context compaction
this file is the source of truth — re-read it before continuing. Add it to
the project's .gitignore.

# Recall

When the user references past work, when post-compaction context is missing
details, or before re-deriving something we may have solved before, use the
recall skill rather than guessing or asking the user to repeat themselves.

# Second brain

When a session produces durable cross-project knowledge (a concept understood,
a tool evaluation, an architecture lesson), contribute it to the llm-wiki via
the llm-wiki skill — at natural pauses, not mid-task.
<!-- reclaude:end -->

## Plugins / Skills

Plugins are configured per-agent in `PROJECT_ROOT/agents/<agent-name>/.claude/settings.local.json`, not globally. To install a plugin for just one agent, run `/plugin install <name>` from within that agent's directory — Claude Code writes to the local settings.local.json automatically.

### Creating Agent Skills

Skills are reusable instruction sets that an agent can invoke for specific workflows. They live under each agent's `.claude/skills/` directory.

**File location:**
```
PROJECT_ROOT/agents/<agent-name>/.claude/skills/<skill-name>/SKILL.md
```

**Format:** Markdown with YAML frontmatter:
```markdown
---
name: my-skill-name
description: One-line description of when to use this skill
---

# Skill Title

...instructions, checklists, templates, process steps...
```

- `name` -- kebab-case identifier. Must be unique within the agent.
- `description` -- tells the agent when to invoke the skill. Be specific about trigger phrases or conditions (e.g. "Use when a customer needs a service agreement").

**What goes in a skill:**
- Multi-step workflows the agent repeats (e.g. generating a document, running a deployment checklist)
- Decision trees or questionnaires that gather inputs before acting
- Templates and field definitions
- Process rules that are too long for CLAUDE.md but need to be followed exactly when invoked

**Invoking:** The agent's Skill tool discovers skills from `.claude/skills/`. When a user request matches the skill's description, the agent loads and follows it. Skills can also be invoked explicitly with `/skill-name`.

## Hooks

Shared Claude Code hooks live at `PROJECT_ROOT/hooks/`. Each agent registers the hooks it wants in its own `.claude/settings.local.json`.

Currently shipping:

- `hooks/channel-reply-reminder.ts` — UserPromptSubmit hook. Parses channel tags on inbound prompts (Telegram, Slack, Discord) and injects a short reminder telling the agent to reply via the correct MCP reply tool. Defense-in-depth for the Reply Channel rule. `create-agent.sh` wires it into every scaffolded agent automatically.

See `hooks/README.md` for details and adding new hooks.

## Messaging Other Agents

Agents can send one-line messages into each other's tmux sessions via the `fleet` MCP's `message_agent` tool. This is how cross-agent coordination happens (e.g. a marketing agent asks the orchestrator to sync schedules; the orchestrator asks a coding agent to clone a repo).

```
fleet:message_agent({ agent: "<name>", message: "<message>" })
```

Under the hood, the tool uses `tmux send-keys -l` to type the message literally, pauses 5 seconds to let Claude Code's input field accept the text (otherwise the trailing Enter can race the input if the target agent is mid-turn and queue the prompt as unsent draft), then submits. The receiving agent sees the text as terminal input (no `<channel>` tag), processes it, and responds in its own terminal. Use this MCP tool — do NOT try to call another agent's Telegram/Slack bot, edit their files directly, or talk to their tmux session yourself.

**Message style:** Terse, one-line instructions only. No greetings, no thanks, no conversational filler. Example: "Call fleet:sync_schedules -- agent-A added PROJECT_ROOT/agents/agent-A/schedules/weekly-report.md." The receiver is another Claude agent, not a human -- skip all pleasantries.

**Reply style:** Respond with a brief confirmation and the result. No conversational back-and-forth, but always confirm completion. Example: "Done. Crontab updated, 12 entries." or "Synced. 3 new schedules installed."

**When to use:** Cross-agent dependencies (schedule syncs, repo clones, handoffs), status pings, or any workflow the other agent owns. Use it sparingly — each message interrupts the other agent's turn.

**Always reply via `fleet:message_agent`.** When you receive a message from another agent, they CANNOT see your terminal output. You MUST use `fleet:message_agent` to send your response back. Replying in your own terminal is the same as not replying at all.

## Fleet MCP

The `fleet` MCP server provides cross-agent management tools. Available to all agents, but some tools are orchestrator-only.

### Observability

| Tool | Purpose |
|------|---------|
| `context_check(agent?)` | Report context window usage (tokens, % of 1M). Omit agent for whole fleet. |
| `agent_status(agent?)` | Live snapshot: working/idle/waiting_input, current spinner, last tool call. Omit for fleet. |
| `list_mcps(agent?, verbose?)` | Which MCP servers each agent has wired up. |
| `list_schedules(agent?)` | All recurring schedules (parsed from `schedules/*.md` frontmatter). |

### Lifecycle

| Tool | Purpose |
|------|---------|
| `compact_agent(agent)` | Send `/compact` to compress an agent's context. Use when context_check shows >50%. |
| `restart_agent(agent, channels)` | Kill and relaunch an agent's tmux session with `--continue`. Safe for self-restart. |
| `message_agent(agent, message)` | Type a one-line message into another agent's tmux session. See "Messaging Other Agents" above. |

### Orchestrator-only

| Tool | Purpose |
|------|---------|
| `sync_schedules()` | Regenerate the MANAGED crontab block from all `schedules/*.md` files. |
| `create_agent(agent)` | Scaffold a new agent folder. Does NOT wire Slack or start the agent. |

## Shared Resources

- MCP servers: `PROJECT_ROOT/mcp/` (Google Workspace, Slack channel, fleet)
- User-level config (Telegram/Slack channels, OAuth tokens): `~/.claude/channels/`, `~/.config/`
