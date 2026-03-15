# Programmatic SEO Strategy — meetpif.com/blog

**Author:** Pif | **Date:** 2026-03-15 | **Status:** Draft v4

---

## Principles

1. **Zynga rule.** Copy Claw Mart's exact playbook. They proved the format works — we replicate the structure and apply it to AI assistant messaging.
2. **Go broad.** Not a narrow "AI chief of staff" niche play. Broad "AI Assistant for [X]" coverage across tools, platforms, and use cases. Cast a wide net.
3. **One article per day.** Steady cadence. Not a bulk dump, not a slow drip.
4. **Template-driven.** One proven structure, applied to every topic. Quality through consistency, not through artisanal crafting of each piece.
5. **Author is Pif.** Every article bylined by Pif. Consistent voice, consistent identity.

---

## The Claw Mart Pattern — Reverse-Engineered from 10 Posts

Analyzed: n8n, Workato, Google Docs, HubSpot, Todoist, Salesforce, Zapier, Notion, Shopify, and their one thought-leadership piece ("Practical AI Agents: Operator's Guide").

### The Exact Template (Tool-Specific Articles)

Every tool-specific article follows this skeleton. The section names vary slightly but the structure is identical across all 10:

```
H1: "AI [Agent/Assistant] for [X]: [Action Subtitle]"
    ↳ Subtitle pattern: "Automate [Activity], [Activity], and [Activity]"
    ↳ Alt pattern: "When [X] Needs [Benefit]" / "Turn [X] Into [Result]"

[Metadata: date | read time (7-13 min) | author]
[Clawsourcing CTA callout box — appears immediately, above the fold]

SECTION 1 — THE GAP (H2)
"Why [X] Alone Isn't Enough" / "The Gap" / "[X]'s Ceiling Is Lower Than You Think"
    - Establishes what the native tool does
    - Names the specific limitations (not vague — cites features by name)
    - 300-800 words
    - Tone: respectful but direct. "It's good at X. It stops at Y."

SECTION 2 — WHAT THE AGENT DOES (H2) ← longest section, 800-2,200 words
"What an AI Agent Actually Does with [X]" / "What a Custom Agent Adds"
    - 3-5 H3 subsections, each a specific capability
    - Each H3: problem → what the agent does → concrete example
    - Capability names are specific, not generic:
      ✓ "CRM Hygiene Enforcement"
      ✓ "Intelligent Abandoned Cart Recovery"
      ✗ "Better Automation" (too vague — they never do this)
    - Code blocks in at least 2 subsections (Python/JSON)

SECTION 3 — ARCHITECTURE (H2)
"Technical Architecture" / "The Technical Foundation" / "How It Connects"
    - API connection details
    - Data flow: what connects to what
    - Code blocks (API auth, webhook setup, config JSON)
    - 300-800 words

SECTION 4 — REAL WORKFLOW (H2)
"Real Workflow: [Specific Scenario]" / "Example: [End-to-End Use Case]"
    - One complete end-to-end example
    - Trigger → steps → outcome
    - Sometimes includes a "two approaches" comparison (manual vs agent)
    - 250-900 words

SECTION 5 — ROI / COST (H2)
"The Math" / "What This Costs vs. The Alternative" / "The ROI Is Obvious"
    - Specific numbers ($X/mo vs $Y/mo)
    - Time saved per week
    - Simple, punchy — not a spreadsheet
    - 200-400 words

SECTION 6 — GET STARTED (H2)
"Getting Started" / "Next Steps" / "Start Building"
    - CTA to the product (for them: Clawsourcing. For us: Pif)
    - 3-5 concrete first steps
    - Newsletter signup
    - 200-500 words

[Related products: 3 cards with images + pricing]
[Newsletter signup: "Get one AI tip daily"]
["More from the Blog": 3 related article cards]
```

### Numbers

| Metric | Range | Average |
|--------|-------|---------|
| Total word count | 3,100-5,800 | ~4,200 |
| H2 sections | 6-8 | 7 |
| H3 subsections | 3-5 (in Section 2) | 4 |
| Code blocks | 3-6 | 4 |
| Reading time | 7-13 min | 10 min |

### Recurring UI Elements (Every Post)

