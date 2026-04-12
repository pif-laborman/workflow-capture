import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mock Anthropic SDK ---
const mockCreate = vi.fn();
const mockStream = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { create: mockCreate, stream: mockStream };
  }
  return { default: MockAnthropic };
});

import { POST as observePOST } from '@/app/api/observe/route';
import { POST as finalizePOST } from '@/app/api/finalize/route';
import { resetCooldown } from '@/lib/cooldown';

function makeObserveRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost:3000/api/observe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeFinalizeRequest(body: Record<string, unknown>): Request {
  return new Request('http://localhost:3000/api/finalize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validObserveBody = {
  frame: 'dGVzdA==',
  transcript_window: 'User clicked settings.',
  seconds_since_last_interjection: 25,
};

const validFinalizeBody = {
  events: [
    { type: 'transcript', timestamp_ms: 1000, text: 'Hello', isFinal: true },
  ],
  workflow_name: 'Test Workflow',
};

describe('Graceful degradation — API key missing', () => {
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    resetCooldown();
    mockCreate.mockReset();
    mockStream.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('/api/observe returns {speak: false} when API key is missing', async () => {
    const response = await observePOST(makeObserveRequest(validObserveBody) as never);
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.speak).toBe(false);
    expect(data.message).toBe('');
  });

  it('/api/finalize returns clear error when API key is missing', async () => {
    const response = await finalizePOST(makeFinalizeRequest(validFinalizeBody) as never);
    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toContain('ANTHROPIC_API_KEY');
  });
});

describe('API key not exposed in responses', () => {
  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-secret-key-12345';
    resetCooldown();
    mockCreate.mockReset();
    mockStream.mockReset();
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    vi.restoreAllMocks();
  });

  it('/api/observe does not expose API key in response body', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ speak: true, message: 'What are you doing?', reason: 'missing_why' }) }],
    });

    const response = await observePOST(makeObserveRequest(validObserveBody) as never);
    const text = JSON.stringify(await response.json());
    expect(text).not.toContain('sk-ant-test-secret-key-12345');
    expect(text).not.toContain('ANTHROPIC_API_KEY');
  });

  it('/api/observe error response does not expose API key', async () => {
    mockCreate.mockRejectedValue(new Error('API failure'));

    const response = await observePOST(makeObserveRequest(validObserveBody) as never);
    const text = JSON.stringify(await response.json());
    expect(text).not.toContain('sk-ant-test-secret-key-12345');
  });

  it('/api/finalize error response does not expose API key', async () => {
    const streamObj = {
      on: vi.fn().mockReturnThis(),
      finalMessage: vi.fn().mockRejectedValue(new Error('Stream failed')),
    };
    mockStream.mockReturnValue(streamObj);

    const response = await finalizePOST(makeFinalizeRequest(validFinalizeBody) as never);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let accumulated = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      accumulated += decoder.decode(value, { stream: true });
    }
    expect(accumulated).not.toContain('sk-ant-test-secret-key-12345');
  });
});
