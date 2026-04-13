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
  // Try ElevenLabs first, fall back to Voxtral
  const elevenLabsKey = process.env.ELEVENLABS_API_KEY;
  const mistralKey = process.env.MISTRAL_API_KEY;

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

  // Try ElevenLabs
  if (elevenLabsKey) {
    try {
      const res = await fetch(
        'https://api.elevenlabs.io/v1/text-to-speech/TX3LPaxmHKxFdv7VOQHJ',
        {
          method: 'POST',
          headers: {
            'xi-api-key': elevenLabsKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text: body.text,
            model_id: 'eleven_flash_v2_5',
          }),
        },
      );

      if (res.ok) {
        const audioBuffer = await res.arrayBuffer();
        return new Response(audioBuffer, {
          headers: {
            'Content-Type': 'audio/mpeg',
            'Content-Length': String(audioBuffer.byteLength),
          },
        });
      }
      // ElevenLabs failed (quota, rate limit, etc.) - fall through to Voxtral
      const errText = await res.text();
      console.warn('ElevenLabs failed, falling back to Voxtral:', res.status, errText.slice(0, 100));
    } catch (err) {
      console.warn('ElevenLabs error, falling back to Voxtral:', err);
    }
  }

  // Voxtral fallback
  if (!mistralKey) {
    return new Response(
      JSON.stringify({ error: 'No TTS provider configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  try {
    const refAudio = getRefAudio();

    const response = await fetch('https://api.mistral.ai/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${mistralKey}`,
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
        JSON.stringify({ error: 'TTS generation failed', detail: errText.slice(0, 200) }),
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
