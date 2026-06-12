# Hooks

Shared Claude Code hooks registered by agents via their
`.claude/settings.local.json`. One script per concern.

## channel-reply-reminder.ts

UserPromptSubmit hook that injects a per-turn reminder telling the agent
which channel reply tool to call. Defense-in-depth on top of the
`Reply Channel (Critical)` rule in CLAUDE.md.

## The problem

Agents drift. Even with the reply-channel rule in CLAUDE.md and a memory
entry reinforcing it, agents sometimes write plain terminal text in
response to Telegram-sourced prompts — invisible to the user on Telegram.

## How this helps

The UserPromptSubmit hook fires the instant a user prompt is submitted,
BEFORE the agent processes it. This hook:

1. Parses the prompt for a `<channel source="..." chat_id="..." message_id="..." ...>` tag.
2. If found, extracts the source, chat_id, and (optional) message_id.
3. Emits structured `additionalContext` injected into the agent's turn:

   > Reply via `mcp__plugin_telegram_telegram__reply` (chat_id=XXX, no reply_to). Terminal output is invisible — user is on telegram.

The reminder is attached to THE specific triggering prompt, so it's more
targeted than a standing CLAUDE.md rule or an always-loaded memory entry.
Not enforcement — the agent can still ignore it — but more pointed.

## Channel support

Supports multiple channel types:

- **Telegram** — `source="plugin:telegram:telegram"` → `mcp__plugin_telegram_telegram__reply` (routes via `chat_id`)
- **Discord** — `source="plugin:discord:discord"` → `mcp__plugin_discord_discord__reply` (routes via `chat_id`)
- **Slack** — `source="slack"` → `mcp__channel-slack__slack_reply` (routes via `channel_id`, supports `thread_ts` for threading)

Add new channel types by adding entries to the `specForSource()` function.

## Install per agent

Register as a UserPromptSubmit hook in the agent's
`.claude/settings.local.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bun <absolute-path>/channel-reply-reminder.ts"
          }
        ]
      }
    ]
  }
}
```

If the file already has other hook entries, merge the UserPromptSubmit
block in — don't replace.

## Testing

```bash
# Telegram prompt — should emit additionalContext
echo '{"prompt":"<channel source=\"plugin:telegram:telegram\" chat_id=\"123\" message_id=\"5\">\nhi\n</channel>"}' \
  | bun channel-reply-reminder.ts

# Slack prompt — should emit additionalContext with channel_id
echo '{"prompt":"<channel source=\"slack\" channel_id=\"D0ARZEL0GEN\" ts=\"123\" user=\"bob\" kind=\"dm\">\nhi\n</channel>"}' \
  | bun channel-reply-reminder.ts

# Slack threaded prompt — should include thread_ts
echo '{"prompt":"<channel source=\"slack\" channel_id=\"C05MEDFB3TJ\" ts=\"456\" thread_ts=\"123\" user=\"bob\" kind=\"channel\">\nhi\n</channel>"}' \
  | bun channel-reply-reminder.ts

# Terminal prompt (no tag) — silent
echo '{"prompt":"just terminal text"}' | bun channel-reply-reminder.ts
```

## Stacking with other layers

This is one layer in a defense-in-depth stack for reply-channel routing:

1. **CLAUDE.md** — standing rule, always loaded. Weakest (drift-prone).
2. **Memory entry** — auto-loaded every turn. Slightly stronger.
3. **UserPromptSubmit hook (this)** — reminder attached to the specific
   triggering prompt. Strongest non-deterministic nudge.

## reclaude-steer.ts

SessionStart post-compaction recovery hook. Part of reclaude (the recall +
llm-wiki memory system bundled into the fleet MCP). Pure static-text emit — it
does NOT index, because the fleet `recall` tool self-freshens (it incrementally
indexes on every search).

- **SessionStart** (`post-compact`, `matcher: "compact"`) — fires when a session
  resumes right after a compaction. Injects recovery guidance: re-read
  `.claude/active-task.md`, re-read relevant auto-memory, and use the fleet
  `recall` tool to recover anything the summary dropped.

**No PreCompact hook.** This Claude Code build's hook output schema has no
PreCompact variant — `additionalContext` is only accepted for
UserPromptSubmit/PostToolUse/PostToolBatch/Stop. A PreCompact emit therefore
fails validation (`(root): Invalid input`) on every compaction for zero benefit,
so `pre-compact` is a deliberate no-op (kept only so a not-yet-restarted agent
still wired to it errors harmlessly). Continuity across a compaction is carried
by the journal (`.claude/active-task.md`) plus this recovery hook — not by
steering the summary.

A hook must never break a session, so this always exits 0 and stays silent on
any error. It emits only the documented
`hookSpecificOutput: { hookEventName, additionalContext }` shape (a top-level
`additionalContext` is rejected by the hook root schema).

### Install per agent

```json
{
  "hooks": {
    "SessionStart": [
      { "matcher": "compact", "hooks": [ { "type": "command", "command": "bun <absolute-path>/reclaude-steer.ts post-compact", "timeout": 30 } ] }
    ]
  }
}
```

### Testing

```bash
# SessionStart (post-compaction) — emits the recovery steering
echo '{}' | bun reclaude-steer.ts post-compact

# pre-compact and unknown/no subcommand — silent, exit 0
echo '{}' | bun reclaude-steer.ts pre-compact
echo '{}' | bun reclaude-steer.ts
```

## Files

- `channel-reply-reminder.ts` — channel reply-routing reminder hook (Bun, stdlib only).
- `reclaude-steer.ts` — reclaude SessionStart post-compaction recovery hook (Bun, stdlib only).
- `README.md` — this file.