1. **CTA callout box** — appears above the fold, before any content. "Don't want to build it yourself?" with link to service page
2. **Code blocks** — Python functions, JSON configs, API examples. Never zero. Always at least 3.
3. **"Copy as Markdown for Your Agent"** button — encourages agents to ingest the content
4. **Related products** — 3 cards with images, titles, and pricing ($2.99-$49)
5. **Newsletter signup** — inline, always present. "Get one AI [X] tip daily"
6. **"More from the Blog"** — 3 related articles at bottom
7. **Breadcrumbs** — Home > Blog > Article

### Sahil Bloom Analysis (2026-03-15)

Compared our template against sahilbloom.com/newsletter/. Key differences evaluated through a programmatic SEO lens — does it scale across 93 articles without per-article creative work?

**Adopted (template-level, zero per-article cost):**
- **Author byline at top** — "by Pif · {date} · {read_time} read" with Pif avatar. Same on every article. Builds E-E-A-T.
- **Sticky reading progress bar** — 3px accent bar at viewport top, scroll-linked. Pure UI component.
- **Styled blockquotes** — CSS-only. Key takeaways and tool quotes in every article.
- **Category tags** — Topic labels below article body. Powers hub-and-spoke architecture for internal linking and topic cluster pages.

**Dropped:**
- **Narrative opening hook** — Sahil opens with personal anecdotes. Requires unique creative writing per article. At 93 articles, doesn't scale. Our Section 1 ("Why [Tool] Alone Isn't Enough") serves the same function with templatable content.
- **P.S. section** — Sahil uses for personal book recs and life updates. Not worth templating. The sidebar CTA and footer CTA cover the same conversion goal.

**Added beyond Sahil (from Claw Mart + our own needs):**
- **Sticky sidebar CTA** (desktop >1100px) — fixed position, Pif logo + pitch + link to /custom. Visible throughout the entire scroll.
- **Related posts grid** — "MORE FROM THE LOG" with 3-column card grid below the article. Internal linking at scale.

### Thought-Leadership Variant (1 in ~20 Articles)

The "Practical AI Agents" post differs:
- **Philosophy-first**, tools as examples (reversed from tool-specific articles)
- **Tiered structure** (Tier 0 → Tier 3) instead of sequential sections
- **Heavy internal product linking** (15+ links to marketplace)
- **No single tool focus** — cross-cutting operational advice
- Serves as a **hub page** that links to the tool-specific articles

---

## Our Template (Adapted for Pif)

Claw Mart skeleton + Sahil Bloom programmatic elements. Substitutes "OpenClaw agent" → "AI assistant" and "Clawsourcing" → "Pif /custom page."

```
[READING PROGRESS BAR — fixed, 3px accent, top of viewport]

[Blog nav: ← ALL POSTS]

[AUTHOR BYLINE: Pif avatar + "by Pif · {date} · {read_time} read"]

H1: "AI Assistant for [X]: [Automate/Manage/Streamline] [Activity], [Activity], and [Activity]"

[Summary: 1-2 sentence subtitle, 18px, text-secondary]

[Divider]

[CTA callout: "Want an AI assistant that manages your [X] for you?" → /custom]

--- ARTICLE BODY + SIDEBAR LAYOUT ---
Left: article body (max-width 640px)
Right: sticky sidebar CTA (desktop >1100px, 220px, fixed position)

--- SECTION 1: THE GAP (H2) — 300-800 words ---
"Why [X] Alone Isn't Enough"
- What the native tool does well
- Where it stops (name specific features/limits)
- The gap an AI assistant fills
- Ends with: "This is where an AI assistant changes the equation."

--- SECTION 2: WHAT THE ASSISTANT DOES (H2) — 800-2,000 words ---
"What an AI Assistant Actually Does with [X]"
- 3-5 H3 subsections, each a specific capability
- Each: problem → what the assistant does → example
- Specific capability names (not generic)
- Code/config blocks in at least 2 subsections

--- SECTION 3: HOW IT WORKS (H2) — 300-800 words ---
"How It Connects"
- API/integration approach
- Data flow: Trigger → Processing → Action → Feedback
- Code blocks (auth, webhooks, config)

--- SECTION 4: REAL WORKFLOW (H2) — 250-900 words ---
"A Real Workflow, End to End"
- One complete example: trigger → steps → outcome
- Bold time labels: **6:30 AM —** / **8:45 AM —** etc.
- Concrete enough to visualize a real day

--- SECTION 5: THE MATH (H2) — 200-400 words ---
"The Numbers"
- Time saved per week (specific hours)
- Cost comparison: manual vs. automated
- ROI framing: "At $X/mo, this pays for itself in Y days"

--- SECTION 6: HONEST TRADEOFFS (H2) — 200-400 words ---
"The Honest Tradeoffs"
- 3-5 bullet points of real limitations
- Builds credibility — don't hide what doesn't work
- Frame as "things to know," not "reasons not to buy"

--- SECTION 7: GET STARTED (H2) — 200-500 words ---
"Get Started"
- CTA to Pif /custom page
- 3-5 first steps
- Link to /login for free tier

--- POST-ARTICLE COMPONENTS ---

[CATEGORY TAGS: topic pills, below article body]
[AUTHOR CARD: Pif avatar + "Written by Pif" + tagline]
[POST NAVIGATION: ← OLDER / NEWER →]
[RELATED POSTS: "MORE FROM THE LOG" — 3-column card grid]
```

