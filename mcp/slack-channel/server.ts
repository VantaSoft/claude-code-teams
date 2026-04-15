#!/usr/bin/env bun
/**
 * Slack channel for Claude Code.
 *
 * A channel plugin that bridges Slack and Claude Code using the same
 * protocol as the first-party Telegram plugin. Connects to Slack via
 * Socket Mode (WebSocket, no public URL), delivers inbound messages
 * via the claude/channel notification protocol, and exposes reply/
 * react/update tools for outbound.
 *
 * Load with: --channels plugin:slack --dangerously-load-development-channels
 * (or via --plugin-dir if using local plugin loading)
 *
 * State dir: $SLACK_STATE_DIR (default ~/.claude/channels/slack)
 *   .env          SLACK_BOT_TOKEN, SLACK_APP_TOKEN
 *   access.json   { dmPolicy, allowFromUsers, channels }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { SocketModeClient } from '@slack/socket-mode'
import { WebClient, retryPolicies } from '@slack/web-api'
import { readFileSync, appendFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, basename } from 'node:path'

// --- Config ---

const STATE_DIR =
  process.env.SLACK_STATE_DIR ??
  join(homedir(), '.claude', 'channels', 'slack')
const ACCESS_FILE = join(STATE_DIR, 'access.json')
const ENV_FILE = join(STATE_DIR, '.env')

// Load .env into process.env (real env wins)
try {
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = line.match(/^(\w+)=(.*)$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
  }
} catch {}

const BOT_TOKEN = process.env.SLACK_BOT_TOKEN
const APP_TOKEN = process.env.SLACK_APP_TOKEN

if (!BOT_TOKEN) {
  process.stderr.write(
    `slack channel: SLACK_BOT_TOKEN required\n` +
      `  set in ${ENV_FILE}\n` +
      `  format: SLACK_BOT_TOKEN=xoxb-...\n`,
  )
  process.exit(1)
}
if (!APP_TOKEN) {
  process.stderr.write(
    `slack channel: SLACK_APP_TOKEN required\n` +
      `  set in ${ENV_FILE}\n` +
      `  format: SLACK_APP_TOKEN=xapp-...\n`,
  )
  process.exit(1)
}

const web = new WebClient(BOT_TOKEN, {
  retryConfig: retryPolicies.fiveRetriesInFiveMinutes,
})
const socket = new SocketModeClient({ appToken: APP_TOKEN })

let botUserId = ''
let botUsername = ''

// Pending ack reactions — keyed by channel_id, value is the list of inbound
// message ts values that got the ackReaction and haven't been cleared yet.
// When the agent sends its first reply to a channel, we auto-clear every
// pending ack for that channel so the "eyes → done" flip works correctly
// even when multiple inbound messages arrive before the agent replies.
const pendingAcks = new Map<string, string[]>()

// --- Access control ---

type Access = {
  dmPolicy?: 'allowlist' | 'disabled'
  allowFromUsers?: string[]
  channels?: string[]
  ackReaction?: string
}

function loadAccess(): Access {
  try {
    return JSON.parse(readFileSync(ACCESS_FILE, 'utf8')) as Access
  } catch {
    return { dmPolicy: 'disabled', allowFromUsers: [], channels: [] }
  }
}


function isAllowed(
  channelId: string,
  userId: string,
  text: string,
  isDM: boolean,
): boolean {
  const access = loadAccess()

  if (isDM) {
    if (access.dmPolicy !== 'allowlist') return false
    return (access.allowFromUsers ?? []).includes(userId)
  }

  // Group channel: must be in channel list + must mention bot
  if (!(access.channels ?? []).includes(channelId)) return false
  const mention = `<@${botUserId}>`
  return text.includes(mention)
}

// Username cache — avoid API call on every message
const userNameCache = new Map<string, string>()

async function resolveUserName(userId: string): Promise<string> {
  const cached = userNameCache.get(userId)
  if (cached) return cached
  try {
    const info = await web.users.info({ user: userId })
    const name = info.user?.name ?? userId
    userNameCache.set(userId, name)
    return name
  } catch {
    return userId
  }
}

// Permission reply pattern — same as the Telegram plugin.
// User types "yes xxxxx" or "no xxxxx" where xxxxx is a 5-letter request code.
const PERMISSION_REPLY_RE = /^\s*(y|yes|n|no)\s+([a-km-z]{5})\s*$/i

// Stores pending permission details. Bounded + TTL'd so abandoned
// requests don't accumulate forever.
const PERMISSION_TTL_MS = 30 * 60 * 1000 // 30 minutes
const PERMISSION_MAX = 200
type PendingPermission = { tool_name: string; description: string; input_preview: string; created_at: number }
const pendingPermissions = new Map<string, PendingPermission>()

function evictExpiredPermissions() {
  const now = Date.now()
  for (const [id, p] of pendingPermissions) {
    if (now - p.created_at > PERMISSION_TTL_MS) pendingPermissions.delete(id)
  }
  // Fallback: if still over-capacity, drop oldest (insertion order).
  while (pendingPermissions.size > PERMISSION_MAX) {
    const first = pendingPermissions.keys().next().value
    if (!first) break
    pendingPermissions.delete(first)
  }
}

// --- MCP Server ---

const mcp = new Server(
  { name: 'slack', version: '0.1.0' },
  {
    capabilities: {
      tools: {},
      experimental: {
        'claude/channel': {},
        'claude/channel/permission': {},
      },
    },
    instructions: [
      'The sender reads Slack, not this session. Anything you want them to see must go through the reply tool — your transcript output never reaches their chat.',
      '',
      'Messages from Slack arrive as <channel source="slack" channel_id="..." ts="..." user="..." user_id="..." kind="dm|channel">. Reply with the reply tool — pass channel_id back. For threaded messages, the tag includes thread_ts — pass it to reply in the same thread.',
      '',
      'reply posts a text message. Use react to add emoji reactions, update to edit a previous bot message (useful for progress updates — edits don\'t trigger push notifications), and remove_reaction to clear reactions.',
      '',
      "Slack's Bot API exposes no message history or search — you only see messages as they arrive. If you need earlier context, ask the user to paste it or summarize.",
    ].join('\n'),
  },
)

// --- Permission relay ---
// Receive permission_request from Claude Code → send to all allowlisted DM users.
mcp.setNotificationHandler(
  z.object({
    method: z.literal('notifications/claude/channel/permission_request'),
    params: z.object({
      request_id: z.string(),
      tool_name: z.string(),
      description: z.string(),
      input_preview: z.string(),
    }),
  }),
  async ({ params }) => {
    const { request_id, tool_name, description, input_preview } = params
    pendingPermissions.set(request_id, { tool_name, description, input_preview, created_at: Date.now() })
    evictExpiredPermissions()
    const access = loadAccess()

    let prettyInput: string
    try {
      prettyInput = JSON.stringify(JSON.parse(input_preview), null, 2)
    } catch {
      prettyInput = input_preview
    }

    const text =
      `🔐 *Permission request*\n` +
      `Tool: \`${tool_name}\`\n` +
      `Description: ${description}\n` +
      `Input:\n\`\`\`${prettyInput}\`\`\`\n\n` +
      `Reply with \`yes ${request_id}\` to allow or \`no ${request_id}\` to deny.`

    // Send to all DM-allowlisted users (using module-level cached access)
    for (const userId of access.allowFromUsers ?? []) {
      web.chat.postMessage({ channel: userId, text }).catch((e) => {
        process.stderr.write(`slack channel: permission_request send to ${userId} failed: ${e}\n`)
      })
    }
  },
)

// --- Tools ---

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'reply',
      description:
        'Reply on Slack. Pass channel_id from the inbound message. Optionally pass thread_ts for threaded replies.',
      inputSchema: {
        type: 'object',
        properties: {
          channel_id: { type: 'string' },
          text: { type: 'string' },
          thread_ts: {
            type: 'string',
            description:
              'Thread parent ts. Pass only when replying inside an existing thread.',
          },
        },
        required: ['channel_id', 'text'],
      },
    },
    {
      name: 'react',
      description: 'Add an emoji reaction to a Slack message.',
      inputSchema: {
        type: 'object',
        properties: {
          channel_id: { type: 'string' },
          ts: {
            type: 'string',
            description: 'The message ts to react to.',
          },
          name: {
            type: 'string',
            description:
              "Emoji name without colons (e.g. 'white_check_mark', '+1', 'eyes').",
          },
        },
        required: ['channel_id', 'ts', 'name'],
      },
    },
    {
      name: 'update',
      description:
        "Edit a message the bot previously sent. Useful for interim progress updates — post an initial 'working on it...' message, then update with the final result. Edits don't trigger push notifications.",
      inputSchema: {
        type: 'object',
        properties: {
          channel_id: { type: 'string' },
          ts: {
            type: 'string',
            description: "The ts of the bot's own message to edit.",
          },
          text: {
            type: 'string',
            description: 'New text to replace the message with.',
          },
        },
        required: ['channel_id', 'ts', 'text'],
      },
    },
    {
      name: 'remove_reaction',
      description:
        "Remove an emoji reaction from a message. Use to clear the ack reaction (eyes) after responding.",
      inputSchema: {
        type: 'object',
        properties: {
          channel_id: { type: 'string' },
          ts: { type: 'string' },
          name: {
            type: 'string',
            description: "Emoji name to remove (e.g. 'eyes').",
          },
        },
        required: ['channel_id', 'ts', 'name'],
      },
    },
    {
      name: 'upload',
      description:
        'Upload a file to a Slack channel or DM. Pass an absolute file path on the local filesystem. Useful for sharing screenshots, logs, generated images, CSVs, etc.',
      inputSchema: {
        type: 'object',
        properties: {
          channel_id: {
            type: 'string',
            description: 'Channel or DM ID to upload to.',
          },
          file_path: {
            type: 'string',
            description: 'Absolute path to the file on the local filesystem.',
          },
          title: {
            type: 'string',
            description: 'Optional title for the file.',
          },
          comment: {
            type: 'string',
            description: 'Optional message to post alongside the file.',
          },
        },
        required: ['channel_id', 'file_path'],
      },
    },
  ],
}))

// Text chunking — Slack caps at ~4000 chars for clean rendering
const TEXT_CHUNK_LIMIT = 4000

function chunkText(text: string): string[] {
  if (text.length <= TEXT_CHUNK_LIMIT) return [text]
  const chunks: string[] = []
  let remaining = text
  while (remaining.length > TEXT_CHUNK_LIMIT) {
    let splitAt = remaining.lastIndexOf('\n\n', TEXT_CHUNK_LIMIT)
    if (splitAt < TEXT_CHUNK_LIMIT / 2)
      splitAt = remaining.lastIndexOf('\n', TEXT_CHUNK_LIMIT)
    if (splitAt < TEXT_CHUNK_LIMIT / 2) splitAt = TEXT_CHUNK_LIMIT
    chunks.push(remaining.slice(0, splitAt).trimEnd())
    remaining = remaining.slice(splitAt).trimStart()
  }
  if (remaining) chunks.push(remaining)
  return chunks
}

mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params
  const a = (args ?? {}) as Record<string, unknown>

  if (name === 'reply') {
    const channel = String(a.channel_id ?? '')
    const text = String(a.text ?? '')
    const threadTs = a.thread_ts != null ? String(a.thread_ts) : undefined

    try {
      const chunks = chunkText(text)
      let lastTs = ''
      for (let i = 0; i < chunks.length; i++) {
        const res = await web.chat.postMessage({
          channel,
          text: chunks[i],
          ...(threadTs ? { thread_ts: threadTs } : {}),
        })
        lastTs = res.ts ?? ''
      }

      // Auto-clear every pending ack reaction for this channel. The agent's
      // reply means the turn is effectively done from the sender's POV, so
      // the eyes indicator should flip off for every inbound message that's
      // still wearing one. Fire-and-forget — if a remove fails we don't
      // block the reply.
      const queued = pendingAcks.get(channel)
      if (queued && queued.length > 0) {
        const ackName = (loadAccess().ackReaction ?? '').trim()
        if (ackName) {
          for (const ackedTs of queued) {
            web.reactions
              .remove({ channel, timestamp: ackedTs, name: ackName })
              .catch((err) => debugLog(`auto-clear ack failed ts=${ackedTs}: ${(err as Error).message}`))
          }
        }
        pendingAcks.delete(channel)
      }

      return {
        content: [
          { type: 'text', text: `sent: channel=${channel} ts=${lastTs}` },
        ],
      }
    } catch (e) {
      return {
        content: [
          {
            type: 'text',
            text: `reply failed: ${(e as Error).message}`,
          },
        ],
        isError: true,
      }
    }
  }

  if (name === 'react') {
    try {
      await web.reactions.add({
        channel: String(a.channel_id),
        timestamp: String(a.ts),
        name: String(a.name),
      })
      return {
        content: [
          {
            type: 'text',
            text: `reacted ${a.name} on ${a.channel_id}/${a.ts}`,
          },
        ],
      }
    } catch (e) {
      return {
        content: [
          {
            type: 'text',
            text: `react failed: ${(e as Error).message}`,
          },
        ],
        isError: true,
      }
    }
  }

  if (name === 'update') {
    try {
      const res = await web.chat.update({
        channel: String(a.channel_id),
        ts: String(a.ts),
        text: String(a.text),
      })
      return {
        content: [
          {
            type: 'text',
            text: `updated: channel=${a.channel_id} ts=${res.ts ?? a.ts}`,
          },
        ],
      }
    } catch (e) {
      return {
        content: [
          {
            type: 'text',
            text: `update failed: ${(e as Error).message}`,
          },
        ],
        isError: true,
      }
    }
  }

  if (name === 'remove_reaction') {
    try {
      await web.reactions.remove({
        channel: String(a.channel_id),
        timestamp: String(a.ts),
        name: String(a.name),
      })
      return {
        content: [
          {
            type: 'text',
            text: `removed ${a.name} from ${a.channel_id}/${a.ts}`,
          },
        ],
      }
    } catch (e) {
      return {
        content: [
          {
            type: 'text',
            text: `remove_reaction failed: ${(e as Error).message}`,
          },
        ],
        isError: true,
      }
    }
  }

  if (name === 'upload') {
    const channel = String(a.channel_id ?? '')
    const filePath = String(a.file_path ?? '')
    const title = a.title != null ? String(a.title) : undefined
    const comment = a.comment != null ? String(a.comment) : undefined

    try {
      await stat(filePath) // verify file exists (async)
      await web.filesUploadV2({
        channel_id: channel,
        file: filePath,
        filename: basename(filePath),
        ...(title ? { title } : {}),
        ...(comment ? { initial_comment: comment } : {}),
      })
      return {
        content: [
          {
            type: 'text',
            text: `uploaded: ${basename(filePath)} to channel=${channel}`,
          },
        ],
      }
    } catch (e) {
      return {
        content: [
          {
            type: 'text',
            text: `upload failed: ${(e as Error).message}`,
          },
        ],
        isError: true,
      }
    }
  }

  return {
    content: [{ type: 'text', text: `unknown tool: ${name}` }],
    isError: true,
  }
})

// --- Inbound: Slack → Claude Code ---

// Debug log — always on, inspectable via: tail -f /tmp/slack-channel-debug.log
const DEBUG_LOG = '/tmp/slack-channel-debug.log'
function debugLog(msg: string): void {
  try { appendFileSync(DEBUG_LOG, new Date().toISOString() + ' ' + msg + '\n') } catch {}
}

// Deduplication by client_msg_id — globally unique per message.
// Bounded Set (last 1000 IDs) instead of time-based cleanup.
const seenMessages = new Set<string>()
const DEDUP_MAX = 1000

function dedup(event: Record<string, unknown>): boolean {
  const id = String(event.client_msg_id ?? `${event.channel}:${event.ts}` ?? '')
  if (!id) return false
  if (seenMessages.has(id)) return true
  seenMessages.add(id)
  if (seenMessages.size > DEDUP_MAX) {
    // Remove oldest entry (Sets iterate in insertion order)
    seenMessages.delete(seenMessages.values().next().value!)
  }
  return false
}

async function handleInbound(event: Record<string, unknown>): Promise<void> {
  const ts = String(event.ts ?? '?')
  debugLog(`message received ts=${ts} user=${event.user ?? 'unknown'}`)

  // Ignore bot messages, message edits (but allow file_share subtype)
  if (event.subtype && event.subtype !== 'file_share') return
  if (event.bot_id) { debugLog(`skip: bot_id ts=${ts}`); return }
  // Allow messages with files but no text
  if (!event.user || (!event.text && !event.files)) { debugLog(`skip: no user/text ts=${ts}`); return }

  // Deduplicate by client_msg_id (or ts fallback)
  if (dedup(event)) {
    debugLog(`skip: duplicate id=${event.client_msg_id ?? ts}`)
    return
  }

  const channelId = String(event.channel)
  const userId = String(event.user)
  const text = String(event.text ?? '')
  const isDM = channelId.startsWith('D')

  if (!isAllowed(channelId, userId, text, isDM)) {
    debugLog(`drop: channel=${channelId} user=${userId} (access denied)`)
    return
  }

  // Progress indicator: react to the inbound message with the configured ack
  // emoji so the sender sees "bot is working". The reaction is automatically
  // cleared when the agent sends its first reply to this channel (see the
  // reply tool handler below). Fire-and-forget on add — if the reaction
  // fails we don't block message delivery.
  {
    const ackName = (loadAccess().ackReaction ?? '').trim()
    if (ackName && event.ts) {
      const ts = String(event.ts)
      web.reactions
        .add({ channel: channelId, timestamp: ts, name: ackName })
        .catch((err) => debugLog(`ack reaction failed ts=${ts}: ${err}`))
      const queue = pendingAcks.get(channelId) ?? []
      queue.push(ts)
      pendingAcks.set(channelId, queue)
    }
  }

  // Permission-reply intercept: if this looks like "yes xxxxx" or "no xxxxx"
  // for a pending permission request, relay the decision instead of forwarding
  // as a channel message. Same pattern as the Telegram plugin.
  const permMatch = PERMISSION_REPLY_RE.exec(text)
  if (permMatch) {
    const behavior = permMatch[1]!.toLowerCase().startsWith('y') ? 'allow' : 'deny'
    const request_id = permMatch[2]!.toLowerCase()
    mcp.notification({
      method: 'notifications/claude/channel/permission',
      params: { request_id, behavior },
    }).catch(() => {})
    pendingPermissions.delete(request_id)
    const emoji = behavior === 'allow' ? '✅' : '❌'
    if (event.ts) {
      web.reactions.add({ channel: channelId, timestamp: String(event.ts), name: behavior === 'allow' ? 'white_check_mark' : 'x' }).catch(() => {})
    }
    return
  }

  // Resolve user display name (cached, sync on cache hit, no await on miss)
  const userName = userNameCache.get(userId) ?? userId
  // Warm cache in background if miss — next message will have the name
  if (!userNameCache.has(userId)) {
    resolveUserName(userId).catch(() => {})
  }

  // Thread context: thread_ts is present when the message is inside a thread
  const threadTs =
    event.thread_ts && event.thread_ts !== event.ts
      ? String(event.thread_ts)
      : undefined

  const meta: Record<string, string> = {
    channel_id: channelId,
    ts: String(event.ts),
    user: userName,
    user_id: userId,
    kind: isDM ? 'dm' : 'channel',
  }
  if (threadTs) meta.thread_ts = threadTs

  // Download attached files before delivering (agent needs the paths)
  const hasFiles = Array.isArray(event.files) && (event.files as unknown[]).length > 0
  const downloadedPaths: string[] = []

  if (hasFiles) {
    const files = event.files as Array<{
      url_private_download?: string
      name?: string
      id?: string
    }>
    const inboxDir = join(STATE_DIR, 'inbox')
    mkdirSync(inboxDir, { recursive: true })

    for (const file of files) {
      if (!file.url_private_download) continue
      try {
        const res = await fetch(file.url_private_download, {
          headers: { Authorization: `Bearer ${BOT_TOKEN}` },
        })
        if (!res.ok) continue
        const buf = Buffer.from(await res.arrayBuffer())
        const safeName = (file.name ?? file.id ?? 'attachment').replace(/[^a-zA-Z0-9._-]/g, '_')
        const localPath = join(inboxDir, `${Date.now()}-${safeName}`)
        writeFileSync(localPath, buf)
        downloadedPaths.push(localPath)
        debugLog(`file downloaded: ${file.name} -> ${localPath} (${buf.length} bytes)`)
      } catch {}
    }
  }

  if (downloadedPaths.length > 0) {
    meta.attachment_paths = downloadedPaths.join(',')
  }

  let content = text
  if (downloadedPaths.length > 0 && !text) {
    content = `(${downloadedPaths.length} file(s) attached)`
  } else if (downloadedPaths.length > 0) {
    content = text + `\n(${downloadedPaths.length} file(s) attached)`
  }
  if (!content) content = ''

  debugLog(`inject: channel=${channelId} ts=${event.ts} user=${userName} chars=${content.length} files=${downloadedPaths.length}`)

  mcp
    .notification({
      method: 'notifications/claude/channel',
      params: { content, meta },
    })
    .then(() => debugLog(`notification sent OK ts=${event.ts}`))
    .catch((err) => {
      debugLog(`notification FAILED ts=${event.ts}: ${err}`)
    })
}

// Serialize handleInbound calls so two messages arriving back-to-back
// can't race on shared state (pendingAcks, notification ordering).
// Socket Mode dispatches message events concurrently; chaining through
// a single promise guarantees FIFO delivery to the agent.
let inboundChain: Promise<void> = Promise.resolve()

socket.on('message', async ({ event, ack }) => {
  const arrived = Date.now()
  const ts = (event as Record<string, unknown>).ts ?? '?'
  process.stderr.write(`slack channel: [TIMING] message arrived ts=${ts} at ${new Date(arrived).toISOString()}\n`)
  await ack()
  const acked = Date.now()
  process.stderr.write(`slack channel: [TIMING] ack sent ${acked - arrived}ms after arrival\n`)
  inboundChain = inboundChain
    .then(() => handleInbound(event as Record<string, unknown>))
    .catch((err) => {
      process.stderr.write(`slack channel: handleInbound error ts=${ts}: ${(err as Error).message}\n`)
    })
    .then(() => {
      process.stderr.write(`slack channel: [TIMING] handleInbound done ${Date.now() - arrived}ms total\n`)
    })
})

socket.on('connected', () => {
  process.stderr.write(
    `slack channel: socket mode connected as @${botUsername} at ${new Date().toISOString()}\n`,
  )
})

socket.on('disconnected', () => {
  process.stderr.write(`slack channel: socket mode DISCONNECTED at ${new Date().toISOString()}\n`)
})

socket.on('error', (err: Error) => {
  process.stderr.write(`slack channel: socket ERROR at ${new Date().toISOString()}: ${err.message}\n`)
})

socket.on('close', () => {
  process.stderr.write(`slack channel: socket CLOSE at ${new Date().toISOString()}\n`)
})

socket.on('reconnecting', () => {
  process.stderr.write(`slack channel: socket RECONNECTING at ${new Date().toISOString()}\n`)
})

// Catch unhandled rejections — keep serving, don't crash
process.on('unhandledRejection', (err) => {
  const msg = err instanceof Error ? err.message : String(err)
  process.stderr.write(`slack channel: unhandled rejection at ${new Date().toISOString()}: ${msg}\n`)
})
// No uncaughtException handler — let the process crash and restart cleanly
// rather than continuing in a corrupted state.

// --- Bootstrap ---
// Socket Mode must start BEFORE mcp.connect() because connect() enters
// the stdio event loop and never returns. Same pattern as the Telegram
// plugin (bot.start() runs in a fire-and-forget async, then MCP connects).

void (async () => {
  try {
    const auth = await web.auth.test()
    if (!auth.user_id) {
      process.stderr.write(`slack channel: auth.test returned no user_id — refusing to start (group-channel mention matching would silently drop everything)\n`)
      process.exit(1)
    }
    botUserId = auth.user_id
    botUsername = auth.user ?? ''
    process.stderr.write(
      `slack channel: bot=@${botUsername} (id=${botUserId}) team=${auth.team}\n`,
    )
  } catch (e) {
    process.stderr.write(`slack channel: auth.test failed: ${(e as Error).message}\n`)
    process.exit(1)
  }

  // Start Socket Mode first (non-blocking, runs in background)
  await socket.start()
})()

// Connect MCP last — this blocks (enters stdio event loop)
const transport = new StdioServerTransport()
await mcp.connect(transport)
