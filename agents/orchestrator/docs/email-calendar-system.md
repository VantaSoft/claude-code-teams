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

## Schedule Files

Create one `.md` file per recurring task under `PROJECT_ROOT/agents/orchestrator/schedules/`. Each file has YAML frontmatter with the cron cadence. Run `scripts/sync-schedules.sh` after editing.

### Example: spam-triage.md (every 30 min)

```markdown
---
cron: "*/30 * * * *"
---
# Spam Triage

Scan unread inboxes across all accounts. Mark obvious spam using gmail_batch_mark_spam.
Categorize remaining emails as Needs Attention / FYI / Not Sure.
Notify principal only for Needs Attention + spam caught.
Maintain known spam senders list in this file.
```

### Example: morning-briefing.md (daily at 7am local)

```markdown
---
cron: "0 14 * * *"
# 14:00 UTC = 7am PDT. Adjust for your timezone.
---
# Morning Briefing

Send principal a Telegram summary:
1. Today's calendar events (all accounts)
2. Unreplied urgent/important emails with age
3. New emails needing attention
4. FYI count by category
```

### Example: calendar-alerts.md (every 15 min)

```markdown
---
cron: "*/15 * * * *"
---
# Calendar Alerts

Check for events starting in next 15-20 min. Send Telegram reminder with event name, time, location/link.
One alert per event. Skip all-day events.
```

## Triage Categories

- **Needs Attention**: notify principal immediately via Telegram (clients, team, questions directed at them, urgent issues)
- **FYI**: include in morning briefing only (automated reports, service notifications, subscribed marketing)
- **Not Sure**: include in next notification with "?" prefix so principal can tell you how to categorize

## Time Zones

Crontab runs in system timezone. For example, 7am Pacific = 14:00 UTC (PDT) or 15:00 UTC (PST). Document the conversion in a frontmatter comment for humans.

## Learning System

Rules improve over time:
- Principal says "this doesn't need my attention" → add sender/pattern to FYI section of spam-triage.md
- Principal says "you should have flagged this" → add sender/pattern to Needs Attention section
- Principal confirms spam → add domain to known spam senders

All rules live in the schedule files themselves. Edit the files directly — no restart or sync needed unless the cron cadence changes.
