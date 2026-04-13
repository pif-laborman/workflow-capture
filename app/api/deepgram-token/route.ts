export async function GET(): Promise<Response> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'DEEPGRAM_API_KEY is not configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  return new Response(
    JSON.stringify({ key: apiKey }),
    { headers: { 'Content-Type': 'application/json' } },
  );
}
