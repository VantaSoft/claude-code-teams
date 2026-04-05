#!/usr/bin/env bun
/**
 * Stop hook: pure-terminal delivery for Telegram-sourced turns.
 *
 * Design: agents respond to Telegram messages by writing text to the
 * terminal. This hook is the authoritative delivery path — at each turn
 * boundary, it reads the just-completed turn, checks whether it came from
 * a Telegram channel, and POSTs the assistant's text to the original chat
 * with a threaded reply to the user's message_id.
 *
 * Stateless. Each Stop event is self-contained. Earlier turns were
 * already handled by their own Stop events.
 *
 * Install: register as a Stop hook in the agent's .claude/settings.local.json:
 *   {"hooks": {"Stop": [{"hooks": [{"type": "command",
 *      "command": "bun $CLAUDE_PROJECT_DIR/hooks/telegram-deliver.ts"}]}]}}
 *
 * Bot token resolution:
 *   1. $TELEGRAM_BOT_TOKEN
 *   2. $TELEGRAM_STATE_DIR/.env (TELEGRAM_BOT_TOKEN=...)
 */

import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'

const CHANNEL_TAG_RE =
  /<channel\s+source="plugin:telegram:telegram"[^>]*\bchat_id="(\d+)"[^>]*\bmessage_id="(\d+)"/i
const LOG_PATH = join(homedir(), '.claude', 'channels', 'telegram-deliver.log')
const MAX_CHARS = 4000 // Telegram caps at 4096

type Entry = {
  type?: string
  uuid?: string
  parentUuid?: string | null
  promptId?: string
  origin?: { kind?: string; server?: string }
  message?: { role?: string; content?: unknown }
}

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; name: string; input: Record<string, unknown> }
  | { type: string; [k: string]: unknown }

function log(msg: string): void {
  try {
    mkdirSync(dirname(LOG_PATH), { recursive: true })
    appendFileSync(LOG_PATH, msg.trimEnd() + '\n')
  } catch {}
}

function loadTranscript(path: string): Entry[] {
  const entries: Entry[] = []
  try {
    const text = readFileSync(path, 'utf8')
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        entries.push(JSON.parse(trimmed))
      } catch {}
    }
  } catch (e) {
    log(`transcript open failed: ${e}`)
  }
  return entries
}

function findTrailingTurn(
  entries: Entry[],
): { assistantEntries: Entry[]; userEntry: Entry | null } | null {
  const byUuid = new Map<string, Entry>()
  for (const e of entries) if (e.uuid) byUuid.set(e.uuid, e)

  let i = entries.length - 1
  while (i >= 0 && entries[i].type !== 'assistant') i--
  if (i < 0) return null
  const trailingEnd = i
  while (i >= 0 && entries[i].type === 'assistant') i--
  const assistantEntries = entries.slice(i + 1, trailingEnd + 1)

  // Walk parentUuid to root user prompt
  let cur: Entry | undefined = assistantEntries[0]
  for (let step = 0; step < 200; step++) {
    const parent = cur?.parentUuid
    if (!parent) return { assistantEntries, userEntry: null }
    cur = byUuid.get(parent)
    if (!cur) return { assistantEntries, userEntry: null }
    if (cur.type === 'user' && cur.promptId) {
      return { assistantEntries, userEntry: cur }
    }
  }
  return { assistantEntries, userEntry: null }
}

function collectText(assistantEntries: Entry[]): string {
  const texts: string[] = []
  for (const e of assistantEntries) {
    const content = (e.message?.content ?? []) as ContentBlock[]
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (block.type === 'text') {
        const t = (block as { text?: string }).text ?? ''
        if (t) texts.push(t)
      }
    }
  }
  return texts.join('\n\n').trim()
}

function readBotToken(): string | null {
  const fromEnv = process.env.TELEGRAM_BOT_TOKEN
  if (fromEnv) return fromEnv
  const stateDir = process.env.TELEGRAM_STATE_DIR
  if (!stateDir) return null
  const envFile = join(stateDir, '.env')
  try {
    for (const line of readFileSync(envFile, 'utf8').split('\n')) {
      const m = line.trim().match(/^TELEGRAM_BOT_TOKEN=(.*)$/)
      if (m) return m[1]
    }
  } catch {}
  return null
}

function chunkText(text: string, limit = MAX_CHARS): string[] {
  if (text.length <= limit) return [text]
  const chunks: string[] = []
  let remaining = text
  while (remaining.length > limit) {
    let splitAt = remaining.lastIndexOf('\n\n', limit)
    if (splitAt < limit / 2) splitAt = remaining.lastIndexOf('\n', limit)
    if (splitAt < limit / 2) splitAt = limit
    chunks.push(remaining.slice(0, splitAt).trimEnd())
    remaining = remaining.slice(splitAt).trimStart()
  }
  if (remaining) chunks.push(remaining)
  return chunks
}

async function sendTelegram(
  token: string,
  chatId: string,
  replyToMessageId: string,
  text: string,
): Promise<boolean> {
  const url = `https://api.telegram.org/bot${token}/sendMessage`
  const chunks = chunkText(text)
  for (let i = 0; i < chunks.length; i++) {
    const body: Record<string, string> = { chat_id: chatId, text: chunks[i] }
    if (i === 0 && replyToMessageId) {
      body.reply_to_message_id = replyToMessageId
      body.allow_sending_without_reply = 'true'
    }
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(body).toString(),
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) {
        log(`sendMessage failed chat=${chatId} status=${res.status} body=${await res.text()}`)
        return false
      }
    } catch (e) {
      log(`sendMessage failed chat=${chatId}: ${e}`)
      return false
    }
  }
  return true
}

async function main(): Promise<void> {
  let payload: Record<string, unknown> = {}
  try {
    const input = await Bun.stdin.text()
    payload = input ? JSON.parse(input) : {}
  } catch {}

  const sid = String(payload.session_id ?? '').slice(0, 8)
  log(`fired session=${sid} active=${payload.stop_hook_active ?? false}`)

  if (payload.stop_hook_active) return

  const transcriptPath = payload.transcript_path as string | undefined
  if (!transcriptPath || !existsSync(transcriptPath)) return

  const entries = loadTranscript(transcriptPath)
  if (!entries.length) return

  const turn = findTrailingTurn(entries)
  if (!turn?.userEntry) return

  const origin = turn.userEntry.origin ?? {}
  if (origin.kind !== 'channel' || origin.server !== 'plugin:telegram:telegram') return

  const content = turn.userEntry.message?.content
  if (typeof content !== 'string') return
  const m = CHANNEL_TAG_RE.exec(content)
  if (!m) return
  const [, chatId, messageId] = m

  // Pure-terminal model: always deliver terminal text. Agents may additionally
  // call the reply tool for attachments/reactions/edits — those are sent via
  // the tool, the terminal text is still delivered here. Possible duplicate
  // if an agent both calls reply tool with text AND writes the same text to
  // terminal; acceptable cost vs. the alternative (invisible terminal text).
  const text = collectText(turn.assistantEntries)
  if (!text) return

  const token = readBotToken()
  if (!token) {
    log('no TELEGRAM_BOT_TOKEN; cannot deliver')
    return
  }

  const ok = await sendTelegram(token, chatId, messageId, text)
  log(`deliver chat=${chatId} chars=${text.length} ok=${ok}`)
}

main()
