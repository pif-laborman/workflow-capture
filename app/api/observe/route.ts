import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { COOLDOWN_MS } from '@/lib/constants';
import { OBSERVE_SYSTEM_PROMPT } from '@/lib/prompts/observe';
import { getLastInterjectionTimestamp, setLastInterjectionTimestamp } from '@/lib/cooldown';
import type { ObserveRequest, ObserveResponse } from '@/lib/types';

const SILENT_RESPONSE: ObserveResponse = {
  speak: false,
  message: '',
  reason: '',
};

export async function POST(request: NextRequest): Promise<NextResponse<ObserveResponse>> {
  // Graceful fallback: no API key → silent
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(SILENT_RESPONSE);
  }

  let body: ObserveRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { speak: false, message: '', reason: 'invalid_request' },
      { status: 400 },
    );
  }

  // Server-side cooldown check
  const now = Date.now();
  const lastTs = getLastInterjectionTimestamp();
  const msSinceLastInterjection = now - lastTs;
  if (lastTs > 0 && msSinceLastInterjection < COOLDOWN_MS) {
    return NextResponse.json({ speak: false, message: '', reason: 'cooldown' });
  }

  // Also respect client-reported cooldown
  if (body.seconds_since_last_interjection < COOLDOWN_MS / 1000) {
    return NextResponse.json({ speak: false, message: '', reason: 'cooldown' });
  }

  // Call Claude Sonnet
  const client = new Anthropic({ apiKey });

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 256,
      system: OBSERVE_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: body.frame,
              },
            },
            {
              type: 'text',
              text: `Current transcript:\n${body.transcript_window}`,
            },
          ],
        },
      ],
    });

    // Extract text content from response
    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json(SILENT_RESPONSE);
    }

    // Parse JSON from Claude's response
    const parsed = JSON.parse(textBlock.text) as ObserveResponse;

    // Update cooldown if Claude decided to speak
    if (parsed.speak) {
      setLastInterjectionTimestamp(Date.now());
    }

    return NextResponse.json({
      speak: !!parsed.speak,
      message: parsed.message || '',
      reason: parsed.reason || '',
    });
  } catch {
    // On any API or parse error, fail silently
    return NextResponse.json(SILENT_RESPONSE);
  }
}
