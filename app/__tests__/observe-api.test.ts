import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { create: mockCreate };
  }
  return { default: MockAnthropic };
});

import { POST } from '@/app/api/observe/route';

function makeRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost:3000/api/observe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validBody = {
  frame: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  transcript_window: 'User clicked the settings button.',
  seconds_since_last_interjection: 25,
};

describe('/api/observe', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    mockCreate.mockReset();
    process.env = { ...originalEnv, ANTHROPIC_API_KEY: 'test-key-123' };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('missing API key', () => {
    it('returns speak: false when ANTHROPIC_API_KEY is not set', async () => {
      delete process.env.ANTHROPIC_API_KEY;

      const req = makeRequest(validBody) as unknown as Parameters<typeof POST>[0];
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.speak).toBe(false);
      expect(data.message).toBe('');
      expect(data.reason).toBe('');
    });

    it('does not call Anthropic when API key is missing', async () => {
      delete process.env.ANTHROPIC_API_KEY;

      const req = makeRequest(validBody) as unknown as Parameters<typeof POST>[0];
      await POST(req);

      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  describe('successful Claude call', () => {
    it('returns valid ObserveResponse when Claude speaks', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{
          type: 'text',
          text: JSON.stringify({
            speak: true,
            message: 'Why did you toggle the "Dark mode" setting?',
            reason: 'missing_why',
          }),
        }],
      });

      const req = makeRequest(validBody) as unknown as Parameters<typeof POST>[0];
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.speak).toBe(true);
      expect(data.message).toBe('Why did you toggle the "Dark mode" setting?');
      expect(data.reason).toBe('missing_why');
    });

    it('returns valid ObserveResponse when Claude stays silent', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: JSON.stringify({ speak: false, message: '', reason: 'none' }) }],
      });

      const req = makeRequest(validBody) as unknown as Parameters<typeof POST>[0];
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.speak).toBe(false);
      expect(data.message).toBe('');
      expect(data.reason).toBe('none');
    });

    it('passes image and transcript to Claude correctly', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: JSON.stringify({ speak: false, message: '', reason: 'none' }) }],
      });

      const req = makeRequest(validBody) as unknown as Parameters<typeof POST>[0];
      await POST(req);

      expect(mockCreate).toHaveBeenCalledOnce();
      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.model).toBe('claude-sonnet-4-20250514');
      expect(callArgs.messages[0].content[0].type).toBe('image');
      expect(callArgs.messages[0].content[0].source.data).toBe(validBody.frame);
      expect(callArgs.messages[0].content[1].type).toBe('text');
      expect(callArgs.messages[0].content[1].text).toContain(validBody.transcript_window);
    });
  });

  describe('error handling', () => {
    it('returns speak: false on invalid JSON body', async () => {
      const req = new Request('http://localhost:3000/api/observe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json',
      }) as unknown as Parameters<typeof POST>[0];

      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.speak).toBe(false);
    });

    it('returns speak: false when Claude API call fails', async () => {
      mockCreate.mockRejectedValueOnce(new Error('API error'));

      const req = makeRequest(validBody) as unknown as Parameters<typeof POST>[0];
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.speak).toBe(false);
    });

    it('returns speak: false when Claude returns unparseable response', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'not valid json' }],
      });

      const req = makeRequest(validBody) as unknown as Parameters<typeof POST>[0];
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.speak).toBe(false);
    });
  });
});
