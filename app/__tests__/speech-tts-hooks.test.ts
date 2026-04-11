import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useSpeechRecognition } from '@/lib/hooks/useSpeechRecognition';
import { useTTS } from '@/lib/hooks/useTTS';

// --- Mock SpeechRecognition ---

class MockSpeechRecognition {
  continuous = false;
  interimResults = false;
  lang = '';
  onresult: ((event: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  start = vi.fn();
  stop = vi.fn();
  abort = vi.fn();
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

describe('useSpeechRecognition', () => {
  let mockRecognition: MockSpeechRecognition;

  beforeEach(() => {
    mockRecognition = new MockSpeechRecognition();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).SpeechRecognition = function () {
      return mockRecognition;
    };
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).SpeechRecognition;
  });

  it('initializes with default state', () => {
    const { result } = renderHook(() => useSpeechRecognition());

    expect(result.current.isListening).toBe(false);
    expect(result.current.transcriptChunks).toEqual([]);
    expect(result.current.interimText).toBe('');
  });

  it('start() enables continuous + interimResults mode', () => {
    const { result } = renderHook(() => useSpeechRecognition());

    act(() => {
      result.current.start();
    });

    expect(mockRecognition.continuous).toBe(true);
    expect(mockRecognition.interimResults).toBe(true);
    expect(mockRecognition.start).toHaveBeenCalled();
    expect(result.current.isListening).toBe(true);
  });

  it('produces transcript chunks with text, timestamp_ms, isFinal from final results', () => {
    vi.spyOn(Date, 'now').mockReturnValue(5000);

    const { result } = renderHook(() => useSpeechRecognition());

    act(() => {
      result.current.start();
    });

    // Simulate a final result
    act(() => {
      mockRecognition.onresult?.({
        resultIndex: 0,
        results: {
          length: 1,
          0: { 0: { transcript: 'hello world' }, isFinal: true, length: 1 },
        },
      });
    });

    expect(result.current.transcriptChunks).toHaveLength(1);
    expect(result.current.transcriptChunks[0]).toEqual({
      text: 'hello world',
      timestamp_ms: 5000,
      isFinal: true,
    });
  });

  it('returns interim results separately from final results', () => {
    const { result } = renderHook(() => useSpeechRecognition());

    act(() => {
      result.current.start();
    });

    // Simulate an interim result
    act(() => {
      mockRecognition.onresult?.({
        resultIndex: 0,
        results: {
          length: 1,
          0: { 0: { transcript: 'hel' }, isFinal: false, length: 1 },
        },
      });
    });

    expect(result.current.interimText).toBe('hel');
    expect(result.current.transcriptChunks).toHaveLength(0);

    // Now simulate the final version
    act(() => {
      mockRecognition.onresult?.({
        resultIndex: 0,
        results: {
          length: 1,
          0: { 0: { transcript: 'hello' }, isFinal: true, length: 1 },
        },
      });
    });

    expect(result.current.interimText).toBe('');
    expect(result.current.transcriptChunks).toHaveLength(1);
    expect(result.current.transcriptChunks[0].text).toBe('hello');
  });

  it('pause() stops recognition, resume() restarts it', () => {
    const { result } = renderHook(() => useSpeechRecognition());

    act(() => {
      result.current.start();
    });

    expect(result.current.isListening).toBe(true);

    act(() => {
      result.current.pause();
    });

    expect(mockRecognition.stop).toHaveBeenCalled();
    expect(result.current.isListening).toBe(false);

    // Reset to check resume calls start again
    mockRecognition.start.mockClear();

    act(() => {
      result.current.resume();
    });

    expect(mockRecognition.start).toHaveBeenCalled();
    expect(result.current.isListening).toBe(true);
  });

  it('auto-restarts on end event if still active', () => {
    const { result } = renderHook(() => useSpeechRecognition());

    act(() => {
      result.current.start();
    });

    // Clear call count from initial start
    mockRecognition.start.mockClear();

    // Simulate recognition ending unexpectedly
    act(() => {
      mockRecognition.onend?.();
    });

    // Should have auto-restarted
    expect(mockRecognition.start).toHaveBeenCalled();
    expect(result.current.isListening).toBe(true);
  });

  it('does not restart on end event after stop()', () => {
    const { result } = renderHook(() => useSpeechRecognition());

    act(() => {
      result.current.start();
    });

    act(() => {
      result.current.stop();
    });

    mockRecognition.start.mockClear();

    // Simulate end event after stop
    act(() => {
      mockRecognition.onend?.();
    });

    // Should NOT restart
    expect(mockRecognition.start).not.toHaveBeenCalled();
    expect(result.current.isListening).toBe(false);
  });

  it('stop() clears recognition and resets state', () => {
    const { result } = renderHook(() => useSpeechRecognition());

    act(() => {
      result.current.start();
    });

    act(() => {
      result.current.stop();
    });

    expect(mockRecognition.stop).toHaveBeenCalled();
    expect(result.current.isListening).toBe(false);
    expect(result.current.interimText).toBe('');
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
