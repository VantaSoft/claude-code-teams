#!/usr/bin/env bun
/**
 * UserPromptSubmit hook: remind the agent to use the channel's reply tool.
 *
 * When a user prompt arrives carrying a channel tag (Telegram, Discord, …),
 * the agent is supposed to reply via that channel's MCP reply tool. The
 * rule lives in CLAUDE.md, but agents drift mid-conversation — especially
 * on short/casual replies — and plain terminal text is invisible to
 * channel users.
 *
 * This hook injects a per-turn reminder tied to THE specific triggering
 * prompt: extract source + chat_id from the tag, emit an additionalContext
 * telling the agent which tool to call with which chat_id. Most targeted
 * nudge possible without actually enforcing routing.
 *
 * Install: register as a UserPromptSubmit hook in the agent's
 * .claude/settings.local.json:
 *   {"hooks": {"UserPromptSubmit": [{"hooks": [{"type": "command",
 *      "command": "bun <abs-path>/channel-reply-reminder.ts"}]}]}}
 */

const CHANNEL_TAG_RE =
  /<channel\s+source="([^"]+)"[^>]*\bchat_id="(\d+)"(?:[^>]*\bmessage_id="(\d+)")?/i

type HookInput = { prompt?: string }
type HookOutput = {
  hookSpecificOutput: {
    hookEventName: 'UserPromptSubmit'
    additionalContext: string
  }
}

function replyToolForSource(source: string): string | null {
  // source looks like "plugin:telegram:telegram" or "plugin:discord:discord"
  const parts = source.split(':')
  if (parts.length < 3 || parts[0] !== 'plugin') return null
  const channel = parts[1]
  return `mcp__plugin_${channel}_${channel}__reply`
}

function buildReminder(source: string, chatId: string): string | null {
  const tool = replyToolForSource(source)
  if (!tool) return null
  const channel = source.split(':')[1]
  return `Reply via ${tool} (chat_id=${chatId}, no reply_to). Terminal output is invisible — user is on ${channel}.`
}

async function main(): Promise<void> {
  let payload: HookInput = {}
  try {
    const input = await Bun.stdin.text()
    payload = input ? JSON.parse(input) : {}
  } catch {
    return
  }

  const prompt = payload.prompt ?? ''
  if (!prompt) return

  const m = CHANNEL_TAG_RE.exec(prompt)
  if (!m) return
  const [, source, chatId] = m

  const reminder = buildReminder(source, chatId)
  if (!reminder) return

  const output: HookOutput = {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: reminder,
    },
  }
  process.stdout.write(JSON.stringify(output))
}

main()
