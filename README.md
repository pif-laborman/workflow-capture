# Workflow Capture

A browser-based tool that captures business workflows through screen recording and voice narration. An AI interviewer (Claude) watches your screen, listens to your explanation, and asks structured follow-up questions in real time, then produces a step-by-step process breakdown with a visual map.

**Live demo:** https://workflow-capture.vercel.app

## How it works

1. Share your screen and start narrating a workflow
2. Claude watches the screen, listens, and asks up to 10 structured questions
3. Questions follow a natural arc: scoping first, then step-level detail, then synthesis
4. At the end you get an editable process breakdown with drag-and-drop reordering and a generated process map

## Stack

| Layer | Service | Role |
|-------|---------|------|
| Speech-to-text | Deepgram Nova-2 | WebSocket streaming transcription |
| Observer | Claude Haiku 4.5 | Vision + text analysis, question generation |
| Text-to-speech | ElevenLabs Flash v2.5 | Primary voice output |
| TTS fallback | Mistral Voxtral | Backup when ElevenLabs is unavailable |
| Framework | Next.js 14 + TypeScript | App and API routes |

## Quick start

```bash
git clone https://github.com/pif-laborman/workflow-capture.git
cd workflow-capture
npm install
cp .env.example .env    # fill in your API keys
npm run dev
```

Open http://localhost:3000 in Chrome (screen capture requires a Chromium browser).

## Environment variables

Copy `.env.example` to `.env` and fill in your keys:

| Variable | Required | Where to get it |
|----------|----------|----------------|
| `ANTHROPIC_API_KEY` | Yes | [console.anthropic.com](https://console.anthropic.com) |
| `DEEPGRAM_API_KEY` | Yes | [console.deepgram.com](https://console.deepgram.com) |
| `ELEVENLABS_API_KEY` | Yes | [elevenlabs.io/app/settings](https://elevenlabs.io/app/settings) |
| `MISTRAL_API_KEY` | No | [console.mistral.ai](https://console.mistral.ai) (TTS fallback) |

Without `ANTHROPIC_API_KEY`, the observer returns silent responses. Without `ELEVENLABS_API_KEY` and `MISTRAL_API_KEY`, voice output is disabled.

## Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/pif-laborman/workflow-capture&env=ANTHROPIC_API_KEY,DEEPGRAM_API_KEY,ELEVENLABS_API_KEY,MISTRAL_API_KEY)

Add your API keys during the Vercel setup prompt. The app works immediately after deploy.

## Architecture

```
Browser
  ├── getDisplayMedia → frame sampler (1 fps, JPEG)
  ├── getUserMedia → Deepgram WebSocket → live transcript
  └── Observe loop (3 trigger modes):
        1. User asks a question → 300ms debounce
        2. User replies to Claude → 1.5s debounce
        3. Silence detected → configurable threshold (default 4s)
              ↓
API routes (Next.js /api):
  /api/deepgram-token  → returns Deepgram key for client WS auth
  /api/observe         → sends transcript + screen frame to Claude Haiku
  /api/tts             → ElevenLabs (primary) or Voxtral (fallback)
  /api/finalize        → generates structured process breakdown
  /api/generate-map    → creates visual process map from steps
```

The observer streams Claude's response and parses JSON early (as soon as the closing `}` arrives) to minimize latency. If `speak: false`, the stream is aborted immediately.

## Customizing the interviewer

The system prompt lives in `lib/prompts/observe.ts`. It defines:

- Interview phases (scoping → step mapping → synthesis)
- Question budget (10 questions per session)
- What to capture per step (trigger, inputs, decisions, tools, timing, pain points)
- Pacing rules (patient, one question at a time, comfortable with silence)

Edit this file to change the interview style, question count, or mapping schema.

## Cost notes

- **Deepgram:** ~$0.0043/min (Nova-2 pay-as-you-go)
- **Claude Haiku:** ~$0.001 per observe call (small context, 128 max tokens)
- **ElevenLabs:** credit-based; burns faster with frequent proactive questions
- **Voxtral:** ~$0.01 per request (fallback only)

A typical 10-minute session runs roughly 20-30 observe calls. Total cost per session is well under $1.

## License

MIT
