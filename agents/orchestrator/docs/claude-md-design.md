# CLAUDE.md Design Principles

## Context

With 1M context windows and reliable `--resume`/`--continue`, CLAUDE.md's role is narrower than it might seem. The conversation context carries most of the working state, and resume restores it. CLAUDE.md is the spec an agent boots into, not its entire brain.

## What CLAUDE.md Is

- **A bootstrap script.** It runs on every session start (including --continue). Identity, role, and boundaries.
- **Human-readable documentation.** A spec that the principal, teammates, or other agents can read to understand what this agent does.
- **An authoritative override.** If an agent drifts from intent, CLAUDE.md is the contract to point back to.

## What CLAUDE.md Is Not

- Not the agent's memory. That's auto memory + conversation context.
- Not a detailed operations manual. Detailed processes live in `docs/`.
- Not a knowledge base. Each agent maintains its own `docs/` folder.

## Design Rules

1. **Keep it lean.** Only include what's needed for identity, boundaries, and basic behavior. Details go in `docs/`.
2. **Identity up top.** Name, role, scope.
3. **Pointers, not content.** Reference `docs/` for detailed guides. Don't duplicate.
4. **Security boundaries.** Explicit and always present — the one thing you don't want an agent to "learn" to ignore through conversation drift.
5. **Detection + delegation.** Use CLAUDE.md to detect scenarios (e.g. "fresh install") and tell the agent to read the relevant doc. Don't embed long instructions in CLAUDE.md directly.

## Template

```markdown
# {Agent Name} — {Role}

You are {name}, {one-line description}.

## Scope

{What this agent does and doesn't do. 2-3 lines max.}

## Security Boundaries

- {Hard rules that must never be violated}

## Resources

- Docs: PROJECT_ROOT/agents/<name>/docs/
- {Any agent-specific resources, paths, API references}
```

## Shared vs Agent-Specific CLAUDE.md

- `PROJECT_ROOT/CLAUDE.md` (shared) — patterns all agents need: folder structure, schedules pattern, plugins strategy
- `PROJECT_ROOT/agents/<name>/CLAUDE.md` (agent-specific) — identity, scope, role-specific boundaries, detection logic

Don't put orchestrator-specific behavior (setup wizards, new-agent creation) in the shared CLAUDE.md. Specialized agents shouldn't inherit responsibilities that aren't theirs.
