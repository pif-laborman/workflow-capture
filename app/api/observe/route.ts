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

  // Build image content: previous frames (older) + current frame (newest)
  const imageContent: Anthropic.ImageBlockParam[] = [];

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

  // Build context text
  const contextParts: string[] = [];

  if (body.transcript_window) {
    contextParts.push(`Current transcript (last 2 minutes):\n${body.transcript_window}`);
  } else {
    contextParts.push('Current transcript: (empty, user has not spoken yet)');
  }

  if (body.seconds_silent !== undefined && body.seconds_silent > 5) {
    contextParts.push(`\nNOTE: The user has been SILENT for ${body.seconds_silent} seconds while the screen has been active. Consider asking what they are doing.`);
  }

  if (body.previous_interjections?.length) {
    contextParts.push(`\nYour previous questions this session (DO NOT repeat these):\n${body.previous_interjections.map((q, i) => `${i + 1}. ${q}`).join('\n')}`);
  }

  if (body.previous_frames?.length) {
    contextParts.push(`\nYou are seeing ${body.previous_frames.length + 1} screenshots in chronological order. The FIRST image is what the screen looked like when the user stopped talking. The LAST image is the current screen. Compare them to understand what happened during the silence.`);
  }

  if (body.user_asked_directly) {
    contextParts.push(`\nIMPORTANT: The user just asked YOU a direct question. Read the end of the transcript carefully and RESPOND to their question. You MUST set speak: true and answer what they asked. Do not analyze the screen; respond to the user conversationally.`);
  }

  // Call Claude Sonnet
  const client = new Anthropic({ apiKey });

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
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

    // Extract text content from response
    const textBlock = response.content.find((block) => block.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json(SILENT_RESPONSE);
    }

    // Parse JSON from Claude's response (strip markdown code blocks if present)
    let jsonStr = textBlock.text.trim();
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
