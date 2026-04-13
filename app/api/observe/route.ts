import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { OBSERVE_SYSTEM_PROMPT } from '@/lib/prompts/observe';
import type { ObserveRequest, ObserveResponse } from '@/lib/types';

const SILENT_RESPONSE: ObserveResponse = {
  speak: false,
  message: '',
  reason: '',
};

export async function POST(request: NextRequest): Promise<NextResponse<ObserveResponse>> {
  // Graceful fallback: no API key -> silent
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

  // Skip images entirely for direct questions (text-only is much faster)
  const skipImages = !!body.user_asked_directly;

  const imageContent: Anthropic.ImageBlockParam[] = [];
  if (!skipImages) {
    // Add previous frames for context (so Claude can see screen changes)
    if (body.previous_frames?.length) {
      for (const prevFrame of body.previous_frames) {
        imageContent.push({
          type: 'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: prevFrame },
        });
      }
    }

    // Add current (latest) frame
    imageContent.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: body.frame },
    });
  }

  // Build context text
  const contextParts: string[] = [];

  if (body.transcript_window) {
    contextParts.push(`Conversation log (last 2 minutes). Lines prefixed [USER] are narration, [CLAUDE] are your previous questions:\n${body.transcript_window}`);
  } else {
    contextParts.push('Conversation log: (empty, user has not spoken yet)');
  }

  if (body.seconds_silent !== undefined && body.seconds_silent > 10) {
    contextParts.push(`\nNOTE: The user has been silent for ${body.seconds_silent} seconds. They may be waiting for you to ask a question about what's on screen.`);
  }

  if (body.previous_interjections?.length) {
    contextParts.push(`\nYour previous questions this session (DO NOT repeat these):\n${body.previous_interjections.map((q, i) => `${i + 1}. ${q}`).join('\n')}`);
  }

  if (body.previous_frames?.length) {
    contextParts.push(`\nYou are seeing ${body.previous_frames.length + 1} screenshots in chronological order. The FIRST image is what the screen looked like when the user stopped talking. The LAST image is the current screen. Compare them to understand what happened during the silence.`);
  }

  if (body.user_asked_directly) {
    contextParts.push(`\nIMPORTANT: The user just asked YOU a direct question or is addressing you. Read the end of the transcript carefully and RESPOND. You MUST set speak: true. If they are greeting you or asking if you are ready, respond warmly and briefly (e.g. "I'm here, go ahead and start whenever you're ready"). If they ask a question, answer it conversationally.`);
  }

  // Call Claude Sonnet
  const client = new Anthropic({ apiKey });

  try {
    // Use streaming to parse JSON as soon as it's complete (saves ~0.5-1s
    // vs waiting for the full response including stop_reason)
    let accumulated = '';
    let earlyResult: ObserveResponse | null = null;

    const stream = client.messages.stream({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      system: body.system_prompt || OBSERVE_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            ...imageContent,
            { type: 'text', text: contextParts.join('') },
          ],
        },
      ],
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        accumulated += event.delta.text;

        // Try to parse early: check if we have a complete JSON object
        // This lets us return as soon as the closing } arrives,
        // without waiting for Claude to finish generating (stop token)
        if (!earlyResult && accumulated.includes('}')) {
          try {
            let jsonStr = accumulated.trim();
            const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (codeBlockMatch) {
              jsonStr = codeBlockMatch[1].trim();
            }
            const parsed = JSON.parse(jsonStr) as ObserveResponse;
            earlyResult = {
              speak: !!parsed.speak,
              message: parsed.message || '',
              reason: parsed.reason || '',
            };
            // If speak is false, return immediately (no need to wait)
            if (!earlyResult.speak) {
              stream.abort();
              return NextResponse.json(earlyResult);
            }
            // If speak is true and we have a message, return immediately
            if (earlyResult.message) {
              stream.abort();
              return NextResponse.json(earlyResult);
            }
          } catch {
            // JSON not complete yet, keep accumulating
          }
        }
      }
    }

    // Fallback: parse whatever we accumulated
    if (earlyResult) {
      return NextResponse.json(earlyResult);
    }

    if (!accumulated.trim()) {
      return NextResponse.json(SILENT_RESPONSE);
    }

    let jsonStr = accumulated.trim();
    const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonStr = codeBlockMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr) as ObserveResponse;

    return NextResponse.json({
      speak: !!parsed.speak,
      message: parsed.message || '',
      reason: parsed.reason || '',
    });
  } catch (err) {
    console.error('Observe API error:', err);
    return NextResponse.json(SILENT_RESPONSE);
  }
}
