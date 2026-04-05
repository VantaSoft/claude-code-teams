# Hooks

Shared Stop hooks that handle cross-channel delivery.

## telegram-deliver.ts

**Model: pure-terminal delivery.** Agents respond to Telegram messages by
writing text to the terminal normally. This Stop hook is the authoritative
delivery path — it reads the session transcript after every turn,
identifies turns that originated from the Telegram channel plugin, and
POSTs the assistant's text to the original chat.

Why pure-terminal: asking the LLM to remember "call the reply tool on
every Telegram turn" fails in practice. Agents drift. With pure-terminal,
the LLM can't forget — writing to terminal is the default behavior, and
routing is handled deterministically by the hook.

### Turn attribution (no race, no state)

Stateless. Each Stop event is self-contained: look at the current turn
only, deliver if conditions hold, exit. Earlier turns were already
handled by their own Stop events.

How the current turn is identified:

1. Walk the transcript from the end, collecting the trailing run of
   `type=assistant` entries. That's the turn that just finished.
2. Walk `parentUuid` from any of those entries to the originating user
   prompt — the nearest ancestor `type=user` entry with a `promptId`.
3. If that user prompt has
   `origin = {kind: "channel", server: "plugin:telegram:telegram"}`,
   extract `chat_id` and `message_id` from the embedded channel tag.
4. Collect the trailing run's text + tool_use blocks. If text exists
   and no reply-tool call matched this `chat_id`, send the text to
   that chat with `reply_to_message_id=message_id` (threaded reply).

The parentUuid chain is set at write time by the harness, so there's no
race between the hook reading the transcript and new Telegram messages
arriving — any new message becomes a new turn with its own new root,
handled by its own future Stop event.

### Skip conditions

The hook does NOT deliver when:

- `stop_hook_active` is true on the incoming payload.
- The trailing turn's root user prompt is not from the Telegram channel.
- The turn has no assistant text output (tool-call-only turn).
- The reply tool (`mcp__plugin_telegram_telegram__reply`) was called with
  matching `chat_id` in the same turn — the agent used the tool for
  attachments, reactions, or edits, the hook steps aside.

### Reply tool still available

Pure-terminal is the default, but the reply tool stays available for
rich operations that text alone can't handle:

- File / image attachments via the `files: [paths]` parameter.
- Emoji reactions via the `react` tool.
- Interim progress edits via `edit_message` during long-running tasks.
- Explicit threading to non-root messages.

When the agent calls the reply tool with a `chat_id` that matches the
turn's Telegram origin, the hook skips delivery for that turn.

### Bot token resolution

The hook looks in this order:

1. `$TELEGRAM_BOT_TOKEN` in the environment.
2. `$TELEGRAM_STATE_DIR/.env`, parsed for `TELEGRAM_BOT_TOKEN=...`.

The agent launcher (`agents/orchestrator/scripts/start-agent.sh`) sets
`TELEGRAM_STATE_DIR` for every agent, so the token is resolved
automatically — no per-agent config needed.

### Runtime

Requires [Bun](https://bun.sh) — already a prerequisite for the telegram
channel plugin itself, so no new dependency for users running Telegram
channels. The hook is a single TypeScript file, no `package.json`, no
`bun install` needed.

### Enable per agent

Add to the agent's `.claude/settings.local.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bun $CLAUDE_PROJECT_DIR/hooks/telegram-deliver.ts"
          }
        ]
      }
    ]
  }
}
```

If the file already has other keys, merge the `hooks` block in — don't
replace the file.

### Message chunking

Telegram caps messages at 4096 characters. The hook splits at 4000, with
preference for paragraph (`\n\n`) and newline boundaries over hard cuts.
The threaded-reply field is only applied to the first chunk; subsequent
chunks post without `reply_to_message_id` to avoid thread-fan-out.

### Diagnostic log

`~/.claude/channels/telegram-deliver.log` — one line per delivery attempt
and per failure. Silent no-ops produce no entries.

### Delivery semantics

Deliver-once-or-miss. If the Telegram API call fails mid-send (transient
network issue, rate limit), that turn is not retried — the next Stop
event handles a different turn. This is an intentional tradeoff against
state-keeping: simpler, no watermark file, no backfill problem on first
enable. If reliability becomes a concern, switch to a state-backed
design with per-session watermarks.

### Testing

Create a synthetic transcript (must include uuid + parentUuid + promptId
+ origin fields that Claude Code writes):

```bash
cat > /tmp/t.jsonl <<'EOF'
{"type":"user","uuid":"u1","parentUuid":null,"promptId":"p1","origin":{"kind":"channel","server":"plugin:telegram:telegram"},"message":{"role":"user","content":"<channel source=\"plugin:telegram:telegram\" chat_id=\"YOUR_CHAT_ID\" message_id=\"1\" user=\"x\" user_id=\"x\" ts=\"2026-01-01T00:00:00Z\">\ntest\n</channel>"}}
{"type":"assistant","uuid":"a1","parentUuid":"u1","message":{"role":"assistant","content":[{"type":"text","text":"hello"}]}}
EOF

TELEGRAM_STATE_DIR=~/.claude/channels/telegram-<agent> \
  echo '{"transcript_path":"/tmp/t.jsonl","session_id":"test","stop_hook_active":false}' \
  | bun hooks/telegram-deliver.ts
```

The target chat should receive "hello" threaded to message_id=1, and
`~/.claude/channels/telegram-deliver.log` should show one delivery line.
