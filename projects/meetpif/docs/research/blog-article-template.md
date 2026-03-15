# Blog Article Page Template — meetpif.com

Reverse-engineered from shopclawmart.com/blog/ai-agent-for-bardeen, adapted to meetpif design system.
Enhanced with Sahil Bloom analysis (2026-03-15): kept programmatic elements, dropped personal newsletter features.

**Implementation status:** LIVE. First article deployed at `/blog/ai-assistant-for-google-calendar`.

---

## Page Layout

```
┌─────────────────────────────────────────────────┐
│  [READING PROGRESS BAR — 3px, accent, fixed]    │ ← sticky, top: 0, z-9999
├─────────────────────────────────────────────────┤
│  BLOG NAV (← ALL POSTS)                         │
├─────────────────────────────────────────────────┤
│                                                 │
│  🟢 AUTHOR BYLINE                               │
│  [Pif avatar 28px] by Pif · March 15, 2026 ·   │
│  10 min read                                    │
│                                                 │
│  H1: ARTICLE TITLE                              │
│  (Inter Tight 700, clamp(28-48px), lp-text)     │
│                                                 │
│  Subtitle (18px, lp-text-secondary, max 600px)  │
│                                                 │
│  ─────────────── divider ───────────────────     │
│                                                 │
│  ┌───────────────────────────────────────────┐  │
│  │ ⚡ CTA CALLOUT BOX                        │  │
│  │ "Want an AI assistant that manages your   │  │
│  │  [X] for you?"  [SEE HOW IT WORKS →]      │  │
│  └───────────────────────────────────────────┘  │
│                                                 │
│  ┌─────────────────────────┐  ┌──────────────┐  │
│  │ ARTICLE BODY            │  │ SIDEBAR CTA  │  │ ← sidebar: fixed, desktop >1100px only
│  │ max-width: 640px        │  │ (220px)      │  │
│  │ blog-rich-content class │  │ Pif logo     │  │
│  │                         │  │ "Get Pif     │  │
│  │ [7 content sections]    │  │  working     │  │
│  │                         │  │  for you"    │  │
│  │                         │  │ [CTA btn]    │  │
│  │                         │  └──────────────┘  │
│  └─────────────────────────┘                    │
│                                                 │
│  CATEGORY TAGS                                  │ ← below article body
│  [google-calendar] [productivity] [scheduling]  │
│                                                 │
│  ─────────────── divider ───────────────────     │
│  AUTHOR CARD                                    │
│  [Pif avatar 44px] Written by Pif               │
│  AI Chief of Staff · running 24/7               │
│                                                 │
│  [← OLDER]                      [NEWER →]       │
│                                                 │
│  ─────────────── divider ───────────────────     │
│  — MORE FROM THE LOG                            │
│  ┌─────┐ ┌─────┐ ┌─────┐                       │
│  │Card │ │Card │ │Card │  (3-col, 1-col mobile) │
│  └─────┘ └─────┘ └─────┘                       │
│                                                 │
└─────────────────────────────────────────────────┘
```

---

## Content Structure (Mandatory Sections)

Every "AI Assistant for [X]" article follows this exact skeleton. No deviation.

### Section 1 — THE GAP (H2)
**Heading:** "Why [Tool] Alone Isn't Enough"
- 300–800 words
- Names 3–5 specific limitations of the tool's native capabilities
- Tone: respectful, factual, no trash-talk
- Ends with the pivot: "This is where an AI assistant changes the equation."

### Section 2 — WHAT THE AI DOES (H2)
**Heading:** "What an AI Assistant Actually Does with [Tool]"
- 800–2,200 words (the meat of the article)
- 3–5 H3 subsections, each a **named capability** (not vague — e.g., "Intelligent Lead Scoring," not "Helps with leads")
- At least 2 subsections include code blocks (Python/JSON/YAML)
- Each capability follows: Scenario → What the AI does → Example output

### Section 3 — ARCHITECTURE (H2)
**Heading:** "How It Connects"
- 300–800 words
- API integration details, webhook setup, config snippets
- At least 1 architecture diagram or config JSON block
- Connection flow: Trigger → AI Processing → Action → Feedback

### Section 4 — REAL WORKFLOW (H2)
**Heading:** "A Real Workflow, End to End"
- 250–900 words
- One complete example: trigger → steps → outcome
- Use **bold labels**: **Trigger:** / **Step 1:** / **Step 2:** / **Result:**
- Concrete, not abstract — real tool actions with real data shapes

### Section 5 — THE MATH (H2)
**Heading:** "The Numbers"
- 200–400 words
- Time saved per week (specific hours)
- Cost comparison: manual vs. automated
- ROI framing: "At $X/mo, this pays for itself in Y days"

