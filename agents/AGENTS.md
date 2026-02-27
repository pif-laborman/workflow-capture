# AGENTS.md — Shared Reference

This folder contains agent definitions. Each subfolder has a SOUL.md (identity + rules) and optionally TOOLS.md (environment).

## Directory Structure

```
~/agents/
  AGENTS.md              # This file (shared reference)
  pif/                   # Pif — dispatcher and primary agent
    SOUL.md              # Identity, rules, operating protocol
    TOOLS.md             # Full tool and service inventory
    HEARTBEAT.md         # Heartbeat protocol
  reader/                # Reader — sandboxed content extraction (untrusted input firewall)
    SOUL.md              # Extraction rules, output format, injection detection
    IDENTITY.md          # Integration guide and usage examples
  {developer,editor,fixer,investigator,planner,reviewer,tester,triager,verifier,writer,researcher,setup,pr}/
                         # Antfarm sub-agents (each has SOUL.md + IDENTITY.md)

~/memory/                # Operational state (ephemeral)
  WORKING.md             # Current tasks, blockers, active projects
  USER.md                # Pavol's profile and trusted senders
  daily/                 # Daily logs (YYYY-MM-DD.md)
  .learnings/            # Errors, learnings, feature requests
  research/              # Research docs

~/life/                  # Durable knowledge (PARA structure)
  projects/              # Active project summaries
  areas/                 # Ongoing responsibilities (infra, security, content, pavol)
  resources/             # Tools, contacts, workflows
  archives/              # Completed/inactive items

~/workflows/             # YAML workflow definitions
~/scripts/               # Helper scripts
~/.claude/skills/        # Claude Code skills (19)
```