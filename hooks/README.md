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
## Files

- `channel-reply-reminder.ts` — the hook (~120 lines, Bun, stdlib only).
- `README.md` — this file.