### Section 6 — HONEST TRADEOFFS (H2)
**Heading:** "The Honest Tradeoffs"
- 200–400 words
- 3–5 bullet points of real limitations
- Builds credibility — don't hide what doesn't work
- Frame as "things to know," not "reasons not to buy"

### Section 7 — GET STARTED (H2)
**Heading:** "Get Started"
- 200–500 words
- Primary CTA to meetpif.com signup
- Newsletter signup (inline component)
- 3 related article links

---

## Typography Mapping

| Element | Font | Size | Weight | Transform | Spacing | Color |
|---------|------|------|--------|-----------|---------|-------|
| H1 (title) | Inter Tight | 36px | 700 | uppercase | 2.88px | --text-primary |
| H2 (sections) | Inter Tight | 20px | 600 | uppercase | 1.6px | --text-primary |
| H3 (subsections) | Inter Tight | 16px | 600 | title case | — | --text-primary |
| Body | Inter | 14px | 400 | — | — | --text-primary |
| Body large (intro) | Inter | 16px | 400 | — | — | --text-secondary |
| Meta text | Inter | 13px | 400 | — | — | --text-tertiary |
| Code blocks | JetBrains Mono | 14px | 400 | — | — | --text-primary |
| CTA button text | Inter Tight | 12px | 500 | uppercase | 1.2px | --text-inverse |
| Breadcrumb | Inter | 12px | 400 | — | — | --text-tertiary |
| Label/overline | Inter | 11px | 500 | uppercase | 1.65px | --text-muted |

---

## Component Specs

### CTA Callout Box
```css
.cta-callout {
  background: var(--bg-surface-raised);
  border: 1px solid var(--border-default);
  border-radius: 10px;
  padding: 20px;
  box-shadow: var(--shadow-sm);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.cta-callout__text {
  font-family: 'Inter', sans-serif;
  font-size: 14px;
  color: var(--text-secondary);
}
.cta-callout__button {
  font-family: 'Inter Tight', sans-serif;
  font-size: 12px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 1.2px;
  background: var(--accent-primary);
  color: var(--text-inverse);
  border: none;
  border-radius: 4px;
  padding: 12px 24px;
  cursor: pointer;
  white-space: nowrap;
}
.cta-callout__button:hover {
  background: var(--accent-primary-hover);
}
```

### Article Card (prose container)
```css
.article-body {
  max-width: 720px;
  margin: 0 auto;
  background: var(--bg-card);
  border: 1px solid var(--border-default);
  border-radius: 10px;
  padding: 32px;
}
.article-body h2 {
  font-family: 'Inter Tight', sans-serif;
  font-size: 20px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 1.6px;
  color: var(--text-primary);
  margin-top: 48px;
  margin-bottom: 16px;
}
.article-body h3 {
  font-family: 'Inter Tight', sans-serif;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin-top: 32px;
  margin-bottom: 12px;
}
.article-body p {
  font-family: 'Inter', sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: var(--text-primary);
  margin-bottom: 16px;
}
.article-body a {
  color: var(--accent-primary);
  text-decoration: underline;
}
.article-body a:hover {
  color: var(--accent-primary-hover);
}
```

### Code Block
```css
.code-block {
  background: var(--bg-surface-sunken);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  padding: 16px;
  overflow-x: auto;
  margin: 16px 0;
}
.code-block code {
  font-family: 'JetBrains Mono', monospace;
  font-size: 14px;
  line-height: 1.5;
  color: var(--text-primary);
}
```

### Inline Newsletter Capture
```css
.newsletter-capture {
  background: var(--bg-surface-raised);
  border: 1px solid var(--accent-primary-muted);
  border-radius: 10px;
  padding: 24px;
  margin: 32px 0;
  text-align: center;
}
.newsletter-capture__title {
  font-family: 'Inter Tight', sans-serif;
  font-size: 16px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 1.6px;
  color: var(--text-primary);
  margin-bottom: 8px;
}
.newsletter-capture__subtitle {
  font-family: 'Inter', sans-serif;
  font-size: 14px;
  color: var(--text-secondary);
  margin-bottom: 16px;
}
.newsletter-capture__input {
  background: var(--bg-surface);
  border: 1px solid var(--border-default);
  border-radius: 6px;
  padding: 8px 12px;
  color: var(--text-primary);
  font-family: 'Inter', sans-serif;
  font-size: 14px;
  width: 260px;
}
```

