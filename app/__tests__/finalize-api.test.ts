import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventType } from '@/lib/types';
import type { SessionEvent } from '@/lib/types';
import { MAX_KEYFRAMES } from '@/lib/constants';
import { selectKeyframes } from '@/lib/keyframes';

// --- Mock Anthropic SDK ---

const mockOn = vi.fn();
const mockFinalMessage = vi.fn();

const mockStream = vi.fn().mockReturnValue({
  on: mockOn,
  finalMessage: mockFinalMessage,
});

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { stream: mockStream };
  }
  return { default: MockAnthropic };
});

import { POST } from '@/app/api/finalize/route';

// --- Helpers ---

function makeEvent(type: EventType, timestamp_ms: number, payload: unknown = {}): SessionEvent {
  return { type, timestamp_ms, payload };
}

function makeRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost:3000/api/finalize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeValidBody(eventCount = 5) {
  const events: SessionEvent[] = [];
  for (let i = 0; i < eventCount; i++) {
    events.push(makeEvent(EventType.Frame, i * 1000, { frame: `data-${i}` }));
  }
  events.push(makeEvent(EventType.Transcript, 500, { text: 'hello' }));
  return { events, workflow_name: 'Test Workflow' };
}

async function readStream(response: Response): Promise<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let result = '';
  let done = false;
  while (!done) {
    const chunk = await reader.read();
    done = chunk.done;
    if (chunk.value) {
      result += decoder.decode(chunk.value, { stream: !done });
    }
  }
  return result;
}

// --- Tests ---

describe('/api/finalize', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    mockStream.mockClear();
    mockOn.mockClear();
    mockFinalMessage.mockClear();
    process.env = { ...originalEnv, ANTHROPIC_API_KEY: 'test-key-123' };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('missing API key', () => {
    it('returns 500 with clear error when ANTHROPIC_API_KEY is not set', async () => {
      delete process.env.ANTHROPIC_API_KEY;

      const req = makeRequest(makeValidBody()) as unknown as Parameters<typeof POST>[0];
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(500);
      expect(data.error).toContain('ANTHROPIC_API_KEY');
    });

    it('does not call Anthropic when API key is missing', async () => {
      delete process.env.ANTHROPIC_API_KEY;

      const req = makeRequest(makeValidBody()) as unknown as Parameters<typeof POST>[0];
      await POST(req);

      expect(mockStream).not.toHaveBeenCalled();
    });
  });

  describe('request validation', () => {
    it('returns 400 on invalid JSON body', async () => {
      const req = new Request('http://localhost:3000/api/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json',
      }) as unknown as Parameters<typeof POST>[0];

      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toBe('Invalid JSON body');
    });

    it('returns 400 when events array is missing', async () => {
      const req = makeRequest({ workflow_name: 'test' }) as unknown as Parameters<typeof POST>[0];
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toContain('events');
    });

    it('returns 400 when events array is empty', async () => {
      const req = makeRequest({ events: [], workflow_name: 'test' }) as unknown as Parameters<typeof POST>[0];
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toContain('events');
    });

    it('returns 400 when workflow_name is missing', async () => {
      const events = [makeEvent(EventType.Frame, 1000)];
      const req = makeRequest({ events }) as unknown as Parameters<typeof POST>[0];
      const res = await POST(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toContain('workflow_name');
    });
  });

  describe('streaming response', () => {
    it('returns a streaming response with workflow JSON', async () => {
      const workflowJson = JSON.stringify({
        name: 'Test Workflow',
        description: 'A test',
        steps: [],
        open_questions: [],
        summary: 'Test summary',
      });

      mockOn.mockImplementation((event: string, cb: (text: string) => void) => {
        if (event === 'text') {
          // Simulate streaming in chunks
          cb(workflowJson.slice(0, 20));
          cb(workflowJson.slice(20));
        }
      });
      mockFinalMessage.mockResolvedValue({
        content: [{ type: 'text', text: workflowJson }],
      });

      const req = makeRequest(makeValidBody()) as unknown as Parameters<typeof POST>[0];
      const res = await POST(req);

      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');

      const text = await readStream(res);
      expect(text).toBe(workflowJson);
    });

    it('passes correct model and system prompt to Claude', async () => {
      mockOn.mockImplementation(() => {});
      mockFinalMessage.mockResolvedValue({ content: [{ type: 'text', text: '{}' }] });

      const body = makeValidBody();
      const req = makeRequest(body) as unknown as Parameters<typeof POST>[0];
      await POST(req);

      expect(mockStream).toHaveBeenCalledOnce();
      const callArgs = mockStream.mock.calls[0][0];
      expect(callArgs.model).toBe('claude-sonnet-4-20250514');
      expect(callArgs.system).toContain('workflow documentation');
      expect(callArgs.messages[0].content).toContain('Test Workflow');
    });

    it('streams error message when Claude API fails', async () => {
      mockOn.mockImplementation(() => {});
      mockFinalMessage.mockRejectedValue(new Error('API timeout'));

      const req = makeRequest(makeValidBody()) as unknown as Parameters<typeof POST>[0];
      const res = await POST(req);
      const text = await readStream(res);

      expect(text).toContain('API timeout');
    });
  });
});

