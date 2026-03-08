# PRD: Onboarding Steps 1-3 — Welcome, Naming, Personality

## Introduction

Replace the current 4-step form wizard in `OnboardingPage.tsx` with the new conversational onboarding flow for the first three steps. This builds on the `OnboardingChat` component (PRD 1) and implements the actual content — what Pif says, what the user chooses, and how state flows between steps.

**Dependency:** PRD 1 (OnboardingChat component) must be completed first.

## Goals

- Implement Steps 1-3 of the onboarding as a chat-based conversation
- Replace the current `OnboardingPage.tsx` with the new flow (Steps 4-7 are stubbed/skipped for now)
- Add state machine for step transitions with persistence
- Add quiet hours and LinkedIn URL fields to the API
- Create a natural, personality-rich experience that feels like talking to Pif

## Context

**Working directory:** `/opt/assistant-platform/mc/`

**Full design spec:** `/root/projects/rif/docs/onboarding-spec.md` — read the Step 1, Step 2, Step 3, and State Machine sections carefully.

**Key files:**
- `src/pages/OnboardingPage.tsx` — current wizard (being replaced)
- `src/components/OnboardingChat.tsx` — chat UI component (from PRD 1)
- `src/components/RequireAuth.tsx` — provides `authHeaders()` for API calls
- `server/src/index.ts` — backend API, onboarding endpoints start around line 543

**Existing API endpoints (no changes needed):**
- `POST /api/onboarding/submit` — currently accepts `bot_token`, `bot_username`, `assistant_name`, `timezone`, `allowed_users`
- `GET /api/onboarding/status` — returns provision status

**The user's first name is available from the auth context** — the Google SSO login stores it. Check how the login/auth flow provides user profile data (likely in a JWT or session).

## User Stories

### US-001: State machine and step management

**Description:** Implement the onboarding state machine that manages step transitions, persists progress, and drives the chat UI.

**Acceptance Criteria:**
- [ ] Create a `useOnboardingState` hook (or similar) in `src/hooks/useOnboardingState.ts`
- [ ] States: `welcome`, `naming`, `personality`, `google_workspace`, `telegram_deeplink`, `submitting`, `provisioning`, `provisioned`, `first_task`, `complete`
- [ ] For this PRD, only `welcome`, `naming`, `personality` are fully implemented. From `personality`, "Next" advances to `submitting` (which triggers the existing provision flow as a temporary bridge)
- [ ] State persists to `localStorage` so refreshing the page resumes where the user left off
- [ ] Going "Back" scrolls up to the earlier step's messages — does NOT delete them from the chat. The user can change answers while keeping the conversation visible above.
- [ ] Collected data (`OnboardingData`) persists alongside state
- [ ] Typecheck passes

### US-002: Step 1 — Welcome

**Description:** Pif introduces itself. Zero effort from the user — just read and click.

**Acceptance Criteria:**
- [ ] On entering onboarding, Pif's messages appear sequentially with typing indicators:
  - Message 1: "Hey, {firstName}. I'm Pif." (use first name from auth context; fall back to "there" if unavailable)
  - Message 2: "I'm going to be your chief of staff — the one who gets things done so you can focus on what matters."
  - Message 3: "Research, tasks, reminders, daily briefs — you message me, I handle it."
  - Message 4: "Let's get you set up. Takes about 3 minutes, and most of it is me doing the work."
- [ ] Single CTA: "Let's go" button (action-button type, primary variant)
- [ ] No progress bar on this step (hidden)
- [ ] Background: `var(--lp-bg)` — warm sand feel matching the login page
- [ ] Clicking "Let's go" advances to `naming` state and animates in Step 2 messages below
- [ ] Typecheck passes
- [ ] Verify in browser

### US-003: Step 2 — Naming

**Description:** The user decides what to call their assistant. Default is pre-selected ("Keep Pif").

**Acceptance Criteria:**
- [ ] Progress bar appears (step 2 of 7 — or however many dots we show)
- [ ] New messages animate in below the Welcome conversation:
  - Message: 'I go by Pif. That\'s worked out pretty well so far.'
  - Message: 'You can keep calling me Pif, or pick a different name. Most people stick with Pif. No pressure either way.'
- [ ] Options component renders two choices:
  - "Keep \"Pif\"" — pre-selected, shows "(recommended)"
  - "Call me something else" — selecting this reveals a text input with placeholder "What should I go by?" and max 30 chars
- [ ] Back button scrolls up to Welcome (does not reset)
- [ ] Next button advances to `personality` state
- [ ] If "Keep Pif" is selected, `assistantName` is set to "Pif"
- [ ] If custom name is entered, `assistantName` is set to the trimmed input value
- [ ] Next is disabled if "something else" is selected but input is empty
- [ ] Typecheck passes
- [ ] Verify in browser

### US-004: Step 3 — Personality Quick-Set

**Description:** Timezone, quiet hours, allowed users, and optional LinkedIn URL. Feels like Pif asking questions, not a config form.

**Acceptance Criteria:**
- [ ] New messages animate in:
  - Message: 'A few quick things so I don\'t embarrass us both.'
