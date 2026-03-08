# PRD: Onboarding Chat UI Component

## Introduction

Build the reusable chat UI component that powers the new conversational onboarding experience. The current onboarding is a generic 4-step form wizard (`OnboardingPage.tsx`). The new design replaces it with a chat-style interface where Pif (the assistant) introduces itself, asks questions, and guides the user through setup via sequential chat messages.

This PRD covers the **foundational component only** — the chat renderer, message types, typing indicator, and sequential message reveal. The actual step content (what Pif says) is covered in a separate PRD.

## Goals

- Create an `OnboardingChat` component that renders messages in a chat bubble layout
- Support all message types needed by the onboarding flow: text, options, input fields, progress indicators, action buttons
- Implement typing indicator with configurable delay between messages
- Messages appear sequentially (not all at once) with natural timing
- Responsive: works on mobile (min 375px) through desktop
- Uses existing landing page CSS variables — same warm sand feel

## Context

**Working directory:** `/opt/assistant-platform/mc/`

**Existing code to reference:**
- `src/pages/OnboardingPage.tsx` — current form wizard (will be replaced in a later PRD)
- `src/pages/LoginPage.tsx` — has the meetpif theme variables, ghost button styles, Pif logo usage
- CSS variables: `--lp-bg`, `--lp-accent`, `--lp-text`, `--lp-text-secondary`, `--lp-text-tertiary`, `--lp-divider`, `--lp-font-body`, `--lp-font-display`, `--lp-space-element`, `--lp-space-tight`, `--lp-space-page-x`
- Ghost button class: `lp-ghost-btn`
- Pif logo: already used in `LoginPage.tsx` — the SVG eyes that peek from the bottom

**Design spec:** `/root/projects/rif/docs/onboarding-spec.md` — see "Step-by-Step Design" and "Animation & Micro-interactions" sections.

## User Stories

### US-001: Chat message container and layout

**Description:** Create the outer chat container component that holds messages in a vertically scrolling layout, left-aligned with an avatar.

**Acceptance Criteria:**
- [ ] Create `src/components/OnboardingChat.tsx`
- [ ] Container is a vertical flex column with messages aligned to the left
- [ ] Messages scroll naturally — newest message is always visible (auto-scroll to bottom on new message)
- [ ] Max width 600px, centered horizontally, with `var(--lp-space-page-x)` padding
- [ ] Background: `var(--lp-bg)`
- [ ] Typecheck passes

### US-002: Pif avatar for chat messages

**Description:** Each message group from Pif shows a small circular avatar to the left of the chat bubbles.

**Acceptance Criteria:**
- [ ] Avatar is a 36px circle with the Pif logo (the eyes SVG from LoginPage.tsx)
- [ ] Avatar appears once per message group (not repeated for consecutive messages from Pif)
- [ ] Avatar is top-aligned with the first message in the group
- [ ] On mobile (<640px), avatar shrinks to 28px
- [ ] Typecheck passes

### US-003: Text message type

**Description:** The most basic message type — a text bubble with Pif's words.

