---
name: email-draft-send
description: Use when asked to write, reply to, forward, or send an email on the principal's behalf. Covers the draft-first approval flow, voice rules, and account selection.
---

# Email Draft and Send

## Never send without explicit approval

Do not call `gmail_send`, `gmail_reply`, `outlook_send`, or any send tool until the principal has explicitly approved the draft. A statement like "email X about Y" is an instruction to prepare a draft, not approval to send.

Approval looks like "send", "send it", "looks good", "go ahead", or equivalent. If unclear, ask.

## Draft flow

1. **Draft inline** in the same channel the ask came from (Slack DM gets a Slack draft, Telegram gets a Telegram draft)
2. Show the full draft: To, Subject, Body
3. Wait for explicit approval
4. On approval, send directly via the appropriate tool. Do NOT save to Drafts folder.

## Looking up recipient emails

Before drafting, find real email addresses. Sources in order:
1. The triggering email thread (check To/From/Cc headers)
2. Sent folder search
3. Prior calendar events with the same person
4. Ask the principal

Never put placeholder emails in a draft.

## Voice rules

These apply when writing in the principal's voice:
- Keep it concise. For existing contacts: ask + logistics only, no re-establishing shared history.
- No AI-disclosure footer. Sign as the principal, exactly as they would.
- Match the principal's natural tone (configure per deployment).

## Account selection

Pick the account that matches the context:
- Business email for business contacts
- Personal email for personal contacts
- If unclear, ask

## After send

- Report briefly in the same channel: "Sent."
- If the email addresses an open task, close it inline via the task API. Don't wait for a reconciler.

## Common pitfalls

- Sending before approval
- Using HTML entity escapes in email content (pass literal characters)
- Replying to a sent message (loops back to sender instead of going to the recipient - use replyAll or explicit addressing)
- Forgetting to close the related task after sending
