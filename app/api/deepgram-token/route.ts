export async function GET(): Promise<Response> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'DEEPGRAM_API_KEY is not configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Generate a short-lived temporary key via Deepgram API
  // The temp key only needs to be valid during the WebSocket handshake
  try {
    const res = await fetch('https://api.deepgram.com/v1/keys/temporary', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        time_to_live_in_seconds: 30,
      }),
    });

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
      JSON.stringify({ key: data.api_key }),
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
