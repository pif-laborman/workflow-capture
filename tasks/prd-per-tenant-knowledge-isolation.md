# PRD: Per-Tenant Knowledge Isolation

## Introduction

The knowledge layer — QMD search index, `~/life/` durable facts, `~/memory/` operational state, and nightly consolidation — is currently single-tenant. All paths are hardcoded to Pavol's home directory. With Matej live as a second tenant, this means he has no knowledge consolidation, no searchable knowledge base, and if consolidation were naively extended, his facts would contaminate Pavol's. This PRD defines the work to give every tenant their own isolated knowledge tree, QMD index, and consolidation cycle.

## Goals

- Every tenant gets an isolated filesystem knowledge tree (`~/tenants/<tenant_id>/`)
- QMD indexes are per-tenant — `qmd search` returns only that tenant's knowledge
- Nightly consolidation runs for all tenants with a knowledge tree
- Brief gatherers that touch the filesystem resolve paths per-tenant
- New tenant provisioning seeds the directory structure automatically
- A tenant-scoped search API endpoint lets tenants query their own knowledge
- Pavol's existing `~/life/` and `~/memory/` remain in place via symlinks — zero disruption

## User Stories

### US-001: Create per-tenant directory structure
**Description:** As a platform operator, I need each tenant to have an isolated directory tree so their knowledge, daily notes, and working state don't leak across tenants.

**Acceptance Criteria:**
- [ ] `~/tenants/<tenant_id>/life/` exists with PARA subdirs: `projects/`, `areas/`, `resources/`, `archives/`
- [ ] `~/tenants/<tenant_id>/memory/` exists with `daily/`, `research/` subdirs and empty `WORKING.md`
- [ ] `~/tenants/<tenant_id>/.cache/qmd/` exists for the tenant's QMD index
- [ ] `~/tenants/<tenant_id>/.claude/projects/-/memory/MEMORY.md` exists (tenant auto-memory)
- [ ] A setup script (`scripts/provision-tenant-dirs.sh`) creates the structure given a tenant_id argument
- [ ] Script is idempotent — running twice doesn't break anything

### US-002: Symlink Pavol's existing directories into tenant tree
**Description:** As the admin tenant, Pavol's existing `~/life/` and `~/memory/` must continue working at their current paths while also being addressable via the tenant tree.

**Acceptance Criteria:**
- [ ] `~/tenants/c2818981-bcb9-4fde-83d8-272d72c7a3d1/life` is a symlink to `~/life/`
- [ ] `~/tenants/c2818981-bcb9-4fde-83d8-272d72c7a3d1/memory` is a symlink to `~/memory/`
- [ ] `~/tenants/c2818981-bcb9-4fde-83d8-272d72c7a3d1/.cache/qmd` is a symlink to `~/.cache/qmd/`
- [ ] Existing scripts (`nightly-consolidation.sh`, brief scripts) keep working without changes until they're updated
- [ ] Symlinks created by `provision-tenant-dirs.sh` when tenant_id matches the admin tenant UUID

### US-003: Seed tenant directories during onboarding
**Description:** As a new user completing onboarding, my tenant directory tree should be created automatically so consolidation and briefs work from day one.

**Acceptance Criteria:**
- [ ] `seedOnboardingDefaults()` in `onboarding-helpers.ts` calls the provisioning script (or equivalent logic) after creating the tenant record
- [ ] Directory structure matches Pavol's layout (cloned without content): `life/{projects,areas,resources,archives}`, `memory/{daily,research}`, empty `WORKING.md`, empty `MEMORY.md`
- [ ] If the provisioning step fails, it logs the error but doesn't block onboarding (non-fatal)
- [ ] Matej's directories are created via a one-time backfill (run `provision-tenant-dirs.sh` for his UUID)

### US-004: Per-tenant QMD index rebuild
**Description:** As a platform operator, I need each tenant's QMD index to only contain their own knowledge so search results don't leak across tenants.

