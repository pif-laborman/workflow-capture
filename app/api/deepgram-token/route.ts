export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';

const DEEPGRAM_PROJECT_ID = process.env.DEEPGRAM_PROJECT_ID || 'ae73a44f-cac9-40af-9c43-5bb9a9a6019b';

const NO_CACHE_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'Pragma': 'no-cache',
};

export async function GET(): Promise<Response> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'DEEPGRAM_API_KEY is not configured' }),
      { status: 500, headers: NO_CACHE_HEADERS },
    );
  }

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
          scopes: ['member'],
          time_to_live_in_seconds: 60,
        }),
        cache: 'no-store',
      },
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error('Deepgram temp key error:', res.status, errText);
      return new Response(
        JSON.stringify({ error: 'Failed to generate temporary key' }),
        { status: 502, headers: NO_CACHE_HEADERS },
      );
    }

    const data = await res.json();
    return new Response(
      JSON.stringify({ key: data.key }),
      { headers: NO_CACHE_HEADERS },
    );
  } catch (err) {
    console.error('Deepgram temp key request failed:', err);
    return new Response(
      JSON.stringify({ error: 'Failed to generate temporary key' }),
      { status: 500, headers: NO_CACHE_HEADERS },
    );
  }
}