- [ ] Three input groups appear sequentially (with short typing delays between each):
  - **Timezone:** "What's your timezone?" with auto-detected value in a dropdown (pre-filled from `Intl.DateTimeFormat().resolvedOptions().timeZone`)
  - **Quiet hours:** "When should I not bother you?" with two time inputs side-by-side: "After [22:00]" and "Before [07:00]" (defaults 22:00 and 07:00)
  - **Allowed users:** "Who else can talk to me?" with text input, placeholder "@username1, @username2", helper text "Leave empty if it's just you"
- [ ] After the config fields, a second message group appears:
  - Message: 'One more thing — totally optional.'
  - Message: 'If you drop your LinkedIn here, I\'ll read your background in about 10 seconds. Saves us the getting-to-know-you phase.'
  - Input: URL field with placeholder "https://linkedin.com/in/..." and "(optional)" label
- [ ] If LinkedIn URL is provided and valid-looking, show a subtle confirmation: "Got it — reading your profile now..."
- [ ] Back button scrolls to Naming step
- [ ] Next button advances to the submit/provision flow
- [ ] Timezone is the only required field (and it's pre-filled, so effectively nothing is required)
- [ ] Typecheck passes
- [ ] Verify in browser

### US-005: Bridge to existing provision flow

**Description:** After Step 3, temporarily bridge to the existing provisioning logic until Steps 4-7 are built. Skip the Telegram and Google Workspace steps for now.

**Acceptance Criteria:**
- [ ] When the user clicks "Next" on Step 3, the flow transitions to `submitting` state
- [ ] Pif says: "Alright, give me a minute — I'm setting up your workspace."
- [ ] Calls `POST /api/onboarding/submit` with the collected data. Since we don't have a bot token from the new flow yet, pass a placeholder or make bot_token optional in the API (see US-006)
- [ ] Shows the existing provisioning status polling UI (adapted to chat style):
  - Progress messages: "Creating your account...", "Setting up your memory system...", "Final checks..."
  - Check marks appear as each phase completes (if the status endpoint supports phases)
  - On success: "Done. Everything's set up." with "Go to Dashboard" button
  - On failure: "Something went wrong on my end — not yours. Let me try again." with Retry button
- [ ] Typecheck passes
- [ ] Verify in browser

### US-006: API — Add quiet hours and LinkedIn fields

**Description:** Extend the `/api/onboarding/submit` endpoint to accept the new fields from Step 3.

**Acceptance Criteria:**
- [ ] `POST /api/onboarding/submit` accepts three new optional fields:
  - `quiet_hours_start` (number, 0-23, default 22)
  - `quiet_hours_end` (number, 0-23, default 7)
  - `linkedin_url` (string, optional)
- [ ] These fields are stored in the tenant config (either in the tenants table directly or in the provision queue config blob — match the existing pattern)
- [ ] `quiet_hours_start` and `quiet_hours_end` map to `DND_START` / `DND_END` in the instance config that gets passed to the provisioner
- [ ] `linkedin_url` is stored for later use (background intelligence) — no immediate processing in this PRD
- [ ] Make `bot_token` and `bot_username` optional in the submit endpoint (allow null/empty). When not provided, the provisioner skips Telegram bot setup. This is the bridge for the new flow where Telegram is connected later (Step 5).
- [ ] Existing calls with bot_token still work (backward compatible)
- [ ] Typecheck passes

### US-007: Remove old wizard UI

**Description:** Replace the current form wizard in `OnboardingPage.tsx` with the new chat-based flow.

**Acceptance Criteria:**
- [ ] `OnboardingPage.tsx` now renders the `OnboardingChat` component with the step content from US-002 through US-005
- [ ] The old STEPS array, form inputs, validate-bot handler, and step-based rendering are removed
- [ ] The page still uses `authHeaders()` for API calls
- [ ] The page still handles the full lifecycle: onboarding → submit → provision → redirect to dashboard
- [ ] The `landing` class and `--lp-*` CSS variables are still used for theming
- [ ] Old CSS classes that are no longer used are cleaned up
- [ ] Typecheck passes
- [ ] Verify in browser — complete flow from Welcome through provisioning works

## Non-Goals

- Steps 4-7 (Google Workspace, Telegram, Aha moment) are NOT implemented — just the first 3 steps + bridge to provisioning
- Background intelligence (company lookup, web search) is NOT wired in — see PRD 3
- The personalized welcome ("I see you're at {companyName}") is NOT implemented yet — depends on PRD 3
- Email sequence is not triggered
- No real LinkedIn scraping — just storing the URL for later

## Technical Notes

- The transition from old to new should be a full replacement, not a parallel system. Delete the old wizard code.
- The provisioning bridge (US-005) is temporary. Once Steps 4-7 are built (future PRDs), the bridge gets replaced with the full flow.
- For the bot_token optionality (US-006), check `server/src/index.ts` around lines 657-873 for the submit handler. The bot_token uniqueness check and Telegram API validation should be skipped when bot_token is empty/null.
- The provision queue config blob should include the new quiet hours fields so the provisioner can write them to the instance's `.env` or config.
