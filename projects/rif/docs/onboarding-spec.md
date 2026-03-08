# Rif Onboarding Experience — Spec

**Status:** Draft
**Created:** 2026-03-08
**Context:** Current 0D implementation is a functional 4-step form wizard. It works, but it's generic SaaS — no personality, no product showcase, no delight. This spec replaces it with a conversational, white-glove experience that uses the product itself as the onboarding vehicle.

---

## Design Philosophy

**The onboarding IS the product demo.** The user's first interaction with their assistant should feel like talking to their assistant. Not filling out a form. Not reading instructions. Having a conversation.

Reference points:
- **Slack** — personalizes onboarding by asking about your team, updates UI as you go, always skippable
- **Linear** — hands-on learning through cinematic micro-interactions; 10+ steps that never feel heavy
- **Notion** — drops you in a usable workspace immediately, adapts prompts to behavior
- **Superhuman** — white-glove onboarding call where they set you up live, then hand over
- **Duolingo** — conversational, progressive disclosure, celebrates every small win

Our edge: we literally have a conversational AI. The onboarding should be a chat with your new assistant.

---

## Journey Map

**Principle: Progressive investment.** Each step asks slightly more than the last. By the time the user hits real friction, they've already made personal choices they don't want to abandon. The sunk cost works in our favor.

```
meetpif.com (landing)
  → "Get Started" / Google SSO (minimal scopes: email + profile)
  → /onboarding (conversational wizard)
    → Step 1: Welcome — zero effort, just read and click
    → Step 2: Naming — near-zero, default pre-selected, feels personal
    → Step 3: Personality — low friction, mostly auto-filled, feels like customization
    → Step 4: Google Workspace — one click "Allow", massive capability unlock
    → Step 5: Telegram — one-click deep link, no BotFather needed
    → Step 6: Provisioning — zero effort, the payoff (assistant narrates its own setup)
    → Step 7: First task — optional victory lap
  → /mc (dashboard, fully set up)
```

**Why this order:** Steps 1-3 are easy wins that build identity ("my assistant, my preferences"). Step 4 is just clicking "Allow" on a Google consent screen — low effort but huge payoff (calendar, email, docs all connected). Step 5 is another single click (Telegram deep link) — the user never touches BotFather. By step 6, the user has done almost no real work but has a fully connected assistant. The progressive investment is now almost entirely emotional (naming, preferences, seeing Pif work) rather than technical.

**Open: API key placement.** If BYOK (bring your own Anthropic key), it groups with Telegram as "technical setup" — step 5b or step 6. If managed keys, it never appears. If deferred, the instance runs on Pif's key during onboarding + first days, then prompts later. See Open Questions.

---

## Background Intelligence

Pif learns about the user in two waves: automatic (before they do anything) and optional (one paste during onboarding).

### Wave 1: Automatic (zero user effort)

**Before the user sees anything,** Pif already knows things. Google SSO gives us their name, email, and profile photo. During the welcome screen (while the user reads the intro), a background request kicks off:

- **Google profile** → first name, last name, profile photo, locale
- **Email domain** → if corporate, scrape the company website (free) for what they do, size, industry. Run a quick web search for the company name.
- **Web search** → `"{firstName} {lastName}" {companyName}` — public mentions, conference talks, published articles, social profiles. This often surfaces their LinkedIn URL, Twitter, or personal site without them providing it.
- **Personal email domains** (gmail, outlook, etc.) → less signal. Pif adapts and leans harder on Wave 2.

This runs async. By step 2, Pif has a sketch of who this person is.

### Wave 2: Optional LinkedIn (one paste, massive context)

During step 3 (Personality), Pif asks for a LinkedIn URL. This is optional but framed as high-value:

> "If you drop your LinkedIn here, I'll read it and know your background in about 10 seconds. Saves us both the getting-to-know-you phase."

If provided, we run the **Apify LinkedIn Profile Scraper** (fits within free monthly credits). This gives us:

