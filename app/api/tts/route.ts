import { NextRequest } from 'next/server';

const ELEVENLABS_VOICE_ID = 'TX3LPaxmHKxFdv7VOQHJ'; // Liam

interface TTSRequestBody {
  text: string;
}

export async function POST(request: NextRequest): Promise<Response> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'ELEVENLABS_API_KEY is not configured' }),
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
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: body.text,
          model_id: 'eleven_flash_v2_5',
        }),
      },
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error('ElevenLabs API error:', response.status, errText);
      return new Response(
        JSON.stringify({ error: 'TTS generation failed', status: response.status, detail: errText.slice(0, 200) }),
        { status: 502, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // ElevenLabs returns raw audio directly (no base64 wrapping)
    const audioBuffer = await response.arrayBuffer();
    return new Response(audioBuffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(audioBuffer.byteLength),
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
