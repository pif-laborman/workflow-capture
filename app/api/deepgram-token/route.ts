const DEEPGRAM_PROJECT_ID = process.env.DEEPGRAM_PROJECT_ID || 'ae73a44f-cac9-40af-9c43-5bb9a9a6019b';

export async function GET(): Promise<Response> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'DEEPGRAM_API_KEY is not configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Generate a short-lived temporary key (30s TTL, only valid for WS handshake)
  try {
    const res = await fetch(
      `https://api.deepgram.com/v1/projects/${DEEPGRAM_PROJECT_ID}/keys`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Token ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          comment: 'workflow-capture-session',
          scopes: ['usage:write'],
          time_to_live_in_seconds: 30,
        }),
      },
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error('Deepgram temp key error:', res.status, errText);
      return new Response(
        JSON.stringify({ error: 'Failed to generate temporary key' }),
        { status: 502, headers: { 'Content-Type': 'application/json' } },
      );
    }

    const data = await res.json();
    return new Response(
      JSON.stringify({ key: data.key }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('Deepgram temp key request failed:', err);
    return new Response(
      JSON.stringify({ error: 'Failed to generate temporary key' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
