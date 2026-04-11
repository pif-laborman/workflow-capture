import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { FINALIZE_SYSTEM_PROMPT } from '@/lib/prompts/finalize';
import { selectKeyframes } from '@/lib/keyframes';
import type { SessionEvent } from '@/lib/types';

interface FinalizeRequestBody {
  events: SessionEvent[];
  workflow_name: string;
}

export async function POST(request: NextRequest): Promise<Response> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'ANTHROPIC_API_KEY is not configured. Please set it in your environment variables.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  let body: FinalizeRequestBody;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON body' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  if (!Array.isArray(body.events) || body.events.length === 0) {
    return new Response(
      JSON.stringify({ error: 'Request body must include a non-empty events array' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  if (!body.workflow_name || typeof body.workflow_name !== 'string') {
    return new Response(
      JSON.stringify({ error: 'Request body must include a workflow_name string' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Select keyframes to reduce token usage
  const reducedEvents = selectKeyframes(body.events);

  const client = new Anthropic({ apiKey });

  const eventLogText = JSON.stringify(reducedEvents, null, 2);

  const stream = client.messages.stream({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: FINALIZE_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Workflow name: ${body.workflow_name}\n\nEvent log:\n${eventLogText}`,
      },
    ],
  });

  // Stream text deltas back to the client as they arrive
  const encoder = new TextEncoder();
  const readableStream = new ReadableStream({
    async start(controller) {
      try {
        stream.on('text', (text) => {
          controller.enqueue(encoder.encode(text));
        });
        await stream.finalMessage();
        controller.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        controller.enqueue(encoder.encode(JSON.stringify({ error: message })));
        controller.close();
      }
    },
  });

  return new Response(readableStream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Transfer-Encoding': 'chunked',
    },
  });
}
