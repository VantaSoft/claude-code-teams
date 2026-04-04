# Email & Calendar System (Example)

This doc describes one pattern for using the Google Workspace MCP server with the orchestrator: multi-account email triage, morning briefings, and calendar alerts. Adapt to your needs.

## Accounts

The Google Workspace MCP server supports multiple accounts. Each account has its own OAuth token file at `~/.config/google-workspace-mcp/tokens-<name>.json`. The `default` account is at `tokens.json`.

Add a new account by running:
```bash
cd PROJECT_ROOT/mcp/google-workspace
node dist/setup.js <account-name>
```

Common account names: `default`, `work`, `personal`, or by company name.

## Recurring Tasks Pattern

Put these in the orchestrator's `heartbeat.md` to run every 30 minutes via crontab.

### Spam Scanner

Scan unread inboxes across all accounts. Mark obvious spam (cold outreach, unsolicited pitches) using `gmail_batch_mark_spam`.

Maintain a known spam senders list in heartbeat.md. Update it when the principal confirms new spam patterns.

### Email Triage

Categorize unread emails into three buckets:
- **Needs Attention**: notify principal immediately via Telegram (clients, team, questions directed at them, urgent issues)
- **FYI**: include in morning briefing only (automated reports, service notifications, subscribed marketing)
- **Not Sure**: include in next notification with "?" prefix so principal can tell you how to categorize

Learn over time — when the principal corrects categorization, update the rules in heartbeat.md.

### Morning Briefing

At a specific time window (e.g. 7-7:30am local), send principal a Telegram summary:
1. Today's calendar events (all accounts)
2. Unreplied urgent/important emails with age
3. New emails needing attention
4. FYI count by category

### Calendar Alerts

Check for events starting in next 15-20 min. Send Telegram reminder with event name, time, location/link. One alert per event.

## Time Window Detection

For time-gated tasks (morning briefing, nightly backup), check current UTC time in heartbeat.md and only run during the window. Skip silently otherwise.

Example: to run at 7am PT (14:00 UTC), gate on `current_time between 14:00-14:30 UTC`.

## Learning System

The triage rules improve over time:
- Principal says "this doesn't need my attention" → add sender/pattern to FYI list
- Principal says "you should have flagged this" → add sender/pattern to Needs Attention list
- Principal confirms spam → add domain to known spam senders

All rules live in `heartbeat.md`. Edit the file directly to update them.