describe('selectKeyframes', () => {
  it('returns all events when frames <= MAX_KEYFRAMES', () => {
    const events: SessionEvent[] = [];
    for (let i = 0; i < 30; i++) {
      events.push(makeEvent(EventType.Frame, i * 1000));
    }
    events.push(makeEvent(EventType.Transcript, 500, { text: 'hi' }));

    const result = selectKeyframes(events);
    expect(result).toEqual(events);
  });

  it('returns exactly MAX_KEYFRAMES frames when there are more', () => {
    const events: SessionEvent[] = [];
    for (let i = 0; i < 200; i++) {
      events.push(makeEvent(EventType.Frame, i * 1000));
    }

    const result = selectKeyframes(events);
    const frameCount = result.filter((e) => e.type === EventType.Frame).length;
    expect(frameCount).toBe(MAX_KEYFRAMES);
  });

  it('preserves all non-frame events', () => {
    const events: SessionEvent[] = [];
    for (let i = 0; i < 200; i++) {
      events.push(makeEvent(EventType.Frame, i * 1000));
    }
    events.push(makeEvent(EventType.Transcript, 500, { text: 'hi' }));
    events.push(makeEvent(EventType.Interjection, 1500, { message: 'why?' }));

    const result = selectKeyframes(events);
    const transcripts = result.filter((e) => e.type === EventType.Transcript);
    const interjections = result.filter((e) => e.type === EventType.Interjection);
    expect(transcripts).toHaveLength(1);
    expect(interjections).toHaveLength(1);
  });

  it('maintains chronological order after sampling', () => {
    const events: SessionEvent[] = [];
    for (let i = 0; i < 200; i++) {
      events.push(makeEvent(EventType.Frame, i * 1000));
    }
    events.push(makeEvent(EventType.Transcript, 50000, { text: 'mid' }));

    const result = selectKeyframes(events);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].timestamp_ms).toBeGreaterThanOrEqual(result[i - 1].timestamp_ms);
    }
  });

  it('evenly samples from across the frame range', () => {
    const events: SessionEvent[] = [];
    for (let i = 0; i < 120; i++) {
      events.push(makeEvent(EventType.Frame, i * 1000));
    }

    const result = selectKeyframes(events);
    const frames = result.filter((e) => e.type === EventType.Frame);
    expect(frames).toHaveLength(MAX_KEYFRAMES);

    // First and last frames should be included
    expect(frames[0].timestamp_ms).toBe(0);
    expect(frames[frames.length - 1].timestamp_ms).toBe(118000); // floor((59) * 2) * 1000
  });
});
