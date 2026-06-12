---
name: recall
description: Search past Claude Code sessions across all projects on this machine. Use when the user references prior work ("like we did last week", "the bug we fixed", "what did we decide about X"), when context was compacted and details are missing, when resuming a project after time away, or before re-deriving a solution that may already exist in a past session. Keyword FTS5 search over full transcripts including tool output.
---

# Recall — past-session search

Every past session is indexed (SQLite FTS5, BM25 ranking) and searchable via the
fleet MCP's recall tools. The index self-refreshes on every call — no manual
reindex needed.

**Search** (start here — 2-4 distinctive keywords; supports `"exact phrases"`, OR, NOT, prefix\*):

    recall(query="drizzle migration enum", n=8)
    recall(query="stripe connect webhook", project="cardsync")

**Read around a hit** (the session id and seq come from the recall output; k is the scroll radius):

    recall_context(session="<session-id>", seq=<seq>, k=8)

**List recent sessions:**

    recall_sessions(n=20)

Workflow: `recall` → pick the strongest hit → `recall_context` to read the
surrounding conversation → apply what you find. Never guess about a past
decision when a fast search can confirm it, and never ask the user to repeat
something findable here.