**Target:** 3,000-4,500 words | 8-12 min read | 7 H2s | 3-5 H3s | 3+ code blocks

### BlogPost Interface (TypeScript)

```typescript
interface BlogPost {
  slug: string           // URL path: /blog/{slug}
  date: string           // Display date: "March 15, 2026"
  title: string          // H1 text
  summary: string        // Subtitle / lede
  readTime: string       // "10 min"
  content: string[]      // Day-log paragraphs (empty for SEO articles)
  richContent?: string   // HTML body for SEO articles
  cta?: { text: string; buttonLabel: string; href: string }
  tags?: string[]        // Category tags: ['google-calendar', 'productivity']
  author?: string        // Defaults to 'Pif'
}
```

---

## Topic Map — 90+ Articles

### Category 1: Productivity & Workspace (15 articles)

| Slug | Title |
|------|-------|
| `ai-assistant-for-google-calendar` | AI Assistant for Google Calendar: Automate Scheduling, Time Blocking, and Meeting Prep |
| `ai-assistant-for-google-docs` | AI Assistant for Google Docs: Automate Drafts, Reviews, and Document Workflows |
| `ai-assistant-for-google-sheets` | AI Assistant for Google Sheets: Automate Reports, Data Entry, and Analysis |
| `ai-assistant-for-gmail` | AI Assistant for Gmail: Automate Triage, Drafts, and Follow-Up |
| `ai-assistant-for-notion` | AI Assistant for Notion: Automate Your Knowledge Base and Project Tracking |
| `ai-assistant-for-todoist` | AI Assistant for Todoist: Automate Task Management and Productivity Analytics |
| `ai-assistant-for-slack` | AI Assistant for Slack: Automate Messages, Summaries, and Channel Workflows |
| `ai-assistant-for-telegram` | AI Assistant for Telegram: Build a Personal Operations Bot |
| `ai-assistant-for-microsoft-teams` | AI Assistant for Microsoft Teams: Automate Updates, Summaries, and Workflows |
| `ai-assistant-for-outlook` | AI Assistant for Outlook: Email Automation Beyond Rules and Filters |
| `ai-assistant-for-obsidian` | AI Assistant for Obsidian: Automate Note-Taking and Knowledge Management |
| `ai-assistant-for-linear` | AI Assistant for Linear: Automate Issues, Sprints, and Status Reports |
| `ai-assistant-for-jira` | AI Assistant for Jira: Automate Tickets, Standups, and Sprint Management |
| `ai-assistant-for-asana` | AI Assistant for Asana: Automate Project Tracking and Team Updates |
| `ai-assistant-for-trello` | AI Assistant for Trello: Automate Boards, Cards, and Workflow Rules |

### Category 2: CRM & Sales (12 articles)

| Slug | Title |
|------|-------|
| `ai-assistant-for-hubspot` | AI Assistant for HubSpot: Automate CRM Hygiene, Follow-Ups, and Pipeline Management |
| `ai-assistant-for-salesforce` | AI Assistant for Salesforce: Automate Pipeline Alerts, Lead Scoring, and Rep Productivity |
| `ai-assistant-for-pipedrive` | AI Assistant for Pipedrive: Automate Deal Tracking and Sales Workflows |
| `ai-assistant-for-close-crm` | AI Assistant for Close CRM: Automate Outreach, Follow-Up, and Reporting |
| `ai-assistant-for-apollo` | AI Assistant for Apollo.io: Automate Prospecting and Lead Enrichment |
| `ai-assistant-for-linkedin-sales` | AI Assistant for LinkedIn Sales Navigator: Automate Lead Gen and Outreach |
| `ai-assistant-for-gong` | AI Assistant for Gong: Automate Call Analysis and Deal Intelligence |
| `ai-assistant-for-outreach` | AI Assistant for Outreach: Automate Sales Sequences and Engagement Tracking |
| `ai-assistant-for-lemlist` | AI Assistant for Lemlist: Automate Cold Email Campaigns and Follow-Up |
| `ai-assistant-for-calendly` | AI Assistant for Calendly: Automate Scheduling, Prep, and Follow-Up |
| `ai-assistant-for-stripe` | AI Assistant for Stripe: Automate Billing, Invoices, and Revenue Ops |
| `ai-assistant-for-freshsales` | AI Assistant for Freshsales: Automate CRM Without Enterprise Complexity |

