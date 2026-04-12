import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useSpeechRecognition } from '@/lib/hooks/useSpeechRecognition';
import { useTTS } from '@/lib/hooks/useTTS';

// --- Mock WebSocket ---

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
  });

  // Test helper: simulate connection open
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  // Test helper: simulate message
  simulateMessage(data: object) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  // Test helper: simulate close
  simulateClose() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

// --- Mock SpeechSynthesis ---

let mockUtteranceInstance: {
  text: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
} | null = null;

function createMockUtterance(text: string) {
  const instance = {
    text,
    onstart: null as (() => void) | null,
    onend: null as (() => void) | null,
    onerror: null as ((event: { error: string }) => void) | null,
  };
  mockUtteranceInstance = instance;
  return instance;
}

// --- Tests ---

describe('useSpeechRecognition (Deepgram)', () => {
  let mockWs: MockWebSocket;

  beforeEach(() => {
    mockWs = new MockWebSocket();

    // Mock WebSocket constructor (must use function, not arrow, to be callable with new)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).WebSocket = function () { return mockWs; };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).WebSocket.OPEN = MockWebSocket.OPEN;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).WebSocket.CONNECTING = MockWebSocket.CONNECTING;

    // Mock AudioContext (must use function, not arrow, to be callable with new)
    const mockProcessor = {
      onaudioprocess: null as ((event: unknown) => void) | null,
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    const mockSource = {
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).AudioContext = function () {
      return {
        sampleRate: 16000,
        state: 'running',
        createMediaStreamSource: vi.fn(() => mockSource),
        createScriptProcessor: vi.fn(() => mockProcessor),
        destination: {},
        close: vi.fn().mockResolvedValue(undefined),
        suspend: vi.fn().mockResolvedValue(undefined),
        resume: vi.fn().mockResolvedValue(undefined),
      };
    };

    // Mock fetch for /api/deepgram-token
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ key: 'test-deepgram-key' }),
    });

    // Mock getUserMedia (fallback if no stream passed)
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: vi.fn(() => []),
          getAudioTracks: vi.fn(() => [{ stop: vi.fn() }]),
        }),
      },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('initializes with default state', () => {
    const { result } = renderHook(() => useSpeechRecognition());

    expect(result.current.isListening).toBe(false);
    expect(result.current.transcriptChunks).toEqual([]);
    expect(result.current.interimText).toBe('');
  });

  it('start() sets isListening and fetches token', async () => {
    const { result } = renderHook(() => useSpeechRecognition());

    await act(async () => {
      result.current.start();
      for (let i = 0; i < 10; i++) {
        await Promise.resolve();
      }
    });

    expect(globalThis.fetch).toHaveBeenCalledWith('/api/deepgram-token');
    expect(result.current.isListening).toBe(true);
  });

  it('produces final transcript chunks from Deepgram messages', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(5000);
    const { result } = renderHook(() => useSpeechRecognition());

    await act(async () => {
      result.current.start();
      await new Promise((r) => setTimeout(r, 10));
    });

    // Simulate WebSocket open and a final result
    act(() => {
      mockWs.simulateOpen();
    });

    act(() => {
      mockWs.simulateMessage({
        channel: { alternatives: [{ transcript: 'hello world' }] },
        is_final: true,
      });
    });

    expect(result.current.transcriptChunks).toHaveLength(1);
    expect(result.current.transcriptChunks[0]).toEqual({
      text: 'hello world',
      timestamp_ms: 5000,
      isFinal: true,
    });
    expect(result.current.interimText).toBe('');
  });

  it('returns interim results separately from final results', async () => {
    const { result } = renderHook(() => useSpeechRecognition());

    await act(async () => {
      result.current.start();
      await new Promise((r) => setTimeout(r, 10));
    });

    act(() => {
      mockWs.simulateOpen();
    });

    // Interim result
    act(() => {
      mockWs.simulateMessage({
        channel: { alternatives: [{ transcript: 'hel' }] },
        is_final: false,
      });
    });

    expect(result.current.interimText).toBe('hel');
    expect(result.current.transcriptChunks).toHaveLength(0);

    // Final result
    act(() => {
      mockWs.simulateMessage({
        channel: { alternatives: [{ transcript: 'hello' }] },
        is_final: true,
      });
    });

    expect(result.current.interimText).toBe('');
    expect(result.current.transcriptChunks).toHaveLength(1);
    expect(result.current.transcriptChunks[0].text).toBe('hello');
  });

  it('stop() cleans up and resets state', async () => {
    const { result } = renderHook(() => useSpeechRecognition());

    await act(async () => {
      result.current.start();
      await new Promise((r) => setTimeout(r, 10));
    });

    act(() => {
      mockWs.simulateOpen();
    });

    act(() => {
      result.current.stop();
    });

    expect(result.current.isListening).toBe(false);
    expect(result.current.interimText).toBe('');
  });

  it('pause() suspends audio, resume() restarts it', async () => {
    const { result } = renderHook(() => useSpeechRecognition());

    await act(async () => {
      result.current.start();
      await new Promise((r) => setTimeout(r, 10));
    });

    act(() => {
      mockWs.simulateOpen();
    });

    expect(result.current.isListening).toBe(true);

    act(() => {
      result.current.pause();
    });

    expect(result.current.isListening).toBe(false);

    act(() => {
      result.current.resume();
    });

    expect(result.current.isListening).toBe(true);
  });
});

