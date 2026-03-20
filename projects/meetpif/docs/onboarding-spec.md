# Pif Onboarding Experience — Spec

**Status:** Implemented (v2)
**Created:** 2026-03-08
**Updated:** 2026-03-18
**Implementation:** `/opt/assistant-platform/mc/mc/src/pages/OnboardingPage.tsx`
**Demo:** `meetpif.com/onboarding-demo` (fake JWT + mocked APIs, no account needed)

---

## Design Philosophy

**Editorial bleed.** Every screen is a magazine spread. The Pif logo is an environmental element — oversized, cropped by viewport edges, positioned asymmetrically. Text is pinned to corners like a masthead. No centering. No symmetry. The tension between what's visible and what's cut off makes it feel intentional and expensive.

**Design framework: editorial bleed.** The same principle fashion magazines use when a face fills the cover and gets cropped by every edge. The logo is *bigger than the frame*. Text floats against it. Each screen varies the logo's position and the text's anchor point so no two layouts repeat.

Reference points:
- **Apple product pages** — one idea per screen, massive hero imagery, spring animations
- **Fashion lookbooks** — imagery bleeds off every edge, text is sparse and positioned asymmetrically
- **Magazine covers** — the subject is cropped by the viewport; text sits in the negative space
- **Linear** — cinematic micro-interactions; multiple steps that never feel heavy

**Design system alignment:**
- Buttons: `border-radius: 4px`, `text-transform: uppercase`, `letter-spacing: 0.08em`, `font-size: 13px` (matches `.lp-guide-cta`)
- Headlines: Inter Tight 700, tight negative tracking (`-0.03em` to `-0.04em`), fluid sizing via `clamp()`
- Body: Inter, `clamp(14px, 1.8vw, 16px)`
- Colors: `var(--lp-*)` tokens (scoped via `.landing` class on root)
- Spring easing: `cubic-bezier(0.16, 1, 0.3, 1)` throughout
- No pills, no rounded corners > 4px on buttons

**Pif's personality shows through copy, not chrome.** Every screen has one line of dry humor. The tone is competent-casual: "I'll be running things for you", "So I know when 3am is. For you, anyway.", "Good. I have opinions now."

---

## Journey Map

```
meetpif.com (landing)
  → "Get Started" / Google SSO
  → /onboarding
    → Screen 1: Welcome — oversized logo, "Hey, {firstName}."
    → Screen 2: Timezone — one dropdown
    → Screen 3: Claude Connect — OAuth authorize + paste code
    → Screen 4: Telegram — deep link, polls for connection
    → Screen 5: LinkedIn — optional, "One link. Zero small talk."
    → Screen 6: Launch — provisioning → success → dashboard
  → /login (dashboard)
```

**5 navigable screens + launch.** Progress indicator (thin segmented bar at viewport top) shows position across all 5. Hides during launch screens.

**Why this order:**
1. **Welcome** — zero effort, emotional hook. The oversized logo mirrors the landing page hero, creating visual continuity.
2. **Timezone** — near-zero effort (auto-detected), earns trust by asking something reasonable.
3. **Claude Connect** — the real unlock. Pif needs a brain. Framed as "Give me something to think with."
4. **Telegram** — the communication channel. "Where you'll actually find me."
5. **LinkedIn** — optional enrichment, positioned last so it doesn't block anything. By now the user is invested. Framed as a benefit: "I'll know your industry, your role, and what you actually care about — before our first real conversation."
6. **Launch** — provisioning with progress bar, then the payoff.

**What we removed:**
- ~~Naming step~~ — everyone keeps "Pif", the step added friction for no value
- ~~Quiet hours~~ — configurable post-onboarding, not worth a screen during setup
- ~~Allowed users~~ — advanced feature, doesn't belong in first-run
- ~~Google Workspace~~ — deferred until post-onboarding (requires GCP app verification for sensitive scopes)
- ~~First task / aha moment~~ — deferred to post-onboarding guided experience
- ~~Chat-based UI~~ — replaced with full-screen editorial screens. Chat felt like "talking to a chatbot." Editorial screens feel like a premium product experience.