- Current role + company (confirmed, not guessed)
- Work history (past companies, titles, tenure)
- Skills + endorsements (what they're known for)
- Education
- Summary/about section (how they describe themselves)
- Industry context

**What Pif does with this:** Populates the user's `USER.md` with a professional context section. This means from day one, Pif knows "this person is a product manager at a B2B SaaS company, previously in consulting, cares about data-driven decisions" — and can tailor research, briefs, and task prioritization accordingly.

**If they skip it:** No pressure. Pif learns organically from conversations. The LinkedIn shortcut just accelerates the first week.

### Intelligence Tiers

| Signal source | Friction | Richness | When available |
|---|---|---|---|
| Google SSO (name, email, photo) | Zero | Low | Instant |
| Email domain → company scrape | Zero | Medium | ~5 seconds |
| Web search (name + company) | Zero | Medium | ~10 seconds |
| LinkedIn URL (Apify scraper) | One paste | Very high | ~15 seconds |

**Privacy note:** The automatic signals are all publicly available information — the same as anyone Googling the person. LinkedIn is explicitly opted-in by the user. But the user didn't *ask* Pif to do any of this — Pif did it proactively. That's the product demo: "I anticipated what would be useful."

---

## Step-by-Step Design

### Step 1: Welcome

The assistant introduces itself. This is the first impression. If Pif has Google profile context, use their first name.

**What the user sees:**
A chat-style interface. The Pif logo sits in a circle avatar. Messages appear with a typing indicator, then reveal with a subtle animation.

```
[Pif avatar]  Hey, {firstName}. I'm Pif.

              I'm going to be your chief of staff — the one who
              gets things done so you can focus on what matters.

              Research, tasks, reminders, daily briefs — you
              message me, I handle it.

              Let's get you set up. Takes about 3 minutes,
              and most of it is me doing the work.

                                              [Let's go →]
```

**If background lookup found their company:**
```
[Pif avatar]  Hey, {firstName}. I'm Pif.

              I'm going to be your chief of staff — the one who
              gets things done so you can focus on what matters.

              I see you're at {companyName}. I already did some
              reading — I'll have more on that later.

              Let's get you set up first.

                                              [Let's go →]
```

**Design notes:**
- Chat bubble UI, not a form. Messages appear sequentially with ~800ms typing delay between them.
- Single CTA button, bottom-right aligned. Ghost button style matching the landing page.
- Pif logo with the `neutral` expression. Transitions to `happy` when user clicks.
- Background: `var(--lp-bg)`. The same warm sand feel from the landing page.
- No progress bar yet — it appears starting from Step 2.
- The "I see you're at {companyName}" line is the first wow moment. It signals: this thing already knows things and does work unprompted. If no company is found, skip the line gracefully — don't draw attention to the absence.
- The intro emphasizes action ("gets things done", "you message me, I handle it"), not conversation.

### Step 2: Naming

**The key insight from Pavol:** The default IS the recommendation. Don't present it as a blank field.

```
[Pif avatar]  I go by Pif. That's worked out pretty well so far.

              You can keep calling me Pif, or pick a different name.
              Most people stick with Pif. No pressure either way.

  ┌─────────────────────────────────────────┐
  │  ○ Keep "Pif"                    (recommended)  │
  │  ○ Call me something else → [________]          │
  └─────────────────────────────────────────┘

                                   [Back]  [Next →]
```

**Design notes:**
- Radio selection, not a text input. "Keep Pif" is pre-selected.
- If they choose "something else", a text input slides in below with placeholder "What should I go by?"
- Name is capped at 30 chars.
- Pif's expression changes to `surprised` if they pick a new name, then settles to `happy`.

### Step 3: Personality Quick-Set

Low friction, mostly auto-filled. This feels like getting to know each other — not filling out a config form. By asking these questions, Pif earns the right to ask for the harder stuff next. This is also where the optional LinkedIn shortcut lives.

```
[Pif avatar]  A few quick things so I don't embarrass us both.

              What's your timezone?
              [Auto-detected: Europe/Prague ▾]

              When should I not bother you?
              ┌──────────────┐  ┌──────────────┐
              │ After [22:00] │  │ Before [07:00]│
              └──────────────┘  └──────────────┘

              Who else can talk to me?
              (Leave empty if it's just you)
              ┌──────────────────────────────────────────┐
              │  @username1, @username2                   │
              └──────────────────────────────────────────┘
```

Then, after the config fields, a second message appears:

```
[Pif avatar]  One more thing — totally optional.

              If you drop your LinkedIn here, I'll read your
              background in about 10 seconds. Saves us the
              getting-to-know-you phase.

  ┌──────────────────────────────────────────────────┐
  │  https://linkedin.com/in/...          (optional) │
  └──────────────────────────────────────────────────┘

                                   [Back]  [Next →]
```

**If LinkedIn is provided,** Pif fires the Apify scraper async. A subtle status line appears:

```
              ✓ Got it — reading your profile now...
```

By the time the user finishes step 4 (Telegram), the scrape is done and Pif has full professional context.

**If skipped,** no friction. Pif moves on. It'll learn organically from conversations.

**Design notes:**
- Timezone auto-detected from browser, shown as a dropdown that's pre-filled.
- Quiet hours framed as "when should I not bother you" — not "DND_START/DND_END."
- Allowed users is optional, clearly labeled. Helper text: "Leave empty if it's just you."
- Each field appears as Pif "asks" it — progressive reveal, not all at once.
- The LinkedIn ask comes as a separate message after the config fields, so it doesn't make the step feel heavy. It's positioned as a shortcut, not a requirement.
- The "(optional)" label is visible in the input placeholder — no ambiguity.
- If the user provided LinkedIn and company context was found, Pif can reference it in later steps: "I see you've been in {industry} for {N} years — I'll keep that in mind."
- This step builds identity and investment. After this, the user has named Pif, configured preferences, and optionally shared their background.

### Step 4: Google Workspace

One click, massive unlock. Since the user already signed in with Google (SSO), we use **incremental authorization** to request additional scopes. This pops a familiar Google consent screen — the user just clicks "Allow." No passwords, no tokens, no leaving the app.

**The framing:** Pif explains what it gets and why, in concrete terms. Not "grant access to Gmail API" — instead "so I can check your calendar before scheduling, summarize emails you haven't read yet, and find documents when you need them."

```
[Pif avatar]  Now let's connect me to your work tools.

              You already signed in with Google — I just need
              a bit more access to be actually useful:

              📅  Calendar — so I know when you're busy
              📧  Email — so I can summarize what matters
              📁  Drive & Docs — so I can find and read your files
              👥  Contacts — so I know who's who

              This is read-only. I look, I don't touch.

                              [Connect Google Workspace]
                              [Skip for now]
```

**On clicking "Connect Google Workspace":**
The browser redirects to Google's consent screen with the additional scopes. The user sees the standard Google permissions dialog listing Calendar, Gmail, Drive, and Contacts (all read-only). They click "Allow" and are redirected back.

**On return (success):**
```
[Pif avatar]  Connected. I can now see your calendar, emails,
              and documents.

              Tomorrow morning, your first daily brief will
              actually have something in it.

                                   [Back]  [Next →]
```

**If skipped:**
```
[Pif avatar]  No problem. You can connect these later from
              the dashboard. I'll work with what I have.

                                   [Next →]
```

**Design notes:**
- **Incremental OAuth:** The redirect uses `include_granted_scopes=true` and adds new scopes on top of the existing `email profile` grant. Google handles merging.
- **Scopes requested:**
  - `https://www.googleapis.com/auth/calendar.readonly`
  - `https://www.googleapis.com/auth/gmail.readonly`
  - `https://www.googleapis.com/auth/drive.readonly` (covers Docs + Sheets)
  - `https://www.googleapis.com/auth/contacts.readonly`
- All read-only. "I look, I don't touch" is both reassuring and on-brand.
- **Refresh token:** The callback stores the OAuth refresh token for this user so Pif can access these services on their behalf going forward. This is the key technical piece — we need `access_type=offline` and `prompt=consent` on the incremental request to get a refresh token.
- **Skippable but encouraged.** The framing makes it clear what they gain. The concrete examples (calendar awareness, email summaries, file search) are the same things Pif actually does — this isn't aspirational, it's real.
- Pif expression: `neutral` during the ask, `happy` on successful connection.
- The success message teases the daily brief — planting the seed for recurring value.
- **GCP app verification:** For production, the app needs Google's OAuth verification since we're requesting sensitive scopes (Gmail, Drive). During alpha/testing, only users added as "test users" in the GCP console can authorize. This is a launch blocker we need to plan for.

### Step 5: Telegram — Connect via Deep Link

~~The highest-friction step~~ — **no longer.** Instead of making each user create their own bot via BotFather (4 steps, leaves the app, copies a token), we use a **shared bot + deep link** approach. One click connects them.

**Architecture:** One shared Telegram bot (`@meetpif_bot` or similar) serves all users. The deep link embeds a unique token that links the Telegram account to their Rif tenant. After linking, all messages are routed per-user.

**Multi-tenant routing — how it works:**

```
User sends message on Telegram
  → Telegram delivers to shared bot webhook (single endpoint)
  → Webhook handler extracts sender's telegram_user_id
  → Lookup: telegram_user_id → tenant_id (via tenant_telegram_links table)
  → Load tenant config (assistant name, SOUL.md path, Claude API key, tools, permissions)
  → Dispatch message to that tenant's Claude session (isolated context per tenant)
  → Response routed back through the shared bot → user's chat
```

**Key properties:**
- **Isolation:** Each tenant gets its own Claude session, memory (`USER.md`, `WORKING.md`), tools, and config. The shared bot is just a message router — it doesn't mix contexts.
- **Tenant config table:** `tenants` row holds `assistant_name`, `soul_path`, `api_key`, `tools_enabled`, `quiet_hours`, etc. The router loads this per-message.
- **`tenant_telegram_links` table:** Maps `telegram_user_id` → `tenant_id`. Created during onboarding `/start` flow. Supports multiple Telegram users per tenant (the "allowed users" from step 3).
- **Allowed users:** If the owner adds `@alice` and `@bob` in step 3, those users can also `/start` with the same tenant's deep link token (or a separate invite link). Their `telegram_user_id` entries point to the same `tenant_id`.
- **Session management:** Each tenant can have at most N concurrent Claude sessions (configurable). Messages queue if the session is busy. The router handles backpressure.
- **Privacy:** Messages from User A never reach User B's context. The shared bot sees all messages, but the routing layer ensures tenant isolation before any processing. Logs are partitioned by tenant.
- **Bot identity:** The bot always appears as `@meetpif_bot` in Telegram, but its messages are signed with the tenant's assistant name (e.g., "Pif" or whatever they chose). Users don't see other tenants' names.
- **Scaling:** One bot webhook → fan-out to per-tenant processing. The webhook is stateless; tenant sessions are the stateful part. This scales horizontally — add more session workers as tenants grow.

**Deep link:** `https://t.me/meetpif_bot?start=<onboarding_token>`

When the user clicks it:
1. Telegram opens (or prompts to install)
2. The bot receives `/start <onboarding_token>`
3. Server maps the Telegram user ID → tenant
4. Bot responds: "Hey {name}, I'm connected. Try sending me something."
5. Onboarding page detects the link (polls `/api/onboarding/status`) and advances

**What the user sees:**

```
[Pif avatar]  Last step — let's connect on Telegram.

              This is how you'll send me work day-to-day.
              Need something researched? Message me.
              Want a task tracked? Message me.
              Forgot something? I'll remind you.

              Tap the button, open Telegram, and we're connected.

                              [Open Telegram →]

              New to Telegram? It's a free messaging app.
              [iPhone ↗]  [Android ↗]  [Desktop ↗]  [Web ↗]
```

**On clicking "Open Telegram →":**
Deep link opens Telegram. The bot receives the `/start` command and links accounts. The onboarding page polls and detects the connection:

```
[Pif avatar]  Connected. I can see you on Telegram now.

              From now on, anything you need — just message
              me there. I'm always on.

                                   [Back]  [Next →]
```

**If Telegram isn't installed (deep link fails / user comes back without connecting):**
```
[Pif avatar]  Looks like you need Telegram first.
              It's free — takes about a minute to set up.

              [iPhone ↗]  [Android ↗]  [Desktop ↗]  [Web ↗]

              Once it's installed, tap this to connect:

                              [Open Telegram →]
```

**Design notes:**
- **One click, no BotFather.** This is the key improvement. The user never creates a bot, never copies a token, never leaves the onboarding flow mentally. They tap a button, Telegram opens, done.
- The deep link format `https://t.me/meetpif_bot?start=TOKEN` automatically sends `/start TOKEN` to the bot when the user taps "Start" in Telegram. The token is a one-time-use UUID tied to their tenant.
- **Polling for connection:** The onboarding page polls `/api/onboarding/status` every 2 seconds after the deep link is clicked. When the server sees the Telegram link event, the page auto-advances. The user doesn't need to come back and click "Next" — it just happens.
- **Multi-tenant bot routing:** Each incoming message is routed by Telegram user ID → tenant lookup table. The bot responds as "Pif" (or whatever the user named their assistant). From the user's perspective, it's their personal assistant — they don't know or care it's a shared bot.
- **Fallback for custom bots:** Power users who want their own bot (custom name, dedicated webhook) can set one up later from the dashboard. This is an advanced feature, not an onboarding requirement.
- Pif expression: `neutral` during the ask, `happy` on connection.
- "Last step" tells the user they're almost done — positive framing.
- The "I don't have Telegram" path handles the install case without derailing the flow.

### Step 6: Provisioning (The Show)

This is where we differentiate. Instead of a spinner with "Setting up...", the assistant narrates what it's doing.

```
[Pif avatar]  Alright. Give me a minute — I'm setting up your workspace.

              ✓ Created your account
              ✓ Set up your memory system
              ✓ Configured your Telegram bot
              ◌ Installing skills...
              ○ Final checks

              I'm being thorough. You'll thank me later.
```

**Design notes:**
- Real-time status updates from polling `/api/onboarding/status`. The server could expose sub-phases.
- Each completed phase gets a check mark with a subtle animation.
- Pif expression: `thinking` during provisioning, `happy` on completion.
- Optional: dry humor in the status messages:
  - "Setting up memory system" → "Teaching myself to remember things"
  - "Installing skills" → "Learning your workflows. I'm a fast reader."
  - "Final checks" → "Making sure I didn't forget anything. I'm thorough like that."
- On failure: Pif expression goes `concerned`, message says what happened, retry button available.

**On success:**
```
[Pif avatar]  Done. Everything's set up.

              Your workspace is ready, your bot is configured,
              and I've already started organizing things.

              One last thing — want to try something?

                              [Show me what you can do →]
                              [Skip to dashboard]
```

### Step 7: First Task (Optional)

A quick guided interaction to show the product works. This is the "aha moment."

```
[Pif avatar]  Here's something simple — say hi on Telegram.

              Open @YourBotName and send "hello".
              I'll reply. Then you'll know we're connected.

              [Open Telegram ↗]

              ○ Waiting for your message...
```

**On receiving the message (via webhook/poll):**
```
[Pif avatar]  Got it. We're officially in business.

              I'll be here when you need me — Telegram for quick
              stuff, the dashboard for the big picture.

                              [Go to Dashboard →]
```

**Design notes:**
- This step is skippable. Some users will want to explore on their own.
- If we can detect the Telegram message server-side (via the bot's webhook), we can confirm in real-time. If not, a manual "I sent it" button works.
- Pif expression: `happy` → `excited` when the message arrives.

---

## The Aha Moment — Showing What Pif Can Actually Do

The first task ("send hello") is warm, but it's not a showstopper. The real aha comes from demonstrating that this isn't a chatbot — it's a working chief of staff who does real things. We want the user to think "wait, it can do THAT?"

### Candidate Aha Moments (pick one for MVP, others become guided tasks post-onboarding)

**Option A: "Let me research something for you" (Recommended)**

Right after provisioning completes. **If background intelligence found the user's company**, Pif can pre-suggest a relevant topic — making the aha moment feel even more personalized:

**With company context:**
```
[Pif avatar]  Done. Everything's ready.

              Remember how I mentioned {companyName}?
              While you were setting up, I started pulling together
              a competitive landscape for your space.

              Want me to finish it? Or pick a different topic.

  ┌──────────────────────────────────────────┐
  │  {companyName} competitive landscape     │
  └──────────────────────────────────────────┘
                              [Research this]
                              [Skip to dashboard]
```

**Without company context (personal email):**
```
[Pif avatar]  Done. Everything's ready.

              Want to see what I can do? Give me a company
              or a topic and I'll research it — competitive
              landscape, market sizing, key players.

              I'll have something for you in about two minutes.

  ┌──────────────────────────────────────────┐
  │  e.g. "electric bikes in Europe"         │
  └──────────────────────────────────────────┘
                              [Research this]
                              [Skip to dashboard]
```

Then Pif actually runs a research workflow — web search, synthesis, structured output — and delivers a 1-page brief right there in the onboarding chat. Real work, done live.

**Why this is the strongest option:** It's what Pif does best. The Rekon competitive landscape deep-dive (15+ companies analyzed, Gong transcripts mined, pricing traps identified), the FelixCraft analysis (site structure breakdown, monetization model, 8 actionable suggestions in one pass), the Czech kindergarten market research (birth rate trends, competitor data quality audit, integration opportunities found) — these are Pif's signature moves. Showing a miniature version live is the fastest path to "holy shit, I need this."

**The background intelligence payoff:** If Pif pre-suggested researching their company's competitive landscape — using knowledge it gathered *during onboarding without being asked* — the aha moment hits twice: once for the research quality, and once for the realization that Pif was already working before it was even fully set up. That's the product demo.

**Option B: "I'll write your first daily brief"**

```
[Pif avatar]  Here's how I'll start each day for you.

              I just wrote your first morning brief based on
              what I know so far. It's short — you just got here.

              ┌─────────────────────────────────────────┐
              │  📋 Morning Brief — March 9, 2026       │
              │                                         │
              │  Welcome aboard. Here's your status:     │
              │  • Workspace: provisioned ✓              │
              │  • Telegram: connected ✓                 │
              │  • Tasks: 0 (a clean slate)              │
              │  • Schedule: heartbeat every 60 min      │
              │                                         │
              │  Nothing urgent. Which means today is    │
              │  a good day to break something.          │
              └─────────────────────────────────────────┘

              Tomorrow's will have more. I learn fast.
```

**Why this works:** It shows the recurring value — this isn't a one-off. Every morning, Pif will be there with context. The humor ("a good day to break something") lands because it's unexpected in a status report.

**Option C: "Create your first task and I'll run with it"**

```
[Pif avatar]  Your task board is empty. Let's fix that.

              Tell me something you've been putting off.
              Could be research, could be a draft, could be
              "figure out why our costs went up."

              I'll put it on the board and start working on it.

  ┌──────────────────────────────────────────┐
  │  What's been on your mind?               │
  └──────────────────────────────────────────┘
                              [Add to task board]
```

Pif creates a task in Supabase, adds a comment with an initial plan, and the user sees it appear in their dashboard in real time.

**Why this works:** It demonstrates the full loop — natural language in, structured task out, visible in the dashboard. It's what Pif does 50+ times a day (task board management, status transitions, comment threads). But it's less dramatic than the research option.

**Option D: "Watch me handle an email"**

```
[Pif avatar]  Want to see something useful?

              Forward me an email — any email — and I'll
              summarize it, extract action items, and draft
              a reply. Takes about 30 seconds.

              Your bot's email: pif+<instance>@meetpif.com
              (or just paste the text here)

  ┌──────────────────────────────────────────┐
  │  Paste email text...                     │
  └──────────────────────────────────────────┘
                              [Handle this]
```

**Why this works:** Email is universal. Everyone has an email they haven't replied to. Pif processing it live — summary, action items, draft reply — is immediately useful and impressive. But it requires email infrastructure we don't have yet.

### Recommendation

**Go with Option A (research) for MVP.** It's:
- The most impressive (real multi-source research, not just a summary)
- Self-contained (no email infra, no pre-existing data needed)
- Fast to demonstrate (~60-90 seconds for a short research brief)
- Directly maps to Pif's proven capabilities
- Easy to scope (one topic, one output, clear start and end)

The brief gets saved to their `~/memory/research/` directory, so it's immediately useful AND it shows the file system in action.

### Humor in the Aha Moment

The humor should be embedded, not signposted. Examples from the provisioning and aha steps:

- During provisioning: "Installing skills... I'm a fast reader." / "Final checks. I'm thorough like that."
- Research loading: "Reading everything I can find. This is what I do for fun."
- Research complete: "Done. I put this together in [X] seconds. You can fact-check me — I don't mind."
- If research topic is very niche: "Interesting choice. I had to dig for this one."
- If research topic is very broad: "That's a big topic. I kept it to one page. You're welcome."
- On first morning brief (day 2): "Day two. Yesterday you set me up. Today I'm earning my keep."

---

## Friction Analysis — Drop-off Risks & Mitigations

### 1. Google Workspace consent fear

**Risk:** User sees "Gmail, Drive, Calendar, Contacts" on the Google consent screen and gets nervous. Permissions anxiety is real — even read-only feels invasive. They skip or abandon.

**Mitigation:**
- **Pre-frame before the redirect.** Pif explains exactly what each scope does in plain language BEFORE the consent screen appears. By the time Google asks, the user already knows what's happening and why.
- **"I look, I don't touch"** — the read-only reassurance is explicit and memorable.
- **Make it skippable with no guilt.** "No problem. You can connect these later from the dashboard." If they skip, Pif still works — just with less context. Nudge again in the Day 1 email.
- **Show immediate value after connecting.** "Tomorrow morning, your first daily brief will actually have something in it" — the payoff is concrete and near.

### 2. Telegram install friction

**Risk:** User doesn't have Telegram installed. Now they need to download an app, create an account, and then do the deep link. That's a lot of steps even with the shared bot approach.

**Mitigation:**
- **Deep link handles everything after install.** Once Telegram is installed, the same link works — tap, connect, done. The friction is the install, not the connection.
- **"I don't have Telegram" path** provides direct download links (iOS, Android, Desktop) and then re-shows the connect button. No dead end.
- **Position Telegram as the value, not the cost.** "This is how you'll send me work from anywhere — your phone, your laptop, on the go." Telegram is the feature, not the requirement.
- **For users who truly won't install Telegram:** Consider a web chat fallback in v2 (dashboard-based messaging). For MVP, Telegram is required — but the deep link makes it one click for anyone who has it.

### 3. Background intelligence misfire

**Risk:** Pif says "I see you're at {companyName}" and gets it wrong — wrong company, outdated info, or the user uses a personal email for work. Awkward at best, trust-breaking at worst.

**Mitigation:**
- **Only show if confidence is high.** If the email domain is `gmail.com`, `outlook.com`, or any freemail provider, skip the company mention entirely. Only trigger for clear corporate domains with a confirmed company website.
- **Soft framing.** "I see you're at {companyName}" not "You work at {companyName}." The former is an observation that invites correction; the latter is an assertion.
- **Graceful fallback.** If the lookup returns nothing or low-confidence results, Pif just uses the generic welcome. The user never knows a lookup happened. No mention = no damage.
- **Let the user correct it.** If Pif gets it wrong, the naming/personality steps give natural opportunities to clarify. "Actually, I use my personal email for work" is a totally normal thing to say.

### 4. Provisioning failure or slow provisioning

**Risk:** Step 6 (provisioning) takes too long or fails. The user has invested 3 minutes, connected everything, and now stares at a spinner. If it fails, they may never come back.

**Mitigation:**
- **Pif narrates the wait.** Real-time status updates with humor: "Teaching myself to remember things..." / "Learning your workflows. I'm a fast reader." The entertainment reduces perceived wait time.
- **Target < 60 seconds.** Optimize the provisioning pipeline. Pre-warm templates, parallelize steps. If it takes > 30 seconds, something's wrong.
- **On failure: clear retry with context.** "Something went wrong on my end — not yours. Let me try again." Auto-retry once, then show a manual retry button. Pif expression goes `concerned`, not `error`.
- **Persist state.** If the user closes the tab and comes back, they land right back at provisioning in progress (or completed). Never restart from step 1.
- **Fallback:** If provisioning is completely broken, send the user an email when it's done: "I'm ready now — come back when you are." Don't lose them.

### 5. User completes onboarding but never comes back

**Risk:** The biggest one. User finishes onboarding, sees the dashboard, closes the tab, and forgets Pif exists. The onboarding was smooth, but there's no hook pulling them back.

**Mitigation:**
- **The aha moment (Step 7) is the hook.** If they do the research demo, they leave with a tangible deliverable — a real research brief they can use. That's memorable.
- **Email sequence is the safety net.** Email 1 (immediate) gives them actions to try. Email 2 (next morning) delivers the first daily brief — unsolicited value. Email 3 (Day 2) delivers proactive research. Each email is designed to pull them back.
- **Telegram is the persistent channel.** Once connected, Pif can send proactive messages: morning briefs, task reminders, "I noticed X in your calendar." The user doesn't have to remember to open the dashboard — Pif comes to them.
- **First-week activation checklist (internal).** Track: Did they send a Telegram message? Did they open a brief? Did they create a task? If not, trigger specific nudges. The goal: at least one meaningful interaction in the first 48 hours.

---

## Technical Requirements

### Chat UI Component

New component: `OnboardingChat.tsx`

- Renders messages in a chat bubble layout (left-aligned, avatar + bubbles)
- Supports message types: `text`, `options`, `input`, `progress`, `action-button`
- Typing indicator with configurable delay before reveal
- Messages queue and render sequentially (not all at once)
- Responsive: works on mobile (min 375px)
- Uses existing landing page CSS variables for theming

### State Machine

The onboarding is a state machine, not a step counter:

```
welcome → naming → personality (+ optional linkedin_scraping async)
→ google_workspace → google_workspace_connecting → google_workspace_done
→ telegram_deeplink → telegram_waiting → telegram_connected
→ submitting → provisioning → provisioned → first_task → complete
```

Async background jobs (not blocking states):
- `bg_company_lookup` — fires on SSO callback, resolves by step 2
- `bg_linkedin_scrape` — fires on LinkedIn URL paste in step 3, resolves by step 6

Each state maps to a set of visible messages + the current interactive element. Going "back" doesn't reset — it scrolls up to the earlier section and lets you change answers while keeping the chat history natural.

### API Changes

The existing 0D endpoints are fine. Additions:

1. **`GET /api/onboarding/status`** — add a `phase` field to the response so the frontend can show granular provisioning progress:
   - `validating_config`, `registering_tenant`, `creating_user`, `rendering_templates`, `installing_skills`, `configuring_services`, `smoke_testing`, `complete`

2. **`POST /api/onboarding/submit`** — add optional fields:
   - `quiet_hours_start` (int, 0-23, default 22)
   - `quiet_hours_end` (int, 0-23, default 7)
   - `linkedin_url` (string, optional) — triggers Apify scrape
   - These map to `DND_START` / `DND_END` in the instance config.

3. **`GET /api/auth/google/workspace`** — incremental OAuth redirect. Requests additional scopes on top of the existing grant:
   - `calendar.readonly`, `gmail.readonly`, `drive.readonly`, `contacts.readonly`
   - Uses `include_granted_scopes=true`, `access_type=offline`, `prompt=consent`
   - Returns to `/api/auth/google/workspace/callback`

4. **`GET /api/auth/google/workspace/callback`** — handles the incremental OAuth callback:
   - Exchanges code for tokens (access + refresh)
   - Stores refresh token in the tenant's encrypted config (logins table or tenant_settings)
   - Returns redirect to `/onboarding?workspace=connected`

5. **`GET /api/onboarding/telegram-link`** — generates a one-time deep link for Telegram connection:
   - Creates a unique token (UUID), stores it in `onboarding_tokens` table with `tenant_id` and `expires_at`
   - Returns `{ url: "https://t.me/meetpif_bot?start=<token>" }`
   - Token expires after 15 minutes. Frontend renders the URL as the "Open Telegram" button.

6. **Telegram bot `/start` handler** — when the shared bot receives `/start <token>`:
   - Looks up token in `onboarding_tokens` → gets `tenant_id`
   - Stores the Telegram user's `chat_id` against the tenant
   - Invalidates the token (one-time use)
   - Bot responds to the user in Telegram: "Hey {name}, I'm connected. Try asking me something."
   - Updates tenant status so the onboarding page's poll detects the connection

7. **`GET /api/onboarding/background`** — returns background intelligence results:
   - `{ company: { name, industry, size, url }, linkedin: { role, history, skills }, web_mentions: [...] }`
   - Frontend polls this to personalize later steps

### Animation & Micro-interactions

- **Typing indicator:** Three animated dots, 400ms delay between each dot appearing
- **Message reveal:** Fade in + slight upward slide (transform: translateY(8px) → 0)
- **Checkbox animation:** Scale pop + check draw (SVG path animation, 300ms)
- **Pif expression transitions:** 200ms crossfade between expression states
- **Progress bar dots:** Step indicators that fill with accent color as you advance

---

## GCP App Verification — Rollout Strategy

Google requires OAuth verification for sensitive scopes (Gmail, Drive, Calendar, Contacts). We're taking a phased approach:

**Alpha (first ~100 users):** Use GCP "testing" mode. Manually add each user's Google email as a test user in the GCP console. Limit: 100 test users. This is manageable for alpha — we're onboarding users individually anyway, and adding them takes 30 seconds.

**Pre-launch (when approaching 100 users):** Submit for sensitive scope verification. Requirements:
- Public homepage (meetpif.com — already live)
- Privacy policy on same domain (need to publish)
- Domain ownership verification via Search Console (already verified for Cloudflare)
- Unlisted YouTube video demonstrating the OAuth flow and how data is used
- Written justification for each scope
- Timeline: 3-5 business days

**Note:** Our scopes are all `readonly` (sensitive, not restricted). This means we do NOT need the CASA security assessment or annual recertification — those are only for restricted scopes like `gmail.modify` or full Drive access. Read-only is the sweet spot: maximum utility, minimum verification burden.

---

## Post-Onboarding Email Sequence

The onboarding doesn't end when the user hits the dashboard. A setup email sequence helps users discover capabilities they didn't explore during onboarding, builds the habit of using Pif, and reduces churn in the critical first week.

**Sent from:** Pif (pif@meetpif.com or the user's bot name). Not "Rif Team" or "noreply" — the emails come from the assistant, in character.

### Sequence

**Email 1: Welcome + Quick Wins (immediately after onboarding)**
- Subject: "I'm set up. Here's what to try first."
- Recap what was connected (calendar, email, Telegram)
- 3 concrete things to try right now:
  - "Message me on Telegram: 'What's on my calendar today?'"
  - "Reply to this email with a topic and I'll research it"
  - "Say 'remind me to X at Y' — I'll handle it"
- Tone: helpful, action-oriented, short

**Email 2: Your First Brief (next morning, ~8am user's timezone)**
- Subject: "Your morning brief — Day 1"
- The actual daily brief, delivered via email (and Telegram, if connected)
- This is the first recurring value moment — shows Pif working without being asked
- If Google Workspace was connected: includes calendar summary and email highlights
- If not connected: lighter brief with a nudge to connect ("I'd have more for you if you connect your calendar — takes 10 seconds")

**Email 3: Deep Dive Example (Day 2)**
- Subject: "I researched {topic} for you" or "Here's something I found about {companyName}"
- If they did the research aha moment during onboarding: follow up with an expanded version
- If they skipped it: proactively run a mini-research on their company/industry and deliver it
- This is the "holy shit" email — unsolicited, genuinely useful work

**Email 4: Power User Tips (Day 4)**
- Subject: "3 things most people don't try in the first week"
- Examples tailored to what they haven't used yet:
  - If no tasks created: "Tell me something you've been putting off"
  - If no research requested: "Give me a company name — I'll have a brief in 2 minutes"
  - If Telegram not active: "Your bot is set up but lonely — try messaging me"
- Nudge toward features they haven't discovered

**Email 5: Check-in (Day 7)**
- Subject: "How's the first week going?"
- Quick recap: what Pif has done for them this week (X briefs, Y tasks, Z messages)
- Ask: "What's one thing I could do better?" — reply goes to a feedback channel
- If they haven't used Pif much: gentle "I'm here when you need me" — no guilt, no pressure

### Design Principles for the Sequence
- **In character.** These emails are from Pif, not from "the team." Same voice as onboarding.
- **Action-first.** Every email has a thing the user can do right now. No "tips and tricks" that are just reading.
- **Adaptive.** The content changes based on what the user has and hasn't done. Connected calendar? Brief includes calendar. Never messaged on Telegram? Nudge toward it.
- **Short.** Nobody reads long onboarding emails. 3-5 sentences max, one clear CTA.
- **Stoppable.** Unsubscribe link, obviously. But also: "Reply 'stop' and I'll only message you on Telegram."

### Technical Notes
- Emails sent via Pif's Gmail (SMTP, app password already configured) or a transactional service (Resend, Postmark) for deliverability
- Sequence state tracked in Supabase (which emails sent, which opened, which acted on)
- Adaptive logic: check user activity (tasks created, messages sent, features used) before sending each email to customize content

---

## What We're NOT Building (MVP)

- Voice onboarding (ElevenLabs TTS narrating the setup) — cool but not MVP
- Custom theme picker during onboarding — they get the default, customize later
- SOUL.md editing during onboarding — that's a dashboard feature
- Multi-user onboarding (inviting team members) — single owner only for now
- Payment/billing step — free during alpha
- Full email sequence automation — the sequence is defined here, but for alpha we can trigger emails manually or with simple cron. Full automation (open tracking, adaptive branching) is post-alpha.

---

## Success Metrics

- **Completion rate:** % of users who start onboarding and reach the dashboard
- **Time to complete:** Target < 4 minutes (3 min was the Pif promise)
- **First Telegram message:** % of users who send their first bot message during onboarding
- **Google Workspace connected:** % of users who grant additional scopes (target: >70%)
- **Drop-off step:** Which step loses the most users (tells us where friction lives)
- **Day-7 retention:** % of users active in week 2 (sent a message, opened a brief, created a task)
- **Email engagement:** Open rates and action rates for each email in the sequence

---

## Open Questions

1. **Should the chat be real AI or scripted?** Scripted is faster to build and more predictable. Real AI (calling Claude in the background) would let users ask questions mid-flow but adds latency and unpredictability. Recommendation: scripted MVP, AI follow-up questions in v2.
2. **Should we persist partial onboarding?** If a user closes the tab at step 3 and comes back, do they restart or resume? Recommendation: persist to server state (tenant status tracks where they are).
3. **Mobile-first or desktop-first?** The BotFather step is easier on mobile (Telegram is right there). The dashboard is better on desktop. Recommendation: responsive, but optimize the onboarding for mobile since that's where Telegram lives.
4. **Anthropic API key — BYOK, managed, or deferred?** Three options:
   - **BYOK (bring your own key):** User pastes their Anthropic API key during onboarding. Highest friction — requires Anthropic signup + payment method + key generation. If chosen, group with Telegram as step 4b ("technical setup" block). Rif charges a lower platform fee.
   - **Managed keys:** Rif pays for Claude API, bundles into pricing. Zero onboarding friction — the user never sees an API key. Higher margins, simpler UX, but Rif carries usage risk.
   - **Deferred:** Instance runs on Pif's key during onboarding + first N days. User is prompted to add their own key later, once they're hooked. "Free trial then convert" model. Best of both worlds for onboarding UX, but requires a migration flow post-onboarding.
   - **Recommendation:** TBD — this is a business model decision that affects pricing, margins, and onboarding friction. Needs Pavol's call.
5. **Email sending infrastructure:** Pif's Gmail SMTP works for alpha (<100 users), but deliverability will suffer at scale (SPF/DKIM alignment, sending reputation). At what point do we switch to a transactional email service (Resend, Postmark)?
