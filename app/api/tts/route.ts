import { NextRequest } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';

// Cache the reference audio base64 at module level
let refAudioCache: string | null = null;

function getRefAudio(): string {
  if (!refAudioCache) {
    const filePath = join(process.cwd(), 'public', 'liam-ref.mp3');
    const buffer = readFileSync(filePath);
    refAudioCache = buffer.toString('base64');
  }
  return refAudioCache;
}

interface TTSRequestBody {
  text: string;
}

export async function POST(request: NextRequest): Promise<Response> {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'MISTRAL_API_KEY is not configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  let body: TTSRequestBody;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON body' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  if (!body.text || typeof body.text !== 'string') {
    return new Response(
      JSON.stringify({ error: 'Request body must include a text string' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  try {
    const refAudio = getRefAudio();

    const response = await fetch('https://api.mistral.ai/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'voxtral-mini-tts-2603',
        input: body.text,
        ref_audio: refAudio,
        response_format: 'mp3',
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Voxtral API error:', response.status, errText);
      return new Response(
        JSON.stringify({ error: 'TTS generation failed' }),
        { status: 502, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const data = await response.json();
    const audioBase64 = data.audio_data;

    if (!audioBase64) {
      return new Response(
        JSON.stringify({ error: 'No audio data in response' }),
        { status: 502, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Decode base64 and return raw MP3
    const audioBuffer = Buffer.from(audioBase64, 'base64');
    return new Response(audioBuffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(audioBuffer.length),
      },
    });
  } catch (err) {
    console.error('TTS route error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