---

## Screen-by-Screen Design

### Screen 1: Welcome

**Layout:** Logo bleeds off the bottom-right edge of the viewport. Text pinned top-left. CTA pinned bottom-left. Three anchor points forming an asymmetric triangle.

**Logo:** Environmental scale — `min(90vh, 110vw, 900px)`. Partially cropped. Entrance animation: scale from 88% over 1.4s with spring easing, then a gentle glow pulse (`drop-shadow`) on a 5s loop. Expression sequence: neutral → wink (2s) → happy (2.8s).

**Copy:**
- Headline: `"Hey, {firstName}."` — clamp(40px, 8vw, 72px), -0.035em tracking
- Subhead: `"I'm Pif. I'll be running things for you."`
- CTA: `"GET STARTED"`

**Notes:**
- `firstName` parsed from JWT payload (set during Google SSO)
- The welcome screen has no back button and no step indicator (indicator starts at screen 2)
- The oversized logo creates direct visual continuity with the landing page hero (which uses the same Pif logo at `min(65vh, 80vw, 600px)`)

### Screen 2: Timezone

**Layout:** Logo bleeds off the top-left (600px, 12% opacity). Content right-aligned, vertically centered.

**Copy:**
- Headline: `"Where in the world are you?"`
- Subhead: `"So I know when 3am is. For you, anyway."`
- Input: timezone dropdown, auto-detected from `Intl.DateTimeFormat().resolvedOptions().timeZone`
- CTA: `"CONTINUE"`

**Notes:**
- Logo expression: `thinking`
- Back button → welcome screen
- The dropdown lists all `Intl.supportedValuesOf('timeZone')` entries

### Screen 3: Claude Connect

**Layout:** Logo bleeds off center-left (700px, 8% opacity). Headline pinned top-right. Auth card pinned bottom-right.

**Two states:**

**Default (not connected):**
- Headline: `"Give me something to think with."`
- Subhead: `"I run on Claude. Connect your account and I can work while you're not looking."`
- Card with CTA: `"CONNECT CLAUDE"` → calls `/api/auth/claude/start`, gets `authorize_url`
- After clicking: card switches to show the authorize link + code paste input
- Card copy: `"Authorize with Claude, paste the code back. Thirty seconds. I've timed it."`

**Connected (success):**
- Logo opacity increases to 15%, expression changes to `happy`
- Checkmark animation (scale from 0 → 1.15 → 1)
- Headline: `"Claude connected."`
- Subhead: `"Good. I have opinions now."`
- CTA: `"CONTINUE"`

**Notes:**
- On mount, checks `/api/auth/claude/status` — if already connected, shows success state immediately
- Logo expression: `neutral` (default), `happy` (connected)

### Screen 4: Telegram

**Layout:** Logo bleeds off top-right (650px, 8% opacity). Content pinned bottom-left.

**Two states:**

**Default (not linked):**
- Headline: `"Where you'll actually find me."`
- Subhead: `"Morning briefs, tasks, questions, the occasional unsolicited observation — all in Telegram."`
- CTA: `"OPEN TELEGRAM"` → calls `/api/telegram/link`, opens deep link in new tab

**Linked (success):**
- Logo opacity increases to 15%
- Checkmark animation
- Headline: `"Telegram connected."`
- Subhead: `"I'll be brief. Usually."`
- CTA: `"CONTINUE"`

**Notes:**
- Deep link format: `https://t.me/meetpif_bot?start=<onboarding_token>`
- After opening the deep link, polls `/api/telegram/status` every 3 seconds
- Auto-advances when `connected: true` is returned
- Logo expression: `happy` in both states

### Screen 5: LinkedIn (Optional)

**Layout:** Logo bleeds off bottom-right (650px, 10% opacity). Content pinned top-left.