### Related Article Card
```css
.related-card {
  background: var(--bg-card);
  border: 1px solid var(--border-default);
  border-radius: 10px;
  padding: 20px;
  transition: border-color var(--duration-fast);
}
.related-card:hover {
  border-color: var(--border-strong);
}
.related-card__date {
  font-family: 'Inter', sans-serif;
  font-size: 12px;
  color: var(--text-tertiary);
  margin-bottom: 8px;
}
.related-card__title {
  font-family: 'Inter Tight', sans-serif;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 8px;
}
.related-card__excerpt {
  font-family: 'Inter', sans-serif;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
}
```

---

## Schema Markup (JSON-LD)

Every article page must include both:

### BlogPosting
```json
{
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  "headline": "{article_title}",
  "description": "{article_subtitle}",
  "author": {
    "@type": "Organization",
    "name": "Pif",
    "url": "https://meetpif.com"
  },
  "publisher": {
    "@type": "Organization",
    "name": "meetpif",
    "url": "https://meetpif.com",
    "logo": {
      "@type": "ImageObject",
      "url": "https://meetpif.com/logo.png"
    }
  },
  "datePublished": "{iso_date}",
  "dateModified": "{iso_date}",
  "mainEntityOfPage": "https://meetpif.com/blog/{slug}",
  "image": "https://meetpif.com/blog/{slug}/og.png",
  "wordCount": "{word_count}",
  "timeRequired": "PT{read_time}M"
}
```

### BreadcrumbList
```json
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://meetpif.com" },
    { "@type": "ListItem", "position": 2, "name": "Blog", "item": "https://meetpif.com/blog" },
    { "@type": "ListItem", "position": 3, "name": "{article_title}", "item": "https://meetpif.com/blog/{slug}" }
  ]
}
```

---

## Meta Tags (per article)

```html
<title>{Article Title} | Pif Blog</title>
<meta name="description" content="{subtitle — max 155 chars}">
<meta name="author" content="Pif">
<link rel="canonical" href="https://meetpif.com/blog/{slug}">

<!-- Open Graph -->
<meta property="og:type" content="article">
<meta property="og:title" content="{article_title}">
<meta property="og:description" content="{subtitle}">
<meta property="og:image" content="https://meetpif.com/blog/{slug}/og.png">
<meta property="og:url" content="https://meetpif.com/blog/{slug}">
<meta property="article:published_time" content="{iso_date}">
<meta property="article:author" content="Pif">

<!-- Twitter -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{article_title}">
<meta name="twitter:description" content="{subtitle}">
<meta name="twitter:image" content="https://meetpif.com/blog/{slug}/og.png">
```

---

## Target Metrics per Article

- **Word count:** 3,000–4,500 words
- **Read time:** 8–12 minutes
- **Code blocks:** 3–6 per article
- **Internal links:** 3–5 (to other blog posts + product pages)
- **External links:** 2–3 (to tool docs, builds E-E-A-T)
- **CTAs:** 3 per article (callout box top, newsletter mid, get started bottom)

---

## Differences from Claw Mart Template

| Claw Mart | meetpif |
|-----------|---------|
| Light theme (bg-sand-50) | Dark-first (bg-page #000) |
| Display serif headings | Inter Tight ALL CAPS headings |
| Rounded-3xl corners | 10px radius (our card standard) |
| "Copy as Markdown" button | Not needed (we're not an agent marketplace) |
| 3 product cards with pricing | Single CTA to meetpif signup |
| Anonymous author | Authored by Pif with avatar byline |
| tide-600 link color | accent-primary (#D8FF66) links |
| Clawsourcing upsell | Link to `/custom` pricing page |
| No progress indicator | 3px reading progress bar (accent, sticky) |
| No sidebar | Sticky sidebar CTA on desktop (>1100px) |
| No category tags | Topic tags below article for clustering |
| Static related articles | Related posts grid (3-col, responsive) |

## Sahil Bloom Decisions (2026-03-15)

Evaluated 6 template differences against Sahil Bloom's newsletter page. Filter: does it scale programmatically across 93 articles?

| Feature | Decision | Reason |
|---------|----------|--------|
| Author byline at top | ✅ ADOPTED | Same component everywhere, builds E-E-A-T |
| Sticky progress bar | ✅ ADOPTED | Pure UI, improves dwell time signal |
| Styled blockquotes | ✅ ADOPTED | CSS-only, same use in every article |
| Category tags | ✅ ADOPTED | Powers hub-and-spoke SEO architecture |
| Narrative opening hook | ❌ DROPPED | Requires unique creative writing per article |
| P.S. section | ❌ DROPPED | Personal newsletter feature, sidebar CTA covers same goal |
