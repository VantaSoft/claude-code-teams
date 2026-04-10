#!/usr/bin/env bun
/**
 * UserPromptSubmit hook: remind the agent to use the channel's reply tool.
 *
 * When a user prompt arrives carrying a channel tag, the agent is supposed
 * to reply via the corresponding MCP reply tool. The rule lives in
 * CLAUDE.md, but agents drift mid-conversation — especially on short/
 * casual replies — and plain terminal text is invisible to channel users.
 *
 * This hook injects a per-turn reminder tied to THE specific triggering
 * prompt: parse the channel tag, identify the source, emit a short
 * additionalContext telling the agent which tool to call with which id.
 *
 * Install: register as a UserPromptSubmit hook in the agent's
 * .claude/settings.local.json:
 *   {"hooks": {"UserPromptSubmit": [{"hooks": [{"type": "command",
 *      "command": "bun <abs-path>/channel-reply-reminder.ts"}]}]}}
 */

const CHANNEL_TAG_RE = /<channel\s+source="([^"]+)"([^>]*)>/i

type HookInput = { prompt?: string }
type HookOutput = {
  hookSpecificOutput: {
    hookEventName: 'UserPromptSubmit'
    additionalContext: string
  }
}

type SourceSpec = {
  label: string
  idAttr: string // attribute name in the channel tag carrying the routing id
  idParamName: string // parameter name for the reply tool
  replyTool: string
}

// Known channel sources. Add new entries here as channels are built.
function specForSource(source: string): SourceSpec | null {
  // First-party Telegram plugin
  if (source === 'plugin:telegram:telegram') {
    return {
      label: 'telegram',
      idAttr: 'chat_id',
      idParamName: 'chat_id',
      replyTool: 'mcp__plugin_telegram_telegram__reply',
    }
  }
  // First-party Discord plugin
  if (source === 'plugin:discord:discord') {
    return {
      label: 'discord',
      idAttr: 'chat_id',
      idParamName: 'chat_id',
      replyTool: 'mcp__plugin_discord_discord__reply',
    }
  }
  // Slack channel (mcp/slack-channel MCP server)
  if (source === 'slack') {
    return {
      label: 'slack',
      idAttr: 'channel_id',
      idParamName: 'channel_id',
      replyTool: 'mcp__channel-slack__slack_reply',
    }
  }
  return null
}

function extractId(attrs: string, idAttr: string): string | null {
  const re = new RegExp(`\\b${idAttr}="([^"]+)"`, 'i')
  const m = re.exec(attrs)
  return m ? m[1] : null
}

function buildReminder(spec: SourceSpec, id: string, threadTs?: string): string {
  // Slack threading: if the user's message is in a thread, reply in the same
  // thread. Telegram policy is "never thread." Discord TBD.
  let threadHint: string
  if (spec.label === 'slack') {
    threadHint = threadTs
      ? `thread_ts="${threadTs}"`
      : `no thread_ts (top-level message)`
  } else {
    threadHint = `no reply_to/thread_ts`
  }
  return (
    `Reply via ${spec.replyTool} (${spec.idParamName}=${id}, ${threadHint}). ` +
    `Terminal output is invisible — user is on ${spec.label}.`
  )
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
  const [, source, attrs] = m

  const spec = specForSource(source)
  if (!spec) return

  const id = extractId(attrs, spec.idAttr)
  if (!id) return

  // Slack may carry a thread_ts attribute on messages inside a thread.
  const threadTs = extractId(attrs, 'thread_ts') ?? undefined

  const output: HookOutput = {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: buildReminder(spec, id, threadTs ?? undefined),
    },
  }
  process.stdout.write(JSON.stringify(output))
}

main()