**Acceptance Criteria:**
- [ ] QMD rebuild for a given tenant uses `QMD_CACHE_DIR=~/tenants/<tenant_id>/.cache/qmd/` (or equivalent env var / CLI flag)
- [ ] QMD collections point to the tenant's `life/` and `memory/` directories, not the global ones
- [ ] Verify: `qmd search "test" -c life` against Matej's index returns zero results from Pavol's knowledge
- [ ] A helper script or function (`rebuild-tenant-qmd.sh <tenant_id>`) wraps the per-tenant rebuild

### US-005: Nightly consolidation loops over all tenants
**Description:** As a tenant, my daily notes should be consolidated into durable knowledge nightly, just like Pavol's.

**Acceptance Criteria:**
- [ ] `nightly-consolidation.sh` discovers all tenant directories under `~/tenants/`
- [ ] For each tenant with a daily note for today, it runs consolidation scoped to that tenant's `life/`, `memory/`, and auto-memory paths
- [ ] The Claude prompt uses tenant-specific paths (not hardcoded `~/life/`, `~/memory/`)
- [ ] Each tenant's consolidation is independent — a failure in one doesn't block others
- [ ] Per-tenant QMD index is rebuilt after each tenant's consolidation
- [ ] Supabase retention cleanup (heartbeats pruning) runs once globally, not per-tenant
- [ ] Schema sync runs once globally, not per-tenant
- [ ] Consolidation log includes tenant_id for each entry

### US-006: Tenant-aware brief gatherers
**Description:** As a tenant receiving briefs, the filesystem-backed sections should show my data, not Pavol's.

**Acceptance Criteria:**
- [ ] `section_daily_notes()` reads from `~/tenants/${BRIEF_TENANT_ID}/memory/daily/` instead of `~/memory/daily/`
- [ ] `section_working_state()` reads from `~/tenants/${BRIEF_TENANT_ID}/memory/WORKING.md` instead of `~/memory/WORKING.md`
- [ ] `section_learnings()` reads from `~/tenants/${BRIEF_TENANT_ID}/memory/.learnings/LEARNINGS.md` instead of `~/memory/.learnings/LEARNINGS.md`
- [ ] `section_proposals()` reads from `~/tenants/${BRIEF_TENANT_ID}/memory/improvement-proposals.md` instead of `~/memory/improvement-proposals.md`
- [ ] If the tenant directory doesn't exist, gatherers fall back gracefully (log warning, return "No data available")
- [ ] Pavol's briefs continue to work via symlinks (his tenant dir points back to `~/life/` and `~/memory/`)

### US-007: Tenant-scoped QMD search API endpoint
**Description:** As a tenant, I want to search my own knowledge base via the API so I can find information I've accumulated.