**Acceptance Criteria:**
- [ ] Text messages render in a bubble with subtle background differentiation (slightly lighter/darker than `--lp-bg`)
- [ ] Font: `var(--lp-font-body)`, size 15px, line-height 1.6, color `var(--lp-text)`
- [ ] Bubbles have 16px horizontal padding, 12px vertical padding, 8px border-radius
- [ ] Max width 85% of container (messages don't stretch full width)
- [ ] Supports inline bold, links (styled with `var(--lp-accent)`)
- [ ] Typecheck passes

### US-004: Typing indicator

**Description:** Before a message appears, show a typing indicator (three animated dots) to create the feeling that Pif is composing a response.

**Acceptance Criteria:**
- [ ] Typing indicator shows three dots that animate with a staggered bounce/pulse
- [ ] Indicator appears in the same position where the next message will render
- [ ] Has the same avatar treatment as a regular message
- [ ] Configurable delay per message via a `delay` prop (default 800ms)
- [ ] After the delay, the typing indicator fades out and the actual message fades in
- [ ] Typecheck passes

### US-005: Sequential message reveal

**Description:** Messages don't all appear at once. They render one by one with typing indicators between them, creating a natural conversation feel.

**Acceptance Criteria:**
- [ ] The `OnboardingChat` component accepts an array of message objects
- [ ] Messages render sequentially — message N+1 only appears after message N is fully visible
- [ ] Each message has an optional `delay` (time before this message starts appearing, after the previous one is done)
- [ ] The sequence stops at the first message that has an interactive element (options, input, button) — this is the "current prompt"
- [ ] New messages can be appended to the array (when the user completes a step, new messages animate in)
- [ ] Auto-scrolls to keep the latest message visible
- [ ] Typecheck passes

### US-006: Options message type (radio/selection)

**Description:** A message that presents choices for the user to pick from (e.g., "Keep Pif" vs "Call me something else").

**Acceptance Criteria:**
- [ ] Renders as a set of radio-style options below the preceding text message
- [ ] Each option has a label and optional "(recommended)" suffix
- [ ] Selected option is highlighted with `var(--lp-accent)` border/indicator
- [ ] One option can be pre-selected (default choice)
- [ ] Selecting an option calls an `onSelect(value)` callback
- [ ] Options can optionally reveal a child element (e.g., selecting "something else" reveals a text input)
- [ ] Styled consistently with `lp-ghost-btn` patterns (border-based, no heavy fills)
- [ ] Typecheck passes

### US-007: Input message type

**Description:** A message that contains a text input field for the user to fill in (e.g., timezone, LinkedIn URL, custom name).

**Acceptance Criteria:**
- [ ] Renders a text input using the existing `onboarding-input` styles
- [ ] Supports `placeholder`, `optional` label, `maxLength`, and input `type` (text, url)
- [ ] Optional fields show "(optional)" in the placeholder or as a subtle label
- [ ] Input change calls an `onChange(value)` callback
- [ ] Can render as a dropdown/select when `type: 'select'` (for timezone)
- [ ] Can render time inputs when `type: 'time'` (for quiet hours — two side-by-side fields)
- [ ] Typecheck passes

### US-008: Action button message type

**Description:** A prominent call-to-action button within the chat (e.g., "Let's go", "Connect Google Workspace", "Open Telegram").

**Acceptance Criteria:**
- [ ] Renders as a full-width or centered `lp-ghost-btn` with optional accent styling
- [ ] Supports `primary` variant (accent border + color) and `secondary` variant (default ghost)
- [ ] Supports `disabled` state with 0.5 opacity and not-allowed cursor
- [ ] Supports loading state (text changes, e.g., "Connecting..." with disabled)
- [ ] Click calls an `onClick` callback
- [ ] Typecheck passes

### US-009: Progress bar component

**Description:** A step progress indicator that appears from Step 2 onwards, showing how far the user is in onboarding.

**Acceptance Criteria:**
- [ ] Horizontal row of small dots (one per step)
- [ ] Current step dot uses `var(--lp-accent)`, completed steps use `var(--lp-text-secondary)`, future steps use `var(--lp-divider)`
- [ ] Positioned at the top of the chat container, fixed (doesn't scroll with messages)
- [ ] Hidden on Step 1 (Welcome) — appears starting Step 2
- [ ] Step count and current step are configurable via props
- [ ] Transition: dot color changes animate over 200ms
- [ ] Typecheck passes

### US-010: Navigation buttons (Back / Next)

**Description:** A button row at the bottom of the chat for advancing or going back. These appear below the current interactive element.

**Acceptance Criteria:**
- [ ] Renders a flex row with optional "Back" (left) and "Next" (right) buttons
- [ ] "Next" button is accent-styled when the current step's required fields are filled
- [ ] "Next" button is disabled (greyed) when required fields are empty
- [ ] "Back" button is always enabled (plain ghost style)
- [ ] Button row sticks to the bottom of the viewport (not scrolled away)
- [ ] On mobile, buttons are full-width stacked
- [ ] Typecheck passes

### US-011: Message type definitions

**Description:** Define the TypeScript types for all message variants so the rest of the onboarding can be built type-safely.

**Acceptance Criteria:**
- [ ] Create `src/types/onboarding.ts` (or add to existing types file)
- [ ] Define `ChatMessage` union type covering: `text`, `options`, `input`, `action-button`, `progress`
- [ ] Each variant includes: `id` (string), `type`, `delay` (optional number), and type-specific fields
- [ ] Define `OnboardingState` type with the full state machine: `welcome | naming | personality | google_workspace | google_workspace_connecting | google_workspace_done | telegram_deeplink | telegram_waiting | telegram_connected | submitting | provisioning | provisioned | first_task | complete`
- [ ] Define `OnboardingData` interface for all collected user data (assistantName, timezone, quietHoursStart, quietHoursEnd, allowedUsers, linkedinUrl, etc.)
- [ ] Export all types
- [ ] Typecheck passes

## Non-Goals

- This PRD does NOT implement the actual onboarding steps/content — just the chat UI primitives
- This PRD does NOT modify the existing `OnboardingPage.tsx` — that happens in PRD 2
- This PRD does NOT add any API endpoints
- No real AI responses — this is a scripted chat UI

## Technical Notes

- All styling should use CSS-in-JS (inline styles or `<style>` blocks) matching the pattern in `OnboardingPage.tsx` and `LoginPage.tsx` — this project doesn't use Tailwind or CSS modules
- Use existing CSS variables from the landing page theme — don't introduce new design tokens
- The component should be pure React (hooks, no external state management)
- Animations use CSS transitions/keyframes — no animation libraries needed