describe('useTTS', () => {
  let mockSpeak: ReturnType<typeof vi.fn>;
  let mockCancel: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSpeak = vi.fn();
    mockCancel = vi.fn();
    mockUtteranceInstance = null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).SpeechSynthesisUtterance = createMockUtterance;

    Object.defineProperty(window, 'speechSynthesis', {
      value: {
        speak: mockSpeak,
        cancel: mockCancel,
      },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    mockUtteranceInstance = null;
  });

  it('initializes with isSpeaking false', () => {
    const { result } = renderHook(() => useTTS());
    expect(result.current.isSpeaking).toBe(false);
  });

  it('speak() calls SpeechSynthesis.speak with utterance', async () => {
    const { result } = renderHook(() => useTTS());

    let speakPromise: Promise<void>;
    act(() => {
      speakPromise = result.current.speak('test message');
    });

    expect(mockSpeak).toHaveBeenCalled();
    expect(mockUtteranceInstance?.text).toBe('test message');

    // Simulate speech completing
    await act(async () => {
      mockUtteranceInstance?.onend?.();
      await speakPromise!;
    });

    expect(result.current.isSpeaking).toBe(false);
  });

  it('sets isSpeaking true during playback', async () => {
    const { result } = renderHook(() => useTTS());

    let speakPromise: Promise<void>;
    act(() => {
      speakPromise = result.current.speak('hello');
    });

    // Simulate onstart
    act(() => {
      mockUtteranceInstance?.onstart?.();
    });

    expect(result.current.isSpeaking).toBe(true);

    // Complete
    await act(async () => {
      mockUtteranceInstance?.onend?.();
      await speakPromise!;
    });

    expect(result.current.isSpeaking).toBe(false);
  });

  it('fires onSpeakStart and onSpeakEnd callbacks', async () => {
    const onSpeakStart = vi.fn();
    const onSpeakEnd = vi.fn();

    const { result } = renderHook(() => useTTS({ onSpeakStart, onSpeakEnd }));

    let speakPromise: Promise<void>;
    act(() => {
      speakPromise = result.current.speak('callback test');
    });

    // Fire onstart
    act(() => {
      mockUtteranceInstance?.onstart?.();
    });

    expect(onSpeakStart).toHaveBeenCalledTimes(1);
    expect(onSpeakEnd).not.toHaveBeenCalled();

    // Fire onend
    await act(async () => {
      mockUtteranceInstance?.onend?.();
      await speakPromise!;
    });

    expect(onSpeakEnd).toHaveBeenCalledTimes(1);
  });

  it('cancels ongoing speech before starting new one', () => {
    const { result } = renderHook(() => useTTS());

    act(() => {
      result.current.speak('first');
    });

    // cancel should have been called before speaking
    expect(mockCancel).toHaveBeenCalled();
  });

  it('cancel() stops ongoing speech', () => {
    const { result } = renderHook(() => useTTS());

    act(() => {
      result.current.cancel();
    });

    expect(mockCancel).toHaveBeenCalled();
    expect(result.current.isSpeaking).toBe(false);
  });
});
