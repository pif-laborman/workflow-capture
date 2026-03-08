# PRD: Background Intelligence API

## Introduction

Build the server-side background intelligence system that learns about the user automatically during onboarding. When a user signs up via Google SSO, Pif starts gathering publicly available information — company details from their email domain, web mentions, and optionally their LinkedIn profile. This data personalizes the onboarding experience (e.g., "I see you're at {companyName}") and seeds the user's profile for day-one usefulness.

This PRD covers the **backend API and data pipeline only**. Frontend integration (showing the personalized welcome in the chat) is a follow-up.

## Goals

- Fire async intelligence gathering on SSO signup — before the user sees anything
- Look up company info from email domain (for corporate emails)
- Run a web search for the user's name + company
- Expose results via an API endpoint that the frontend can poll
- Store results for later use (seeding the tenant's USER.md)
- Handle the LinkedIn scrape when a URL is provided in Step 3

## Context

**Working directory:** `/opt/assistant-platform/mc/`

**Full design spec:** `/root/projects/rif/docs/onboarding-spec.md` — see "Background Intelligence" section.

**Key files:**
- `server/src/index.ts` — API server, onboarding endpoints
- Google SSO callback — wherever the OAuth callback stores user profile data (check auth routes)

**Apify account:** Available for LinkedIn scraping. Check `/root/agents/pif/TOOLS.md` for API token and actor IDs. The LinkedIn Profile Scraper actor fits within free monthly credits.

**Freemail domains to skip:** gmail.com, googlemail.com, outlook.com, hotmail.com, live.com, yahoo.com, icloud.com, me.com, protonmail.com, proton.me, aol.com, mail.com, zoho.com, yandex.com, gmx.com, fastmail.com

## User Stories

### US-001: Trigger background lookup on SSO callback

**Description:** When a user completes Google SSO login for the first time (new tenant), automatically start the background intelligence pipeline.

**Acceptance Criteria:**
- [ ] After the Google OAuth callback creates/identifies the user, check if this is a new tenant (first login)
- [ ] If new tenant, fire an async background job (non-blocking — don't slow down the redirect)
- [ ] Pass the user's email, first name, last name, and profile photo URL to the pipeline
- [ ] Store a `background_intel_status` field on the tenant: `pending` → `running` → `done` | `failed`
- [ ] The OAuth callback redirects immediately — intelligence runs in the background
- [ ] Typecheck passes

### US-002: Email domain company lookup

**Description:** For corporate email addresses, scrape the company website and identify the company.

**Acceptance Criteria:**
- [ ] Extract the domain from the user's email address
- [ ] Check against the freemail domain list — if it's a freemail provider, skip this step entirely
- [ ] For corporate domains, attempt to:
  1. Fetch the domain's homepage (with a 5-second timeout)
  2. Extract: company name (from `<title>`, Open Graph tags, or `meta` description), industry keywords, basic description
  3. Run a web search for the domain name to get additional context (company size, industry, what they do)
- [ ] Store results in a `background_intel` JSON column on the tenant:
  ```json
  {
    "company": {
      "name": "Acme Corp",
      "domain": "acme.com",
      "description": "B2B SaaS for logistics",
      "industry": "logistics",
      "source": "website_scrape"
    }
  }
  ```
- [ ] If the scrape fails or returns garbage, store `null` for company — don't store bad data
- [ ] Total time for this step: target < 5 seconds
- [ ] Typecheck passes

### US-003: Web search for user name + company

**Description:** Search the web for the user to find public mentions, social profiles, and professional context.

**Acceptance Criteria:**
- [ ] Run a web search query: `"{firstName} {lastName}" {companyName}` (if company found) or `"{firstName} {lastName}" {emailDomain}` (if no company)
- [ ] For the web search, use a free/available search method — options:
  - Brave Search API (free tier: 2,000 queries/month)
  - DuckDuckGo instant answer API (free, limited)
  - Or a simple scrape approach
- [ ] Parse results for: LinkedIn URL, Twitter/X profile, personal website, notable mentions
- [ ] Store in the `background_intel` JSON:
  ```json
  {
    "web_mentions": [
      { "url": "https://linkedin.com/in/...", "type": "linkedin", "title": "..." },
      { "url": "https://twitter.com/...", "type": "twitter", "title": "..." }
    ],
    "linkedin_url_discovered": "https://linkedin.com/in/..."
  }
  ```
- [ ] If no meaningful results, store empty arrays — don't fail
- [ ] Total time: target < 10 seconds
- [ ] Typecheck passes

### US-004: Background intel API endpoint

**Description:** Create an endpoint the frontend can poll to get background intelligence results.

**Acceptance Criteria:**
- [ ] `GET /api/onboarding/background` — returns the background intelligence for the authenticated user's tenant
- [ ] Response format:
  ```json
  {
    "status": "done",
    "company": { "name": "...", "domain": "...", "description": "...", "industry": "..." },
    "web_mentions": [...],
    "linkedin_url_discovered": "...",
    "linkedin_profile": null
  }
  ```
- [ ] Status values: `pending` (not started), `running` (in progress), `done` (complete), `failed` (error), `skipped` (freemail, nothing to look up)
- [ ] If status is `pending` or `running`, frontend knows to keep polling
- [ ] Requires authentication (JWT via `authHeaders()`)
- [ ] Typecheck passes

### US-005: LinkedIn profile scrape (Apify)

**Description:** When the user provides a LinkedIn URL during Step 3, scrape their profile using Apify for rich professional context.

**Acceptance Criteria:**
- [ ] `POST /api/onboarding/linkedin` — accepts `{ linkedin_url: "https://linkedin.com/in/..." }`
- [ ] Validates the URL looks like a LinkedIn profile URL (basic regex: contains `linkedin.com/in/`)
- [ ] Calls the Apify LinkedIn Profile Scraper actor with the URL
- [ ] Stores results in the `background_intel` JSON under `linkedin_profile`:
  ```json
  {
    "linkedin_profile": {
      "headline": "Product Manager at Acme",
      "current_role": "Product Manager",
      "current_company": "Acme Corp",
      "experience": [...],
      "education": [...],
      "skills": [...],
      "summary": "..."
    }
  }
  ```
- [ ] If the company wasn't found via email domain but LinkedIn has it, backfill the company info
- [ ] Returns `{ status: "scraping" }` immediately (async operation)
- [ ] The `/api/onboarding/background` endpoint reflects LinkedIn status via a `linkedin_status` field: `pending`, `scraping`, `done`, `failed`
- [ ] Apify call is rate-limited: max 1 scrape per tenant
- [ ] Handle Apify errors gracefully — log and set status to `failed`, don't crash
- [ ] Typecheck passes

### US-006: Database schema for background intel

**Description:** Add the necessary columns/tables to store background intelligence data.

**Acceptance Criteria:**
- [ ] Add to the `tenants` table (or a new `tenant_background_intel` table — pick the simpler option):
  - `background_intel` (jsonb, nullable) — stores the full intelligence payload
  - `background_intel_status` (text, default 'pending') — pipeline status
- [ ] Create a Supabase migration file following the existing migration numbering pattern
- [ ] Migration is idempotent (can be re-run safely)
- [ ] Typecheck passes

## Non-Goals

- Frontend integration (showing "I see you're at {companyName}" in the chat) — that's wired up when PRD 2's welcome step consumes the background endpoint
- Generating the USER.md content from intelligence data — that's a provisioning step
- Paid search APIs — stick to free tiers
- Real-time streaming of results to the frontend — polling is fine

## Technical Notes

- The background pipeline should be fire-and-forget from the SSO callback. Use `setImmediate()` or a similar async dispatch — don't block the auth redirect.
- For web search, evaluate what's available first. If no free search API is practical, the company website scrape alone is still valuable. The web search can be a v2 enhancement.
- Apify LinkedIn scraper: check the exact actor ID and input format in TOOLS.md. The free tier gives ~$5/month in credits. Each profile scrape costs ~$0.01-0.05 so it's well within budget.
- Store all intelligence data as a single JSONB column rather than multiple columns — the schema will evolve and JSONB is flexible.
- Be careful with rate limits on external services. Add retries with backoff for flaky network calls.
- The freemail domain list should be a constant array in the code, not a database lookup. It rarely changes.