**Copy:**
- Headline: `"One link. Zero small talk."`
- Subhead: `"Drop your LinkedIn and I'll know your industry, your role, and what you actually care about — before our first real conversation."`
- Input: URL field, placeholder `"https://linkedin.com/in/..."`
- CTA: `"FINISH SETUP"` (submits onboarding)
- Skip link: `"Skip"` (also submits, just without LinkedIn)

**Notes:**
- This is a local interstitial — the state machine step remains `telegram_deeplink`, and LinkedIn is handled as UI state within OnboardingPage
- LinkedIn URL is stored in `onboardingData.linkedinUrl` and submitted with the rest of the data
- If provided, triggers Apify LinkedIn Profile Scraper post-provisioning to populate the tenant's `USER.md`
- Logo expression: `focused`
- Skip and Finish both call the same `handleSubmit` — the only difference is whether `linkedinUrl` has a value

### Screen 6: Launch

Three sub-states, all using editorial bleed layout:

**Pending:**
- Logo: center (600px, 8% opacity), expression `focused`
- Content: bottom-left
- Headline: `"One moment."`
- Subhead: `"Building your workspace. Teaching myself your name."`
- Progress bar: thin accent line, animates through 25% → 55% → 80% on timers, 100% on success
- Polls `/api/onboarding/status` for completion

**Success:**
- Logo: center (800px, 18% opacity), expression `happy`, entrance + glow animation
- Content: bottom-left
- Headline: `"You're live."` — clamp(44px, 9vw, 80px), the biggest text in the flow
- Subhead: `"Everything's in place. I've already started reading up on you — first impressions pending."`
- CTA: `"GO TO YOUR DASHBOARD"`

**Failure:**
- Logo: bottom-center (700px, 6% opacity), expression `skeptical`
- Content: left-center
- Headline: `"That didn't work."`
- Subhead: `"My fault, not yours. I'd explain but it wouldn't make either of us feel better."`
- CTA: `"TRY AGAIN"`

---

## Progress Indicator

Thin segmented bar fixed to the top of the viewport. 5 segments corresponding to the 5 navigable screens. Segment states:

| State | Style |
|-------|-------|
| Done | `var(--lp-accent)` solid |
| Active | `rgba(216, 255, 102, 0.45)` |
| Future | `rgba(255, 255, 255, 0.08)` |

Hidden during launch screens (pending/success/failure).

---

## Spatial Choreography

No two screens share the same layout. The logo rotates through positions around the viewport:

| Screen | Logo position | Logo size | Logo opacity | Content anchor |
|--------|--------------|-----------|-------------|---------------|
| Welcome | bottom-right bleed | 900px | full | text top-left, CTA bottom-left |
| Timezone | top-left bleed | 600px | 12% | right-center |
| Claude (default) | center-left bleed | 700px | 8% | headline top-right, card bottom-right |
| Claude (success) | center-left bleed | 700px | 15% | right-center |
| Telegram (default) | top-right bleed | 650px | 8% | bottom-left |
| Telegram (success) | top-right bleed | 650px | 15% | bottom-left |
| LinkedIn | bottom-right bleed | 650px | 10% | top-left |
| Launch (pending) | center | 600px | 8% | bottom-left |
| Launch (success) | center | 800px | 18% | bottom-left |
| Launch (failure) | bottom-center | 700px | 6% | left-center |

---

## Animation System

All animations use the spring easing curve: `cubic-bezier(0.16, 1, 0.3, 1)`.

| Animation | Duration | Purpose |
|-----------|----------|---------|
| `ob-fade-up` | 650ms | Staggered content entrance (headlines, body, CTAs) |
| `ob-hero-entrance` | 1400ms | Welcome logo scale-in (88% → 100%) |
| `ob-glow` | 5s loop | Subtle drop-shadow pulse on welcome + success logos |
| `ob-check-scale` | 500ms | Checkmark bounce (0 → 1.15 → 1) |
| `ob-crossfade-in` | 400ms | Sub-screen transitions |

Stagger delays create reading rhythm: headline at 200ms, subhead at 400ms, input at 550ms, CTA at 700ms.

---

## State Machine

The underlying state machine (`useOnboardingState` hook) drives these steps:

```
welcome → personality → claude_connect → telegram_deeplink → submitting → provisioning → provisioned → complete
```

**Mapping to visual screens:**
- `welcome` → Welcome screen
- `personality` → Timezone screen (was "personality" when it included quiet hours + LinkedIn)
- `claude_connect` → Claude Connect screen
- `telegram_deeplink` → Telegram screen OR LinkedIn screen (LinkedIn is a local UI interstitial, not a state machine step)
- `submitting/provisioning/provisioned/complete` → Launch screen

State is persisted to `localStorage` under key `mc_onboarding_state`. Users can refresh and resume where they left off.

---

## Demo Mode

`/onboarding-demo` route (`OnboardingDemoPage.tsx`) enables full walkthrough without authentication:

- Seeds a fake JWT in localStorage
- Intercepts `fetch()` to mock all API endpoints
- Claude connect auto-succeeds on code paste
- Telegram auto-connects
- Provisioning completes instantly

Mock routes:
```
/api/onboarding/submit → { ok: true, instance_name: 'demo-instance' }
/api/onboarding/status → { status: 'done', ... }
/api/auth/claude/status → { connected: true, ... }
/api/auth/claude/start → { session_id: '...', authorize_url: '#demo-authorize' }
/api/auth/claude/complete → { ok: true, ... }
/api/telegram/status → { connected: true }
/api/telegram/link → { deep_link: '#demo-telegram-link' }
```

---

## What Gets Seeded at Provisioning

When the onboarding submit completes, `seedOnboardingDefaults()` in `onboarding-helpers.ts` creates:

| Resource | Details | Status |
|----------|---------|--------|
| **Default project** | "General" project with tenant's color | Live |
| **Schedules** | From `workflows/manifest.json` — workflows with `included_by_default: true` get cron schedules. Hours adjusted for user's timezone. | Live |
| **Briefs** | Morning (haiku) + evening (sonnet). Disabled, `delivery_target: null`. Activate when user connects Telegram. | Live (2026-03-20) |
| **Daily notes** | **Not seeded.** Created by heartbeat on first run. Heartbeat needs `$HOME` parameterization. | Gap — needs parameterized heartbeat |
| **Nightly consolidation** | Schedule seeded (`included_by_default: true`). Script needs `$HOME` parameterization before it works for non-Pif tenants. | Seeded, script gap |
| **Memory files** | WORKING.md, USER.md, SOUL.md rendered from templates during instance provisioning. | Via provisioner (0C.4) |

**Briefs activation flow:** Briefs seed as disabled with no delivery target. When the user connects Telegram (or another channel) in Settings, the frontend should set `delivery_target` and `enabled: true` on their briefs. This flow is designed but not yet built in the Settings UI.

---

## Background Intelligence

Unchanged from original spec. Two waves:

**Wave 1 (automatic):** Google SSO provides name, email, photo. Email domain triggers company scrape + web search. Runs async during welcome screen.

**Wave 2 (LinkedIn):** If user provides LinkedIn URL in screen 5, Apify scraper runs post-provisioning. Populates tenant `USER.md` with professional context: role, company, industry, work history, skills.

| Signal source | Friction | Richness | When available |
|---|---|---|---|
| Google SSO | Zero | Low | Instant |
| Email domain → company scrape | Zero | Medium | ~5 seconds |
| Web search (name + company) | Zero | Medium | ~10 seconds |
| LinkedIn URL (Apify scraper) | One paste | Very high | ~15 seconds |

---

## Future Considerations

**Deferred to post-onboarding:**
- Google Workspace integration (requires GCP app verification for sensitive scopes)
- First task / aha moment (guided experience in dashboard)
- Allowed users configuration
- Quiet hours configuration
- Custom assistant naming

**Potential enhancements:**
- Parallax on logo position during transitions between screens
- Sound design (subtle tones on checkmark animations)
- Haptic feedback on mobile (vibrate on success states)
- "I see you're at {companyName}" personalization on welcome screen when background intelligence returns fast enough