### Category 3: Marketing & Content (12 articles)

| Slug | Title |
|------|-------|
| `ai-assistant-for-mailchimp` | AI Assistant for Mailchimp: Automate Campaigns, Segments, and Audience Growth |
| `ai-assistant-for-convertkit` | AI Assistant for ConvertKit: Automate Creator Email Marketing |
| `ai-assistant-for-beehiiv` | AI Assistant for Beehiiv: Automate Newsletter Operations and Growth |
| `ai-assistant-for-substack` | AI Assistant for Substack: Automate Publishing and Subscriber Management |
| `ai-assistant-for-buffer` | AI Assistant for Buffer: Automate Social Scheduling and Analytics |
| `ai-assistant-for-hootsuite` | AI Assistant for Hootsuite: Automate Social Media Management at Scale |
| `ai-assistant-for-canva` | AI Assistant for Canva: Automate Design Workflows and Brand Consistency |
| `ai-assistant-for-wordpress` | AI Assistant for WordPress: Automate Publishing, SEO, and Site Management |
| `ai-assistant-for-webflow` | AI Assistant for Webflow: Automate Site Updates and Content Operations |
| `ai-assistant-for-google-analytics` | AI Assistant for Google Analytics: Automate Reports, Alerts, and Insights |
| `ai-assistant-for-semrush` | AI Assistant for SEMrush: Automate SEO Monitoring and Competitor Analysis |
| `ai-assistant-for-ahrefs` | AI Assistant for Ahrefs: Automate Backlink Tracking and Keyword Research |

### Category 4: Automation & Dev Platforms (10 articles)

| Slug | Title |
|------|-------|
| `ai-assistant-for-zapier` | AI Assistant for Zapier: When Zaps Aren't Enough |
| `ai-assistant-for-make` | AI Assistant for Make: Automate Complex Workflows with Intelligence |
| `ai-assistant-for-n8n` | AI Assistant for n8n: Self-Hosted Automation with an AI Brain |
| `ai-assistant-for-pipedream` | AI Assistant for Pipedream: Code-First Automation with AI |
| `ai-assistant-for-retool` | AI Assistant for Retool: Build Smarter Internal Tools |
| `ai-assistant-for-airtable` | AI Assistant for Airtable: Automate Databases, Views, and Workflows |
| `ai-assistant-for-supabase` | AI Assistant for Supabase: Automate Backend Operations and Data Pipelines |
| `ai-assistant-for-vercel` | AI Assistant for Vercel: Automate Deployments, Monitoring, and Previews |
| `ai-assistant-for-github` | AI Assistant for GitHub: Automate PRs, Issues, and Code Review |
| `ai-assistant-for-cloudflare` | AI Assistant for Cloudflare: Automate DNS, Workers, and Security Rules |

### Category 5: Finance & Accounting (8 articles)

| Slug | Title |
|------|-------|
| `ai-assistant-for-quickbooks` | AI Assistant for QuickBooks: Automate Bookkeeping, Invoicing, and Reports |
| `ai-assistant-for-xero` | AI Assistant for Xero: Automate Accounting Workflows and Reconciliation |
| `ai-assistant-for-wave` | AI Assistant for Wave: Free Accounting with AI Automation |
| `ai-assistant-for-freshbooks` | AI Assistant for FreshBooks: Automate Invoices and Expense Tracking |
| `ai-assistant-for-gusto` | AI Assistant for Gusto: Automate Payroll, Benefits, and HR |
| `ai-assistant-for-expensify` | AI Assistant for Expensify: Automate Expense Reports and Approvals |
| `ai-assistant-for-mercury` | AI Assistant for Mercury: Automate Startup Banking and Cash Ops |
| `ai-assistant-for-brex` | AI Assistant for Brex: Automate Corporate Card and Expense Management |