**Acceptance Criteria:**
- [ ] `GET /api/search?q=<query>&collection=<optional>` endpoint exists
- [ ] Endpoint requires authentication (JWT with tenant_id)
- [ ] Search executes `qmd search` against the tenant's QMD index directory
- [ ] Collection parameter maps to the tenant's directories: `life` → `~/tenants/<tid>/life/`, `memory` → `~/tenants/<tid>/memory/`
- [ ] Returns JSON array of results with `path`, `title`, `snippet`, `score`
- [ ] Returns 404 or empty results if tenant has no QMD index (hasn't had consolidation yet)
- [ ] Results never include content from other tenants' indexes

## Functional Requirements

- FR-1: Create `~/tenants/` root directory with one subdirectory per tenant, identified by tenant UUID
- FR-2: Pavol's tenant entry (`c2818981-...`) uses symlinks to existing `~/life/`, `~/memory/`, `~/.cache/qmd/` — no file moves
- FR-3: All other tenants get real directories cloned from Pavol's structure (empty content)
- FR-4: `scripts/provision-tenant-dirs.sh` accepts `<tenant_id>` argument, creates the full tree, is idempotent
- FR-5: `seedOnboardingDefaults()` calls `provision-tenant-dirs.sh` via `child_process.execSync` (or spawns async) during onboarding
- FR-6: `nightly-consolidation.sh` iterates `~/tenants/*/` and runs consolidation per-tenant with scoped paths
- FR-7: The Claude consolidation prompt receives tenant-specific paths as variables, not hardcoded `~/life/`
- FR-8: `brief-lib.sh` resolves `TENANT_HOME` from `BRIEF_TENANT_ID` before accessing filesystem paths
- FR-9: A helper function `tenant_home()` in `brief-lib.sh` returns `~/tenants/${1}` (single point of resolution)
- FR-10: `GET /api/search` route added to MC server, authenticated, scoped to tenant's QMD cache
- FR-11: Search endpoint spawns `qmd search` as a child process with `QMD_CACHE_DIR` env var set to tenant's cache dir
- FR-12: Per-tenant QMD rebuild runs `qmd update` with collections pointing to tenant's `life/` and `memory/` directories

## Non-Goals

- Migrating Pavol's files into `~/tenants/` (symlinks preserve current paths)
- Per-tenant `~/projects/` directories (git repos stay shared for now)
- Per-tenant session transcripts (handled by Telegram sandbox already)
- Tenant-facing UI for browsing the knowledge tree (API only for now)
- Custom PARA categories per tenant (all tenants get the same structure)
- Per-tenant consolidation scheduling (all tenants run at 2:30 AM CET; brief-style opt-in deferred)
- DST-aware consolidation scheduling

## Technical Considerations

- **QMD env var:** Verify that `qmd` respects `QMD_CACHE_DIR` or equivalent for index path override. If not, check if `--index-dir` flag exists. Worst case, use a wrapper that sets `XDG_CACHE_HOME` before invoking `qmd`.
- **Consolidation concurrency:** Running Claude for N tenants sequentially at 2:30 AM is fine for 2 tenants. At 5+ tenants, consider parallel execution with a concurrency cap (Claude API rate limits).
- **Disk usage:** Each QMD index is ~28MB. At 10 tenants that's 280MB — acceptable. Monitor if tenant count grows significantly.
- **Symlink safety:** The filesystem API's `path.resolve()` follows symlinks. The `isPathAllowed()` check uses resolved paths, so Pavol's symlinked tenant dir resolves to the real `~/life/` path which is inside the allowed root. No security issue.
- **Onboarding race condition:** If the user triggers a brief before `provision-tenant-dirs.sh` completes, gatherers will see no directory and return fallback messages. Acceptable — the brief still delivers, just with less data.
- **Admin tenant UUID:** `c2818981-bcb9-4fde-83d8-272d72c7a3d1` is hardcoded in migration 022. The provisioning script should detect this UUID and create symlinks instead of real directories.

## Success Metrics

- Matej's briefs return his own daily notes and working state (not Pavol's)
- `qmd search` against Matej's index returns zero results from Pavol's `~/life/` files
- Nightly consolidation log shows entries for both tenants
- New tenant onboarding creates directory tree without manual intervention
- `/api/search?q=test` returns tenant-scoped results

## Resolved Questions

1. **QMD cache dir override** — Need to check `qmd --help` before implementing US-004. If `QMD_CACHE_DIR` or `--index-dir` isn't supported, fall back to setting `XDG_CACHE_HOME` per invocation.
2. **Consolidation events** — YES. Write an event to the `events` table per tenant on consolidation completion (type: `consolidation`, source: `nightly-consolidation`). Useful for monitoring and brief reporting.
3. **Search API tier gating** — NO gating. Available to all tenants.
4. **`section_git_activity` and `section_deployments` for non-admin tenants** — Skip for non-admin tenants (return "Not available"). These scan `~/projects/*/` which are Pavol's local git repos on the VPS — other tenants don't have local repos. Note: this is separate from the Supabase `projects` table (task board projects), which all tenants can create. Future option: make these Supabase-backed via `events` table.
