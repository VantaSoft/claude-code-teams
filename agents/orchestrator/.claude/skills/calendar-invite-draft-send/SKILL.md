---
name: calendar-invite-draft-send
description: Use when asked to create, update, delete, or reconcile a calendar invite. Covers the draft-first approval flow, attendee lookup, timezone rules, and duplicate reconciliation.
---

# Calendar Invite Draft and Send

## Never create/update/delete without explicit approval

Do not call `gcal_create_event`, `gcal_update_event`, `gcal_delete_event`, or equivalent tools until the principal has explicitly approved the draft. "Set up a meeting with X" is an instruction to prepare, not create-approval.

Approval looks like "send", "create it", "looks good", "confirm", or equivalent. If unclear, ask.

## Draft flow

Reply in the same channel the ask came from. Format:

> *Title:* ...
> *When:* Day, Month Date, Year - HH:MM-HH:MM timezone
> *Attendees:* email1, email2
> *Where:* Google Meet (auto) / physical address
> *Description:* ...
>
> Reply "send" to create and send, or tell me what to change.

## Looking up attendee emails

Before drafting, find real email addresses. Sources in order:
1. The triggering email thread (check To/From/Cc headers)
2. Sent folder search
3. Prior calendar events with the same person
4. Ask the principal

Never put placeholder emails in a draft.

## Time and timezone

- Use the principal's local timezone consistently
- Include the UTC offset in ISO timestamps (e.g. `2026-05-15T14:00:00-07:00`)
- Check DST for the event date
- Default duration: 30 minutes for calls, 1 hour for working sessions, unless specified
- No HTML entity escapes in titles or descriptions (pass literal characters)

## After create

- Report briefly: include the Meet link and event link if available
- Close the related task inline if this satisfied an open task
- For events involving external parties, ensure `sendUpdates: "all"` so attendees receive the invite email

## Duplicate-invite reconciliation

When someone else sends their own invite for a meeting you already created:
1. Surface the duplicate to the principal
2. Wait for their decision (accept theirs and delete yours, or keep yours)
3. Never delete unilaterally

## Adding a missing guest

- If you created the event: update it to add the attendee
- If someone else created it: forward the invite or create a parallel event
- Ask the principal which approach they prefer

## Common pitfalls

- Creating the event before approval
- Using HTML entity escapes in titles
- Forgetting `sendUpdates: "all"` (attendees don't get the invite email)
- Wrong timezone offset (invite shows at wrong hour)
- Deleting a duplicate invite without principal approval
- Leaving the related task open after the invite is sent