### Category 6: Customer Support (8 articles)

| Slug | Title |
|------|-------|
| `ai-assistant-for-intercom` | AI Assistant for Intercom: Automate Support, Onboarding, and Messaging |
| `ai-assistant-for-zendesk` | AI Assistant for Zendesk: Automate Tickets, Routing, and Resolution |
| `ai-assistant-for-freshdesk` | AI Assistant for Freshdesk: Automate Help Desk Without Enterprise Pricing |
| `ai-assistant-for-crisp` | AI Assistant for Crisp: Automate Live Chat and Customer Engagement |
| `ai-assistant-for-helpscout` | AI Assistant for Help Scout: Automate Email-Based Customer Support |
| `ai-assistant-for-drift` | AI Assistant for Drift: Automate Conversational Marketing and Qualification |
| `ai-assistant-for-typeform` | AI Assistant for Typeform: Automate Survey Processing and Response Analysis |
| `ai-assistant-for-surveymonkey` | AI Assistant for SurveyMonkey: Automate Feedback Collection and Reporting |

### Category 7: E-Commerce & Ops (8 articles)

| Slug | Title |
|------|-------|
| `ai-assistant-for-shopify` | AI Assistant for Shopify: Automate Orders, Inventory, and Customer Comms |
| `ai-assistant-for-woocommerce` | AI Assistant for WooCommerce: Automate Store Operations and Fulfillment |
| `ai-assistant-for-gumroad` | AI Assistant for Gumroad: Automate Digital Product Sales and Delivery |
| `ai-assistant-for-lemon-squeezy` | AI Assistant for Lemon Squeezy: Automate SaaS Billing and License Management |
| `ai-assistant-for-shippo` | AI Assistant for Shippo: Automate Shipping, Labels, and Tracking |
| `ai-assistant-for-aftership` | AI Assistant for AfterShip: Automate Order Tracking and Delivery Alerts |
| `ai-assistant-for-printful` | AI Assistant for Printful: Automate Print-on-Demand Operations |
| `ai-assistant-for-amazon-seller` | AI Assistant for Amazon Seller Central: Automate Listings and Inventory |

### Category 8: Roles & Use Cases (15 articles)

| Slug | Title |
|------|-------|
| `ai-assistant-for-solo-founders` | AI Assistant for Solo Founders: Run Operations Without Hiring |
| `ai-assistant-for-freelancers` | AI Assistant for Freelancers: Automate Admin, Focus on the Work |
| `ai-assistant-for-real-estate-agents` | AI Assistant for Real Estate Agents: Automate Leads, Follow-Up, and Showings |
| `ai-assistant-for-lawyers` | AI Assistant for Lawyers: Automate Research, Intake, and Case Management |
| `ai-assistant-for-consultants` | AI Assistant for Consultants: Automate Client Reporting and Deliverables |
| `ai-assistant-for-coaches` | AI Assistant for Coaches: Automate Scheduling, Check-Ins, and Client Comms |
| `ai-assistant-for-recruiters` | AI Assistant for Recruiters: Automate Sourcing, Screening, and Candidate Tracking |
| `ai-assistant-for-accountants` | AI Assistant for Accountants: Automate Client Bookkeeping and Reporting |
| `ai-assistant-for-creators` | AI Assistant for Content Creators: Automate Publishing, Analytics, and Engagement |
| `ai-assistant-for-agencies` | AI Assistant for Agencies: Automate Client Reporting and Project Management |
| `ai-assistant-for-executive-assistants` | AI Assistant for Executive Assistants: Augment Your Role with AI |
| `ai-assistant-for-morning-briefings` | AI Assistant for Morning Briefings: Start Every Day Informed |
| `ai-assistant-for-meeting-notes` | AI Assistant for Meeting Notes: Automate Summaries and Action Items |
| `ai-assistant-for-email-triage` | AI Assistant for Email Triage: Inbox Zero on Autopilot |
| `ai-assistant-for-daily-standups` | AI Assistant for Daily Standups: Automate Status Updates Across Tools |

### Category 9: Thought Leadership (5 articles — 1 per ~20 tool articles)

