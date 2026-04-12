import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { COOLDOWN_MS } from '@/lib/constants';

const mockCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { create: mockCreate };
  }
  return { default: MockAnthropic };
});

import { POST } from '@/app/api/observe/route';
import { resetCooldown, getLastInterjectionTimestamp } from '@/lib/cooldown';

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
    resetCooldown();
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

  describe('cooldown enforcement', () => {
    it('returns cooldown when client reports seconds_since_last_interjection < 20', async () => {
      const body = { ...validBody, seconds_since_last_interjection: 10 };
      const req = makeRequest(body) as unknown as Parameters<typeof POST>[0];
      const res = await POST(req);
      const data = await res.json();

      expect(data.speak).toBe(false);
      expect(data.reason).toBe('cooldown');
    });

    it('enforces server-side cooldown after an interjection', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: JSON.stringify({ speak: true, message: 'Why did you click that?', reason: 'missing_why' }) }],
      });

      const req1 = makeRequest(validBody) as unknown as Parameters<typeof POST>[0];
      const res1 = await POST(req1);
      const data1 = await res1.json();
      expect(data1.speak).toBe(true);

      // Second call immediately: should be cooldown
      const req2 = makeRequest(validBody) as unknown as Parameters<typeof POST>[0];
      const res2 = await POST(req2);
      const data2 = await res2.json();
      expect(data2.speak).toBe(false);
      expect(data2.reason).toBe('cooldown');
    });

    it('allows interjection after cooldown expires', async () => {
      // First call: Claude speaks
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: JSON.stringify({ speak: true, message: 'Question?', reason: 'missing_why' }) }],
      });

      const req1 = makeRequest(validBody) as unknown as Parameters<typeof POST>[0];
      await POST(req1);

      // Advance time past cooldown
      const realDateNow = Date.now;
      const frozenNow = realDateNow();
      vi.spyOn(Date, 'now').mockReturnValue(frozenNow + COOLDOWN_MS + 1000);

      // Second call: Claude speaks again
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: JSON.stringify({ speak: true, message: 'Another question?', reason: 'contradiction' }) }],
      });

      const req2 = makeRequest(validBody) as unknown as Parameters<typeof POST>[0];
      const res2 = await POST(req2);
      const data2 = await res2.json();
      expect(data2.speak).toBe(true);
    });

    it('updates lastInterjectionTimestamp only when speak is true', async () => {
      expect(getLastInterjectionTimestamp()).toBe(0);

      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: JSON.stringify({ speak: false, message: '', reason: 'none' }) }],
      });

      const req = makeRequest(validBody) as unknown as Parameters<typeof POST>[0];
      await POST(req);

      expect(getLastInterjectionTimestamp()).toBe(0);
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