| Slug | Title |
|------|-------|
| `practical-ai-assistants-operators-guide` | Practical AI Assistants: The Operator's Guide to Production Use |
| `ai-assistant-vs-chatbot` | AI Assistant vs Chatbot: What's Actually Different in 2026 |
| `cost-of-ai-assistant-2026` | The Real Cost of Running an AI Assistant in 2026 |
| `build-vs-buy-ai-assistant` | Build vs Buy an AI Assistant: When DIY Makes Sense and When It Doesn't |
| `future-of-ai-assistants` | Where AI Assistants Are Headed (And What to Build Now) |

**Total: 93 articles across 9 categories.**

---

## SEO Infrastructure (Build Once, Before Day 1)

- [x] `/blog` route on meetpif.com — article list, blog index page ✅
- [x] CTA callout component — "Want an AI assistant that manages your [X] for you?" → /custom. Above the fold. ✅
- [x] "More from the Blog" component — 3 related articles grid, bottom of every post ✅
- [x] Author byline component — Pif avatar + name + date + read time, top of every article ✅
- [x] Reading progress bar — sticky 3px accent bar at top of viewport ✅
- [x] Category tags component — topic labels below article body ✅
- [x] Styled blockquotes — CSS for key takeaways and pull quotes ✅
- [x] Sticky sidebar CTA — desktop only (>1100px), fixed position, links to /custom ✅
- [x] Rich content rendering — `dangerouslySetInnerHTML` for SEO articles, paragraph array for day-logs ✅
- [ ] Sitemap.xml — auto-generated on each publish
- [ ] `BlogPosting` + `BreadcrumbList` JSON-LD schema on every article
- [ ] OG image template — auto-generated per article (title + Pif brand)
- [ ] Google Search Console — verified for meetpif.com
- [ ] Category hub pages: `/blog/productivity`, `/blog/crm`, `/blog/marketing`, etc.
- [ ] Category filtering on blog index page
- [ ] Newsletter signup component — inline, on every article
- [ ] Breadcrumbs — Home > Blog > [Category] > Article
- [ ] Author page for Pif
- [ ] Canonical URLs, meta descriptions, robots.txt
- [ ] "Copy as Markdown" button (optional — Claw Mart does this, it's clever)

---

## Automation Pipeline (from OpenClaw SEO Guide)

Reference: OpenClaw SEO Content Automation Guide (Google Drive .docx). The guide describes a 4-phase autonomous pipeline. Below is our adaptation for Pif's architecture.

### Phase 1: Keyword Research & Validation

Our approach differs from OpenClaw's — we use a **fixed topic map** (93 articles pre-planned), not dynamic trend discovery. But we still validate each topic before writing.

```
Per-topic validation (before drafting):
1. SERP check via Brave Search API
   - Who ranks for "AI assistant for [tool]"?
   - What do top 5 articles cover? What gaps exist?
   - allintitle count — if >5,000, keyword may be too competitive
2. Reddit/community validation
   - Are people actually asking about AI + [tool]?
   - What specific pain points surface?
   - Extract exact phrasing for FAQ section
3. Competitor content analysis
   - Fetch top 3-5 ranking articles
   - Note: word count, sections covered, code examples, freshness
   - Identify what they miss — that's our angle
4. Validation score
   - Search volume signal (Brave result count)
   - Community interest (Reddit post frequency)
   - Competition level (allintitle, content quality)
   - Score ≥90 → proceed to draft. <90 → deprioritize.
```

### Phase 2: Content Creation

```
1. Pick topic from map → slug + title + target keyword
2. Run validation (Phase 1) — 10 min
3. Draft using template — 30-45 min (Pif-authored, Antfarm-assisted)
   - Fill each H2 section (7 mandatory sections)
   - 3-5 H3 capabilities in Section 2 (informed by competitor gaps)
   - Code blocks in at least 2 sections
   - "The Numbers" section with real data
   - "Honest Tradeoffs" section — 3-5 real limitations
   - FAQ schema with 5-7 questions (sourced from Reddit + "People Also Ask")
   - CTA to Pif /custom in Get Started
4. Quality gate
   - SEO checklist: keyword in title, first 100 words, at least 1 H2, conclusion
   - Word count ≥3,000
   - Code blocks ≥3
   - Internal links ≥3 (to other blog posts + product pages)
   - External links ≥2 (to tool docs — builds E-E-A-T)
```

### Phase 3: Publishing & Distribution

```
1. Publish to /blog/[slug]
   - Add BlogPost entry with richContent, tags, cta
   - Build + deploy (Vite → mc/dist/ → nginx → Cloudflare)
2. Post-publish automation
   - Generate OG image (title + Pif brand template)
   - Submit to Google Search Console for indexing
   - Update sitemap.xml
   - Update internal link database (topic → URL → anchor texts)
   - Cross-link: update 2-3 existing articles to link to new one
3. Social distribution
   - Generate + post LinkedIn (hook + 5 bullets + CTA)
   - Generate + post Twitter/X (280-char hook + link)
   - Reddit: helpful comment in relevant subreddit (not promotional)
```

**Daily at 10:00 AM CET.**

### Phase 4: Monitoring & Optimization

```
Day 2:   Is it indexed? (GSC URL Inspection)
Day 7:   Initial ranking position. Impressions starting?
Day 14:  Impressions, clicks, CTR. Compare to other articles.
Day 30:  Full analysis — keep / update / consolidate.
         If not page 1-3: re-run competitor analysis, update content.
```

**Monthly optimization cycle:**
- Re-analyze underperforming articles (ranking >30 after 30 days)
- Fetch updated competitor content — have they improved?
- Add missing sections, update stats, increase word count
- Resubmit to GSC after update
- Track: which categories perform best? Adjust publishing priority.

---

## Advanced Strategies (from OpenClaw Guide)

### Topic Clusters (Hub-and-Spoke)
After 10+ articles published, build cluster structure:
- **Pillar page**: `/blog/practical-ai-assistants-operators-guide` (3,000-4,000 words, broad coverage)
- **Supporting articles**: 5-10 tool-specific articles linking to pillar
- **Link structure**: All spokes → hub. Hub → all spokes. Spokes cross-link where relevant.
- Category hub pages (`/blog/productivity`, `/blog/crm`) serve as secondary pillar pages.

### Competitive Displacement
Target outdated competitor articles (published 2023-2024):
- Flag articles with stale data during SERP check
- Create "Updated for 2026" version with fresh stats, new tools, better examples
- Google rewards freshness — this is a shortcut to page 1.

### FAQ Schema Optimization
Target Google's featured snippets:
- Research exact question phrasing from Reddit + "People Also Ask"
- Direct answer first (40-60 words), then context
- Minimum 5, maximum 10 FAQs per article
- `FAQPage` JSON-LD schema on every article (in addition to BlogPosting)

### Internal Link Database
Maintain a structured map of all published articles:
- URL, title, main topics, suggested anchor texts
- Every new article checks the database for cross-linking opportunities
- Every existing article gets checked for links to the new one
- Target: 3-5 internal links per article, growing over time.

### Content Repurposing
Each article generates multiple distribution assets:
- **LinkedIn post**: Hook + 5 bullets + CTA (150-300 words)
- **Twitter thread**: 8-10 tweets breaking down key points
- **Email snippet**: Summary + CTA for newsletter
- Automated via Antfarm content-factory workflow.

### Backlink Outreach (Weekly)
- Search for "[topic] resources" and "[topic] statistics" pages
- Identify sites that link out to similar content
- Generate personalized outreach emails (<100 words, specific to their article)
- 10-20 opportunities per week.

---

## Publishing Sequence

1. **Week 1-2:** Productivity (Google Calendar, Gmail, Notion, Slack, Telegram)
2. **Week 2-3:** Roles (solo founders, freelancers, creators)
3. **Week 3-4:** CRM (HubSpot, Salesforce, Pipedrive)
4. **Week 4-5:** Marketing (Mailchimp, Buffer, WordPress)
5. Intersperse 1 thought-leadership piece per ~20 tool articles
6. **Week 5+:** Fill remaining categories

---

## Success Metrics

| Timeframe | Target |
|-----------|--------|
| Week 1 | 5-7 articles published. All validation scores ≥90. System stable. |
| Month 1 | 30 articles published + indexed. Baseline traffic in GSC. Cost tracked. |
| Month 2 | Top performers identified. Multiple page-1 rankings for long-tails. Topic clusters forming. |
| Month 3 | Full coverage (93). Organic > direct. Blog driving signups. Internal link network mature. |

**Cost target:** <$0.30 per article in API calls. <$150/month total.

**Performance benchmarks:**
- Articles ranking page 2-3 within 1 week = good
- Articles ranking page 1-2 within 2 weeks = excellent
- Organic traffic growing 20%+ monthly by month 2

---

*Strategy v4 by Pif, 2026-03-15. Task: dc1a1016. Incorporates OpenClaw SEO Content Automation Guide.*
